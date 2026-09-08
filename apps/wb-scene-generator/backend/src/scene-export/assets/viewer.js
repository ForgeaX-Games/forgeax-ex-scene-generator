(function() {
'use strict';
const TILE_PIXEL = 16;
const STATE = {
  terrain: null,
  terrainConfig: null,
  objectConfig: null,
  terrainTsj: null,
  objectTsj: null,
  terrainAtlas: null,
  objectAtlas: null,
  worldW: 0, worldH: 0,
  tx: 0, ty: 0, scale: 1,
  canvas: null, ctx: null,
  overlayCanvas: null, overlayCtx: null,
  mode: 'cell',
  selected: null,
  gfxBuffer: null,
  highlight: null,        // null（全部）| number（数字 elev）| 'transition'（坡）
  hasTransition: false,
  transitionCells: [],
  // area-tag highlight
  areaHighlight: null,    // { name: string, coords: Set<"x,y"> } | null
  areaTree: [],           // AreaTagNode[]
  // collision overlay
  collisionCells: new Set(), // Set<"x,y"> of cells occupied by object colliders
  showCollision: false,
  // sampled typical points
  sampledPoints: [],   // { x, y, label }[]  — accumulated across sessions
  sampleSource: null,  // name of the area last sampled from
};
const $ = id => document.getElementById(id);

async function loadJson(path) { const r = await fetch(path); if (!r.ok) throw new Error(path + ' HTTP ' + r.status); return r.json(); }
async function loadImage(path) { return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = path; }); }

async function boot() {
  const hud = $('hud'); hud.textContent = '加载配置…';
  // file:// 下 fetch 会被同源策略拦住，提示用户走启动器
  if (location.protocol === 'file:') {
    hud.textContent = '⚠ 当前用 file:// 打开，浏览器禁止读取同目录文件。请双击启动器脚本（Windows: serve.bat；macOS/Linux: serve.sh 或 python3 serve.py），脚本会自动选一个可用端口并在浏览器打开。';
    return;
  }
  try {
    STATE.terrain       = await loadJson('./terrain.json');
    STATE.terrainConfig = await loadJson('./terrain-config.json');
    STATE.objectConfig  = await loadJson('./object-type-config.json');
    STATE.terrainTsj    = await loadJson('./terrain_atlas.tsj');
    STATE.objectTsj     = await loadJson('./object_atlas.tsj');
    hud.textContent = '加载贴图…';
    STATE.terrainAtlas  = await loadImage('./terrain_atlas.png');
    STATE.objectAtlas   = await loadImage('./object_atlas.png');
    // 修订 9.2：terrain.json.cells 是分组扁平结构 —— { "<group>": MapCell[] }
    //   group key 当前用「数字高度」+「特殊 'transition'」，每组直接是 1D cell 数组
    //   （不再做 worldH 长度的稀疏 2D 包裹）。组内 cell 自带 height/slope 等固有属性。
    // 同时兼容策划文档（terrain-design.md §二 originalMap）的 cells: MapCell[y][x] 2D 形态作退路。
    STATE.cellsByGroup = {};       // group key → MapCell[]；key: number elev OR 'transition'
    STATE.cellsByXY = new Map();   // "x,y" → [{ group, cell }, ...]（数字 elev 升序，最后是 transition）
    STATE.flatCells = [];
    STATE.transitionCells = [];    // 坡 cell 单列一份，方便 filter / 渲染顺序
    STATE.hasTransition = false;
    const cellsField = STATE.terrain.cells;
    const isGroupedCells = cellsField && typeof cellsField === 'object' && !Array.isArray(cellsField);
    if (isGroupedCells) {
      // 数字 elev 升序；非数字 key（如 'transition'）作为单独通道
      const allKeys = Object.keys(cellsField);
      const numKeys = allKeys.filter(k => !Number.isNaN(Number(k))).sort((a, b) => Number(a) - Number(b));
      const otherKeys = allKeys.filter(k => Number.isNaN(Number(k))).sort();
      STATE.elevations = numKeys.map(Number);
      // 数字层
      for (const elev of STATE.elevations) {
        const list = cellsField[String(elev)];
        const flat = Array.isArray(list) ? list : [];
        STATE.cellsByGroup[elev] = flat;
        for (const c of flat) {
          const key = c.x + ',' + c.y;
          if (!STATE.cellsByXY.has(key)) STATE.cellsByXY.set(key, []);
          STATE.cellsByXY.get(key).push({ group: elev, cell: c });
          STATE.flatCells.push(Object.assign({ height: elev }, c));
        }
      }
      // 过渡层（坡）：cell 自带 slope 子结构，独立通道
      if (otherKeys.includes('transition')) {
        STATE.hasTransition = true;
        const list = cellsField['transition'];
        const flat = Array.isArray(list) ? list : [];
        STATE.cellsByGroup['transition'] = flat;
        STATE.transitionCells = flat;
        for (const c of flat) {
          const key = c.x + ',' + c.y;
          if (!STATE.cellsByXY.has(key)) STATE.cellsByXY.set(key, []);
          STATE.cellsByXY.get(key).push({ group: 'transition', cell: c });
        }
      }
    } else if (Array.isArray(cellsField)) {
      // Legacy 兼容：策划 terrain-design.md §二 cells: MapCell[y][x] 单一 2D 数组形态
      const flat = Array.isArray(cellsField[0]) ? cellsField.flat() : cellsField;
      const elevSet = new Set();
      for (const c of flat) {
        const elev = Number.isFinite(c.height) ? c.height : 0;
        elevSet.add(elev);
        if (!STATE.cellsByGroup[elev]) STATE.cellsByGroup[elev] = [];
        STATE.cellsByGroup[elev].push(c);
        const key = c.x + ',' + c.y;
        if (!STATE.cellsByXY.has(key)) STATE.cellsByXY.set(key, []);
        STATE.cellsByXY.get(key).push({ group: elev, cell: c });
        STATE.flatCells.push(c);
      }
      STATE.elevations = [...elevSet].sort((a, b) => a - b);
    } else {
      STATE.elevations = [];
    }
    // 同一格子内按 group 升序（底→顶；transition 排到最后），用于绘制层叠和信息面板的 tab 顺序
    const _groupOrder = (g) => (g === 'transition' ? Number.POSITIVE_INFINITY : g);
    for (const arr of STATE.cellsByXY.values()) arr.sort((a, b) => _groupOrder(a.group) - _groupOrder(b.group));
    // 修订 10：pickup 玩法元数据已合入 ObjectType.pickup，不再单独从 items/<id>.json 拉取
    indexConfigs();
    computeBounds();
    prepareCanvas();
    buildElevButtons();
    await bakeSceneBuffer();
    registerEvents();
    fitToView();
    draw();
    bakeCollisionCells();
    buildAreaTreeUI();
    const elevSum = STATE.elevations.map(e => 'e' + e + '=' + (STATE.cellsByGroup[e]?.length || 0))
      .concat(STATE.hasTransition ? ['transition=' + STATE.transitionCells.length] : []).join(' ');
    hud.textContent = 'cells=' + STATE.flatCells.length + ' (' + elevSum + ')  objects=' + STATE.terrain.objects.length + '  world=' + STATE.worldW + '×' + STATE.worldH;
  } catch (e) {
    hud.textContent = '加载失败：' + e.message;
    console.error(e);
  }
}

// 在 #elev-buttons 容器里按数据动态插入 e0/e1/e2/... 按钮；过渡层按钮已在 HTML 里固定。
// 当数据没有过渡层时，隐藏 elev-T 按钮。
function buildElevButtons() {
  const host = $('elev-buttons');
  if (!host) return;
  host.innerHTML = '';
  for (const e of STATE.elevations) {
    const btn = document.createElement('button');
    btn.className = 'elev-btn';
    btn.id = 'elev-' + e;
    btn.textContent = 'E' + e;
    btn.title = '只亮 elevation=' + e + '，其他层半透明';
    btn.addEventListener('click', () => setHighlight(e));
    host.appendChild(btn);
  }
  const tBtn = $('elev-T');
  if (tBtn) tBtn.style.display = STATE.hasTransition ? '' : 'none';
}

