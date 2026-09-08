/**
 * buildingWindow: 在墙体上开窗（窗要求内外两侧都是空格）
 * 原电池: building_window
 */

import type { Grid } from "./buildingCarve.js";

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223; s = s >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) { const j=Math.floor(rand()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
}

interface WinCand { r: number; c: number; dir: "H" | "V"; width: number; }

/**
 * 判断水平窗 (r, c..c+w-1) 的扩展段 (r, c-1..c+w) 是否完整在同一连续横向墙体段内。
 * 即 c-1 和 c+w 也必须是非零格（若在边界内）。
 */
function isOnHWallSegment(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  const lo = c - 1, hi = c + w;
  if (lo >= 0 && grid[r][lo] === 0) return false;
  if (hi < cols && grid[r][hi] === 0) return false;
  return true;
}

/**
 * 判断垂直窗 (r..r+w-1, c) 的扩展段 (r-1..r+w, c) 是否完整在同一连续纵向墙体段内。
 */
function isOnVWallSegment(grid: Grid, rows: number, cols: number, r: number, c: number, w: number): boolean {
  const lo = r - 1, hi = r + w;
  if (lo >= 0 && grid[lo][c] === 0) return false;
  if (hi < rows && grid[hi][c] === 0) return false;
  return true;
}

function collectCands(grid: Grid, rows: number, cols: number, w: number): WinCand[] {
  const cands: WinCand[] = [];
  for (let r=0; r<rows; r++) {
    for (let c=0; c<=cols-w; c++) {
      if (Array.from({length:w},(_,i)=>grid[r][c+i]).every(v=>v!==0) &&
          r>0&&grid[r-1][c]===0 && r<rows-1&&grid[r+1][c]===0 &&
          isOnHWallSegment(grid, rows, cols, r, c, w))
        cands.push({r,c,dir:"H",width:w});
    }
  }
  for (let c=0; c<cols; c++) {
    for (let r=0; r<=rows-w; r++) {
      if (Array.from({length:w},(_,i)=>grid[r+i][c]).every(v=>v!==0) &&
          c>0&&grid[r][c-1]===0 && c<cols-1&&grid[r][c+1]===0 &&
          isOnVWallSegment(grid, rows, cols, r, c, w))
        cands.push({r,c,dir:"V",width:w});
    }
  }
  return cands;
}

function cells(cand: WinCand, cols: number): number[] {
  if (cand.dir==="H") return Array.from({length:cand.width},(_,i)=>cand.r*cols+cand.c+i);
  return Array.from({length:cand.width},(_,i)=>(cand.r+i)*cols+cand.c);
}

function exclusion(cand: WinCand, cols: number): number[] {
  const cs = cells(cand, cols);
  if (cand.dir==="H") { if(cand.c-1>=0) cs.push(cand.r*cols+(cand.c-1)); cs.push(cand.r*cols+(cand.c+cand.width)); }
  else { if(cand.r-1>=0) cs.push((cand.r-1)*cols+cand.c); cs.push((cand.r+cand.width)*cols+cand.c); }
  return cs;
}

function pickWindows(cands: WinCand[], count: number, cols: number): WinCand[] {
  const occ=new Set<number>(), result: WinCand[]=[];
  for (const c of cands) {
    if (result.length>=count) break;
    const cs=cells(c,cols); if(cs.some(k=>occ.has(k))) continue;
    exclusion(c,cols).forEach(k=>occ.add(k)); result.push(c);
  }
  return result;
}

function uniformPick<T>(arr: T[], count: number): T[] {
  if (count<=0||arr.length===0) return [];
  if (count>=arr.length) return [...arr];
  const step=arr.length/count;
  return Array.from({length:count},(_,i)=>arr[Math.floor(i*step+step/2)]);
}

export function windowOne(wallGrid: Grid, windowCount: number, windowWidth: number, randomEnable: boolean, seedRaw: number): { outputGrid: Grid; windowGrid: Grid } {
  const rows=wallGrid.length, cols=wallGrid[0].length;
  const outputGrid: Grid = wallGrid.map(row=>[...row]);
  const windowGrid: Grid = Array.from({length:rows},()=>new Array(cols).fill(0));
  if (windowCount===0) return {outputGrid,windowGrid};
  const cands=collectCands(wallGrid,rows,cols,windowWidth);
  if (cands.length===0) return {outputGrid,windowGrid};

  let ordered: WinCand[];
  if (randomEnable) { const rand=makeLCG(seedRaw); const sh=[...cands]; shuffle(sh,rand); ordered=sh; }
  else { ordered=uniformPick([...cands].sort((a,b)=>a.dir.localeCompare(b.dir)||a.r-b.r||a.c-b.c), windowCount); }

  const chosen=pickWindows(ordered,windowCount,cols);
  for (const w of chosen) {
    for (const k of cells(w,cols)) { const r=Math.floor(k/cols),c=k%cols; outputGrid[r][c]=0; windowGrid[r][c]=1; }
  }
  return {outputGrid,windowGrid};
}

/** 批量开窗 */
export function buildingWindow(wallGridList: Grid[], windowCount: number, windowWidth: number, randomEnable: boolean, seedRaw: number): { outputGridList: Grid[]; windowGridList: Grid[] } {
  const baseSeed=seedRaw===0?Date.now():seedRaw;
  const outputGridList: Grid[]=[], windowGridList: Grid[]=[];
  wallGridList.forEach((grid,i)=>{
    if (!grid||grid.length===0||!grid[0]||grid[0].length===0) { outputGridList.push([]); windowGridList.push([]); return; }
    const res=windowOne(grid,windowCount,windowWidth,randomEnable,baseSeed+i*999983);
    outputGridList.push(res.outputGrid); windowGridList.push(res.windowGrid);
  });
  return {outputGridList,windowGridList};
}
