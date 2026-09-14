import { describe, expect, test } from "vitest";
import { waitOf, type Waiting } from "./waiting";

const idle = { text: "", bad: false };

/** A Tab waiting for one job, its status line the job's own. */
function waiting(job: Waiting["job"], text: string, readingCount = { done: 0, total: 0 }): Waiting {
  return { cutting: false, job, readingCount, status: { text, bad: false }, statusFromJob: true };
}

describe("waitOf: a wait is shown where its outcome will land", () => {
  test("nothing running is no wait", () => {
    expect(waitOf({ ...waiting(null, ""), statusFromJob: false })).toBeNull();
  });

  test("a read shows above the SourceTracks, filled by the SourceTracks done", () => {
    const wait = waitOf(
      waiting({ kind: "read", tabId: 3, positions: [0, 2, 4, 5] }, "Liest den Ton der Tonspuren … 2 von 4 fertig", {
        done: 2,
        total: 4,
      }),
    );
    expect(wait).toEqual({ where: "sourceTracks", text: "Liest den Ton der Tonspuren … 2 von 4 fertig", share: 0.5 });
  });

  test("a scan and a project's audio show there too, with nothing to count", () => {
    const scan = waitOf(waiting({ kind: "scan", tabId: 3 }, "Prüft die Tonspuren …"));
    expect(scan).toEqual({ where: "sourceTracks", text: "Prüft die Tonspuren …", share: 0 });
    const project = waitOf(waiting({ kind: "projectAudio", tabId: 3 }, "Liest den Ton für die Wellenform …"));
    expect(project?.where).toBe("sourceTracks");
    expect(project?.share).toBe(0);
  });

  test("a single SourceTrack being read has no count either", () => {
    const wait = waitOf(waiting({ kind: "read", tabId: 3, positions: [4] }, "Liest den Ton der Tonspur …", { done: 0, total: 1 }));
    expect(wait?.share).toBe(0);
  });

  test("news in the status line stays there: the bars say what the job does instead", () => {
    const wait = waitOf({
      ...waiting({ kind: "read", tabId: 3, positions: [0, 2] }, "Projekt gespeichert: C:/x.smarttrim", { done: 0, total: 2 }),
      statusFromJob: false,
    });
    expect(wait).toEqual({ where: "sourceTracks", text: "Liest den Ton der Tonspuren …", share: 0 });
    expect(waitOf({ ...waiting({ kind: "scan", tabId: 3 }, "Plant neu …"), statusFromJob: false })?.text).toBe("Prüft die Tonspuren …");
  });

  test("a cut shows where the result will appear, and wins over a read still running", () => {
    const wait = waitOf({
      ...waiting({ kind: "read", tabId: 3, positions: [0] }, "Liest die Aufnahme …", { done: 0, total: 1 }),
      cutting: true,
    });
    expect(wait).toEqual({ where: "result", text: "Liest die Aufnahme …", share: 0 });
  });

  test("a cut with no line of its own still says it is cutting", () => {
    expect(waitOf({ cutting: true, job: null, readingCount: { done: 0, total: 0 }, status: idle, statusFromJob: false })?.text).toBe(
      "Schneidet …",
    );
  });

  test("a refusal is never a wait: it stays a red line", () => {
    const refused = { text: "Die Tonspur ließ sich nicht lesen: …", bad: true };
    expect(
      waitOf({
        cutting: false,
        job: { kind: "read", tabId: 3, positions: [0] },
        readingCount: { done: 0, total: 1 },
        status: refused,
        statusFromJob: false,
      }),
    ).toBeNull();
  });
});
