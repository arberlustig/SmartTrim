import { describe, expect, test } from "vitest";
import { placementOf, readSavedWindow, savedWindowText } from "./windowPlacement";

const screen = { x: 0, y: 0, width: 2560, height: 1040 };
const second = { x: 2560, y: 0, width: 1920, height: 1040 };

describe("placementOf: where the window opens", () => {
  test("the very first start is maximised, wherever the system puts the window", () => {
    expect(placementOf(null, [screen])).toEqual({ bounds: null, maximized: true });
  });

  test("a window closed on a display still there opens where it stood", () => {
    const saved = { x: 200, y: 60, width: 820, height: 760, maximized: false };
    expect(placementOf(saved, [screen])).toEqual({ bounds: { x: 200, y: 60, width: 820, height: 760 }, maximized: false });
  });

  test("a window closed maximised opens maximised again, remembering its normal size underneath", () => {
    const saved = { x: 200, y: 60, width: 820, height: 760, maximized: true };
    expect(placementOf(saved, [screen])).toEqual({ bounds: { x: 200, y: 60, width: 820, height: 760 }, maximized: true });
  });

  test("a window closed on a display that is gone comes back onto a display, its size kept", () => {
    const saved = { x: 2700, y: 100, width: 820, height: 760, maximized: false };
    expect(placementOf(saved, [screen])).toEqual({ bounds: null, maximized: false });
    // With the second display back, the same bounds are fine again.
    expect(placementOf(saved, [screen, second]).bounds).toEqual({ x: 2700, y: 100, width: 820, height: 760 });
  });

  test("a window hanging mostly off every display is put back by the system", () => {
    const saved = { x: 2400, y: 1000, width: 820, height: 760, maximized: false };
    expect(placementOf(saved, [screen]).bounds).toBeNull();
  });
});

describe("the saved window file", () => {
  test("round-trips", () => {
    const saved = { x: 12, y: 34, width: 1200, height: 900, maximized: true };
    expect(readSavedWindow(savedWindowText(saved))).toEqual(saved);
  });

  test("anything but a saved window reads as nothing saved", () => {
    expect(readSavedWindow("")).toBeNull();
    expect(readSavedWindow("not json")).toBeNull();
    expect(readSavedWindow('{"width":"wide"}')).toBeNull();
    expect(readSavedWindow('{"x":0,"y":0,"width":0,"height":600,"maximized":false}')).toBeNull();
  });
});
