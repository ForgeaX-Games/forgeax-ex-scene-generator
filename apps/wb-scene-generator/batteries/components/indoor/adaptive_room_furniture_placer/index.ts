/**
 * adaptive_room_furniture_placer - 独立版（所有依赖内联，无外部 import 依赖其他电池）
 *
 * DataTree 数据格式：roomGrid / doorGrid / outputGrid 均为 grid/access:item——
 * 本算子每次只处理单张房间网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：roomGrid     (grid)  - 房间网格（1=可用）
 *       doorGrid     (grid)  - 门位置网格（非0=门格）
 *       furnitureList (array) - 统一家具清单，rank 1-7 主家具，rank 8-9 填充家具
 *       seed         (number)- 随机种子
 * 输出：outputGrid   (grid)  - 重映射后的家具网格（id 从1起）
 *       nameList     (array) - [{id, name, type, direction}]，每个实例独立 id
 *       furnitureIndex(array) - 原始家具编号列表
 *       roomReport   (array) - 每个房间放置摘要
 */

import singleLibraryData from "./simple_furniture_demo.json" assert { type: "json" };
import groupLibraryData from "./desk_chair_set.json" assert { type: "json" };

type Grid = number[][];
type FurnitureDirection = "top" | "right" | "bottom" | "left" | "square" | "h" | "v";

interface FurnitureTemplate {
  id: string; size: string; shape: string;
  placementEdges: number[]; mask: Grid; rows: number; cols: number;
  isGroup: boolean; components: Record<string, string>;
}
interface PlacedFurniture {
  name: string; rank: number; effectiveRank: number;
  templateId: string; templateMask: Grid;
  anchor: [number, number]; edge: number;
  isGroup: boolean; groupSlots: number; components: Record<string, string>;
}
type TemplateLibrary = Record<string, FurnitureTemplate[]>;
interface FurnitureListItem {
  rank: number; name: string; furniture_id: string;
  type?: "single" | "group"; placement?: "edge" | "center";
}
interface FurnitureIndexEntry {
  rank: number; name: string; isGroup: boolean; direction: FurnitureDirection;
}
type Cell = [number, number];
type RoomCategory = "small" | "medium" | "large";
interface RoomInfo { grid: Grid; area: number; category: RoomCategory; }
interface RoomReport { area: number; category: RoomCategory; placedCount: number; }

const SMALL_MAX_AREA = 10, LARGE_MIN_AREA = 40, RANK_STRIDE = 1000, MIN_ROOM_AREA = 6;

function edgeToDirection(edge: number): FurnitureDirection {
  switch (edge) { case 0: return "top"; case 1: return "right"; case 2: return "bottom"; case 3: return "left"; default: return "square"; }
}
function shapeDirectionFromId(templateId: string, edge: number): FurnitureDirection {
  if (edge >= 0) return edgeToDirection(edge);
  const lower = templateId.toLowerCase();
  if (lower.includes("_h_") || lower.endsWith("_h")) return "h";
  if (lower.includes("_v_") || lower.endsWith("_v")) return "v";
  return "square";
}
function calcPlacedDirection(p: { edge: number; templateId: string }): FurnitureDirection {
  return shapeDirectionFromId(p.templateId, p.edge);
}
function calcGroupSlotDirection(mask: Grid, slotIndex: number, overallDirection: FurnitureDirection): FurnitureDirection {
  if (slotIndex === 1) return overallDirection;
  let r1 = 0, c1 = 0, n1 = 0, r2 = 0, c2 = 0, n2 = 0;
  for (let r = 0; r < mask.length; r++) for (let c = 0; c < (mask[r]?.length ?? 0); c++) {
    const v = mask[r][c];
    if (v === 1) { r1 += r; c1 += c; n1++; } else if (v === slotIndex) { r2 += r; c2 += c; n2++; }
  }
  if (n1 === 0 || n2 === 0) return overallDirection;
  const dr = r2 / n2 - r1 / n1, dc = c2 / n2 - c1 / n1;
  if (Math.abs(dr) >= Math.abs(dc)) return dr > 0 ? "top" : "bottom";
  return dc > 0 ? "left" : "right";
}

