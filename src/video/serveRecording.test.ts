import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { serveRecording } from "./serveRecording";

// The window's <video> reads the Recording through SmartTrim's own address, a piece at a time (ADR-0027).
describe("serveRecording", () => {
  let workDir: string;
  let recordingPath: string;
  /** 1000 bytes that each say where they are, so any piece handed back can be checked against the file itself. */
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_byte, at) => (at * 7) % 251));

  beforeAll(() => {
    workDir = mkdtempSync(join(tmpdir(), "smarttrim-video-"));
    recordingPath = join(workDir, "Part1.mp4");
    writeFileSync(recordingPath, bytes);
  });
  afterAll(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  /** The Tabs as the store knows them: Tab 1 holds the Recording, every other Tab is closed. */
  const recordingPathOf = (tabId: number) => {
    if (tabId !== 1) throw new Error(`Tab ${tabId} is closed.`);
    return recordingPath;
  };
  const ask = (url: string, range?: string) =>
    serveRecording(new Request(url, range ? { headers: { Range: range } } : {}), recordingPathOf);

  test("a piece asked for comes back byte for byte as the file holds it", async () => {
    const piece = await ask("smarttrim-video://tab/1", "bytes=100-199");

    expect(piece.status).toBe(206);
    expect(piece.headers.get("Content-Range")).toBe("bytes 100-199/1000");
    expect(piece.headers.get("Content-Length")).toBe("100");
    expect(piece.headers.get("Content-Type")).toBe("video/mp4");
    expect(Buffer.from(await piece.arrayBuffer())).toEqual(bytes.subarray(100, 200));
  });

  // Chromium opens a video with "bytes=0-" and seeks with "bytes=<n>-"; without a Range it asks for the whole file.
  test("a piece from a byte to the end, and the whole file when no piece is named", async () => {
    const toTheEnd = await ask("smarttrim-video://tab/1", "bytes=900-");
    const whole = await ask("smarttrim-video://tab/1");

    expect([toTheEnd.status, toTheEnd.headers.get("Content-Range"), toTheEnd.headers.get("Content-Length")]).toEqual([
      206,
      "bytes 900-999/1000",
      "100",
    ]);
    expect(Buffer.from(await toTheEnd.arrayBuffer())).toEqual(bytes.subarray(900));
    expect([whole.status, whole.headers.get("Content-Length"), whole.headers.get("Accept-Ranges")]).toEqual([200, "1000", "bytes"]);
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes);
  });

  // The address is SmartTrim's own, and the window reaches it: it must never become a way to read any file on the disk.
  test("a piece past the end, a closed Tab and an address naming anything but a Tab are refused", async () => {
    const pastTheEnd = await ask("smarttrim-video://tab/1", "bytes=1000-");
    const closed = await ask("smarttrim-video://tab/2", "bytes=0-");
    const aPath = await ask("smarttrim-video://C:/Windows/win.ini", "bytes=0-");
    const notANumber = await ask("smarttrim-video://tab/1x", "bytes=0-");

    expect([pastTheEnd.status, pastTheEnd.headers.get("Content-Range")]).toEqual([416, "bytes */1000"]);
    expect([closed.status, aPath.status, notANumber.status]).toEqual([404, 404, 404]);
  });
});
