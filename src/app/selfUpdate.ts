import type { Texts } from "./texts.ts";

/**
 * What the updater reports, reduced to what the window needs (ADR-0032). The main process turns electron-updater's
 * events into these; nothing here knows about electron-updater itself.
 */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "current" }
  | { type: "found"; version: string }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "failed" };

/**
 * Where SmartTrim's own update stands. "unreachable" is a check that failed before any newer version was found —
 * offline, say — and shows nothing; "failed" is a newer version that was found and did not arrive.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "unreachable" }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "failed"; version: string };

export function nextUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  // A downloaded update is installed when SmartTrim closes; nothing a later check says can take that back.
  if (state.kind === "ready") return state;
  switch (event.type) {
    case "checking":
      return { kind: "checking" };
    case "current":
      return { kind: "current" };
    case "found":
      return { kind: "downloading", version: event.version, percent: 0 };
    case "progress":
      return state.kind === "downloading" ? { ...state, percent: Math.floor(event.percent) } : state;
    case "downloaded":
      return { kind: "ready", version: event.version };
    case "failed":
      return state.kind === "downloading" || state.kind === "failed"
        ? { kind: "failed", version: state.version }
        : { kind: "unreachable" };
  }
}

/** Whether another check may start: never over one under way, and never once an update waits to be installed. */
export function mayCheckAgain(state: UpdateState): boolean {
  return state.kind === "idle" || state.kind === "current" || state.kind === "unreachable" || state.kind === "failed";
}

/** What the window says about the update, and whether it offers to restart now; null while there is nothing to say. */
export function updateNotice(state: UpdateState, texts: Texts): { text: string; restart: boolean } | null {
  switch (state.kind) {
    case "downloading":
      return { text: texts.updateLoading(state.version, state.percent), restart: false };
    case "ready":
      return { text: texts.updateReady(state.version), restart: true };
    case "failed":
      return { text: texts.updateFailed(state.version), restart: false };
    default:
      return null;
  }
}