function setHighlight(mode) {
  STATE.highlight = mode; // null | number | 'transition'
  const ids = ['elev-all', 'elev-T', ...STATE.elevations.map(e => 'elev-' + e)];
  for (const id of ids) { const el = $(id); if (el) el.classList.remove('elev-active'); }
  const activeId = mode === null ? 'elev-all' : mode === 'transition' ? 'elev-T' : 'elev-' + mode;
  const activeEl = $(activeId);
  if (activeEl) activeEl.classList.add('elev-active');
  // 重新烘焙以应用 alpha 蒙版
  bakeSceneBuffer().then(draw);
}

// 把 tsj.tiles 转成 Map（id → tile 元数据）；object-type-config 的 types 是 dict
function indexConfigs() {
  STATE.terrainTileById = new Map();
  for (const t of STATE.terrainTsj.tiles) STATE.terrainTileById.set(t.id, t);
  STATE.objectTileById = new Map();
  for (const t of STATE.objectTsj.tiles) STATE.objectTileById.set(t.id, t);
  STATE.objectTypeById = new Map();
  const types = STATE.objectConfig.types || {};
  for (const [tid, o] of Object.entries(types)) {
    STATE.objectTypeById.set(tid, { typeId: tid, ...o });
  }
}

function computeBounds() {
  // terrain.json 顶层带 cols/rows 时直接用；否则从 cells/objects 反推
  let W = STATE.terrain.cols | 0;
  let H = STATE.terrain.rows | 0;
  if (!W || !H) {
    for (const c of STATE.flatCells) { if (c.x + 1 > W) W = c.x + 1; if (c.y + 1 > H) H = c.y + 1; }
    for (const o of STATE.terrain.objects) { if (o.x + 1 > W) W = o.x + 1; if (o.y + 1 > H) H = o.y + 1; }
  }
  STATE.worldW = W; STATE.worldH = H;
}

function prepareCanvas() {
  const c = STATE.canvas = $('canvas');
  c.width  = STATE.worldW * TILE_PIXEL;
  c.height = STATE.worldH * TILE_PIXEL;
  STATE.ctx = c.getContext('2d');
  STATE.ctx.imageSmoothingEnabled = false;

  const oc = STATE.overlayCanvas = $('overlay-canvas');
  oc.width  = c.width;
  oc.height = c.height;
  STATE.overlayCtx = oc.getContext('2d');
  STATE.overlayCtx.imageSmoothingEnabled = false;
}

// pivot y 可能 > 1（如 1.2），用取小数解读为"近底部"
function pivotTopOffsetRatio(pvy) {
  const py = (pvy > 1) ? (pvy - Math.floor(pvy)) : pvy;
  return 1 - py;
}

// v3: interaction 可能是字符串或 { type, range } 对象，统一取字符串
function getInteractionType(typeDef) {
  const v = typeDef && typeDef.interaction;
  if (typeof v === 'string') return v;
  if (v && typeof v.type === 'string') return v.type;
  return typeDef && typeDef.interactionLegacy || 'none';
}

// 绘制一格内的一层 tile
function drawTerrainTile(ctx, tile, worldX, worldY) {
  const px = tile.pivot || { x: 0.5, y: 0.5 };
  const anchorX = (worldX + 0.5) * TILE_PIXEL;
  const anchorY = (worldY + 0.5) * TILE_PIXEL;
  // 地形 PPU=16，资产缩放=1（tile 原生 16px = 1 cell）
  const dw = tile.width, dh = tile.height;
  const imgX = anchorX - px.x * dw;
  const imgY = anchorY - pivotTopOffsetRatio(px.y) * dh;
  ctx.drawImage(STATE.terrainAtlas, tile.x, tile.y, tile.width, tile.height, imgX, imgY, dw, dh);
}

function drawObjectSprite(ctx, typeDef, tile, obj) {
  // PPU by category：pickup=32，其它=16
  const ppu = typeDef.interaction === 'pickup' ? 32 : 16;
  const scale = TILE_PIXEL / ppu;
  const px = tile.pivot || { x: 0.5, y: 0.5 };
  const anchorX = (obj.x + 0.5) * TILE_PIXEL;
  const anchorY = (obj.y + 0.5) * TILE_PIXEL;
  const dw = tile.width  * scale;
  const dh = tile.height * scale;
  const imgX = anchorX - px.x * dw;
  const imgY = anchorY - pivotTopOffsetRatio(px.y) * dh;
  ctx.drawImage(STATE.objectAtlas, tile.x, tile.y, tile.width, tile.height, imgX, imgY, dw, dh);
}

// 预烘焙场景到离屏 canvas（性能）；后续 draw() 每帧只做背景 blit + 高亮
// 修订 9：渲染顺序在数字层升序基础上，把过渡层（坡）插在 elevationHigh 这一档之后
//         （视觉上和高端那侧的 ground 同高），这样坡才能盖在低端的草上、不被高端的 cliff 盖住。
async function bakeSceneBuffer() {
  const buf = document.createElement('canvas');
  buf.width  = STATE.worldW * TILE_PIXEL;
  buf.height = STATE.worldH * TILE_PIXEL;
  const bx = buf.getContext('2d');
  bx.imageSmoothingEnabled = false;

  const tpls = STATE.terrainConfig.templates;
  const hl = STATE.highlight;

  // 高亮模式下，被淡化的层用 0.2 alpha，活跃层用 1.0
  function alphaFor(layerKey /* number | 'transition' | 'object' */) {
    if (hl === null || hl === undefined) return 1.0;
    if (hl === 'transition' && layerKey === 'transition') return 1.0;
    if (typeof hl === 'number'  && layerKey === hl)        return 1.0;
    // object 在任何 elev 高亮模式下都淡化（除非未设置高亮）
    return 0.2;
  }

  // 把过渡层 cell 按 elevationHigh 分桶，便于按"低→高"插队渲染
  const slopeByEH = new Map(); // elevHigh → [cells]
  for (const c of STATE.transitionCells || []) {
    const eh = c.slope?.elevationHigh ?? STATE.elevations[STATE.elevations.length - 1];
    if (!slopeByEH.has(eh)) slopeByEH.set(eh, []);
    slopeByEH.get(eh).push(c);
  }

  function drawCellList(cells, layerKey) {
    bx.globalAlpha = alphaFor(layerKey);
    for (const cell of cells) {
      for (let li = 0; li < cell.template_id.length; li++) {
        const tid = cell.template_id[li];
        const gix = cell.graphic_index[li];
        const tpl = tpls[tid]; if (!tpl || !tpl.graphic_id) continue;
        const tileId = tpl.graphic_id[gix];
        if (tileId == null) continue;
        const tile = STATE.terrainTileById.get(tileId); if (!tile) continue;
        drawTerrainTile(bx, tile, cell.x, cell.y);
      }
    }
    bx.globalAlpha = 1.0;
  }

  // 1) 数字层按 elevation 升序绘制；坡 cell 在其 elevationHigh 这档绘完后插队上场
  for (const elev of STATE.elevations) {
    drawCellList(STATE.cellsByGroup[elev] || [], elev);
    if (slopeByEH.has(elev)) drawCellList(slopeByEH.get(elev), 'transition');
  }
  // 2) 兜底：如果某个坡的 elevationHigh 不在数字层里（理论上不会），最后再画一次
  for (const [eh, cells] of slopeByEH) {
    if (!STATE.elevations.includes(eh)) drawCellList(cells, 'transition');
  }

  // 3) 对象按 terrain.json.objects[] 顺序绘制（数组顺序即叠放顺序）
  bx.globalAlpha = alphaFor('object');
  for (const obj of STATE.terrain.objects) {
    const typeDef = STATE.objectTypeById.get(obj.typeId); if (!typeDef) continue;
    if (typeof typeDef.graphic !== 'number') continue;
    const tile = STATE.objectTileById.get(typeDef.graphic); if (!tile) continue;
    drawObjectSprite(bx, typeDef, tile, obj);
  }
  bx.globalAlpha = 1.0;

  STATE.gfxBuffer = buf;
}

