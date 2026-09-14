import { describe, expect, test } from "vitest";
import { waitOf } from "./waiting";

const idle = { text: "", bad: false };

describe("waitOf: a wait is shown where its outcome will land", () => {
  test("nothing running is no wait", () => {
    expect(waitOf({ cutting: false, job: null, readingCount: { done: 0, total: 0 }, status: idle })).toBeNull();
  });

  test("a read shows above the SourceTracks, filled by the SourceTracks done", () => {
    const wait = waitOf({
      cutting: false,
      job: { kind: "read", tabId: 3, positions: [0, 2, 4, 5] },
      readingCount: { done: 2, total: 4 },
      status: { text: "Liest den Ton der Tonspuren … 2 von 4 fertig", bad: false },
    });
    expect(wait).toEqual({ where: "sourceTracks", text: "Liest den Ton der Tonspuren … 2 von 4 fertig", share: 0.5 });
  });

  test("a scan and a project's audio show there too, with nothing to count", () => {
    const scan = waitOf({
      cutting: false,
      job: { kind: "scan", tabId: 3 },
      readingCount: { done: 0, total: 0 },
      status: { text: "Prüft die Tonspuren …", bad: false },
    });
    expect(scan).toEqual({ where: "sourceTracks", text: "Prüft die Tonspuren …", share: 0 });
    const project = waitOf({
      cutting: false,
      job: { kind: "projectAudio", tabId: 3 },
      readingCount: { done: 0, total: 0 },
      status: { text: "Liest den Ton für die Wellenform …", bad: false },
    });
    expect(project?.where).toBe("sourceTracks");
    expect(project?.share).toBe(0);
  });

  test("a single SourceTrack being read has no count either", () => {
    const wait = waitOf({
      cutting: false,
      job: { kind: "read", tabId: 3, positions: [4] },
      readingCount: { done: 0, total: 1 },
      status: { text: "Liest den Ton der Tonspur …", bad: false },
    });
    expect(wait?.share).toBe(0);
  });

  test("a cut shows where the result will appear, and wins over a read still running", () => {
    const wait = waitOf({
      cutting: true,
      job: { kind: "read", tabId: 3, positions: [0] },
      readingCount: { done: 0, total: 1 },
      status: { text: "Liest die Aufnahme …", bad: false },
    });
    expect(wait).toEqual({ where: "result", text: "Liest die Aufnahme …", share: 0 });
  });

  test("a cut with no line of its own still says it is cutting", () => {
    expect(waitOf({ cutting: true, job: null, readingCount: { done: 0, total: 0 }, status: idle })?.text).toBe("Schneidet …");
  });

  test("a refusal is never a wait: it stays a red line", () => {
    const refused = { text: "Die Tonspur ließ sich nicht lesen: …", bad: true };
    expect(
      waitOf({ cutting: false, job: { kind: "read", tabId: 3, positions: [0] }, readingCount: { done: 0, total: 1 }, status: refused }),
    ).toBeNull();
  });
});
