import type { BackgroundJob } from "./tabs.ts";

/** Where the window shows a wait, and what it says under the bars. */
export interface Wait {
  /** Above the SourceTracks, where the waveforms will appear — or where the result box will. */
  readonly where: "sourceTracks" | "result";
  readonly text: string;
  /** How much of the bars is lit, 0 to 1. 0 when there is nothing to count; the unlit bars pulse instead. */
  readonly share: number;
}

export interface Waiting {
  /** True while the Tab's analysis runs. */
  readonly cutting: boolean;
  /** The background job running for this Tab, if the one job the window runs is this Tab's. */
  readonly job: BackgroundJob | null;
  /** How far the read running for this Tab has got. */
  readonly readingCount: { readonly done: number; readonly total: number };
  /** The Tab's status line: what a job or a cut put up, or a refusal. */
  readonly status: { readonly text: string; readonly bad: boolean };
}

/**
 * A wait is shown where its outcome will land (ADR-0029): a cut where the result box will be, a scan or a read where
 * the waveforms will be. A refusal is never a wait — it stays a red line next to Schneiden. A cut wins over a read
 * still running for the same Tab, since the cut is what the user pressed.
 */
export function waitOf({ cutting, job, readingCount, status }: Waiting): Wait | null {
  if (status.bad) return null;
  if (cutting) return { where: "result", text: status.text || "Schneidet …", share: 0 };
  if (!job) return null;
  // All SourceTracks are read at once (ADR-0011), so the count only moves as each finishes; one alone has no count.
  const counted = job.kind === "read" && readingCount.total > 1;
  return { where: "sourceTracks", text: status.text, share: counted ? readingCount.done / readingCount.total : 0 };
}
