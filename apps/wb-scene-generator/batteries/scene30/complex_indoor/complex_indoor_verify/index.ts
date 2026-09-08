/**
 * complex_indoor_verify
 * Verifies all rooms are reachable from the initial room via BFS
 * on the connection graph. Repairs by detecting physically adjacent
 * rooms (sharing wall cells) and adding connections — does NOT paint
 * new corridors on the grid to avoid stray wall artifacts.
 */

export function complexIndoorVerify(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0) return { error: "inputGrid is required" };

  const grid = inputGrid.map(row => [...row]);
  const H = grid.length;
  const W = grid[0].length;

  const roomListRaw = input.roomList as any[] | undefined;
  if (!Array.isArray(roomListRaw) || roomListRaw.length === 0) {
    return { outputGrid: grid, roomList: roomListRaw || [], connectionList: input.connectionList || [] };
  }

  const roomList = roomListRaw.map((r: any) => ({ ...r }));
  const connListRaw = input.connectionList as any[] | undefined;
  const connectionList = Array.isArray(connListRaw) ? connListRaw.map((c: any) => ({ ...c })) : [];

  const roomIds = new Set(roomList.map((r: any) => r.id as number));
  const initialId = Math.min(...roomIds);

  const adj = new Map<number, Set<number>>();
  for (const id of roomIds) adj.set(id, new Set());
  for (const conn of connectionList) {
    const a = conn.roomA as number;
    const b = conn.roomB as number;
    if (adj.has(a) && adj.has(b)) {
      adj.get(a)!.add(b);
      adj.get(b)!.add(a);
    }
  }

  function bfsReachable(startId: number): Set<number> {
    const visited = new Set<number>();
    const queue = [startId];
    visited.add(startId);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of (adj.get(cur) || [])) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    return visited;
  }

  let reachable = bfsReachable(initialId);
  const unreachable = [...roomIds].filter(id => !reachable.has(id));

  if (unreachable.length > 0) {
    // Find physically adjacent room pairs by scanning wall cells
    // that touch two different room interiors
    const wallNeighborPairs = new Map<string, [number, number][]>();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x] !== 1) continue;
        const touching = new Set<number>();
        for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] > 1) {
            touching.add(grid[ny][nx]);
          }
        }
        const touchArr = [...touching].sort((a, b) => a - b);
        for (let i = 0; i < touchArr.length; i++) {
          for (let j = i + 1; j < touchArr.length; j++) {
            const key = `${touchArr[i]},${touchArr[j]}`;
            if (!wallNeighborPairs.has(key)) wallNeighborPairs.set(key, []);
            wallNeighborPairs.get(key)!.push([y, x]);
          }
        }
      }
    }

    // Add missing connections for physically adjacent rooms
    for (const [key, cells] of wallNeighborPairs) {
      const [aStr, bStr] = key.split(",");
      const a = parseInt(aStr), b = parseInt(bStr);
      if (!roomIds.has(a) || !roomIds.has(b)) continue;
      const alreadyConnected = adj.get(a)?.has(b) || adj.get(b)?.has(a);
      if (!alreadyConnected) {
        connectionList.push({ roomA: a, roomB: b, sharedWallCells: cells });
        if (!adj.has(a)) adj.set(a, new Set());
        if (!adj.has(b)) adj.set(b, new Set());
        adj.get(a)!.add(b);
        adj.get(b)!.add(a);
      }
    }
  }

  return {
    outputGrid: grid,
    roomList,
    connectionList,
  };
}