type NameListItem = { id: number; name: string; type: string; direction?: string };
function furnitureNameCollapse(input: Record<string, unknown>): Record<string, unknown> {
  const rawList = input.list, maskA = input.maskA as Grid | undefined;
  const typeValue = typeof input.type === "string" ? input.type : "asset";
  if (!Array.isArray(rawList)) return { error: "list error" };
  if (!maskA || !Array.isArray(maskA) || !maskA.length) return { error: "maskA error" };
  const rankToNewId = new Map<number, number>(), nameList: NameListItem[] = [];
  for (const item of rawList) {
    if (typeof item !== "object" || !item) continue;
    const obj = item as Record<string, unknown>;
    const rank = typeof obj.rank === "number" ? obj.rank : Number(obj.rank);
    const name = typeof obj.name === "string" ? obj.name.trim() : String(obj.name ?? "").trim();
    if (isNaN(rank) || !name || rankToNewId.has(rank)) continue;
    const newId = nameList.length + 1;
    rankToNewId.set(rank, newId);
    const entry: NameListItem = { id: newId, name, type: typeValue };
    if (typeof obj.direction === "string") entry.direction = obj.direction;
    nameList.push(entry);
  }
  const rows = maskA.length, cols = maskA[0]?.length ?? 0;
  const outputGrid: Grid = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => { const v = maskA[r][c]; return v === 0 ? 0 : (rankToNewId.get(v) ?? 0); })
  );
  return { outputGrid, nameList, count: nameList.length };
}

function buildSingleLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) for (const raw of cat.items ?? []) {
    const item = raw as Record<string, unknown>, mask = item["mask"] as Grid;
    const tpl: FurnitureTemplate = { id: item["id"] as string, size: item["size"] as string, shape: item["shape"] as string, placementEdges: item["placement_edges"] as number[], mask, rows: mask.length, cols: mask[0]?.length ?? 0, isGroup: false, components: {} };
    (lib[`${tpl.size}_${tpl.shape}`] ??= []).push(tpl);
  }
  return lib;
}
function extractGroupBaseName(id: string): string { return id.replace(/_(edge\d+|center_\w+)$/, ""); }
function buildGroupLibrary(libraryData: unknown): TemplateLibrary {
  const data = libraryData as { furniture_categories?: Array<{ items?: unknown[] }> };
  const lib: TemplateLibrary = {};
  for (const cat of data.furniture_categories ?? []) for (const raw of cat.items ?? []) {
    const item = raw as Record<string, unknown>, mask = item["mask"] as Grid;
    const tpl: FurnitureTemplate = { id: item["id"] as string, size: (item["size"] as string) ?? "small", shape: (item["shape"] as string) ?? "square", placementEdges: (item["placement_edges"] as number[]) ?? [], mask, rows: mask.length, cols: mask[0]?.length ?? 0, isGroup: true, components: (item["components"] as Record<string, string>) ?? {} };
    (lib[extractGroupBaseName(tpl.id)] ??= []).push(tpl);
  }
  return lib;
}

