/** SmartTrim's own address scheme, through which the window's <video> reads a Tab's Recording (ADR-0027). */
export const VIDEO_SCHEME = "smarttrim-video";

/** Where the window's <video> finds a Tab's Recording. It names the Tab, never a path on the disk. */
export function videoAddressOf(tabId: number): string {
  return `${VIDEO_SCHEME}://tab/${tabId}`;
}
