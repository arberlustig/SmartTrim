import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

/** What a <video> is told it is reading, by the Recording's extension. */
const CONTENT_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime" };

/**
 * Answers the window's <video> reading a Tab's Recording through `smarttrim-video://tab/<id>` (ADR-0027). It answers
 * Range requests itself from the file: passing the request on to `net.fetch` of the file never answered on a 23 GB
 * Recording (ADR-0022). Only a Tab's own Recording is served, looked up by `recordingPathOf`, never a path from the URL.
 */
export async function serveRecording(request: Request, recordingPathOf: (tabId: number) => string): Promise<Response> {
  const url = new URL(request.url);
  const [, tabId] = /^\/(\d+)$/.exec(url.pathname) ?? [];
  let path: string;
  try {
    if (url.host !== "tab" || tabId === undefined) throw new Error(`${request.url} names no Tab.`);
    path = recordingPathOf(Number(tabId));
  } catch {
    // Whatever is not a Tab's Recording does not exist, as far as this address goes.
    return new Response(null, { status: 404 });
  }
  const size = (await stat(path)).size;
  const headers = {
    "Content-Type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  const range = request.headers.get("Range");
  if (range === null) {
    return new Response(streamOf(path, 0, size - 1), { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  }

  // "bytes=<first>-<last>" or "bytes=<first>-": what Chromium's media stack sends.
  const [, first, last] = /^bytes=(\d+)-(\d*)$/.exec(range) ?? [];
  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  // A piece that starts past the end, ends before it starts, or is written some other way cannot be answered.
  if (first === undefined || start > end) {
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
  }
  return new Response(streamOf(path, start, end), {
    status: 206,
    headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
  });
}

/** The bytes `start` to `end` of the file, both included, read as they are asked for rather than all at once. */
function streamOf(path: string, start: number, end: number): ReadableStream {
  return Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
}