function draw() {
  const ctx = STATE.ctx;
  ctx.clearRect(0, 0, STATE.canvas.width, STATE.canvas.height);
  ctx.drawImage(STATE.gfxBuffer, 0, 0);
  // 高亮选中
  if (STATE.selected) drawSelection(ctx, STATE.selected);
}

// 归一化坐标（原点图像左下，y↑）下点是否在 collider 内；rect 为 [x1,y1,x2,y2]，
// polygon 为 [[x,y], ...]，都是 TSJ collider 的序列化格式
function pointInCollider(nx, ny, col) {
  if (!col || col.type === 'none') return false;
  if (col.type === 'rect' && Array.isArray(col.rect)) {
    const [x1, y1, x2, y2] = col.rect;
    return nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2;
  }
  if (col.type === 'polygon' && Array.isArray(col.points)) {
    let inside = false;
    const pts = col.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > ny) !== (yj > ny)) && (nx < (xj - xi) * (ny - yi) / (yj - yi) + xi))
        inside = !inside;
    }
    return inside;
  }
  return false;
}

function drawSelection(ctx, sel) {
  ctx.save();
  if (sel.type === 'cell') {
    ctx.strokeStyle = '#ffd640';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(sel.x * TILE_PIXEL + 0.5, sel.y * TILE_PIXEL + 0.5, TILE_PIXEL - 1, TILE_PIXEL - 1);
    ctx.restore();
    return;
  }
  if (sel.type !== 'object') { ctx.restore(); return; }

  // ── 对象选中叠加层（与主页 drawObjectSelection 一致） ─────────────────────
  const obj = sel.obj;
  const typeDef = STATE.objectTypeById.get(obj.typeId);
  if (!typeDef) { ctx.restore(); return; }
  const tile = STATE.objectTileById.get(typeDef.graphic);
  if (!tile) { ctx.restore(); return; }

  // 与 drawObjectSprite 完全一致的几何：pickup PPU=32，其它 PPU=16
  const ppu     = typeDef.interaction === 'pickup' ? 32 : 16;
  const scale   = TILE_PIXEL / ppu;
  const pivot   = tile.pivot || { x: 0.5, y: 0.5 };
  const dw      = tile.width  * scale;
  const dh      = tile.height * scale;
  const anchorX = (obj.x + 0.5) * TILE_PIXEL;
  const anchorY = (obj.y + 0.5) * TILE_PIXEL;
  const imgX    = anchorX - pivot.x * dw;
  const imgY    = anchorY - pivotTopOffsetRatio(pivot.y) * dh;

  // 图像覆盖的格子范围
  const colMin = Math.floor(imgX / TILE_PIXEL);
  const colMax = Math.floor((imgX + dw - 1) / TILE_PIXEL);
  const rowMin = Math.floor(imgY / TILE_PIXEL);
  const rowMax = Math.floor((imgY + dh - 1) / TILE_PIXEL);

  // 归一化 → canvas 坐标：y↑，原点在图像左下
  const toCanvasX = nx => imgX + nx * dw;
  const toCanvasY = ny => imgY + dh - ny * dh;

  // 1. 贴图占格高亮（浅黄填充）
  ctx.fillStyle = 'rgba(255,200,50,0.20)';
  for (let r = rowMin; r <= rowMax; r++)
    for (let c = colMin; c <= colMax; c++)
      ctx.fillRect(c * TILE_PIXEL, r * TILE_PIXEL, TILE_PIXEL, TILE_PIXEL);

  // 2. 贴图实际绘制范围（黄色实线）
  ctx.strokeStyle = '#ffd640';
  ctx.lineWidth   = 2;
  ctx.strokeRect(imgX + 1, imgY + 1, dw - 2, dh - 2);

  // 3. 锚点格子标记（深黄半透明）
  ctx.fillStyle = 'rgba(255,214,64,0.50)';
  ctx.fillRect(obj.x * TILE_PIXEL, obj.y * TILE_PIXEL, TILE_PIXEL, TILE_PIXEL);

  // 4+5. 碰撞：烘焙网格（红色填充）+ 轮廓线（橙色虚线）
  const collider = tile.collider;
  if (collider && collider.type !== 'none') {
    ctx.fillStyle = 'rgba(255,80,80,0.40)';
    for (let r = rowMin; r <= rowMax; r++) {
      for (let c = colMin; c <= colMax; c++) {
        const nx = ((c + 0.5) * TILE_PIXEL - imgX) / dw;
        const ny = 1 - ((r + 0.5) * TILE_PIXEL - imgY) / dh;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        if (pointInCollider(nx, ny, collider))
          ctx.fillRect(c * TILE_PIXEL, r * TILE_PIXEL, TILE_PIXEL, TILE_PIXEL);
      }
    }
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    if (collider.type === 'rect' && Array.isArray(collider.rect)) {
      const [x1, y1, x2, y2] = collider.rect;
      ctx.rect(toCanvasX(x1), toCanvasY(y2), (x2 - x1) * dw, (y2 - y1) * dh);
    } else if (collider.type === 'polygon' && Array.isArray(collider.points) && collider.points.length > 0) {
      ctx.moveTo(toCanvasX(collider.points[0][0]), toCanvasY(collider.points[0][1]));
      for (let k = 1; k < collider.points.length; k++)
        ctx.lineTo(toCanvasX(collider.points[k][0]), toCanvasY(collider.points[k][1]));
      ctx.closePath();
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.restore();
}

function applyCamera() {
  const c = STATE.canvas;
  c.style.left = STATE.tx + 'px';
  c.style.top  = STATE.ty + 'px';
  c.style.transform = 'scale(' + STATE.scale + ')';
  c.style.transformOrigin = '0 0';
  applyOverlayCamera();
}

function fitToView() {
  const wrap = $('map-wrap');
  const rect = wrap.getBoundingClientRect();
  const pad = 40;
  const sx = (rect.width - pad) / STATE.canvas.width;
  const sy = (rect.height - pad) / STATE.canvas.height;
  STATE.scale = Math.max(0.05, Math.min(sx, sy));
  STATE.tx = (rect.width - STATE.canvas.width * STATE.scale) / 2;
  STATE.ty = (rect.height - STATE.canvas.height * STATE.scale) / 2;
  applyCamera();
}
function oneToOne() { STATE.scale = 1; STATE.tx = 20; STATE.ty = 20; applyCamera(); }

function screenToCell(e) {
  const wrap = $('map-wrap');
  const rect = wrap.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const cx = (mx - STATE.tx) / STATE.scale;
  const cy = (my - STATE.ty) / STATE.scale;
  const col = Math.floor(cx / TILE_PIXEL);
  const row = Math.floor(cy / TILE_PIXEL);
  return { col, row, cx, cy };
}

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function showCellInfo(x, y) {
  const info = $('info');
  // 一格可能在多个 elevation 同时有 cell（桥+水），按 elev 升序枚举为标签页；过渡层（坡）单独 tab
  const stack = STATE.cellsByXY.get(x + ',' + y) || [];
  let html = '<h2>📌 Cell (' + x + ', ' + y + ')</h2>';
  if (!stack.length) { info.innerHTML = html + '<div class="sub">该格在所有 elevation 上都无 terrain 数据（空）</div>'; return; }
  const tabLabel = (s) => {
    if (s.group === 'transition') {
      const ramp = s.cell.slope || {};
      const dir = (ramp.direction || '').toUpperCase();
      return '坡' + (dir ? ' ' + dir : '') + ' E' + ramp.elevationLow + '→E' + ramp.elevationHigh;
    }
    return 'E' + s.group;
  };
  html += '<div class="sub">x=' + x + ' · y=' + y + ' · 命中 ' + stack.length + ' 个层</div>';
  if (stack.length > 1) {
    const tabId = 'cell_' + x + '_' + y + '_' + Date.now();
    html += '<div style="margin:8px 0 10px;display:flex;gap:6px;flex-wrap:wrap;">';
    stack.forEach((s, i) => {
      html += '<button class="cell-tab" data-tab="' + tabId + '_' + i + '" style="padding:3px 10px;border-radius:4px;border:1px solid var(--border);background:' + (i === 0 ? 'var(--accent)' : 'var(--bg-3)') + ';color:' + (i === 0 ? '#000' : 'var(--fg)') + ';cursor:pointer;font-size:11px;">' + escHtml(tabLabel(s)) + '</button>';
    });
    html += '</div>';
    stack.forEach((s, i) => {
      html += '<div class="cell-panel" id="' + tabId + '_' + i + '" style="display:' + (i === 0 ? 'block' : 'none') + '">';
      html += s.group === 'transition' ? renderSlopeCellPanel(s.cell) : renderCellPanel(s.cell, s.group);
      html += '</div>';
    });
    info.innerHTML = html;
    info.querySelectorAll('.cell-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-tab');
        info.querySelectorAll('.cell-tab').forEach(b => {
          const on = b === btn;
          b.style.background = on ? 'var(--accent)' : 'var(--bg-3)';
          b.style.color = on ? '#000' : 'var(--fg)';
        });
        info.querySelectorAll('.cell-panel').forEach(p => { p.style.display = (p.id === id) ? 'block' : 'none'; });
      });
    });
  } else {
    html += stack[0].group === 'transition' ? renderSlopeCellPanel(stack[0].cell) : renderCellPanel(stack[0].cell, stack[0].group);
    info.innerHTML = html;
  }
}

