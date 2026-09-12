import type { AnalysisRequest } from "../analysis/analyseRecording.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { CutSummary } from "../app/runCut.ts";

/**
 * Every answer the window gets from the main process, so a refusal reaches the user as a sentence instead of as an
 * IPC exception. `null` means the user closed the dialog.
 */
export type Answer<Value> = { ok: true; value: Value } | { ok: false; message: string };

/** What the window can ask the main process to do. Nothing else crosses into Node. */
export interface SmartTrimApi {
  /** Opens the file dialog and probes what the user picked. */
  chooseRecording(): Promise<Answer<RecordingInfo | null>>;
  /** Analyses the Recording and plans the cuts. The plan stays in the main process until it is saved. */
  cut(request: AnalysisRequest): Promise<Answer<CutSummary>>;
  /** Opens the save dialog and writes the Premiere file. Returns where it landed. */
  save(): Promise<Answer<string | null>>;
  /** Shows a saved file in Explorer. */
  reveal(path: string): Promise<Answer<null>>;
}
