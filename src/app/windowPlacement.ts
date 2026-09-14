export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Where the window stood when it was closed, and whether it was maximised then. */
export interface SavedWindow extends Rect {
  readonly maximized: boolean;
}

export interface Placement {
  /** Where to open the window, or null to let the system place it. */
  readonly bounds: Rect | null;
  readonly maximized: boolean;
}

/** How much of a remembered window must lie on a display for it to open there: enough of its title bar to grab. */
const VISIBLE_WIDTH = 200;
const VISIBLE_HEIGHT = 60;

/**
 * Where the window opens (ADR-0029): maximised on the very first start, since nothing was saved; afterwards where it
 * was closed, as long as enough of it still lies on a connected display — a window closed on a display that is gone
 * would otherwise open out of reach. Closed maximised, it opens maximised, with its normal size remembered underneath.
 */
export function placementOf(saved: SavedWindow | null, workAreas: readonly Rect[]): Placement {
  if (!saved) return { bounds: null, maximized: true };
  const { x, y, width, height } = saved;
  const onADisplay = workAreas.some(
    (area) =>
      Math.min(x + width, area.x + area.width) - Math.max(x, area.x) >= VISIBLE_WIDTH &&
      Math.min(y + height, area.y + area.height) - Math.max(y, area.y) >= VISIBLE_HEIGHT,
  );
  return { bounds: onADisplay ? { x, y, width, height } : null, maximized: saved.maximized };
}

/** The saved window as it is written to `window.json`. */
export function savedWindowText(saved: SavedWindow): string {
  return JSON.stringify(saved);
}

/** The saved window read back, or null for anything that is not one — nothing saved, then. */
export function readSavedWindow(text: string): SavedWindow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { x, y, width, height, maximized } = parsed as Record<string, unknown>;
  const numbers = [x, y, width, height].every((value) => typeof value === "number" && Number.isFinite(value));
  if (!numbers || typeof maximized !== "boolean") return null;
  if ((width as number) <= 0 || (height as number) <= 0) return null;
  return { x: x as number, y: y as number, width: width as number, height: height as number, maximized };
}
