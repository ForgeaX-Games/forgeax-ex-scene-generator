type Grid = number[][];

const PARK = 413;

function isGrid(value: unknown): value is Grid {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    Array.isArray(value[0]) &&
    ((value[0] as unknown[]).length === 0 ||
      typeof (value[0] as unknown[])[0] === "number")
  );
}

export function gtaParkOverlay(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.zoneGrid)) return { error: "zoneGrid is required" };

  const zoneGrid = input.zoneGrid as Grid;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;

  let cellCount = 0;
  const parkGrid: Grid = Array.from({ length: rows }, (_, y) =>
    Array.from({ length: cols }, (_, x) => {
      if (zoneGrid[y]?.[x] === PARK) {
        cellCount++;
        return PARK;
      }
      return 0;
    }),
  );

  return { parkGrid, outputGrid: parkGrid, cellCount };
}