function computeEdgeCells(layout: Grid, rows: number, cols: number): Record<number, Array<[number, number]>> {
  const top: Array<[number,number]> = [], right: Array<[number,number]> = [], bottom: Array<[number,number]> = [], left: Array<[number,number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!layout[r][c]) continue;
    if (r === 0 || !layout[r-1][c]) top.push([r,c]);
    if (r === rows-1 || !layout[r+1][c]) bottom.push([r,c]);
    if (c === 0 || !layout[r][c-1]) left.push([r,c]);
    if (c === cols-1 || !layout[r][c+1]) right.push([r,c]);
  }
  return { 0: top, 1: right, 2: bottom, 3: left };
}
function bodyCells(tpl: FurnitureTemplate): Array<[number,number]> {
  const cells: Array<[number,number]> = [];
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) { const v = tpl.mask[r][c]; if (tpl.isGroup ? v !== 0 : v === 1) cells.push([r,c]); }
  return cells;
}
function aisleCells(tpl: FurnitureTemplate): Array<[number,number]> {
  const cells: Array<[number,number]> = [];
  for (let r = 0; r < tpl.rows; r++) for (let c = 0; c < tpl.cols; c++) if (!tpl.mask[r][c]) cells.push([r,c]);
  return cells;
}
function isRoomCell(layout: Grid, rows: number, cols: number, r: number, c: number): boolean {
  return r >= 0 && r < rows && c >= 0 && c < cols && layout[r][c] !== 0;
}
function isValidPlacement(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, doorZone?: Set<string>): boolean {
  for (const [dr,dc] of bodyCells(tpl)) { const r=ar+dr,c=ac+dc; if (!isRoomCell(layout,rows,cols,r,c)||maskA[r][c]!==0||maskB[r][c]!==0||doorZone?.has(`${r},${c}`)) return false; }
  for (const [dr,dc] of aisleCells(tpl)) { const r=ar+dr,c=ac+dc; if (r<0||r>=rows||c<0||c>=cols) continue; if (isRoomCell(layout,rows,cols,r,c)&&maskA[r][c]!==0) return false; }
  return true;
}
function isEdgeAligned(tpl: FurnitureTemplate, ar: number, ac: number, edge: number, edgeCells: Record<number,Array<[number,number]>>): boolean {
  const body = bodyCells(tpl); if (!body.length) return false;
  const es = new Set(edgeCells[edge].map(([r,c]) => `${r},${c}`));
  if (edge===0){const minR=Math.min(...body.map(([dr])=>ar+dr));return body.some(([dr,dc])=>ar+dr===minR&&es.has(`${minR},${ac+dc}`));}
  if (edge===2){const maxR=Math.max(...body.map(([dr])=>ar+dr));return body.some(([dr,dc])=>ar+dr===maxR&&es.has(`${maxR},${ac+dc}`));}
  if (edge===1){const maxC=Math.max(...body.map(([,dc])=>ac+dc));return body.some(([dr,dc])=>ac+dc===maxC&&es.has(`${ar+dr},${maxC}`));}
  const minC=Math.min(...body.map(([,dc])=>ac+dc));return body.some(([dr,dc])=>ac+dc===minC&&es.has(`${ar+dr},${minC}`));
}
function makePrng(seed: number): ()=>number {
  let s = seed >>> 0;
  return function(){ s+=0x6d2b79f5; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))>>>0; return ((t^(t>>>14))>>>0)/4294967296; };
}
function shuffleArray<T>(arr: T[], rand: ()=>number): T[] {
  const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
}
const MAX_CANDIDATES=30;
function dedupPairs(pairs: Array<[number,number]>): Array<[number,number]> {
  const seen=new Set<string>(); return pairs.filter(([r,c])=>{const k=`${r},${c}`;if(seen.has(k))return false;seen.add(k);return true;});
}
function sampleCandidates(cands: Array<[number,number]>, rand: ()=>number): Array<[number,number]> {
  if(cands.length<=MAX_CANDIDATES)return cands;
  const result: Array<[number,number]>=[],pool=[...cands];
  for(let i=0;i<MAX_CANDIDATES;i++){const j=Math.floor(rand()*pool.length);result.push(pool[j]);pool.splice(j,1);}
  return result;
}
function generateEdgeCandidates(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, edge: number, edgeCells: Record<number,Array<[number,number]>>, rand: ()=>number, doorZone?: Set<string>): Array<[number,number]> {
  const valid: Array<[number,number]>=[],body=bodyCells(tpl);
  if(edge===0){const minDr=Math.min(...body.map(([dr])=>dr)),bDcs=body.filter(([dr])=>dr===minDr).map(([,dc])=>dc);for(const[er,ec]of edgeCells[0]){const aR=er-minDr;for(const dc of bDcs){const aC=ec-dc;if(isValidPlacement(layout,maskA,maskB,rows,cols,tpl,aR,aC,doorZone)&&isEdgeAligned(tpl,aR,aC,0,edgeCells))valid.push([aR,aC]);}}}
  else if(edge===2){const maxDr=Math.max(...body.map(([dr])=>dr)),bDcs=body.filter(([dr])=>dr===maxDr).map(([,dc])=>dc);for(const[er,ec]of edgeCells[2]){const aR=er-maxDr;for(const dc of bDcs){const aC=ec-dc;if(isValidPlacement(layout,maskA,maskB,rows,cols,tpl,aR,aC,doorZone)&&isEdgeAligned(tpl,aR,aC,2,edgeCells))valid.push([aR,aC]);}}}
  else if(edge===1){const maxDc=Math.max(...body.map(([,dc])=>dc)),bDrs=body.filter(([,dc])=>dc===maxDc).map(([dr])=>dr);for(const[er,ec]of edgeCells[1]){const aC=ec-maxDc;for(const dr of bDrs){const aR=er-dr;if(isValidPlacement(layout,maskA,maskB,rows,cols,tpl,aR,aC,doorZone)&&isEdgeAligned(tpl,aR,aC,1,edgeCells))valid.push([aR,aC]);}}}
  else{const minDc=Math.min(...body.map(([,dc])=>dc)),bDrs=body.filter(([,dc])=>dc===minDc).map(([dr])=>dr);for(const[er,ec]of edgeCells[3]){const aC=ec-minDc;for(const dr of bDrs){const aR=er-dr;if(isValidPlacement(layout,maskA,maskB,rows,cols,tpl,aR,aC,doorZone)&&isEdgeAligned(tpl,aR,aC,3,edgeCells))valid.push([aR,aC]);}}}
  return sampleCandidates(dedupPairs(valid),rand);
}
function generateCenterCandidates(layout: Grid, maskA: Grid, maskB: Grid, rows: number, cols: number, tpl: FurnitureTemplate, rand: ()=>number, doorZone?: Set<string>): Array<[number,number]> {
  const valid: Array<[number,number]>=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(isValidPlacement(layout,maskA,maskB,rows,cols,tpl,r,c,doorZone))valid.push([r,c]);
  return sampleCandidates(valid,rand);
}
function scorePlacement(placed: PlacedFurniture[], anchor: [number,number], edge: number, usedEdges: Record<number,number>, edgeCells: Record<number,Array<[number,number]>>, rows: number, cols: number, isCenter: boolean): number {
  let score=0;
  if(placed.length>0){const sR=placed.reduce((s,p)=>s+p.anchor[0],0)/placed.length,sC=placed.reduce((s,p)=>s+p.anchor[1],0)/placed.length;score+=Math.min(Math.sqrt((anchor[0]-sR)**2+(anchor[1]-sC)**2),8)*1.5;}
  if(!isCenter){const mU=Math.max(0,...Object.values(usedEdges));score+=(mU-(usedEdges[edge]??0))*2;}
  else{const aE=Object.values(edgeCells).flat();if(aE.length>0){const mW=Math.min(...aE.map(([br,bc])=>Math.sqrt((anchor[0]-br)**2+(anchor[1]-bc)**2)));if(mW<3)score-=(3-mW)*2;}score+=Math.max(0,4-Math.sqrt((anchor[0]-rows/2)**2+(anchor[1]-cols/2)**2))*2;}
  if(placed.length>0){const mD=Math.min(...placed.map(p=>Math.sqrt((anchor[0]-p.anchor[0])**2+(anchor[1]-p.anchor[1])**2)));if(mD<2)score-=(2-mD)*3;}
  return score;
}
function maxMaskValue(tpl: FurnitureTemplate): number { let m=1; for(let r=0;r<tpl.rows;r++)for(let c=0;c<tpl.cols;c++)if(tpl.mask[r][c]>m)m=tpl.mask[r][c]; return m; }
function applyPlacerMask(maskA: Grid, maskB: Grid, layout: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, eR: number): void {
  for(let r=0;r<tpl.rows;r++)for(let c=0;c<tpl.cols;c++){const v=tpl.mask[r][c],gr=ar+r,gc=ac+c;if(v===1)maskA[gr][gc]=eR;else if(v>1)maskA[gr][gc]=eR+(v-1);else if(gr>=0&&gr<rows&&gc>=0&&gc<cols&&layout[gr][gc]!==0)maskB[gr][gc]=1;}
}
function applyFillerMask(maskA: Grid, maskB: Grid, layout: Grid, rows: number, cols: number, tpl: FurnitureTemplate, ar: number, ac: number, eR: number): void {
  for(let r=0;r<tpl.rows;r++)for(let c=0;c<tpl.cols;c++){const v=tpl.mask[r][c],gr=ar+r,gc=ac+c;if(v===1)maskA[gr][gc]=eR;else if(v>1)maskA[gr][gc]=eR+10;else if(gr>=0&&gr<rows&&gc>=0&&gc<cols&&layout[gr][gc]!==0)maskB[gr][gc]=1;}
}
function resolveTemplates(item: FurnitureListItem, singleLib: TemplateLibrary, groupLib: TemplateLibrary): FurnitureTemplate[] {
  return item.type==="group"?(groupLib[item.furniture_id]??[]):(singleLib[item.furniture_id]??[]);
}