function renderSlopeCellPanel(cell) {
  const slope = cell.slope || {};
  const DIR_NAME = { ns: '低N→高S', sn: '低S→高N', ew: '低E→高W', we: '低W→高E' };
  const dirLabel = DIR_NAME[slope.direction] || (slope.direction || '—');
  let html = '<div style="background:#3a2a4a;border-left:3px solid #b07acc;padding:8px 10px;margin-bottom:10px;border-radius:3px;font-size:11.5px;color:#e3cffb;">'
           + '<b>过渡层（slope）</b> · 该 cell 不属于任一 elevation，是连接 E' + slope.elevationLow
           + '↔E' + slope.elevationHigh + ' 的坡面（' + escHtml(dirLabel) + '）。</div>';
  html += '<div class="field-group"><h4>新格式 Cell 属性（slope）</h4><table>';
  html += '<tr><th>x</th><td><code>' + cell.x + '</code></td></tr>';
  html += '<tr><th>y</th><td><code>' + cell.y + '</code></td></tr>';
  // 修订 9.1：transition cell 也带 height 字段（== elevationHigh，与渲染顺序一致）
  if (cell.height !== undefined) {
    html += '<tr><th>height</th><td><code>' + cell.height + '</code><span style="font-size:10px;color:var(--muted);margin-left:6px;">（== elevationHigh，过渡层视觉所在层）</span></td></tr>';
  }
  html += '<tr><th>elevation</th><td><em style="color:var(--muted)">—（过渡层，按 elevationLow/High 解析）</em></td></tr>';
  html += '<tr><th>elevationLow</th><td><code>' + slope.elevationLow + '</code></td></tr>';
  html += '<tr><th>elevationHigh</th><td><code>' + slope.elevationHigh + '</code></td></tr>';
  html += '<tr><th>direction</th><td><code>' + escHtml(slope.direction || '—') + '</code> <span style="font-size:10px;color:var(--muted);margin-left:4px;">' + escHtml(dirLabel) + '</span></td></tr>';
  html += '<tr><th>template_id</th><td><code>' + escHtml(JSON.stringify(cell.template_id)) + '</code></td></tr>';
  html += '<tr><th>graphic_index</th><td><code>' + escHtml(JSON.stringify(cell.graphic_index)) + '</code></td></tr>';
  if (cell.areaTags) html += '<tr><th>areaTags</th><td><code>' + escHtml(JSON.stringify(cell.areaTags)) + '</code></td></tr>';
  html += '</table></div>';
  // template 详情 + sub-tile 预览
  const tpls = STATE.terrainConfig.templates;
  for (let i = 0; i < cell.template_id.length; i++) {
    const tid = cell.template_id[i], gix = cell.graphic_index[i];
    const tpl = tpls[tid];
    html += '<div class="field-group"><h4>坡模板 · ' + escHtml(tid) + '</h4>';
    if (!tpl) { html += '<div style="color:var(--danger);font-size:11px;">未在 terrain-config 中找到</div></div>'; continue; }
    const tileId = tpl.graphic_id[gix];
    html += '<table>';
    html += '<tr><th>terrain_type</th><td>' + escHtml(tpl.terrain_type) + '</td></tr>';
    if (tpl.placement) html += '<tr><th>placement</th><td><code>' + escHtml(tpl.placement) + '</code></td></tr>';
    if (tpl._ramp) html += '<tr><th>_ramp</th><td><code>' + escHtml(JSON.stringify(tpl._ramp)) + '</code></td></tr>';
    html += '<tr><th>graphic_index</th><td><code>' + gix + '</code></td></tr>';
    html += '<tr><th>tile_id</th><td><code>' + tileId + '</code></td></tr>';
    html += '</table>';
    const tile = STATE.terrainTileById.get(tileId);
    if (tile) {
      const prev = document.createElement('canvas');
      prev.width = tile.width * 2; prev.height = tile.height * 2;
      const px = prev.getContext('2d'); px.imageSmoothingEnabled = false;
      px.drawImage(STATE.terrainAtlas, tile.x, tile.y, tile.width, tile.height, 0, 0, prev.width, prev.height);
      const slot = 'sp_slope_' + cell.x + '_' + cell.y + '_' + i;
      html += '<div class="sprite-preview" id="' + slot + '"></div>';
      setTimeout(() => { const host = $(slot); if (host) host.appendChild(prev); }, 0);
    }
    html += '</div>';
  }
  // JSON preview
  html += '<div class="field-group"><h4>JSON 预览</h4><pre>' + escHtml(JSON.stringify(cell, null, 2)) + '</pre></div>';
  return html;
}

function renderCellPanel(cell, elev) {
  // 修订 9.1：cell.height 是 cell 自身固有属性；分组 key（elev）只是当前导出借用的维度
  const heightVal = (cell.height !== undefined) ? cell.height : elev;
  const heightHint = (cell.height !== undefined && cell.height !== elev)
    ? '（来自 cell.height）'
    : '（来自 cell.height，同分组 key）';
  let html = '<div class="field-group"><h4>新格式 Cell 属性 (E' + elev + ')</h4><table>';
  html += '<tr><th>x</th><td><code>' + cell.x + '</code></td></tr>';
  html += '<tr><th>y</th><td><code>' + cell.y + '</code></td></tr>';
  html += '<tr><th>height</th><td><code>' + heightVal + '</code><span style="font-size:10px;color:var(--muted);margin-left:6px;">' + heightHint + '</span></td></tr>';
  html += '<tr><th>template_id</th><td><code>' + escHtml(JSON.stringify(cell.template_id)) + '</code></td></tr>';
  html += '<tr><th>graphic_index</th><td><code>' + escHtml(JSON.stringify(cell.graphic_index)) + '</code></td></tr>';
  if (cell.areaTags) html += '<tr><th>areaTags</th><td><code>' + escHtml(JSON.stringify(cell.areaTags)) + '</code></td></tr>';
  html += '</table></div>';
  // 每层 template 详情（cell.template_id[] 从底到顶）
  const tpls = STATE.terrainConfig.templates;
  for (let i = 0; i < cell.template_id.length; i++) {
    const tid = cell.template_id[i], gix = cell.graphic_index[i];
    const tpl = tpls[tid];
    const layerLabel = cell.template_id.length > 1
      ? (i === cell.template_id.length - 1 ? '↑顶层' : '↓底层（透过顶层可见）')
      : '单层';
    html += '<div class="field-group"><h4>' + layerLabel + ' · ' + escHtml(tid) + '</h4>';
    if (!tpl) { html += '<div style="color:var(--danger);font-size:11px;">未在 terrain-config 中找到</div>'; html += '</div>'; continue; }
    const tileId = tpl.graphic_id[gix];
    html += '<table>';
    html += '<tr><th>terrain_type</th><td>' + escHtml(tpl.terrain_type) + '</td></tr>';
    if (tpl.region) html += '<tr><th>region</th><td>' + escHtml(tpl.region) + '</td></tr>';
    if (tpl.water_body_id) html += '<tr><th>water_body_id</th><td>' + escHtml(tpl.water_body_id) + '</td></tr>';
    if (tpl.placement) html += '<tr><th>placement</th><td><code>' + escHtml(tpl.placement) + '</code></td></tr>';
    html += '<tr><th>graphic_index</th><td><code>' + gix + '</code></td></tr>';
    html += '<tr><th>tile_id</th><td><code>' + tileId + '</code></td></tr>';
    html += '</table>';
    // sprite preview
    const tile = STATE.terrainTileById.get(tileId);
    if (tile) {
      const prev = document.createElement('canvas');
      prev.width = tile.width * 2; prev.height = tile.height * 2;
      const px = prev.getContext('2d'); px.imageSmoothingEnabled = false;
      px.drawImage(STATE.terrainAtlas, tile.x, tile.y, tile.width, tile.height, 0, 0, prev.width, prev.height);
      const slot = 'sp_' + cell.x + '_' + cell.y + '_e' + elev + '_' + i;
      html += '<div class="sprite-preview" id="' + slot + '"></div>';
      setTimeout(() => { const host = $(slot); if (host) host.appendChild(prev); }, 0);
    }
    html += '</div>';
  }
  return html;
}

