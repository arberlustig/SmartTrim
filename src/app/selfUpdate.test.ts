import { describe, expect, test } from "vitest";
import { mayCheckAgain, nextUpdateState, updateNotice, type UpdateEvent, type UpdateState } from "./selfUpdate";
import { TEXTS } from "./texts";

/** The state after a run of the updater's events, from a SmartTrim that has not asked yet. */
const after = (...events: UpdateEvent[]): UpdateState =>
  events.reduce(nextUpdateState, { kind: "idle" } satisfies UpdateState as UpdateState);

describe("nextUpdateState: what an update is doing, from the updater's events", () => {
  test("a newer version is found, loaded and then ready to be installed", () => {
    expect(after({ type: "checking" }, { type: "found", version: "1.3.0" })).toEqual({
      kind: "downloading",
      version: "1.3.0",
      percent: 0,
    });
    expect(after({ type: "checking" }, { type: "found", version: "1.3.0" }, { type: "progress", percent: 41.7 })).toEqual({
      kind: "downloading",
      version: "1.3.0",
      percent: 41,
    });
    expect(
      after({ type: "checking" }, { type: "found", version: "1.3.0" }, { type: "downloaded", version: "1.3.0" }),
    ).toEqual({ kind: "ready", version: "1.3.0" });
  });

  test("no newer version leaves SmartTrim current", () => {
    expect(after({ type: "checking" }, { type: "current" })).toEqual({ kind: "current" });
  });

  // Offline, GitHub away, or a release without its latest.yml: the check itself failed, and there is nothing a
  // user can do about it while cutting. It is logged, not shown.
  test("a check that fails before anything was found is unreachable, not a failed update", () => {
    expect(after({ type: "checking" }, { type: "failed" })).toEqual({ kind: "unreachable" });
  });

  // Once "wird geladen" was on screen, silence would leave it there for ever — or let the user believe it arrived.
  test("a found version that does not arrive is a failed update, by its version", () => {
    expect(
      after({ type: "checking" }, { type: "found", version: "1.3.0" }, { type: "progress", percent: 60 }, { type: "failed" }),
    ).toEqual({ kind: "failed", version: "1.3.0" });
  });

  test("an update that is ready stays ready whatever a later event says", () => {
    const ready = after({ type: "found", version: "1.3.0" }, { type: "downloaded", version: "1.3.0" });
    for (const event of [{ type: "checking" }, { type: "current" }, { type: "failed" }, { type: "progress", percent: 3 }] as const) {
      expect(nextUpdateState(ready, event)).toEqual(ready);
    }
  });

  test("progress without a download under way changes nothing", () => {
    expect(after({ type: "checking" }, { type: "progress", percent: 50 })).toEqual({ kind: "checking" });
  });
});

describe("mayCheckAgain: whether the next check may run", () => {
  test("only when nothing is under way and nothing is waiting to be installed", () => {
    expect(mayCheckAgain({ kind: "idle" })).toBe(true);
    expect(mayCheckAgain({ kind: "current" })).toBe(true);
    expect(mayCheckAgain({ kind: "unreachable" })).toBe(true);
    // A download that broke off is tried again with the next check.
    expect(mayCheckAgain({ kind: "failed", version: "1.3.0" })).toBe(true);
    expect(mayCheckAgain({ kind: "checking" })).toBe(false);
    expect(mayCheckAgain({ kind: "downloading", version: "1.3.0", percent: 10 })).toBe(false);
    expect(mayCheckAgain({ kind: "ready", version: "1.3.0" })).toBe(false);
  });
});

describe("updateNotice: what the window says about an update", () => {
  test("nothing while checking, when current, or when the check could not be made", () => {
    for (const state of [{ kind: "idle" }, { kind: "checking" }, { kind: "current" }, { kind: "unreachable" }] as const) {
      expect(updateNotice(state, TEXTS.de)).toBeNull();
    }
  });

  test("a download says which version and how far, in the language spoken", () => {
    expect(updateNotice({ kind: "downloading", version: "1.3.0", percent: 41 }, TEXTS.de)).toEqual({
      text: "SmartTrim 1.3.0 wird geladen … 41 %",
      restart: false,
    });
    expect(updateNotice({ kind: "downloading", version: "1.3.0", percent: 41 }, TEXTS.en)?.text).toBe(
      "Loading SmartTrim 1.3.0 … 41 %",
    );
  });

  test("a ready update says it installs on closing, and offers to restart now", () => {
    expect(updateNotice({ kind: "ready", version: "1.3.0" }, TEXTS.de)).toEqual({
      text: "SmartTrim 1.3.0 ist bereit und wird beim Schließen installiert.",
      restart: true,
    });
  });

  test("a failed download says so, and offers nothing to press", () => {
    expect(updateNotice({ kind: "failed", version: "1.3.0" }, TEXTS.en)).toEqual({
      text: "SmartTrim 1.3.0 could not be loaded – SmartTrim will try again later.",
      restart: false,
    });
  });
});