interface PlaceResult { maskA: Grid; maskB: Grid; placed: PlacedFurniture[]; diagnostics: string[]; }

function placeAll(layout: Grid, maskA: Grid, maskB: Grid, singleLib: TemplateLibrary, groupLib: TemplateLibrary, edgeItems: FurnitureListItem[], centerItems: FurnitureListItem[], rankOffset: number, seed: number, doorZone?: Set<string>): PlaceResult {
  const rows=layout.length,cols=layout[0]?.length??0;
  const edgeCells=computeEdgeCells(layout,rows,cols),usedEdges: Record<number,number>={0:0,1:0,2:0,3:0};
  const placed: PlacedFurniture[]=[],diagnostics: string[]=[],rand=makePrng(seed);
  const outMaskA: Grid=maskA.map(r=>[...r]),outMaskB: Grid=maskB.map(r=>[...r]);
  let rankShift=0;
  function placeOne(item: FurnitureListItem, isCenter: boolean): void {
    const eR=rankOffset+item.rank+rankShift,allT=resolveTemplates(item,singleLib,groupLib);
    const tmpls=isCenter?allT.filter(t=>!t.placementEdges.length):allT.filter(t=>t.placementEdges.length>0);
    if(!tmpls.length){diagnostics.push(`[skip] ${item.name}`);return;}
    let bS=-Infinity,bA: [number,number]|null=null,bT: FurnitureTemplate|null=null,bE=-1;
    if(!isCenter){for(const tpl of shuffleArray(tmpls,rand))for(const edge of tpl.placementEdges){const cs=generateEdgeCandidates(layout,outMaskA,outMaskB,rows,cols,tpl,edge,edgeCells,rand,doorZone);for(const a of cs){const s=scorePlacement(placed,a,edge,usedEdges,edgeCells,rows,cols,false);if(s>bS){bS=s;bA=a;bT=tpl;bE=edge;}}}}
    else{for(const tpl of shuffleArray(tmpls,rand)){const cs=generateCenterCandidates(layout,outMaskA,outMaskB,rows,cols,tpl,rand,doorZone);for(const a of cs){const s=scorePlacement(placed,a,-1,usedEdges,edgeCells,rows,cols,true);if(s>bS){bS=s;bA=a;bT=tpl;}}}}
    if(!bA||!bT){diagnostics.push(`[skip] ${item.name}: no pos`);return;}
    applyPlacerMask(outMaskA,outMaskB,layout,rows,cols,bT,bA[0],bA[1],eR);
    if(!isCenter)usedEdges[bE]=(usedEdges[bE]??0)+1;
    const slots=maxMaskValue(bT);if(bT.isGroup&&slots>1)rankShift+=slots-1;
    placed.push({name:item.name,rank:item.rank,effectiveRank:eR,templateId:bT.id,templateMask:bT.mask,anchor:bA,edge:bE,isGroup:bT.isGroup,groupSlots:slots,components:bT.components});
  }
  for(const item of edgeItems)placeOne(item,false);
  for(const item of centerItems)placeOne(item,true);
  return{maskA:outMaskA,maskB:outMaskB,placed,diagnostics};
}

