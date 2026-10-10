/** Vertical insertion math used by the Configure Tabs row drag path. */
export function insertionIndexFromMidpoints(
  rows: readonly { top: number; height: number }[],
  y: number,
): number {
  for (let index = 0; index < rows.length; index++) {
    if (y < rows[index]!.top + rows[index]!.height / 2) return index
  }
  return rows.length
}
