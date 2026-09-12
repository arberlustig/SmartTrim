/** The stretch of the Recording the zoomed waveform is showing. */
export interface ZoomWindow {
  fromSeconds: number;
  toSeconds: number;
}

/**
 * How close the zoom goes. Ten seconds across the window is about eighty pixels a second, enough to see a single
 * join; closer than that there is nothing left to learn from the picture.
 */
export const CLOSEST_WINDOW_SECONDS = 10;

/**
 * Sets the width of the window, keeping whatever was in the middle in the middle. Refuses nothing: a width wider
 * than the Recording becomes the whole Recording, a narrower one than the closest zoom becomes that, and a window
 * that would hang off either end is slid back on.
 */
export function zoomedTo(window: ZoomWindow, recordingSeconds: number, widthSeconds: number): ZoomWindow {
  const width = Math.min(Math.max(widthSeconds, CLOSEST_WINDOW_SECONDS), recordingSeconds);
  const middle = (window.fromSeconds + window.toSeconds) / 2;
  return slidOntoRecording(middle - width / 2, width, recordingSeconds);
}

/**
 * Slides the window along by a stretch of time, keeping its width. Scrolling hard at either end stops there rather
 * than carrying the window off the Recording and drawing empty space beside the waveform.
 */
export function pannedBy(window: ZoomWindow, recordingSeconds: number, bySeconds: number): ZoomWindow {
  const width = window.toSeconds - window.fromSeconds;
  return slidOntoRecording(window.fromSeconds + bySeconds, width, recordingSeconds);
}

/** Puts a window of the given width at the given start, moved back onto the Recording if it hangs off an end. */
function slidOntoRecording(fromSeconds: number, widthSeconds: number, recordingSeconds: number): ZoomWindow {
  const from = Math.min(Math.max(fromSeconds, 0), recordingSeconds - widthSeconds);
  return { fromSeconds: from, toSeconds: from + widthSeconds };
}