const EDGE_OCC=0.65,CTR_OCC=0.80,MX_FAIL=5;
function roomOccRatio(layout: Grid,maskA: Grid,maskB: Grid,rows: number,cols: number): number {
  let t=0,o=0;for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){if(!layout[r][c])continue;t++;if(maskA[r][c]||maskB[r][c])o++;}return t?o/t:1;
}
function edgeOccRatio(maskA: Grid,maskB: Grid,eCells: Record<number,Array<[number,number]>>): number {
  const all=Object.values(eCells).flat();if(!all.length)return 1;let o=0;for(const[r,c]of all)if(maskA[r][c]||maskB[r][c])o++;return o/all.length;
}
interface FillResult { maskA: Grid; maskB: Grid; placed: PlacedFurniture[]; diagnostics: string[]; }
function fillAll(layout: Grid, maskA: Grid, maskB: Grid, singleLib: TemplateLibrary, groupLib: TemplateLibrary, fillList: FurnitureListItem[], rankOffset: number, seed: number, doorZone?: Set<string>): FillResult {
  const rows=layout.length,cols=layout[0]?.length??0;
  const edgeCells=computeEdgeCells(layout,rows,cols),usedEdges: Record<number,number>={0:0,1:0,2:0,3:0};
  const placed: PlacedFurniture[]=[],diagnostics: string[]=[],rand=makePrng(seed);
  const outMaskA: Grid=maskA.map(r=>[...r]),outMaskB: Grid=maskB.map(r=>[...r]);
  let instanceCounter=0;
  for(const item of fillList){
    const isEdge=(item.placement??"edge")==="edge",oLim=isEdge?EDGE_OCC:CTR_OCC;
    const allT=resolveTemplates(item,singleLib,groupLib),tmpls=isEdge?allT.filter(t=>t.placementEdges.length>0):allT.filter(t=>!t.placementEdges.length);
    if(!tmpls.length){diagnostics.push(`[skip] ${item.name}`);continue;}
    let failCount=0;
    while(failCount<MX_FAIL){
      const ratio=isEdge?edgeOccRatio(outMaskA,outMaskB,edgeCells):roomOccRatio(layout,outMaskA,outMaskB,rows,cols);
      if(ratio>=oLim)break;
      let bS=-Infinity,bA: [number,number]|null=null,bT: FurnitureTemplate|null=null,bE=-1;
      if(isEdge){for(const tpl of shuffleArray(tmpls,rand))for(const edge of tpl.placementEdges){const cs=generateEdgeCandidates(layout,outMaskA,outMaskB,rows,cols,tpl,edge,edgeCells,rand,doorZone);for(const a of cs){const s=scorePlacement(placed,a,edge,usedEdges,edgeCells,rows,cols,false);if(s>bS){bS=s;bA=a;bT=tpl;bE=edge;}}}}
      else{for(const tpl of shuffleArray(tmpls,rand)){const cs=generateCenterCandidates(layout,outMaskA,outMaskB,rows,cols,tpl,rand,doorZone);for(const a of cs){const s=scorePlacement(placed,a,-1,usedEdges,edgeCells,rows,cols,true);if(s>bS){bS=s;bA=a;bT=tpl;}}}}
      if(!bA||!bT){failCount++;continue;}
      instanceCounter++;const iR=rankOffset+instanceCounter;
      applyFillerMask(outMaskA,outMaskB,layout,rows,cols,bT,bA[0],bA[1],iR);
      if(isEdge)usedEdges[bE]=(usedEdges[bE]??0)+1;
      placed.push({name:item.name,rank:item.rank,effectiveRank:iR,templateId:bT.id,templateMask:bT.mask,anchor:bA,edge:bE,isGroup:bT.isGroup,groupSlots:1,components:bT.components});
      failCount=0;
    }
  }
  return{maskA:outMaskA,maskB:outMaskB,placed,diagnostics};
}