function showObjectInfo(obj) {
  const typeDef = STATE.objectTypeById.get(obj.typeId);
  const info = $('info');
  let html = '<h2>📦 ' + escHtml(obj.typeId) + '</h2>';
  html += '<div class="sub">instanceId: <code>' + escHtml(obj.instanceId) + '</code> · (' + obj.x + ', ' + obj.y + ')</div>';

  html += '<div class="field-group"><h4>ObjectInstance</h4><table>';
  html += '<tr><th>typeId</th><td><code>' + escHtml(obj.typeId) + '</code></td></tr>';
  html += '<tr><th>x / y</th><td><code>' + obj.x + ' / ' + obj.y + '</code></td></tr>';
  if (obj.height != null) html += '<tr><th>height</th><td><code>' + obj.height + '</code></td></tr>';
  html += '<tr><th>direction</th><td><code>' + (obj.direction ?? 0) + '</code></td></tr>';
  html += '<tr><th>interacted</th><td><code>' + (obj.interacted ?? false) + '</code></td></tr>';
  if (obj.current_stack != null) html += '<tr><th>current_stack</th><td><code>' + obj.current_stack + '</code></td></tr>';
  html += '</table></div>';

  if (!typeDef) { html += '<div style="color:var(--danger);font-size:11px;">未找到对应 typeId 的 ObjectType 定义</div>'; info.innerHTML = html; return; }
  html += '<div class="field-group"><h4>ObjectType</h4><table>';
  html += '<tr><th>name</th><td>' + escHtml(typeDef.name) + '</td></tr>';
  html += '<tr><th>graphicSize</th><td><code>cols=' + typeDef.graphicSize.cols + ' rows=' + typeDef.graphicSize.rows + '</code></td></tr>';
  html += '<tr><th>graphicOffset</th><td><code>(' + typeDef.graphicOffset.x + ', ' + typeDef.graphicOffset.y + ')</code></td></tr>';
  html += '<tr><th>objectHeight</th><td><code>' + typeDef.objectHeight + '</code></td></tr>';
  html += '<tr><th>interaction</th><td><code>' + typeDef.interaction + '</code></td></tr>';
  const ppu = typeDef.interaction === 'pickup' ? 32 : 16;
  html += '<tr><th>PPU (隐含)</th><td><code>' + ppu + '</code></td></tr>';
  html += '</table></div>';

  // TSJ asset binding
  const tile = STATE.objectTileById.get(typeDef.graphic);
  if (tile) {
    html += '<div class="field-group"><h4>TSJ · 贴图绑定</h4><table>';
    html += '<tr><th>tile_id</th><td><code>' + tile.id + '</code></td></tr>';
    html += '<tr><th>atlas rect</th><td><code>' + tile.x + ',' + tile.y + ' ' + tile.width + '×' + tile.height + '</code></td></tr>';
    if (tile.pivot) html += '<tr><th>pivot</th><td><code>(' + tile.pivot.x + ', ' + tile.pivot.y + ')</code></td></tr>';
    if (tile.collider) html += '<tr><th>collider</th><td><code>' + escHtml(JSON.stringify(tile.collider)) + '</code></td></tr>';
    html += '</table>';
    const prev = document.createElement('canvas');
    prev.width = tile.width * 2; prev.height = tile.height * 2;
    const px = prev.getContext('2d'); px.imageSmoothingEnabled = false;
    px.drawImage(STATE.objectAtlas, tile.x, tile.y, tile.width, tile.height, 0, 0, prev.width, prev.height);
    html += '<div class="sprite-preview" id="sp_obj"></div></div>';
    setTimeout(() => { const host = $('sp_obj'); if (host) host.appendChild(prev); }, 0);

    // 占格 / 烘焙网格（与 drawSelection 同一几何推算）
    const ppuX  = typeDef.interaction === 'pickup' ? 32 : 16;
    const sc    = TILE_PIXEL / ppuX;
    const pv    = tile.pivot || { x: 0.5, y: 0.5 };
    const dw    = tile.width  * sc, dh = tile.height * sc;
    const imgX  = (obj.x + 0.5) * TILE_PIXEL - pv.x * dw;
    const imgY  = (obj.y + 0.5) * TILE_PIXEL - pivotTopOffsetRatio(pv.y) * dh;
    const cMin = Math.floor(imgX / TILE_PIXEL), cMax = Math.floor((imgX + dw - 1) / TILE_PIXEL);
    const rMin = Math.floor(imgY / TILE_PIXEL), rMax = Math.floor((imgY + dh - 1) / TILE_PIXEL);
    const footprintCells = (cMax - cMin + 1) * (rMax - rMin + 1);
    const baked = [];
    if (tile.collider && tile.collider.type !== 'none') {
      for (let r = rMin; r <= rMax; r++) for (let c = cMin; c <= cMax; c++) {
        const nx = ((c + 0.5) * TILE_PIXEL - imgX) / dw;
        const ny = 1 - ((r + 0.5) * TILE_PIXEL - imgY) / dh;
        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
        if (pointInCollider(nx, ny, tile.collider)) baked.push({ c, r });
      }
    }
    html += '<div class="field-group"><h4>碰撞 / 占格</h4><table>';
    html += '<tr><th>贴图占格</th><td><code>' + footprintCells + ' 格</code> (cols ' + cMin + '→' + cMax + ', rows ' + rMin + '→' + rMax + ')</td></tr>';
    html += '<tr><th>烘焙网格</th><td>' + (baked.length > 0
      ? '<code>' + baked.length + ' 格</code> ' + baked.map(c => '(' + c.c + ',' + c.r + ')').join(' ')
      : '<span style="color:var(--muted);">无（collisionMask=[]）</span>') + '</td></tr>';
    html += '</table></div>';
  }

  // 修订 10：pickup 玩法元数据已合入 ObjectType.pickup，直接展示
  if (typeDef.interaction === 'pickup' && typeDef.pickup) {
    html += '<div class="field-group"><h4>Pickup 玩法元数据（ObjectType.pickup）</h4>';
    html += '<pre>' + escHtml(JSON.stringify(typeDef.pickup, null, 2)) + '</pre></div>';
  } else if (typeDef.interaction === 'pickup') {
    html += '<div class="field-group"><h4>Pickup 玩法元数据</h4>';
    html += '<div style="color:var(--muted);font-size:11px;">该 typeId 暂无 ObjectType.pickup 字段</div></div>';
  }
  info.innerHTML = html;
}

