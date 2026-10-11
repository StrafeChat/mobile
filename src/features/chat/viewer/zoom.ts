/** The viewer's zoom steps (the web's ZOOM_STEPS) and stepping between them. */
export const ZOOM_STEPS = [1, 1.5, 2, 3, 4];

/** The next zoom step from `current` in direction `dir` (the web's stepZoom). */
export function stepZoom(current: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i]! < current - 0.01) return ZOOM_STEPS[i]!;
  return 1;
}