function makeZeroGrid(rows: number, cols: number): Grid { return Array.from({length:rows},()=>new Array(cols).fill(0)); }

function findRoomComponents(roomGrid: Grid, rows: number, cols: number): Omit<RoomInfo,"category">[] {
  const visited: boolean[][]=Array.from({length:rows},()=>new Array(cols).fill(false));
  const rooms: Omit<RoomInfo,"category">[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    if(roomGrid[r][c]!==1||visited[r][c])continue;
    const cells: Cell[]=[],queue: Cell[]=[[r,c]];visited[r][c]=true;
    while(queue.length>0){const[cr,cc]=queue.shift()!;cells.push([cr,cc]);for(const[dr,dc]of[[-1,0],[1,0],[0,-1],[0,1]] as Cell[]){const nr=cr+dr,nc=cc+dc;if(nr>=0&&nr<rows&&nc>=0&&nc<cols&&!visited[nr][nc]&&roomGrid[nr][nc]===1){visited[nr][nc]=true;queue.push([nr,nc]);}}}
    const grid: Grid=makeZeroGrid(rows,cols);for(const[pr,pc]of cells)grid[pr][pc]=1;
    rooms.push({grid,area:cells.length});
  }
  return rooms.sort((a,b)=>b.area-a.area);
}

function buildDoorZone(doorGrid: Grid, rows: number, cols: number): Set<string> {
  const zone=new Set<string>();
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
    if(doorGrid[r][c]===0)continue;
    for(const[dr,dc]of[[0,0],[-1,0],[1,0],[0,-1],[0,1]]){const nr=r+dr,nc=c+dc;if(nr>=0&&nr<rows&&nc>=0&&nc<cols)zone.add(`${nr},${nc}`);}
  }
  return zone;
}
function splitFurnitureList(list: FurnitureListItem[]): {mainList: FurnitureListItem[];fillList: FurnitureListItem[]} {
  return{mainList:list.filter(i=>i.rank<=7),fillList:list.filter(i=>i.rank>=8)};
}
function filterByCategory(list: FurnitureListItem[], category: RoomCategory): FurnitureListItem[] {
  return list.filter(item=>{
    const lower=(item.furniture_id??"").toLowerCase();
    const prefix=lower.startsWith("large_")||lower.includes("_large")?"large":lower.startsWith("medium_")||lower.includes("_medium")?"medium":"small";
    if(category==="small")return prefix==="small";
    if(category==="medium")return prefix==="small"||prefix==="medium";
    return true;
  });
}