// 命中判定：优先精确锚点（Pickup 等锚点即实例的自然情况），
// 其次反向推算贴图实际覆盖格子（考虑 pivot 偏移与 PPU 缩放），
// 最后才退到 graphicSize 占格 bbox（兼容无 pivot 的退路）。
// 多个命中时，后画的（数组靠后）覆盖先画的，按 terrain.json.objects[] 倒序取第一个。
function findObjectAtCell(col, row) {
  const objs = STATE.terrain.objects;
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    if (o.x === col && o.y === row) return o;
  }
  for (let i = objs.length - 1; i >= 0; i--) {
    const o = objs[i];
    const t = STATE.objectTypeById.get(o.typeId); if (!t) continue;
    const tile = STATE.objectTileById.get(t.graphic); if (!tile) continue;
    const ppu   = t.interaction === 'pickup' ? 32 : 16;
    const scale = TILE_PIXEL / ppu;
    const pivot = tile.pivot || { x: 0.5, y: 0.5 };
    const dw    = tile.width  * scale;
    const dh    = tile.height * scale;
    const imgX  = (o.x + 0.5) * TILE_PIXEL - pivot.x * dw;
    const imgY  = (o.y + 0.5) * TILE_PIXEL - pivotTopOffsetRatio(pivot.y) * dh;
    const colMin = Math.floor(imgX / TILE_PIXEL);
    const colMax = Math.floor((imgX + dw - 1) / TILE_PIXEL);
    const rowMin = Math.floor(imgY / TILE_PIXEL);
    const rowMax = Math.floor((imgY + dh - 1) / TILE_PIXEL);
    if (col >= colMin && col <= colMax && row >= rowMin && row <= rowMax) return o;
  }
  return null;
}

// ─── Object collider baking (mirrors scripts/area-tag-query.ts) ──────────────

/**
 * Bake all object sprites' TSJ colliders into STATE.collisionCells.
 * Exact same geometry as drawSelection / findObjectAtCell in the viewer.
 */
function bakeCollisionCells() {
  const occupied = new Set();
  for (const obj of (STATE.terrain.objects || [])) {
    const typeDef = STATE.objectTypeById.get(obj.typeId);
    if (!typeDef) continue;
    const tile = STATE.objectTileById.get(typeDef.graphic);
    if (!tile) continue;

    const ppu   = getInteractionType(typeDef) === 'pickup' ? 32 : 16;
    const scale = TILE_PIXEL / ppu;
    const pivot = tile.pivot || { x: 0.5, y: 0.5 };
    const dw    = tile.width  * scale;
    const dh    = tile.height * scale;
    const imgX  = (obj.x + 0.5) * TILE_PIXEL - pivot.x * dw;
    const imgY  = (obj.y + 0.5) * TILE_PIXEL - pivotTopOffsetRatio(pivot.y) * dh;

    const colMin = Math.floor(imgX / TILE_PIXEL);
    const colMax = Math.floor((imgX + dw - 1) / TILE_PIXEL);
    const rowMin = Math.floor(imgY / TILE_PIXEL);
    const rowMax = Math.floor((imgY + dh - 1) / TILE_PIXEL);

    const col = tile.collider;
    if (col && col.type !== 'none') {
      for (let r = rowMin; r <= rowMax; r++) {
        for (let c = colMin; c <= colMax; c++) {
          const nx = ((c + 0.5) * TILE_PIXEL - imgX) / dw;
          const ny = 1 - ((r + 0.5) * TILE_PIXEL - imgY) / dh;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
          if (pointInCollider(nx, ny, col)) occupied.add(c + ',' + r);
        }
      }
    }
    // collider.type === 'none'：无碰撞体，不标记任何格子
  }
  STATE.collisionCells = occupied;
}

// ─── Area-tag query (mirrors scripts/area-tag-query.ts) ──────────────────────

/**
 * Return { x, y }[] for every cell that carries `tagName` in any areaTags level.
 */
function queryAreaTag(tagName) {
  const seen = new Set();
  const result = [];
  for (const cell of STATE.flatCells) {
    if (!cell.areaTags) continue;
    let matched = false;
    for (const names of Object.values(cell.areaTags)) {
      if (names.includes(tagName)) { matched = true; break; }
    }
    if (!matched) continue;
    const key = cell.x + ',' + cell.y;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ x: cell.x, y: cell.y });
  }
  return result;
}

/**
 * Build a hierarchical AreaTagNode tree from loaded flat cells.
 * Each node: { name, level, cellCount, children[] }
 */
function buildAreaTagTree() {
  const levelSet = new Set();
  for (const cell of STATE.flatCells) {
    if (!cell.areaTags) continue;
    for (const k of Object.keys(cell.areaTags)) levelSet.add(k);
  }
  const levels = [...levelSet].sort();
  if (levels.length === 0) return [];

  // prefix-tree keyed by name
  const roots = new Map();

  for (const cell of STATE.flatCells) {
    if (!cell.areaTags) continue;
    const coordKey = cell.x + ',' + cell.y;
    const path = [];
    for (const lv of levels) {
      const names = cell.areaTags[lv];
      if (!names || !names.length) break;
      path.push({ name: names[0], level: lv });
    }
    if (!path.length) continue;

    let parentMap = roots;
    for (const { name, level } of path) {
      if (!parentMap.has(name)) {
        parentMap.set(name, { name, level, cells: new Set(), children: new Map() });
      }
      const node = parentMap.get(name);
      node.cells.add(coordKey);
      parentMap = node.children;
    }
  }

  function toPublic(node) {
    return {
      name: node.name,
      level: node.level,
      cellCount: node.cells.size,
      children: [...node.children.values()].map(toPublic),
    };
  }
  return [...roots.values()].map(toPublic);
}

// ─── Overlay canvas rendering ─────────────────────────────────────────────────

const AREA_COLORS = [
  'rgba(110,168,255,0.35)',   // blue
  'rgba(100,220,140,0.35)',   // green
  'rgba(255,210,80,0.35)',    // yellow
  'rgba(220,130,255,0.35)',   // purple
  'rgba(255,130,100,0.35)',   // orange-red
  'rgba(80,230,220,0.35)',    // cyan
];
const AREA_BORDERS = [
  'rgba(110,168,255,0.90)',
  'rgba(100,220,140,0.90)',
  'rgba(255,210,80,0.90)',
  'rgba(220,130,255,0.90)',
  'rgba(255,130,100,0.90)',
  'rgba(80,230,220,0.90)',
];
let _colorIdx = 0;
const _areaColorCache = new Map(); // name → colorIdx

function colorIdxFor(name) {
  if (!_areaColorCache.has(name)) {
    _areaColorCache.set(name, _colorIdx % AREA_COLORS.length);
    _colorIdx++;
  }
  return _areaColorCache.get(name);
}

function applyOverlayCamera() {
  const oc = STATE.overlayCanvas;
  oc.style.left = STATE.canvas.style.left;
  oc.style.top  = STATE.canvas.style.top;
  oc.style.transform = STATE.canvas.style.transform;
  oc.style.transformOrigin = '0 0';
}

