/**
 * buildingInnerDoor: 在内墙上开门，确保所有室内房间互通（Kruskal MST）
 * 原电池: building_inner_door
 */

import type { Grid } from "./buildingCarve.js";

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223; s = s >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

class UnionFind {
  private parent: number[]; private rank: number[];
  constructor(n: number) { this.parent = Array.from({ length: n }, (_, i) => i); this.rank = new Array(n).fill(0); }
  find(x: number): number { return this.parent[x] === x ? x : (this.parent[x] = this.find(this.parent[x])); }
  union(x: number, y: number): boolean {
    const px = this.find(x), py = this.find(y); if (px === py) return false;
    if (this.rank[px] < this.rank[py]) this.parent[px] = py;
    else if (this.rank[px] > this.rank[py]) this.parent[py] = px;
    else { this.parent[py] = px; this.rank[px]++; } return true;
  }
  connected(x: number, y: number): boolean { return this.find(x) === this.find(y); }
}

function labelRegions(grid: Grid, rows: number, cols: number): { labels: Int32Array; roomCount: number; exteriorIds: Set<number> } {
  const labels = new Int32Array(rows * cols).fill(-1); let roomCount = 0;
  const dx = [0,0,1,-1], dy = [1,-1,0,0];
  function bfs(startKey: number, label: number) {
    labels[startKey] = label; const q = [startKey]; let head = 0;
    while (head < q.length) {
      const key = q[head++]; const cr = Math.floor(key/cols), cc = key%cols;
      for (let d = 0; d < 4; d++) {
        const nr = cr+dx[d], nc = cc+dy[d];
        if (nr<0||nr>=rows||nc<0||nc>=cols) continue;
        const nk = nr*cols+nc;
        if (grid[nr][nc]===0 && labels[nk]===-1) { labels[nk]=label; q.push(nk); }
      }
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (grid[r][c]===0 && labels[r*cols+c]===-1) bfs(r*cols+c, roomCount++);
  const ext = new Set<number>();
  for (let c = 0; c < cols; c++) { const t=labels[c],b=labels[(rows-1)*cols+c]; if(t!==-1)ext.add(t); if(b!==-1)ext.add(b); }
  for (let r = 0; r < rows; r++) { const l=labels[r*cols],rr=labels[r*cols+cols-1]; if(l!==-1)ext.add(l); if(rr!==-1)ext.add(rr); }
  return { labels, roomCount, exteriorIds: ext };
}

interface WallSeg { wallCells: number[]; roomA: number; roomB: number; }

function collectSegments(grid: Grid, labels: Int32Array, rows: number, cols: number, ext: Set<number>): WallSeg[] {
  const segs: WallSeg[] = [];
  const indoor = (id: number) => id !== -1 && !ext.has(id);

  for (let r = 0; r < rows; r++) {
    let s=-1, rA=-1, rB=-1;
    for (let c = 0; c <= cols; c++) {
      let inner=false, a=-1, b=-1;
      if (c<cols && grid[r][c]!==0) {
        const top = r>0&&grid[r-1][c]===0?labels[(r-1)*cols+c]:-1;
        const bot = r<rows-1&&grid[r+1][c]===0?labels[(r+1)*cols+c]:-1;
        if (indoor(top)&&indoor(bot)&&top!==bot) { inner=true; a=Math.min(top,bot); b=Math.max(top,bot); }
      }
      if (s!==-1 && (!inner||a!==rA||b!==rB)) {
        const cells: number[] = [];
        for (let wc=s; wc<c; wc++) cells.push(r*cols+wc);
        if (cells.length>=2) segs.push({ wallCells:cells, roomA:rA, roomB:rB });
        s=-1;
      }
      if (inner && s===-1) { s=c; rA=a; rB=b; }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s=-1, rA=-1, rB=-1;
    for (let r = 0; r <= rows; r++) {
      let inner=false, a=-1, b=-1;
      if (r<rows && grid[r][c]!==0) {
        const left = c>0&&grid[r][c-1]===0?labels[r*cols+c-1]:-1;
        const right = c<cols-1&&grid[r][c+1]===0?labels[r*cols+c+1]:-1;
        if (indoor(left)&&indoor(right)&&left!==right) { inner=true; a=Math.min(left,right); b=Math.max(left,right); }
      }
      if (s!==-1 && (!inner||a!==rA||b!==rB)) {
        const cells: number[] = [];
        for (let wr=s; wr<r; wr++) cells.push(wr*cols+c);
        if (cells.length>=2) segs.push({ wallCells:cells, roomA:rA, roomB:rB });
        s=-1;
      }
      if (inner && s===-1) { s=r; rA=a; rB=b; }
    }
  }
  return segs;
}

function openDoor(seg: WallSeg, outG: Grid, doorG: Grid, cols: number, rand: () => number): void {
  const cells = seg.wallCells, len = cells.length;
  const minW = 2, maxW = 4, maxA = Math.min(maxW, len-2);
  let start: number, width: number;
  if (maxA < minW) { width=Math.min(minW,len); start=Math.floor((len-width)/2); }
  else { width=minW+Math.floor(rand()*(maxA-minW+1)); start=1+Math.floor(rand()*(len-width-1)); }
  for (let i=start; i<start+width; i++) {
    const k=cells[i]; outG[Math.floor(k/cols)][k%cols]=0; doorG[Math.floor(k/cols)][k%cols]=1;
  }
}

export function innerDoorOne(inputGrid: Grid, seedRaw: number): { outputGrid: Grid; doorGrid: Grid } {
  const rows=inputGrid.length, cols=inputGrid[0].length;
  const rand=makeLCG(seedRaw);
  const outputGrid: Grid = inputGrid.map(row=>[...row]);
  const doorGrid: Grid = Array.from({ length:rows }, ()=>new Array(cols).fill(0));
  const { labels, roomCount, exteriorIds } = labelRegions(inputGrid, rows, cols);
  const indoor: number[] = [];
  for (let i=0; i<roomCount; i++) if (!exteriorIds.has(i)) indoor.push(i);
  if (indoor.length<=1) return { outputGrid, doorGrid };
  const segs = collectSegments(inputGrid, labels, rows, cols, exteriorIds);
  if (segs.length===0) return { outputGrid, doorGrid };
  const idxMap = new Map<number,number>(); indoor.forEach((id,i)=>idxMap.set(id,i));
  const uf = new UnionFind(indoor.length);
  shuffle(segs, rand);
  const chosen: WallSeg[] = [];
  for (const seg of segs) {
    const ia=idxMap.get(seg.roomA), ib=idxMap.get(seg.roomB);
    if (ia===undefined||ib===undefined) continue;
    if (!uf.connected(ia,ib)) { uf.union(ia,ib); chosen.push(seg); }
  }
  for (const seg of chosen) openDoor(seg, outputGrid, doorGrid, cols, rand);
  return { outputGrid, doorGrid };
}

/** 批量内墙开门 */
export function buildingInnerDoor(gridList: Grid[], seedRaw: number): { outputGridList: Grid[]; doorGridList: Grid[] } {
  const baseSeed = seedRaw===0?Date.now():seedRaw;
  const outputGridList: Grid[]=[], doorGridList: Grid[]=[];
  gridList.forEach((grid,i)=>{
    if (!grid||grid.length===0||!grid[0]||grid[0].length===0) { outputGridList.push([]); doorGridList.push([]); return; }
    const res=innerDoorOne(grid, baseSeed+i*999983);
    outputGridList.push(res.outputGrid); doorGridList.push(res.doorGrid);
  });
  return { outputGridList, doorGridList };
}
