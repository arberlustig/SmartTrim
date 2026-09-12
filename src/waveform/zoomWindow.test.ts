import { describe, expect, test } from "vitest";
import { CLOSEST_WINDOW_SECONDS, pannedBy, zoomedTo } from "./zoomWindow";

describe("the zoom window", () => {
  // Zooming around the middle of what you are looking at is what keeps the place you were studying on screen.
  test("zooming in keeps the middle of the window where it was", () => {
    expect(zoomedTo({ fromSeconds: 0, toSeconds: 100 }, 1000, 20)).toEqual({ fromSeconds: 40, toSeconds: 60 });
  });

  test("does not zoom closer than the closest zoom", () => {
    expect(zoomedTo({ fromSeconds: 100, toSeconds: 200 }, 1000, 2)).toEqual({
      fromSeconds: 150 - CLOSEST_WINDOW_SECONDS / 2,
      toSeconds: 150 + CLOSEST_WINDOW_SECONDS / 2,
    });
  });

  test("does not zoom out past the whole Recording", () => {
    expect(zoomedTo({ fromSeconds: 100, toSeconds: 200 }, 1000, 99999)).toEqual({
      fromSeconds: 0,
      toSeconds: 1000,
    });
  });

  // Zooming out near an end would otherwise put the window partly before the Recording starts, and the waveform
  // would be drawn with empty space beside it.
  test("a window that would hang off an end is slid back onto the Recording", () => {
    expect(zoomedTo({ fromSeconds: 0, toSeconds: 20 }, 1000, 100)).toEqual({ fromSeconds: 0, toSeconds: 100 });
    expect(zoomedTo({ fromSeconds: 980, toSeconds: 1000 }, 1000, 100)).toEqual({
      fromSeconds: 900,
      toSeconds: 1000,
    });
  });

  // A Recording shorter than the closest zoom is still a Recording; it is simply all on screen at once.
  test("a Recording shorter than the closest zoom shows whole", () => {
    expect(zoomedTo({ fromSeconds: 0, toSeconds: 4 }, 4, 10)).toEqual({ fromSeconds: 0, toSeconds: 4 });
  });
});

describe("sliding the zoom window along", () => {
  test("moves the window by the time asked for, keeping its width", () => {
    expect(pannedBy({ fromSeconds: 100, toSeconds: 200 }, 1000, 50)).toEqual({
      fromSeconds: 150,
      toSeconds: 250,
    });
    expect(pannedBy({ fromSeconds: 100, toSeconds: 200 }, 1000, -50)).toEqual({
      fromSeconds: 50,
      toSeconds: 150,
    });
  });

  // Scrolling hard at either end must stop at the end, not leave the Recording behind and show empty space.
  test("stops at the start and at the end of the Recording", () => {
    expect(pannedBy({ fromSeconds: 100, toSeconds: 200 }, 1000, -9999)).toEqual({
      fromSeconds: 0,
      toSeconds: 100,
    });
    expect(pannedBy({ fromSeconds: 100, toSeconds: 200 }, 1000, 9999)).toEqual({
      fromSeconds: 900,
      toSeconds: 1000,
    });
  });

  test("a window already showing the whole Recording does not move", () => {
    expect(pannedBy({ fromSeconds: 0, toSeconds: 1000 }, 1000, 250)).toEqual({
      fromSeconds: 0,
      toSeconds: 1000,
    });
  });
});