function drawAreaOverlay() {
  const oc = STATE.overlayCanvas;
  const ox = STATE.overlayCtx;
  ox.clearRect(0, 0, oc.width, oc.height);

  // ── Layer 1: area-tag highlight ───────────────────────────────────────────
  if (STATE.areaHighlight) {
    const { name, coords } = STATE.areaHighlight;
    const ci = colorIdxFor(name);
    const fillColor   = AREA_COLORS[ci];
    const borderColor = AREA_BORDERS[ci];

    ox.fillStyle = fillColor;
    for (const key of coords) {
      const [x, y] = key.split(',').map(Number);
      ox.fillRect(x * TILE_PIXEL, y * TILE_PIXEL, TILE_PIXEL, TILE_PIXEL);
    }

    ox.strokeStyle = borderColor;
    ox.lineWidth = 1.5;
    for (const key of coords) {
      const [x, y] = key.split(',').map(Number);
      const px = x * TILE_PIXEL, py = y * TILE_PIXEL;
      if (!coords.has(x + ',' + (y - 1))) {
        ox.beginPath(); ox.moveTo(px, py); ox.lineTo(px + TILE_PIXEL, py); ox.stroke();
      }
      if (!coords.has(x + ',' + (y + 1))) {
        ox.beginPath(); ox.moveTo(px, py + TILE_PIXEL); ox.lineTo(px + TILE_PIXEL, py + TILE_PIXEL); ox.stroke();
      }
      if (!coords.has((x - 1) + ',' + y)) {
        ox.beginPath(); ox.moveTo(px, py); ox.lineTo(px, py + TILE_PIXEL); ox.stroke();
      }
      if (!coords.has((x + 1) + ',' + y)) {
        ox.beginPath(); ox.moveTo(px + TILE_PIXEL, py); ox.lineTo(px + TILE_PIXEL, py + TILE_PIXEL); ox.stroke();
      }
    }
  }

  // ── Layer 2: collision cells ──────────────────────────────────────────────
  if (STATE.showCollision && STATE.collisionCells.size > 0) {
    ox.fillStyle = 'rgba(255,60,60,0.28)';
    ox.strokeStyle = 'rgba(255,60,60,0.70)';
    ox.lineWidth = 0.8;
    for (const key of STATE.collisionCells) {
      const [x, y] = key.split(',').map(Number);
      const px = x * TILE_PIXEL, py = y * TILE_PIXEL;
      ox.fillRect(px, py, TILE_PIXEL, TILE_PIXEL);
      ox.strokeRect(px + 0.5, py + 0.5, TILE_PIXEL - 1, TILE_PIXEL - 1);
    }
  }
}

function highlightArea(name) {
  const coords = queryAreaTag(name);
  if (!coords.length) return;
  const coordSet = new Set(coords.map(c => c.x + ',' + c.y));
  STATE.areaHighlight = { name, coords: coordSet };
  drawAreaOverlay();
  // Switch to area tab if not already there
  const areaPanel = document.getElementById('side-panel-area');
  if (areaPanel && areaPanel.style.display === 'none') switchTab('area');
  // Update active state in tree
  document.querySelectorAll('.at-row').forEach(r => {
    r.classList.toggle('at-active', r.dataset.name === name);
  });
  const clearBtn = document.getElementById('area-clear');
  if (clearBtn) {
    clearBtn.style.display = 'block';
    clearBtn.textContent = '✕ 清除高亮  (' + coords.length + ' 格)';
  }
  // Remember as sample source and update label
  STATE.sampleSource = name;
  const srcLbl = document.getElementById('sample-source-label');
  if (srcLbl) srcLbl.textContent = name;
  // Pan to centroid
  if (coords.length > 0) {
    const avgX = coords.reduce((s, c) => s + c.x, 0) / coords.length;
    const avgY = coords.reduce((s, c) => s + c.y, 0) / coords.length;
    const wrap = document.getElementById('map-wrap');
    const rect = wrap.getBoundingClientRect();
    STATE.tx = rect.width / 2 - (avgX + 0.5) * TILE_PIXEL * STATE.scale;
    STATE.ty = rect.height / 2 - (avgY + 0.5) * TILE_PIXEL * STATE.scale;
    applyCamera();
    applyOverlayCamera();
  }
}

window.clearAreaHighlight = function() {
  STATE.areaHighlight = null;
  drawAreaOverlay();
  document.querySelectorAll('.at-row').forEach(r => r.classList.remove('at-active'));
  const clearBtn = document.getElementById('area-clear');
  if (clearBtn) clearBtn.style.display = 'none';
};

window.toggleCollision = function() {
  STATE.showCollision = !STATE.showCollision;
  const btn = document.getElementById('coll-btn');
  if (btn) btn.classList.toggle('elev-active', STATE.showCollision);
  drawAreaOverlay();
};

// ─── Typical-coordinate sampling (mirrors scripts/area-tag-query.ts) ─────────

/**
 * Gaussian-weighted random sample biased toward the centroid of `candidates`.
 * `sigmaFraction` controls spread: 0.3 = tight, 0.5 = default, 1.0 = near-uniform.
 */
function _weightedSample(candidates, sigmaFraction, rng) {
  if (!candidates.length) return null;
  const sf = Math.max(0.01, sigmaFraction || 0.5);
  let sumX = 0, sumY = 0;
  for (const c of candidates) { sumX += c.x; sumY += c.y; }
  const cx = sumX / candidates.length, cy = sumY / candidates.length;
  let maxDist = 0;
  for (const c of candidates) {
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > maxDist) maxDist = d;
  }
  const sigma = Math.max(0.5, maxDist * sf);
  const twoSigmaSq = 2 * sigma * sigma;
  let total = 0;
  const cumulative = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const d = Math.hypot(candidates[i].x - cx, candidates[i].y - cy);
    total += Math.exp(-(d * d) / twoSigmaSq);
    cumulative[i] = total;
  }
  const threshold = (rng || Math.random)() * total;
  let lo = 0, hi = candidates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < threshold) lo = mid + 1; else hi = mid;
  }
  return candidates[lo];
}

/**
 * Return `n` typical coordinates for `tagName`.
 * Coordinates in `excludeSet` (Set of "x,y") are removed before each draw.
 * `sigmaFraction` controls Gaussian spread (default 0.5).
 */
function sampleTypicalCoords(tagName, n, excludeSet, sigmaFraction) {
  const all = queryAreaTag(tagName);   // all area cells (no height/free filter in viewer)
  if (!all.length) return [];
  const exclude = excludeSet || new Set();
  const results = [];
  for (let i = 0; i < n; i++) {
    const pool = all.filter(c => !exclude.has(c.x + ',' + c.y));
    const candidates = pool.length > 0 ? pool : all;
    const pick = _weightedSample(candidates, sigmaFraction);
    if (!pick) break;
    results.push(pick);
    exclude.add(pick.x + ',' + pick.y);
  }
  return results;
}

// ─── Sampled-points overlay + UI ─────────────────────────────────────────────

function drawSampledPoints() {
  const oc = STATE.overlayCanvas;
  const ox = STATE.overlayCtx;
  const pts = STATE.sampledPoints;
  if (!pts.length) return;

  const r = Math.max(3, TILE_PIXEL * 0.35); // marker radius
  for (let i = 0; i < pts.length; i++) {
    const { x, y } = pts[i];
    const px = (x + 0.5) * TILE_PIXEL;
    const py = (y + 0.5) * TILE_PIXEL;
    // outer ring
    ox.beginPath(); ox.arc(px, py, r + 1.5, 0, Math.PI * 2);
    ox.fillStyle = 'rgba(0,0,0,0.55)'; ox.fill();
    // filled circle
    ox.beginPath(); ox.arc(px, py, r, 0, Math.PI * 2);
    ox.fillStyle = '#ff9f1c'; ox.fill();
    // index label
    ox.fillStyle = '#000';
    ox.font = `bold ${Math.max(7, Math.round(r * 1.1))}px sans-serif`;
    ox.textAlign = 'center'; ox.textBaseline = 'middle';
    ox.fillText(String(i + 1), px, py);
  }
  ox.textAlign = 'left'; ox.textBaseline = 'alphabetic'; // reset
}

// Extend drawAreaOverlay to also draw sampled points
const _origDrawAreaOverlay = drawAreaOverlay;
drawAreaOverlay = function() {
  _origDrawAreaOverlay();
  drawSampledPoints();
};