export function adaptiveRoomFurniturePlacer(input: Record<string, unknown>): Record<string, unknown> {
  const roomGrid=input.roomGrid as Grid|undefined;
  const doorGrid=input.doorGrid as Grid|undefined;
  const rawFurnitureList=input.furnitureList;
  const seedRaw=typeof input.seed==="number"?Math.floor(input.seed):42;
  const baseSeed=seedRaw===0?Date.now():seedRaw;
  if(!roomGrid||!Array.isArray(roomGrid)||!roomGrid.length) return{error:"roomGrid is required"};
  const rows=roomGrid.length,cols=roomGrid[0]?.length??0;
  const effectiveDoorGrid: Grid=doorGrid&&Array.isArray(doorGrid)&&doorGrid.length>0?doorGrid:makeZeroGrid(rows,cols);
  const furnitureList: FurnitureListItem[]=Array.isArray(rawFurnitureList)?rawFurnitureList as FurnitureListItem[]:[];
  const{mainList,fillList}=splitFurnitureList(furnitureList);
  const doorZone=buildDoorZone(effectiveDoorGrid,rows,cols);
  const singleLib=buildSingleLibrary(singleLibraryData),groupLib=buildGroupLibrary(groupLibraryData);
  const globalMaskA: Grid=makeZeroGrid(rows,cols);
  const allFurnitureIndex: FurnitureIndexEntry[]=[],roomReports: RoomReport[]=[];
  const rawRooms=findRoomComponents(roomGrid,rows,cols);
  const rooms: RoomInfo[]=rawRooms.map(r=>({...r,category:r.area>=LARGE_MIN_AREA?"large":r.area<=SMALL_MAX_AREA?"small":"medium" as RoomCategory}));
  for(let i=0;i<rooms.length;i++){
    const{grid:rGrid,area,category}=rooms[i];
    if(area<MIN_ROOM_AREA)continue;
    const roomSeed=baseSeed+i*999983,baseRankOffset=i*RANK_STRIDE;
    const zeroA=makeZeroGrid(rows,cols),zeroB=makeZeroGrid(rows,cols);
    const filteredMain=filterByCategory(mainList,category),filteredFill=filterByCategory(fillList,category);
    const edgeItems=filteredMain.filter(it=>(it.placement??"edge")==="edge").sort((a,b)=>a.rank-b.rank);
    const centerItems=filteredMain.filter(it=>it.placement==="center").sort((a,b)=>a.rank-b.rank);
    const{maskA:placedA,maskB:placedB,placed}=placeAll(rGrid,zeroA,zeroB,singleLib,groupLib,edgeItems,centerItems,baseRankOffset,roomSeed,doorZone);
    for(const p of placed){
      const od=calcPlacedDirection(p);
      for(let j=0;j<p.groupSlots;j++){
        const si=j+1,sl=p.components[String(si)],en=sl?`${p.name}_${sl}`:j===0?p.name:`${p.name}_组件${j}`;
        allFurnitureIndex.push({rank:p.effectiveRank+j,name:en,isGroup:p.isGroup,direction:p.isGroup?calcGroupSlotDirection(p.templateMask,si,od):od});
      }
    }
    let finalA=placedA,totalPlaced=placed.length;
    if(filteredFill.length>0){
      const maxMainRank=placed.reduce((max,p)=>Math.max(max,p.effectiveRank+p.groupSlots-1),baseRankOffset);
      const{maskA:filledA,placed:filledPlaced}=fillAll(rGrid,placedA,placedB,singleLib,groupLib,[...filteredFill].sort((a,b)=>a.rank-b.rank),maxMainRank,roomSeed+1,doorZone);
      finalA=filledA;totalPlaced+=filledPlaced.length;
      for(const p of filledPlaced){
        const od=calcPlacedDirection(p),dir=p.isGroup?calcGroupSlotDirection(p.templateMask,1,od):od;
        allFurnitureIndex.push({rank:p.effectiveRank,name:p.name,isGroup:p.isGroup,direction:dir});
      }
    }
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)if(finalA[r][c]!==0)globalMaskA[r][c]=finalA[r][c];
    roomReports.push({area,category,placedCount:totalPlaced});
  }
  allFurnitureIndex.sort((a,b)=>a.rank-b.rank);
  const collapseResult=furnitureNameCollapse({list:allFurnitureIndex,maskA:globalMaskA,type:"tile"});
  return{outputGrid:collapseResult.outputGrid??globalMaskA,nameList:collapseResult.nameList??[],furnitureIndex:allFurnitureIndex,roomReport:roomReports};
}