/** Execute a sample from the currently highlighted area and update the UI. */
window.runSample = function() {
  const name = STATE.areaHighlight?.name || STATE.sampleSource;
  if (!name) {
    alert('请先在地名树中点击一个地名再进行采样');
    return;
  }
  const countEl = document.getElementById('sample-count');
  const n = Math.max(1, parseInt(countEl?.value || '3', 10));
  const sigmaEl = document.getElementById('sample-sigma');
  const sigma = Math.max(0.1, parseFloat(sigmaEl?.value || '0.5'));

  const accumulateEl = document.getElementById('sample-accumulate');
  const accumulate = accumulateEl?.checked;

  // Build exclude set from existing points if accumulating
  const excludeSet = new Set();
  if (accumulate) {
    for (const p of STATE.sampledPoints) excludeSet.add(p.x + ',' + p.y);
  }

  const picks = sampleTypicalCoords(name, n, excludeSet, sigma);
  if (!picks.length) { alert(`"${name}" 在当前过滤条件下无可用格子`); return; }

  if (accumulate) {
    const nextLabel = STATE.sampledPoints.length;
    picks.forEach((p, i) => STATE.sampledPoints.push({ ...p, label: nextLabel + i + 1 }));
  } else {
    STATE.sampledPoints = picks.map((p, i) => ({ ...p, label: i + 1 }));
  }
  STATE.sampleSource = name;

  drawAreaOverlay();
  renderSampledList();
};

window.clearSampledPoints = function() {
  STATE.sampledPoints = [];
  drawAreaOverlay();
  renderSampledList();
};

function renderSampledList() {
  const el = document.getElementById('sampled-list');
  if (!el) return;
  if (!STATE.sampledPoints.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;">尚未采样</div>';
    return;
  }
  el.innerHTML = STATE.sampledPoints.map((p, i) =>
    `<div style="display:flex;align-items:center;gap:6px;padding:2px 0;">` +
    `<span style="display:inline-flex;align-items:center;justify-content:center;` +
    `width:18px;height:18px;border-radius:50%;background:#ff9f1c;` +
    `color:#000;font-size:10px;font-weight:700;flex-shrink:0;">${i + 1}</span>` +
    `<code style="font-size:10.5px;">(${p.x}, ${p.y})</code>` +
    (p.height !== undefined ? `<span style="color:var(--muted);font-size:10px;">h=${p.height}</span>` : '') +
    `<span style="margin-left:auto;font-size:10px;color:var(--muted);cursor:pointer;" ` +
    `onclick="panToPoint(${p.x},${p.y})" title="定位到该格子">📍</span>` +
    `</div>`
  ).join('');
}

window.panToPoint = function(x, y) {
  const wrap = document.getElementById('map-wrap');
  const rect = wrap.getBoundingClientRect();
  STATE.tx = rect.width  / 2 - (x + 0.5) * TILE_PIXEL * STATE.scale;
  STATE.ty = rect.height / 2 - (y + 0.5) * TILE_PIXEL * STATE.scale;
  applyCamera();
  // Flash-select the cell
  STATE.selected = { type: 'cell', x, y };
  draw();
};

// ─── Area-tag tree UI ─────────────────────────────────────────────────────────

function buildAreaTreeUI() {
  STATE.areaTree = buildAreaTagTree();
  renderAreaTree(STATE.areaTree, '');
}

function renderAreaTree(nodes, filterText) {
  const container = document.getElementById('area-tree');
  if (!container) return;
  if (!nodes.length) { container.textContent = '（地图中无 areaTags 数据）'; return; }
  container.innerHTML = '';
  for (const node of nodes) {
    const el = buildTreeNodeEl(node, filterText);
    if (el) container.appendChild(el);
  }
}

function nodeMatchesFilter(node, q) {
  if (!q) return true;
  if (node.name.includes(q)) return true;
  return node.children.some(c => nodeMatchesFilter(c, q));
}

function buildTreeNodeEl(node, filterText) {
  if (filterText && !nodeMatchesFilter(node, filterText)) return null;

  const wrap = document.createElement('div');
  wrap.className = 'at-node';

  const row = document.createElement('div');
  row.className = 'at-row';
  row.dataset.name = node.name;

  const toggle = document.createElement('span');
  toggle.className = 'at-toggle';
  toggle.textContent = node.children.length ? '▶' : ' ';

  const badge = document.createElement('span');
  badge.className = 'at-level-badge';
  badge.textContent = node.level.replace('area_', '');

  const nameSpan = document.createElement('span');
  nameSpan.className = 'at-name';
  if (filterText && node.name.includes(filterText)) {
    // Highlight matched text
    const idx = node.name.indexOf(filterText);
    nameSpan.innerHTML =
      escHtml(node.name.slice(0, idx)) +
      '<mark style="background:#ffd64066;color:inherit">' + escHtml(filterText) + '</mark>' +
      escHtml(node.name.slice(idx + filterText.length));
  } else {
    nameSpan.textContent = node.name;
  }

  const count = document.createElement('span');
  count.className = 'at-count';
  count.textContent = node.cellCount + ' 格';

  row.appendChild(toggle);
  row.appendChild(badge);
  row.appendChild(nameSpan);
  row.appendChild(count);
  wrap.appendChild(row);

  let childrenEl = null;
  if (node.children.length) {
    childrenEl = document.createElement('div');
    childrenEl.className = 'at-children' + (filterText ? '' : ' collapsed');
    for (const child of node.children) {
      const el = buildTreeNodeEl(child, filterText);
      if (el) childrenEl.appendChild(el);
    }
    wrap.appendChild(childrenEl);

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const collapsed = childrenEl.classList.toggle('collapsed');
      toggle.textContent = collapsed ? '▶' : '▼';
    });
  }

  row.addEventListener('click', () => {
    highlightArea(node.name);
    // Also expand children
    if (childrenEl) {
      childrenEl.classList.remove('collapsed');
      toggle.textContent = '▼';
    }
  });

  return wrap;
}

window.filterAreaTree = function(q) {
  const trimmed = q.trim();
  renderAreaTree(STATE.areaTree, trimmed);
};

// ─── Register events ──────────────────────────────────────────────────────────

function registerEvents() {
  const wrap = $('map-wrap');
  wrap.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const rect = wrap.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const worldX = (mx - STATE.tx) / STATE.scale;
    const worldY = (my - STATE.ty) / STATE.scale;
    STATE.scale *= factor;
    STATE.scale = Math.max(0.05, Math.min(16, STATE.scale));
    STATE.tx = mx - worldX * STATE.scale;
    STATE.ty = my - worldY * STATE.scale;
    applyCamera(); applyOverlayCamera();
  }, { passive: false });
  let dragging = false, lastX = 0, lastY = 0;
  wrap.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    wrap.classList.add('dragging');
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    STATE.tx += e.clientX - lastX; STATE.ty += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; applyCamera(); applyOverlayCamera();
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; wrap.classList.remove('dragging'); }
  });
  STATE.canvas.addEventListener('click', e => {
    const { col, row } = screenToCell(e);
    if (col < 0 || col >= STATE.worldW || row < 0 || row >= STATE.worldH) return;
    if (STATE.mode === 'cell') {
      STATE.selected = { type: 'cell', x: col, y: row };
      showCellInfo(col, row);
    } else {
      const obj = findObjectAtCell(col, row);
      if (obj) { STATE.selected = { type: 'object', obj }; showObjectInfo(obj); }
      else { STATE.selected = null; $('info').innerHTML = '<div class="sub">该位置无对象</div>'; }
    }
    draw();
  });
  $('fit-btn').addEventListener('click', fitToView);
  $('one-btn').addEventListener('click', oneToOne);
  $('cell-mode').addEventListener('click', () => {
    STATE.mode = 'cell';
    $('cell-mode').classList.add('active'); $('obj-mode').classList.remove('active');
  });
  $('obj-mode').addEventListener('click', () => {
    STATE.mode = 'object';
    $('obj-mode').classList.add('active'); $('cell-mode').classList.remove('active');
  });
  $('elev-all').addEventListener('click', () => setHighlight(null));
  const tBtn = $('elev-T');
  if (tBtn) tBtn.addEventListener('click', () => setHighlight('transition'));
  window.addEventListener('resize', fitToView);
}

boot();
})();