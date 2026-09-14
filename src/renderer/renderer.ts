import {
  EVENT_LEAD_SECONDS,
  PRESETS,
  EVENT_TAIL_SECONDS,
  MARGIN_SECONDS,
  MINIMUM_DEAD_ZONE_SECONDS,
  THRESHOLD_DBFS,
  analysisRequestFrom,
  applyPreset,
  canCut,
  markLockedRangeEnd,
  markLockedRangeStart,
  removeLockedRange,
  canExport,
  cutFinished,
  planFinished,
  planSettingsFrom,
  presetChoice,
  projectSaved,
  redoNeeded,
  roleOf,
  savedChoicesFrom,
  newCutSession,
  setMarginSeconds,
  setMinimumDeadZoneSeconds,
  revealEmptySourceTracks,
  setEventLeadSeconds,
  setEventTailSeconds,
  setSourceTrackRole,
  setThresholdDbfs,
  toggleExportSourceTrack,
  visibleSourceTracks,
  type Preset,
  type CutSession,
  type TrackRole,
} from "../app/cutSession.ts";
import { allPresets, presetFromSliders } from "../app/presets.ts";
import {
  askBeforeClosing,
  jobRefused,
  nextBackgroundJob,
  projectAudioArrived,
  projectTab,
  readArrived,
  recordingTab,
  roleGiven,
  scanArrived,
  unsavedLockedRanges,
  viewedAfterClosing,
  type BackgroundJob,
  type TabWork,
} from "../app/tabs.ts";
import type { Refusal } from "../app/openFile.ts";
import { cuttingAllDoes, savingAllDoes, settingsCopied, type TakenOver } from "../app/allTabs.ts";
import { bandsIn, keptShareByColumn, type CutBand } from "../waveform/cutShape.ts";
import { CLOSEST_WINDOW_SECONDS, pannedBy, zoomedTo, type ZoomWindow } from "../waveform/zoomWindow.ts";
import type { CutSummary, SourceTrackWaveform } from "../app/runCut.ts";
import { LONGEST_EXCERPT_SECONDS, playbackOf, recordingSecondsAt, type Playback } from "../playback/playback.ts";
import { PICTURE_HEIGHT, frameAtSeconds, framesDue, pictureSizeOf } from "../picture/framesDue.ts";
import { pictureWaitMs } from "../picture/pictureWait.ts";
import type { Answer, OpenedInWindow, SmartTrimApi } from "../preload/api.ts";

declare global {
  interface Window {
    smarttrim: SmartTrimApi;
  }
}

function element<Kind extends HTMLElement>(id: string): Kind {
  const found = document.getElementById(id);
  if (!found) throw new Error(`The window has no #${id}.`);
  return found as Kind;
}

const view = {
  chooseRecording: element<HTMLButtonElement>("chooseRecording"),
  openProject: element<HTMLButtonElement>("openProject"),
  openNotes: element("openNotes"),
  openNotesHeading: element("openNotesHeading"),
  openNotesList: element("openNotesList"),
  dismissNotes: element<HTMLButtonElement>("dismissNotes"),
  tabStrip: element("tabStrip"),
  tabAsking: element("tabAsking"),
  tabQuestionTitle: element("tabQuestionTitle"),
  tabQuestion: element("tabQuestion"),
  tabQuestionHeld: element("tabQuestionHeld"),
  saveClose: element<HTMLButtonElement>("saveClose"),
  discardClose: element<HTMLButtonElement>("discardClose"),
  cancelClose: element<HTMLButtonElement>("cancelClose"),
  recordingInfo: element("recordingInfo"),
  emptyDrop: element("emptyDrop"),
  emptyChoose: element<HTMLButtonElement>("emptyChoose"),
  emptyOpen: element<HTMLButtonElement>("emptyOpen"),
  reading: element("reading"),
  readingBars: element("readingBars"),
  readingText: element("readingText"),
  cutting: element("cutting"),
  cuttingBars: element("cuttingBars"),
  cuttingText: element("cuttingText"),
  sourceTracks: element("sourceTracks"),
  sourceTracksHint: element("sourceTracksHint"),
  threshold: element<HTMLInputElement>("threshold"),
  thresholdValue: element("thresholdValue"),
  margin: element<HTMLInputElement>("margin"),
  marginValue: element("marginValue"),
  deadZone: element<HTMLInputElement>("deadZone"),
  deadZoneValue: element("deadZoneValue"),
  preset: element<HTMLSelectElement>("preset"),
  savePreset: element<HTMLButtonElement>("savePreset"),
  newPreset: element<HTMLButtonElement>("newPreset"),
  deletePreset: element<HTMLButtonElement>("deletePreset"),
  presetNaming: element("presetNaming"),
  presetName: element<HTMLInputElement>("presetName"),
  confirmPreset: element<HTMLButtonElement>("confirmPreset"),
  cancelPreset: element<HTMLButtonElement>("cancelPreset"),
  presetAsking: element("presetAsking"),
  presetQuestion: element("presetQuestion"),
  confirmAsk: element<HTMLButtonElement>("confirmAsk"),
  cancelAsk: element<HTMLButtonElement>("cancelAsk"),
  eventSliders: element("eventSliders"),
  eventLead: element<HTMLInputElement>("eventLead"),
  eventLeadValue: element("eventLeadValue"),
  eventTail: element<HTMLInputElement>("eventTail"),
  eventTailValue: element("eventTailValue"),
  cut: element<HTMLButtonElement>("cut"),
  cutAll: element<HTMLButtonElement>("cutAll"),
  saveAllRow: element("saveAllRow"),
  saveAll: element<HTMLButtonElement>("saveAll"),
  takeOverRow: element("takeOverRow"),
  takeOver: element<HTMLButtonElement>("takeOver"),
  takeOverAsking: element("takeOverAsking"),
  takeOverQuestion: element("takeOverQuestion"),
  takeOverRoles: element<HTMLButtonElement>("takeOverRoles"),
  takeOverSliders: element<HTMLButtonElement>("takeOverSliders"),
  cancelTakeOver: element<HTMLButtonElement>("cancelTakeOver"),
  cutPicture: element("cutPicture"),
  picture: element("picture"),
  pictureFrame: element("pictureFrame"),
  pictureCanvas: element<HTMLCanvasElement>("pictureCanvas"),
  pictureNote: element("pictureNote"),
  pictureToggle: element<HTMLButtonElement>("pictureToggle"),
  overview: element<HTMLCanvasElement>("overview"),
  zoom: element<HTMLInputElement>("zoom"),
  zoomValue: element("zoomValue"),
  skipRow: element("skipRow"),
  skipRemoved: element<HTMLInputElement>("skipRemoved"),
  longestExcerpt: element("longestExcerpt"),
  held: element("held"),
  holdStart: element<HTMLButtonElement>("holdStart"),
  holdEnd: element<HTMLButtonElement>("holdEnd"),
  heldList: element("heldList"),
  status: element("status"),
  result: element("result"),
  dropOverlay: element("dropOverlay"),
};

// Said once, from the same number `readExcerpt` refuses by, so the hint cannot promise a length the app refuses.
view.longestExcerpt.textContent = `${LONGEST_EXCERPT_SECONDS / 60} Minuten`;

type Mutable<Shape> = { -readonly [Key in keyof Shape]: Shape[Key] };

/** A line under the Schneiden button: what is going on, or what went wrong. */
interface Status {
  text: string;
  bad: boolean;
}

/**
 * One open Tab (CONTEXT.md) as the window keeps it. Everything a Recording has on screen lives here, so each Tab is
 * as independent as a window of its own; the rules deciding what runs in the background for it are `TabWork`'s
 * (ADR-0025). Answers arriving for a Tab write into its own record, never into whichever Tab is on screen by then.
 */
interface OpenTab extends Mutable<TabWork> {
  /** The finished cut on screen, or null once a setting made it stale. */
  finished: CutSummary | null;
  /**
   * The waveform of every SourceTrack read so far, whether or not it still has a role: putting a role back is instant
   * (ADR-0020). Which are drawn follows the roles.
   */
  waveforms: SourceTrackWaveform[];
  /** The stretch of the Recording the zoomed waveforms are showing. */
  zoom: ZoomWindow;
  /**
   * The Playhead while nothing plays: where listening starts next, shared by every waveform of the Tab because they
   * all show the same stretch of the Recording. Set by clicking a waveform, left where the sound stopped.
   */
  playheadSeconds: number | null;
  /** True while this Tab's analysis runs, so nothing in it can be started twice or changed underneath it. */
  working: boolean;
  status: Status;
  /** How far the read running for this Tab has got. */
  readingCount: { done: number; total: number };
  /** Waiting for the sliders to come to rest, so one drag is one job and not fifty. */
  redoTimer: ReturnType<typeof setTimeout> | undefined;
  /** The replan or new decision on its way to the main process, so a cut or a save can let it arrive first. */
  redoing: Promise<void> | null;
  /**
   * Which action on all Tabs last passed this Tab over. The strip marks it for as long as the reason still holds
   * (`stillPassedOver`), so setting what was missing takes the mark away without another run.
   */
  skippedBy: "cutAll" | "saveAll" | null;
}

/** The open Tabs, in the order of the strip. */
let tabs: OpenTab[] = [];
/** The Tab on screen, or null while none is open. */
let viewedId: number | null = null;
/** A Tab waiting for the user to say whether it may be closed with held stretches no project holds. */
let closeAsking: OpenTab | null = null;
/** True while "Projekt speichern und schließen" waits for its save dialog, so the question cannot be answered twice. */
let savingForClose = false;
/** True while the question before "Für alle übernehmen" is on screen. */
let takeOverAsking = false;
/** How far "Alle schneiden" has got, or null while it is not running. */
let cuttingAll: { done: number; total: number } | null = null;
/** How far "Alle Premiere-Dateien speichern" has got, or null while it is not running. */
let savingAll: { done: number; total: number } | null = null;

/**
 * One thing opening files had to say, the way an exception reads: which file, what went wrong in the user's words,
 * and beneath it the core of what was reported — never the path it was wrapped in.
 */
interface OpenNote {
  /** A file that would not open, or only news — a Recording that is already open. */
  tone: "refused" | "info";
  /** The file's name, or empty when the note is about several. */
  name: string;
  text: string;
  detail?: string;
}

/** What opening the last files had to say. Stays until the next opening or until dismissed. */
let openNotes: OpenNote[] = [];
/**
 * A heading of its own for notes that are not about opening files — what an action on all Tabs did. It belongs to the
 * list it was written for (compared by identity) and lapses as soon as anything else puts its own notes up.
 */
let notesHeading: { notes: OpenNote[]; text: string } | null = null;
/** The status line while no Tab is open — the first-run download, say. */
const windowStatus: Status = { text: "", bad: false };
/** What the sliders show while no Tab is open: the settings a new Tab starts on. */
const NO_TAB_SESSION: CutSession = newCutSession();

/** The Presets the user saved themselves, as the main process last reported them. */
let ownPresets: readonly Preset[] = [];
/** True while the name field is open, so the dropdown does not fight the user for the same row. */
let naming = false;
/**
 * A question waiting for the user, asked as a row in the window. Electron's own `confirm()` is a Windows popup,
 * and closing one leaves the window without focus until the user clicks away and back (ADR-0018).
 */
let asking: { question: string; yes: () => void } | null = null;
/** True until ffmpeg and the model are there: on a first run they have to be downloaded first. */
let preparing = true;

function viewed(): OpenTab | null {
  return tabs.find((tab) => tab.id === viewedId) ?? null;
}

function tabById(tabId: number): OpenTab | undefined {
  return tabs.find((tab) => tab.id === tabId);
}

/** Whether a Tab is still open. An answer for a closed one is dropped without a word: closing it was the user's call. */
function isOpen(tab: OpenTab): boolean {
  return tabs.includes(tab);
}

const decimals = (value: number, digits: number) =>
  value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Lengths the way the user reads them: hours and minutes for a Recording, seconds for a short one. */
function duration(seconds: number): string {
  if (seconds < 60) return `${decimals(seconds, 1)} Sek`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} Min`;
  return `${Math.floor(minutes / 60)} Std ${String(minutes % 60).padStart(2, "0")} Min`;
}

/** What the scan found on one SourceTrack, in the user's words. */
function soundHint(scan: { carriesSound: boolean; slicesWithSound: number; sliceCount: number } | undefined): string {
  if (!scan) return "";
  if (!scan.carriesSound) return " · kein Ton gefunden";
  return scan.slicesWithSound === scan.sliceCount ? " · Ton durchgehend" : " · Ton stellenweise";
}

function channels(count: number): string {
  if (count === 2) return "Stereo";
  if (count === 1) return "Mono";
  return `${count} Kanäle`;
}

/* ── The status line ───────────────────────────────────────────────────────────────────────────────────────── */

/** Where a Tab's status goes — or the window's, while no Tab is open. */
function statusOf(tab: OpenTab | null): Status {
  return tab ? tab.status : windowStatus;
}

function setStatus(tab: OpenTab | null, text: string, bad = false): void {
  const status = statusOf(tab);
  status.text = text;
  status.bad = bad;
  drawStatus();
}

function clearStatus(tab: OpenTab | null): void {
  setStatus(tab, "");
}

/** Puts a refusal the window worked out itself where the refusals from the main process go. */
function say(tab: OpenTab | null, message: string): void {
  setStatus(tab, message, true);
}

/** Says what went wrong instead of leaving the window silent, and never calls a refusal a success. */
function show<Value>(tab: OpenTab | null, answer: Answer<Value>, ifRefused: string): Value | undefined {
  if (answer.ok) return answer.value;
  say(tab, `${ifRefused}: ${answer.message}`);
  return undefined;
}

function drawStatus(): void {
  const tab = viewed();
  const status = statusOf(tab);
  // PROTOTYPE: a wait is shown where its outcome will land (docs/design/ui-direction.md). Reading fills the bars
  // above the SourceTracks; a cut pulses them where the result will appear. Refusals stay next to Schneiden.
  const cutting = tab !== null && tab.working;
  const reading =
    tab !== null && !cutting && !status.bad && (status.text.startsWith("Liest") || status.text.startsWith("Prüft"));
  view.reading.hidden = !reading;
  view.cutting.hidden = !cutting;
  if (reading && tab) {
    const { done, total } = tab.readingCount;
    fillSoundBars(view.readingBars, status.text.includes(" von ") && total > 0 ? done / total : 0);
    view.readingText.textContent = status.text;
  }
  if (cutting) {
    fillSoundBars(view.cuttingBars, 0);
    // The cut's own line, never one left over from reading the SourceTracks.
    view.cuttingText.textContent = status.text.startsWith("Liest die Aufnahme") ? status.text : "Schneidet …";
  }
  view.status.textContent = reading || cutting ? "" : status.text;
  view.status.classList.toggle("bad", status.bad);
}

/** The heights of the mark's five bars, repeated across the width; a pattern, never real audio. */
const SOUND_BAR_HEIGHTS = [40, 85, 60, 85, 40];

/** As many 4 px bars, 3 px apart, as the block is wide — made once the block is on screen, since hidden it has no width. */
function makeSoundBars(into: HTMLElement): void {
  const count = Math.max(20, Math.floor((into.clientWidth + 3) / 7));
  if (into.children.length === count) return;
  into.replaceChildren(
    ...Array.from({ length: count }, (_, index) => {
      const bar = document.createElement("i");
      bar.style.setProperty("--h", String(SOUND_BAR_HEIGHTS[index % SOUND_BAR_HEIGHTS.length]));
      bar.style.setProperty("--i", String(index));
      return bar;
    }),
  );
}

/** Lights the bars up to a share of them; the rest keep pulsing (the CSS does that) so the wait never looks stuck. */
function fillSoundBars(bars: HTMLElement, share: number): void {
  makeSoundBars(bars);
  const lit = Math.round(share * bars.children.length);
  [...bars.children].forEach((bar, index) => bar.classList.toggle("on", index < lit));
}

/**
 * How long a Tab's Recording is, in seconds. Taken from the Recording itself rather than from the cut, because the
 * waveform is drawn as soon as a SourceTrack gets a role — long before there is a cut (ADR-0020).
 */
function recordingSeconds(tab: OpenTab | null): number | null {
  const recording = tab?.session.recording;
  if (!recording) return null;
  return (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** The folder a file lies in, the way the notes name it. */
function folderOf(path: string): string {
  return path.slice(0, path.length - fileName(path).length - 1);
}

/** Whether an action on all Tabs runs or any Tab is being cut: then nothing may start that cuts or changes a Tab. */
function allTabsBusy(): boolean {
  return cuttingAll !== null || savingAll !== null || tabs.some((each) => each.working);
}

/* ── Drawing the Tab on screen ─────────────────────────────────────────────────────────────────────────────── */

/** The strip of Tabs, the question before closing one, and what opening the last files had to say. */
function drawTabs(): void {
  view.tabStrip.hidden = tabs.length === 0;
  view.tabStrip.replaceChildren(
    ...tabs.map((tab) => {
      const name = fileName(tab.session.recording?.path ?? "");
      const item = document.createElement("div");
      item.className = ["tab", tab.id === viewedId ? "viewed" : "", tab.skippedBy ? "skipped" : ""].filter(Boolean).join(" ");
      const label = document.createElement("button");
      label.type = "button";
      label.className = "tabLabel";
      // A Tab busy in the background says so, since its status line is only on screen while it is.
      const busy = tab.working || job?.tabId === tab.id;
      if (busy) {
        const mark = document.createElement("span");
        mark.className = "busyMark";
        mark.append(...[0, 1, 2].map(() => document.createElement("i")));
        label.append(mark);
      }
      label.append(document.createTextNode(name));
      label.title = tab.session.recording?.path ?? name;
      label.addEventListener("click", () => viewTab(tab.id));
      const close = document.createElement("button");
      close.type = "button";
      close.className = "tabClose";
      close.textContent = "×";
      close.title = `${name} schließen`;
      close.addEventListener("click", () => requestClose(tab));
      item.append(label, close);
      return item;
    }),
  );

  drawCloseQuestion();
  drawTakeOverQuestion();

  view.openNotes.hidden = openNotes.length === 0;
  const refusedCount = openNotes.filter((note) => note.tone === "refused" && note.name).length;
  view.openNotesHeading.textContent =
    notesHeading?.notes === openNotes
      ? notesHeading.text
      : refusedCount === 0
        ? ""
        : refusedCount === 1
          ? "Eine Datei ließ sich nicht öffnen"
          : `${refusedCount} Dateien ließen sich nicht öffnen`;
  view.openNotesList.replaceChildren(
    ...openNotes.map((note) => {
      const line = document.createElement("li");
      line.className = note.tone;
      const text = document.createElement("span");
      text.className = "noteText";
      if (note.name) {
        const name = document.createElement("strong");
        name.textContent = note.name;
        text.append(name, ": ");
      }
      text.append(note.text);
      line.append(text);
      if (note.detail) {
        const detail = document.createElement("span");
        detail.className = "noteDetail";
        detail.textContent = note.detail;
        line.append(detail);
      }
      return line;
    }),
  );
}

/** Shows at most this many held stretches in the question; the rest are counted. */
const HELD_SHOWN_IN_QUESTION = 5;

/** The dialog before closing a Tab that holds stretches no saved project holds (ADR-0025). */
function drawCloseQuestion(): void {
  const tab = closeAsking;
  view.tabAsking.hidden = tab === null;
  if (!tab) return;
  const unsaved = unsavedLockedRanges(tab.session);
  const count = unsaved.length;
  // A project can only be saved from a cut: it holds what the analysis found (ADR-0016).
  const canSave = tab.finished !== null;
  view.tabQuestionTitle.textContent = `„${fileName(tab.session.recording?.path ?? "")}“ schließen?`;
  view.tabQuestion.textContent =
    (count === 1
      ? "Du hast hier eine Stelle festgehalten, die in keinem gespeicherten Projekt steht. Ohne Speichern ist sie weg."
      : `Du hast hier ${count} Stellen festgehalten, die in keinem gespeicherten Projekt stehen. Ohne Speichern sind sie weg.`) +
    (canSave ? "" : " Als Projekt speichern lässt sich erst nach dem Schneiden.");
  view.tabQuestionHeld.replaceChildren(
    ...unsaved.slice(0, HELD_SHOWN_IN_QUESTION).map((range) => {
      const item = document.createElement("li");
      item.textContent = `${clock(range.startSeconds)} – ${clock(range.endSeconds)}`;
      return item;
    }),
    ...(count > HELD_SHOWN_IN_QUESTION
      ? [Object.assign(document.createElement("li"), { className: "more", textContent: `und ${count - HELD_SHOWN_IN_QUESTION} weitere` })]
      : []),
  );
  view.saveClose.hidden = !canSave;
  // While a replan is pending the plan behind the file would lack the stretch just held.
  view.saveClose.disabled = savingForClose || redoNeeded(tab.session) !== "nothing";
  view.discardClose.disabled = savingForClose;
  view.cancelClose.disabled = savingForClose;
}

function drawRecording(tab: OpenTab | null): void {
  const recording = tab?.session.recording;
  // The drop area stands in for the sentence while nothing is open; the header's buttons step aside for its own.
  view.emptyDrop.hidden = Boolean(recording);
  document.body.classList.toggle("empty", !recording);
  if (!recording) {
    view.recordingInfo.textContent = "Noch keine Aufnahme offen.";
    return;
  }
  const seconds = (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;
  const fps = decimals(recording.frameRate.numerator / recording.frameRate.denominator, 2).replace(",00", "");
  const name = document.createElement("strong");
  name.textContent = fileName(recording.path);
  const detail = document.createElement("div");
  detail.textContent =
    `${duration(seconds)} · ${recording.width}×${recording.height} · ${fps} Bilder/s · ` +
    `${recording.sourceTracks.length} Tonspuren`;
  view.recordingInfo.replaceChildren(name, detail);
}

function drawSourceTracks(tab: OpenTab | null): void {
  view.sourceTracks.replaceChildren();
  const recording = tab?.session.recording;
  if (!tab || !recording) {
    view.sourceTracksHint.textContent = "Öffne zuerst eine Aufnahme.";
    return;
  }
  const { session } = tab;
  const visible = visibleSourceTracks(session);

  const head = document.createElement("div");
  head.className = "head";
  for (const caption of ["diese Spur …", "nach Premiere", ""]) {
    const cell = document.createElement("span");
    cell.textContent = caption;
    head.append(cell);
  }
  view.sourceTracks.append(head);

  recording.sourceTracks.forEach((sourceTrack, index) => {
    if (!visible.includes(index)) return;
    const row = document.createElement("div");
    row.className = "row";

    /** One of the two ticks of a row. Only the cutting one makes a finished cut stale. */
    const box = (checked: boolean, title: string, change: () => void) => {
      const holder = document.createElement("label");
      const tick = document.createElement("input");
      tick.type = "checkbox";
      tick.checked = checked;
      tick.disabled = tab.working;
      tick.title = title;
      tick.addEventListener("change", () => {
        change();
        draw();
      });
      holder.append(tick);
      return holder;
    };

    const text = document.createElement("div");
    text.textContent = `Tonspur ${index + 1}`;
    const detail = document.createElement("span");
    detail.textContent =
      `${channels(sourceTrack.channelCount)} · ${sourceTrack.sampleRate / 1000} kHz` +
      soundHint(session.scan?.[index]);

    // One TrackRole per SourceTrack (CONTEXT.md): it drives the cut, it keeps its moments, or it is ignored.
    const role = document.createElement("select");
    role.disabled = tab.working;
    role.title = `Was Tonspur ${index + 1} zum Schnitt beiträgt`;
    for (const [value, label] of [
      ["ignored", "wird ignoriert"],
      ["voice", "danach schneiden"],
      ["content", "Momente behalten"],
    ] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      role.append(option);
    }
    role.value = roleOf(session, index);
    role.addEventListener("change", () => {
      // An ignored SourceTrack loses its row's waveform and with it the only button that could stop its sound —
      // a sound still on its way included.
      if (role.value === "ignored" && (playing?.position ?? fetchingFor) === index) stopPlaying();
      // A role asks for the SourceTrack's waveform, so a Tab whose read was refused tries again (ADR-0025).
      Object.assign(tab, roleGiven(tab, setSourceTrackRole(tab.session, index, role.value as TrackRole)));
      afterSettingChange(tab);
      draw();
      // A SourceTrack that just got a role shows its waveform straight away, before anything is cut (ADR-0020).
      void pump();
    });

    row.append(
      role,
      // Changing this changes the file, not the cut, so a finished cut stays on screen.
      box(session.exportSourceTracks.includes(index), `Tonspur ${index + 1} nach Premiere übernehmen`, () => {
        tab.session = toggleExportSourceTrack(tab.session, index);
      }),
      text,
      detail,
    );
    view.sourceTracks.append(row);

    // The waveform of this SourceTrack, right under the dropdown that gave it a role. The canvas element is reused
    // across redraws rather than made anew: the rows are rebuilt on every draw, and a fresh canvas mid-drag would
    // lose both the picture and the pointer.
    // Only a SourceTrack that has a role shows one. What was read for it stays in memory either way, so taking the
    // role away and putting it back costs no second read (ADR-0020).
    const waveform =
      roleOf(session, index) === "ignored" ? undefined : tab.waveforms.find((each) => each.position === index);
    if (!waveform) return;
    const holder = document.createElement("div");
    holder.className = "waveform";
    // One SourceTrack plays at a time; its own button stops it, and the button of another row switches to that one.
    const isPlaying = playing?.position === index;
    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = isPlaying ? "play playing" : "play";
    playButton.textContent = isPlaying ? "■" : fetchingFor === index ? "…" : "▶";
    playButton.title = isPlaying
      ? `Tonspur ${index + 1} anhalten`
      : `Tonspur ${index + 1} ab dem weißen Strich anhören (höchstens ${LONGEST_EXCERPT_SECONDS / 60} Minuten)`;
    playButton.addEventListener("click", () => void play(index));
    holder.append(playButton, waveformCanvas(index));
    row.append(holder);
  });
  view.sourceTracksHint.replaceChildren();
  const hint = document.createElement("span");
  hint.textContent =
    session.listenTo.length === 0
      ? 'Stell bei der Spur, auf der du sprichst, "danach schneiden" ein. Rechts, was in Premiere landen soll.'
      : !canExport(session)
        ? "Kreuze rechts mindestens eine Spur an, sonst hat das Premiere-Projekt keinen Ton."
        : session.contentSourceTracks.length === 0
          ? 'Alles, was auf den Schnitt-Spuren laut genug ist, bleibt erhalten. "Momente behalten" hält Knaller am Leben, bei denen keiner redet.'
          : "Auf den Momente-Spuren bleibt, was deutlich aus dem eigenen Grundton ausbricht — Explosionen, Fanfaren, abrupte Stille.";
  view.sourceTracksHint.append(hint);

  // A scan only listens to slices, so a hidden SourceTrack has to stay reachable.
  const hidden = recording.sourceTracks.length - visible.length;
  if (hidden === 0 && !session.emptySourceTracksShown) return;
  // A tick nobody can see is exactly what the hiding must not cause, in either direction.
  const hiddenExported = recording.sourceTracks.filter(
    (_sourceTrack, index) => !visible.includes(index) && session.exportSourceTracks.includes(index),
  ).length;
  const reveal = document.createElement("button");
  reveal.className = "link";
  reveal.textContent = session.emptySourceTracksShown
    ? "Leere Tonspuren ausblenden"
    : `${hidden} leere ${hidden === 1 ? "Tonspur" : "Tonspuren"} zeigen ` +
      (hiddenExported === 0
        ? `(${hidden === 1 ? "kommt" : "kommen"} nicht nach Premiere)`
        : `(${hiddenExported} davon ${hiddenExported === 1 ? "kommt" : "kommen"} nach Premiere)`);
  reveal.disabled = tab.working;
  reveal.addEventListener("click", () => {
    tab.session = revealEmptySourceTracks(tab.session, !tab.session.emptySourceTracksShown);
    draw();
  });
  view.sourceTracksHint.append(document.createElement("br"), reveal);
}

/** The Preset dropdown. "eigene" is what the sliders are once one of them has been moved off a Preset. */
const OWN_SETTINGS = "eigene";

function drawSettings(tab: OpenTab | null): void {
  const session = tab?.session ?? NO_TAB_SESSION;
  const choice = presetChoice(session, ownPresets);
  const chosenIsOwn = choice !== null && ownPresets.some((preset) => preset.name === choice.name);
  // Without a Tab there is nothing for a setting to belong to.
  const busy = !tab || tab.working || naming || asking !== null;

  view.preset.replaceChildren();
  for (const name of [...PRESETS.map((preset) => preset.name), ...(choice ? [] : [OWN_SETTINGS])]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    view.preset.append(option);
  }
  // The user's own sit under a separator, so it is plain which three the app came with.
  if (ownPresets.length > 0) {
    const mine = document.createElement("optgroup");
    mine.label = "Eigene";
    for (const preset of ownPresets) {
      const option = document.createElement("option");
      option.value = preset.name;
      option.textContent = preset.name;
      mine.append(option);
    }
    view.preset.append(mine);
  }
  view.preset.value = choice?.name ?? OWN_SETTINGS;
  // The chosen Preset keeps its place in the list while the sliders sit off it, and says so.
  if (choice?.changed) {
    const shown = [...view.preset.options].find((option) => option.value === choice.name);
    if (shown) shown.textContent = `${choice.name} (geändert)`;
  }

  view.preset.disabled = busy;
  view.newPreset.disabled = busy;
  // Only there when there is something to write back, and only into one of the user's own.
  view.savePreset.hidden = !(chosenIsOwn && choice.changed);
  view.savePreset.disabled = busy;
  // Deleting follows the choice, not the sliders: a nudged Preset is still the one the user is working on.
  view.deletePreset.disabled = busy || !chosenIsOwn;
  view.presetNaming.hidden = !naming;
  view.presetAsking.hidden = asking === null;
  if (asking) view.presetQuestion.textContent = asking.question;
  view.threshold.value = String(session.thresholdDbfs);
  view.thresholdValue.textContent = `${decimals(session.thresholdDbfs, 0)} dB`;
  view.margin.value = String(session.marginSeconds);
  view.marginValue.textContent = `${decimals(session.marginSeconds, 2)} s`;
  view.deadZone.value = String(session.minimumDeadZoneSeconds);
  view.deadZoneValue.textContent = `${decimals(session.minimumDeadZoneSeconds, 2)} s`;
  // What is kept around a moment only matters once a SourceTrack is looked at for moments.
  view.eventSliders.hidden = session.contentSourceTracks.length === 0;
  view.eventLead.value = String(session.eventLeadSeconds);
  view.eventLeadValue.textContent = `${decimals(session.eventLeadSeconds, 1)} s`;
  view.eventTail.value = String(session.eventTailSeconds);
  view.eventTailValue.textContent = `${decimals(session.eventTailSeconds, 1)} s`;
}

function drawResult(tab: OpenTab | null): void {
  view.result.replaceChildren();
  const cut = tab?.finished ?? null;
  view.result.hidden = cut === null;
  if (!tab || !cut) return;

  const sentence = document.createElement("p");
  sentence.textContent =
    `Von ${duration(cut.recordingSeconds)} bleiben ${duration(cut.keptSeconds)} übrig – ` +
    `${decimals(cut.removedShare * 100, 0)} % sind weg.`;
  const numbers = document.createElement("p");
  numbers.className = "numbers";
  numbers.textContent =
    `${cut.keepSegments.toLocaleString("de-DE")} Teile, ${duration(cut.removedSeconds)} entfernt.`;

  const buttons = document.createElement("div");
  buttons.className = "buttons";
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Premiere-Datei speichern …";
  // Without a SourceTrack to export the file would hold a sequence with no audio at all.
  // While a replan is still pending the plan in the main process is the one before the last change: saved now, the
  // file would lack a stretch just held and still say "Gespeichert".
  const mayNotSave = () => !canExport(tab.session) || redoNeeded(tab.session) !== "nothing";
  save.disabled = mayNotSave();
  save.addEventListener("click", async () => {
    save.disabled = true;
    clearStatus(tab);
    const saved = show(tab, await window.smarttrim.save(tab.id, tab.session.exportSourceTracks), "Speichern ging nicht");
    save.disabled = mayNotSave();
    // undefined is a refusal, already on screen; null means the user closed the dialog.
    if (saved === undefined || saved === null || !isOpen(tab)) return;
    // The result box belongs to the Tab on screen; another Tab's box gets the news in its status line instead.
    if (viewed() !== tab) {
      setStatus(tab, `Gespeichert: ${saved}`);
      return;
    }
    const done = document.createElement("p");
    done.className = "numbers";
    done.textContent = `Gespeichert: ${saved}`;
    const reveal = document.createElement("button");
    reveal.textContent = "Im Ordner zeigen";
    reveal.addEventListener("click", () => void window.smarttrim.reveal(saved));
    view.result.append(done, reveal);
  });

  // The project is what makes tomorrow cheap: it holds what the analysis found, so the Recording is not read again.
  const saveProject = document.createElement("button");
  saveProject.textContent = "Projekt speichern";
  saveProject.title = "Speichert neben der Aufnahme – oder in das Projekt, aus dem dieser Tab kommt";
  // While a redo is still pending the numbers on screen and the plan behind them are one step apart.
  saveProject.disabled = redoNeeded(tab.session) !== "nothing";
  saveProject.addEventListener("click", async () => {
    saveProject.disabled = true;
    await saveProjectOf(tab);
    saveProject.disabled = redoNeeded(tab.session) !== "nothing";
  });

  buttons.append(save, saveProject);
  view.result.append(sentence, numbers, buttons);
}

/**
 * Saves a Tab as a project without asking where — into its own project, else beside its Recording (ADR-0025) — and
 * says where it landed. The path, or undefined when writing failed and the reason is in the Tab's status line.
 */
async function saveProjectOf(tab: OpenTab): Promise<string | undefined> {
  clearStatus(tab);
  // Taken now: a stretch held while the file is being written is not in it, and must not count as saved.
  const choices = savedChoicesFrom(tab.session);
  const saved = show(tab, await window.smarttrim.saveProjectBeside(tab.id, choices), "Speichern ging nicht");
  if (saved === undefined || !isOpen(tab)) return undefined;
  // What the file holds no longer needs asking about when the Tab is closed (ADR-0025).
  tab.session = projectSaved(tab.session, choices);
  setStatus(tab, `Projekt gespeichert: ${saved}`);
  return saved;
}

function draw(): void {
  const tab = viewed();
  forgetSettledPassOvers();
  drawTabs();
  drawRecording(tab);
  drawPicture(tab);
  drawSourceTracks(tab);
  drawSettings(tab);
  drawResult(tab);
  // The colours over the waveform come from the plan, so every redraw of the numbers redraws them too.
  drawWaveforms();
  // After the waveforms: whether there is anything to hold on follows whether they are shown.
  drawHeld(tab);
  drawStatus();
  const settingsLocked = !tab || tab.working;
  view.chooseRecording.disabled = preparing;
  view.openProject.disabled = preparing;
  view.emptyChoose.disabled = preparing;
  view.emptyOpen.disabled = preparing;
  view.threshold.disabled = settingsLocked;
  view.margin.disabled = settingsLocked;
  view.deadZone.disabled = settingsLocked;
  view.eventLead.disabled = settingsLocked;
  view.eventTail.disabled = settingsLocked;
  // While all Tabs are cut or saved, a Tab cut by hand could be cut twice, or lose its cut just before it is saved.
  const allRunning = cuttingAll !== null || savingAll !== null;
  view.cut.disabled = !tab || tab.working || preparing || allRunning || !canCut(tab.session);
  view.cut.textContent = tab?.working ? "Arbeitet …" : "Schneiden";
  const severalTabs = tabs.length > 1;
  const counted = (progress: { done: number; total: number }) =>
    `${Math.min(progress.done + 1, progress.total)} von ${progress.total}`;
  view.cutAll.hidden = !severalTabs && cuttingAll === null;
  view.cutAll.disabled = preparing || allTabsBusy();
  view.cutAll.textContent = cuttingAll ? `Schneidet ${counted(cuttingAll)} …` : "Alle schneiden";
  view.saveAllRow.hidden = !severalTabs && savingAll === null;
  view.saveAll.disabled =
    preparing || allTabsBusy() || !tabs.some((each) => savingAllDoes(each.session, each.finished !== null) === "save");
  view.saveAll.textContent = savingAll ? `Speichert ${counted(savingAll)} …` : "Alle Premiere-Dateien speichern";
  view.takeOverRow.hidden = !severalTabs;
  // A Tab being cut or saved must not have its settings changed underneath (ADR-0026).
  view.takeOver.disabled = !tab || allTabsBusy();
}

/**
 * What a changed setting costs. Luft and Pause are planned again from what the analysis already found, which takes
 * milliseconds and no reading; the threshold and the SourceTracks decide what is found at all, so the cut on screen
 * stops being offered until it is made again (ADR-0004).
 */
function afterSettingChange(tab: OpenTab): void {
  if (!tab.finished) return;
  const redo = redoNeeded(tab.session);
  if (redo === "nothing") return;
  if (redo === "analyse") {
    tab.finished = null;
    setStatus(tab, "Einstellung geändert – noch einmal schneiden.");
    return;
  }
  scheduleRedo(tab, redo);
}

function scheduleRedo(tab: OpenTab, redo: "replan" | "redecide"): void {
  setStatus(tab, redo === "replan" ? "Plant neu …" : "Rechnet neu …");
  clearTimeout(tab.redoTimer);
  tab.redoTimer = setTimeout(() => void redoNow(tab), 120);
}

/** The settings a redo was asked for, so numbers from a slider position the user has left behind are not called current. */
const settingsNow = (tab: OpenTab) => ({ thresholdDbfs: tab.session.thresholdDbfs, ...planSettingsFrom(tab.session) });

/**
 * Plans or decides a Tab's cut again, if its settings ask for that. A redo already on its way is not asked twice: its
 * promise is handed back, so a cut or a save can wait for it to arrive.
 */
function redoNow(tab: OpenTab): Promise<void> {
  if (tab.redoing) return tab.redoing;
  const redo = redoNeeded(tab.session);
  if (!isOpen(tab) || !tab.finished || (redo !== "replan" && redo !== "redecide")) return Promise.resolve();
  const running = redoAs(tab, redo).finally(() => {
    tab.redoing = null;
  });
  tab.redoing = running;
  return running;
}

async function redoAs(tab: OpenTab, redo: "replan" | "redecide"): Promise<void> {
  // What the plan will belong to: the settings as they are when it is asked for, wherever the sliders go meanwhile.
  const askedWith = tab.session;
  const used = settingsNow(tab);
  const answer =
    redo === "replan" ? await window.smarttrim.replan(tab.id, used) : await window.smarttrim.redecide(tab.id, used);
  if (!isOpen(tab)) return;
  const summary = show(tab, answer, redo === "replan" ? "Das Neuplanen ging nicht" : "Das Neurechnen ging nicht");
  if (summary) {
    // A slider pulled back while this ran leaves these numbers one step behind; the plan is marked as made for where
    // the sliders were, so the next redo is asked for rather than a plan the sliders no longer describe being saved.
    tab.session = planFinished(tab.session, askedWith);
    if (redoNeeded(tab.session) === "analyse") {
      // A role changed while this ran — taken over from another Tab, say: these numbers belong to SourceTracks no
      // longer chosen, and the cut has to be made again.
      tab.finished = null;
      setStatus(tab, "Einstellung geändert – noch einmal schneiden.");
    } else {
      tab.finished = summary;
      // A sound that skips what the cut removes was built from the cut before this one: heard on, it would jump over a
      // stretch just held, under a band that now says kept. It starts again from where it is, on the new cut. So does
      // one still on its way, which was asked for with the old cut. Only the Tab on screen can have a sound.
      const stale =
        viewed() !== tab
          ? null
          : playing
            ? playing.skipping
              ? playing.position
              : null
            : fetchingFor !== null && view.skipRemoved.checked
              ? fetchingFor
              : null;
      if (stale !== null) {
        stopPlaying();
        void play(stale);
      }
      if (redoNeeded(tab.session) === "nothing") clearStatus(tab);
    }
  }
  draw();
  // A refusal stays on screen rather than being asked again every 120 ms.
  const next = redoNeeded(tab.session);
  if (summary && (next === "replan" || next === "redecide")) scheduleRedo(tab, next);
}

function slider(
  input: HTMLInputElement,
  range: { min: number; max: number; step: number },
  change: (session: CutSession, value: number) => CutSession,
): void {
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.addEventListener("input", () => {
    const tab = viewed();
    if (!tab) return;
    tab.session = change(tab.session, Number(input.value));
    afterSettingChange(tab);
    draw();
  });
}

slider(view.threshold, THRESHOLD_DBFS, setThresholdDbfs);
slider(view.margin, MARGIN_SECONDS, setMarginSeconds);
slider(view.deadZone, MINIMUM_DEAD_ZONE_SECONDS, setMinimumDeadZoneSeconds);
slider(view.eventLead, EVENT_LEAD_SECONDS, setEventLeadSeconds);
slider(view.eventTail, EVENT_TAIL_SECONDS, setEventTailSeconds);

view.preset.addEventListener("change", () => {
  const tab = viewed();
  const preset = allPresets(ownPresets).find((each) => each.name === view.preset.value);
  // "eigene" is not something to pick: it only describes sliders that belong to no Preset.
  if (!tab || !preset) return;
  tab.session = applyPreset(tab.session, preset);
  afterSettingChange(tab);
  draw();
});


/* ── The waveforms ─────────────────────────────────────────────────────────────────────────────────────────── */

/** Kept stretches are green, removed ones a dark red that is also plainly darker, so the two differ without hue. */
const KEPT_BAND = "#1f3a2e";
const REMOVED_BAND = "#2a1416";
const KEPT_WAVE = "#7fd6b4";
/** Before anything is cut there is nothing to colour, so the waveform is drawn plain (ADR-0020). */
// PROTOTYPE: the plain waveform before any cut tinted to sit on the navy ground (docs/design/ui-direction.md).
const PLAIN_BAND = "#11121c";
const PLAIN_WAVE = "#9c9fb6";
const REMOVED_WAVE = "#7a4046";
/** Over a stretch the playing sound jumps across, so a Join is seen as it is heard. Neither green nor red. */
const JOIN_MARK = "#e8b04a";
const PLAYHEAD = "#e8eaed";
/** Held stretches (ADR-0023): blue, a colour the cut itself never uses, so held reads apart from kept. */
const HELD = "#5aa9e6";

/**
 * Tints every held stretch blue and edges it near the top, over whatever the cut and the sound drew there, and draws
 * a waiting Anfang as a thin blue line. `xOf` places a moment of the Recording on this canvas.
 */
function drawHeldOver(
  paint: CanvasRenderingContext2D,
  session: CutSession,
  width: number,
  height: number,
  xOf: (second: number) => number,
  edge = 4,
): void {
  paint.fillStyle = HELD;
  for (const range of session.lockedRanges) {
    const from = Math.max(xOf(range.startSeconds), 0);
    const to = Math.min(xOf(range.endSeconds), width);
    if (to <= 0 || from >= width) continue;
    paint.globalAlpha = 0.16;
    paint.fillRect(from, 0, Math.max(to - from, 1), height);
    paint.globalAlpha = 1;
    paint.fillRect(from, 3, Math.max(to - from, 1), edge);
  }
  const waiting = session.lockedRangeStart;
  if (waiting === null) return;
  const x = xOf(waiting);
  if (x >= 0 && x <= width) paint.fillRect(x - 0.5, 0, 1, height);
}

/** Draws one canvas at the screen's own pixel density, and hands back its context and size in CSS pixels. */
function canvasBrush(canvas: HTMLCanvasElement, cssHeight: number): { paint: CanvasRenderingContext2D; width: number } {
  const width = Math.max(Math.round(canvas.clientWidth), 1);
  const ratio = window.devicePixelRatio || 1;
  const pixels = { width: Math.round(width * ratio), height: Math.round(cssHeight * ratio) };
  // Assigning width or height throws the bitmap away and makes a new one — about 3.7 MB across the canvases, on
  // every redraw, and a redraw happens on every slider move. Only do it when the size really changed.
  if (canvas.width !== pixels.width || canvas.height !== pixels.height) {
    canvas.width = pixels.width;
    canvas.height = pixels.height;
  }
  const paint = canvas.getContext("2d") as CanvasRenderingContext2D;
  paint.setTransform(ratio, 0, 0, ratio, 0, 0);
  paint.clearRect(0, 0, width, cssHeight);
  return { paint, width };
}

/**
 * The last answer of `overviewPeaks`. It depends only on which Tab and which waveforms are shown and how wide the
 * strip is — none of which changes when a slider moves — so without this it rescanned 1.08 million peaks on every
 * redraw.
 */
let overviewPeaksCache: { key: string; peaks: number[] } | null = null;

/**
 * The loudest thing any shown SourceTrack does in each column of the strip. The strip spans the whole Recording,
 * so one column is minutes wide; taking the loudest across the SourceTracks answers "is there any sound here at
 * all", which is what the strip is for.
 */
function overviewPeaks(tab: OpenTab, columns: number, recordingSeconds: number): number[] {
  const shown = shownWaveforms(tab);
  const key = `${tab.id}|${columns}|${shown.map((waveform) => waveform.position).join(",")}`;
  if (overviewPeaksCache?.key === key) return overviewPeaksCache.peaks;

  const loudest = new Array<number>(columns).fill(0);
  for (const waveform of shown) {
    for (let column = 0; column < columns; column += 1) {
      const from = Math.floor((column / columns) * recordingSeconds * waveform.peaksPerSecond);
      const to = Math.max(Math.floor(((column + 1) / columns) * recordingSeconds * waveform.peaksPerSecond), from + 1);
      for (let peak = from; peak < to && peak < waveform.peaks.length; peak += 1) {
        const height = waveform.peaks[peak] as number;
        if (height > (loudest[column] as number)) loudest[column] = height;
      }
    }
  }
  overviewPeaksCache = { key, peaks: loudest };
  return loudest;
}

/** The strip over the whole Recording: brightness is how much of that column survives, plus the zoom window. */
function drawOverview(tab: OpenTab): void {
  const seconds = recordingSeconds(tab);
  if (!seconds) return;
  const { finished, zoom } = tab;
  const height = 34;
  const { paint, width } = canvasBrush(view.overview, height);

  // The strip carries the same two things as the waveforms below: the cut behind, the sound in front. Without a
  // cut the band is plain — an all-red one would claim the whole Recording is being removed.
  paint.fillStyle = finished ? REMOVED_BAND : PLAIN_BAND;
  paint.fillRect(0, 0, width, height);

  const share = finished ? keptShareByColumn(finished.keptRanges, seconds, width) : [];
  for (let column = 0; column < width; column += 1) {
    const kept = share[column] as number;
    if (!(kept > 0)) continue;
    // A column that only half survives is only half as green, which is what makes the strip read as a heat strip.
    paint.globalAlpha = kept;
    paint.fillStyle = KEPT_BAND;
    paint.fillRect(column, 0, 1, height);
    paint.globalAlpha = 1;
  }

  // The sound itself, over the cut: one line per column, mirrored around the middle, as in the waveforms below.
  const peaks = overviewPeaks(tab, width, seconds);
  const middle = height / 2;
  for (let column = 0; column < width; column += 1) {
    const loudest = peaks[column] as number;
    if (loudest <= 0) continue;
    const half = Math.max(loudest * (middle - 1.5), 0.5);
    paint.fillStyle = !finished ? PLAIN_WAVE : (share[column] as number) > 0.5 ? KEPT_WAVE : REMOVED_WAVE;
    paint.fillRect(column, middle - half, 1, half * 2);
  }

  // Held stretches over the whole Recording, so a held moment far outside the zoom can still be found.
  drawHeldOver(paint, tab.session, width, height, (second) => (second / seconds) * width, 3);

  // Where the zoom below is looking.
  const left = (zoom.fromSeconds / seconds) * width;
  const right = (zoom.toSeconds / seconds) * width;
  paint.strokeStyle = "#e8eaed";
  paint.lineWidth = 1.5;
  paint.strokeRect(left + 0.75, 0.75, Math.max(right - left - 1.5, 1), height - 1.5);
}

/** One SourceTrack's waveform across the zoom window, with the cut painted behind it. */
function drawWaveform(tab: OpenTab, canvas: HTMLCanvasElement, waveform: SourceTrackWaveform): void {
  const seconds = recordingSeconds(tab);
  if (!seconds) return;
  const { finished, zoom } = tab;
  const height = 66;
  const { paint, width } = canvasBrush(canvas, height);
  const span = zoom.toSeconds - zoom.fromSeconds;
  const xOf = (second: number) => ((second - zoom.fromSeconds) / span) * width;

  // Without a cut there is nothing to colour: the waveform is a preview of the sound, not of a plan (ADR-0020).
  const bands = finished ? bandsIn(finished.keptRanges, zoom.fromSeconds, zoom.toSeconds) : [];
  if (!finished) {
    paint.fillStyle = PLAIN_BAND;
    paint.fillRect(0, 0, width, height);
  } else {
    for (const band of bands) {
      paint.fillStyle = band.kept ? KEPT_BAND : REMOVED_BAND;
      const from = xOf(band.startSeconds);
      paint.fillRect(from, 0, Math.max(xOf(band.endSeconds) - from, 0.5), height);
    }
  }

  // The waveform itself, one vertical line per pixel column, mirrored around the middle. The bands are already in
  // order and cover the window, so one cursor walks them alongside the columns — searching the whole cut for every
  // column cost millions of comparisons per redraw, and a redraw happens on every slider move.
  const middle = height / 2;
  let band = 0;
  for (let column = 0; column < width; column += 1) {
    const at = zoom.fromSeconds + (column / width) * span;
    const from = Math.floor(at * waveform.peaksPerSecond);
    const to = Math.max(Math.floor((at + span / width) * waveform.peaksPerSecond), from + 1);
    let loudest = 0;
    for (let peak = from; peak < to && peak < waveform.peaks.length; peak += 1) {
      const peakHeight = waveform.peaks[peak] as number;
      if (peakHeight > loudest) loudest = peakHeight;
    }
    while (band + 1 < bands.length && (bands[band] as CutBand).endSeconds <= at) band += 1;
    const half = Math.max(loudest * (height / 2 - 2), 0.5);
    paint.fillStyle = !finished ? PLAIN_WAVE : (bands[band] as CutBand).kept ? KEPT_WAVE : REMOVED_WAVE;
    paint.fillRect(column, middle - half, 1, half * 2);
  }

  drawHeldOver(paint, tab.session, width, height, xOf);

  // The Playhead. While this SourceTrack plays: a bar over every stretch the sound jumps across, and the line at the
  // moment being heard, read off the clock the sound itself runs on (ADR-0022). While nothing plays: the line on
  // every waveform, where listening starts next. While another SourceTrack plays, this one shows none.
  const now = playing?.tab === tab ? playing : null;
  let lineAt: number | null = null;
  if (now && now.position === waveform.position) {
    paint.fillStyle = JOIN_MARK;
    for (const join of now.playback.joins) {
      const from = xOf(join.removedFromSeconds);
      const to = xOf(join.removedToSeconds);
      if (to < 0 || from > width) continue;
      paint.fillRect(from, 0, Math.max(to - from, 1), 3);
      paint.fillRect(from, height - 3, Math.max(to - from, 1), 3);
    }
    lineAt = heardIn(now);
  } else if (!now) {
    lineAt = tab.playheadSeconds;
  }
  if (lineAt === null) return;
  const x = xOf(lineAt);
  if (x >= 0 && x <= width) {
    paint.fillStyle = PLAYHEAD;
    paint.fillRect(x - 1, 0, 2, height);
  }
}

/**
 * The canvas of one SourceTrack's waveform, made once and kept. The SourceTrack rows are rebuilt on every draw, so
 * a canvas made fresh each time would be cleared constantly and would drop the pointer in the middle of a drag. Only
 * the Tab on screen is drawn, so one canvas per position serves every Tab.
 */
const waveformCanvases = new Map<number, HTMLCanvasElement>();

function waveformCanvas(position: number): HTMLCanvasElement {
  const made = waveformCanvases.get(position);
  if (made) return made;
  const canvas = document.createElement("canvas");
  canvas.dataset["position"] = String(position);
  canvas.title = `Tonspur ${position + 1} · klicken setzt den Strich, ziehen verschiebt, Mausrad zoomt`;
  waveformCanvases.set(position, canvas);
  return canvas;
}

/**
 * The waveforms belonging to SourceTracks that still have a role. Audio read for a role the user took away stays
 * in `waveforms` so putting the role back is instant (ADR-0020), but none of it is drawn.
 */
function shownWaveforms(tab: OpenTab): SourceTrackWaveform[] {
  return tab.waveforms.filter((waveform) => roleOf(tab.session, waveform.position) !== "ignored");
}

function drawWaveforms(): void {
  const tab = viewed();
  const seconds = recordingSeconds(tab);
  // No SourceTrack with a role means nothing to picture — an empty strip would sit there claiming to show a cut.
  view.cutPicture.hidden = !tab || !seconds || shownWaveforms(tab).length === 0;
  if (!tab || !seconds || view.cutPicture.hidden) return;

  view.zoom.min = "0";
  view.zoom.max = "1000";
  view.zoom.step = "1";
  // The slider runs from the whole Recording at the left to the closest zoom at the right, and the ends are far
  // apart, so it moves in steps of a fixed ratio rather than of a fixed number of seconds.
  const widest = seconds;
  const closest = Math.min(CLOSEST_WINDOW_SECONDS, widest);
  const span = tab.zoom.toSeconds - tab.zoom.fromSeconds;
  view.zoom.value = String(Math.round((Math.log(widest / span) / Math.log(widest / closest)) * 1000));
  view.zoomValue.textContent = duration(span);
  // Before a cut there is nothing removed to skip, so the switch would promise something it cannot do.
  view.skipRow.hidden = tab.finished === null;

  for (const waveform of tab.waveforms) {
    const canvas = waveformCanvases.get(waveform.position);
    // A canvas the row has not put on screen yet has no width to draw into.
    if (canvas?.isConnected) drawWaveform(tab, canvas, waveform);
  }
  drawOverview(tab);
}

/** Moves the zoom window of the Tab on screen and redraws, without touching anything else on screen. */
function showWindow(tab: OpenTab, next: ZoomWindow): void {
  tab.zoom = next;
  if (viewed() === tab) drawWaveforms();
}

/** Takes in waveforms that arrived for a Tab, keeping every one read before, and starts its zoom on the whole Recording. */
function mergeWaveforms(tab: OpenTab, drawn: readonly SourceTrackWaveform[]): void {
  // Merged, not replaced: an analysis only decodes the SourceTracks with a role, while the read-ahead brought in
  // every one that carries sound. Replacing would throw those away and make switching roles slow again (ADR-0020).
  tab.waveforms = [...drawn, ...tab.waveforms].filter(
    (waveform, at, all) => all.findIndex((each) => each.position === waveform.position) === at,
  );
  // The zoom is only set up when there was nothing to look at yet: a user who zoomed to a suspect spot stays there.
  const seconds = recordingSeconds(tab);
  if (seconds && tab.zoom.toSeconds <= 1) tab.zoom = { fromSeconds: 0, toSeconds: seconds };
  Object.assign(tab, readArrived(tab, drawn.map((waveform) => waveform.position)));
}

/* ── Work in the background ────────────────────────────────────────────────────────────────────────────────── */

/**
 * The one job running in the background, across every Tab: scanning a Recording, reading its SourceTracks, or reading
 * a reopened project's audio. The owner chose one Recording after another over all at once (ADR-0025).
 */
let job: BackgroundJob | null = null;

/** Starts the next background job, if there is one and none is running. Called whenever something may have left work. */
async function pump(): Promise<void> {
  if (job || preparing) return;
  const next = nextBackgroundJob(tabs, viewedId);
  const tab = next ? tabById(next.tabId) : undefined;
  if (!next || !tab) return;
  job = next;
  drawTabs();
  try {
    if (next.kind === "scan") await scanTab(tab);
    else if (next.kind === "read") await readTab(tab, next.positions);
    else await readProjectAudioOf(tab);
  } catch (error) {
    // An answer is a value, never an exception (ADR-0012); this is a fault in the window. Stall the Tab rather than
    // retrying it for ever.
    if (isOpen(tab)) {
      Object.assign(tab, jobRefused(tab));
      say(tab, `Das ging nicht: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    job = null;
  }
  draw();
  void pump();
}

/** Says how far reading a Tab's SourceTracks has got, without taking its status line away from a refusal. */
function drawReading(tab: OpenTab): void {
  if (tab.status.bad) return;
  const { done, total } = tab.readingCount;
  setStatus(
    tab,
    total === 1 ? "Liest den Ton der Tonspur …" : `Liest den Ton der Tonspuren … ${done} von ${total} fertig`,
  );
}

/** A status line a background job put up, which it takes down again once done — and no other. */
const isJobLine = (tab: OpenTab) =>
  !tab.status.bad && (tab.status.text.startsWith("Liest den Ton") || tab.status.text === "Prüft die Tonspuren …");

/** Listens to slices of a Tab's SourceTracks, so its EmptyTracks are hidden and the rest read ahead (ADR-0013). */
async function scanTab(tab: OpenTab): Promise<void> {
  setStatus(tab, "Prüft die Tonspuren …");
  const answer = await window.smarttrim.scan(tab.id);
  if (!isOpen(tab)) return;
  const scan = show(tab, answer, "Die Tonspuren ließen sich nicht prüfen");
  if (!scan) {
    Object.assign(tab, jobRefused(tab));
    return;
  }
  // Not the whole Tab anew: its rows were on screen during the scan, and a role given meanwhile is the user's.
  Object.assign(tab, scanArrived(tab, scan));
  if (isJobLine(tab)) clearStatus(tab);
}

/**
 * Reads SourceTracks of a Tab — those with a role, and every one the scan found sound on — and draws them (ADR-0020).
 * This is the same read the cut needs, only earlier: what it brings in is kept in the main process and the cut reuses
 * it.
 */
async function readTab(tab: OpenTab, positions: readonly number[]): Promise<void> {
  tab.readingCount = { done: 0, total: positions.length };
  drawReading(tab);
  const answer = await window.smarttrim.readSourceTracks(tab.id, positions);
  if (!isOpen(tab)) return;
  const drawn = show(tab, answer, "Die Tonspur ließ sich nicht lesen");
  if (!drawn) {
    // Asked again, the same read would be refused again — one ffmpeg on a 23 GB file per turn. The user retries by
    // giving a role again.
    Object.assign(tab, jobRefused(tab));
    return;
  }
  mergeWaveforms(tab, drawn);
  // Only the reading line is cleared. A warning such as "noch einmal schneiden" belongs to the settings, not to
  // this read, and wiping it would leave stale numbers on screen with nothing saying so.
  if (isJobLine(tab)) clearStatus(tab);
}

/**
 * Reads the audio of a reopened project, so its waveform appears. It runs in the background: the sliders and the
 * numbers are already usable, and the waveform appears when it arrives.
 */
async function readProjectAudioOf(tab: OpenTab): Promise<void> {
  setStatus(tab, "Liest den Ton für die Wellenform …");
  const answer = await window.smarttrim.readProjectAudio(tab.id);
  if (!isOpen(tab)) return;
  const drawn = show(tab, answer, "Der Ton ließ sich nicht nachlesen");
  if (!drawn) {
    Object.assign(tab, jobRefused(tab));
    return;
  }
  mergeWaveforms(tab, drawn);
  // What a threshold is decided from is back in memory, so moving it decides again instead of asking for a whole new
  // cut — without claiming the sliders as they stand now are what the cut was planned with.
  Object.assign(tab, projectAudioArrived(tab, drawn.map((waveform) => waveform.position)));
  if (isJobLine(tab)) clearStatus(tab);
}

/**
 * Fetches the waveforms of the analysis that just finished. The shape of the sound does not change with a slider, so
 * this is asked for once per analysis (ADR-0019).
 */
async function loadWaveforms(tab: OpenTab): Promise<void> {
  const drawn = show(tab, await window.smarttrim.waveforms(tab.id), "Die Wellenform ließ sich nicht zeichnen");
  if (!drawn || !isOpen(tab)) return;
  mergeWaveforms(tab, drawn);
  // A full redraw, not just the picture: the SourceTrack rows are what put each waveform's canvas on screen, and
  // they were built while there was still nothing to draw.
  draw();
}

/* ── Presets ───────────────────────────────────────────────────────────────────────────────────────────────── */

/** Closes whatever row was open and gives the keyboard back to the dropdown, which would otherwise hold nothing. */
function closePresetRow(): void {
  naming = false;
  asking = null;
  draw();
  view.preset.focus();
}

/** Puts a question in the window instead of in a Windows popup, and runs the action only if the user says yes. */
function ask(question: string, yes: () => void): void {
  asking = { question, yes };
  draw();
  view.confirmAsk.focus();
}

view.confirmAsk.addEventListener("click", () => {
  const act = asking?.yes;
  closePresetRow();
  act?.();
});

view.cancelAsk.addEventListener("click", closePresetRow);

/** Takes the Presets the main process reports back, and puts the saved one on the dropdown of the Tab on screen. */
function presetsSaved(saved: readonly Preset[], chosen: Preset): void {
  ownPresets = saved;
  const tab = viewed();
  // The sliders already carry these values, so this only marks which Preset they now belong to.
  if (tab) tab.session = applyPreset(tab.session, chosen);
  closePresetRow();
}

view.newPreset.addEventListener("click", () => {
  clearStatus(viewed());
  naming = true;
  draw();
  view.presetName.value = "";
  view.presetName.focus();
});

view.cancelPreset.addEventListener("click", closePresetRow);

view.presetName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") view.confirmPreset.click();
  if (event.key === "Escape") view.cancelPreset.click();
});

view.confirmPreset.addEventListener("click", () => {
  const tab = viewed();
  if (!tab) return;
  clearStatus(tab);
  const name = view.presetName.value.trim();
  let preset: Preset;
  try {
    // Refuses a built-in name or a blank one here, before the main process is asked to write anything.
    preset = presetFromSliders(tab.session, name);
  } catch (reason) {
    say(tab, (reason as Error).message);
    return;
  }

  const write = async () => {
    const saved = show(tab, await window.smarttrim.savePreset(preset), "Die Voreinstellung ließ sich nicht speichern");
    if (saved) presetsSaved(saved, preset);
  };
  if (ownPresets.some((each) => each.name === name)) {
    naming = false;
    ask(`„${name}“ gibt es schon. Überschreiben?`, () => void write());
    return;
  }
  void write();
});

// Writing the sliders back into the Preset they were changed from. No question first: the button only exists while
// there is something to write back, and pressing it says plainly enough what is meant.
view.savePreset.addEventListener("click", async () => {
  const tab = viewed();
  if (!tab) return;
  clearStatus(tab);
  const choice = presetChoice(tab.session, ownPresets);
  if (!choice) return;
  const preset = presetFromSliders(tab.session, choice.name);
  const saved = show(tab, await window.smarttrim.savePreset(preset), "Die Voreinstellung ließ sich nicht speichern");
  if (saved) presetsSaved(saved, preset);
});

view.deletePreset.addEventListener("click", () => {
  const tab = viewed();
  if (!tab) return;
  clearStatus(tab);
  const choice = presetChoice(tab.session, ownPresets);
  if (!choice) return;
  ask(`„${choice.name}“ löschen?`, async () => {
    const left = show(tab, await window.smarttrim.deletePreset(choice.name), "Die Voreinstellung ließ sich nicht löschen");
    if (!left) return;
    ownPresets = left;
    // The sliders keep their values; only the name they belonged to is gone — in every Tab that had it chosen.
    for (const each of tabs) {
      if (each.session.selectedPreset === choice.name) each.session = { ...each.session, selectedPreset: null };
    }
    draw();
  });
});


/* ── Zooming, dragging and the strip ───────────────────────────────────────────────────────────────────────── */

view.zoom.addEventListener("input", () => {
  const tab = viewed();
  const seconds = recordingSeconds(tab);
  if (!tab || !seconds) return;
  const closest = Math.min(CLOSEST_WINDOW_SECONDS, seconds);
  // The slider is a ratio, not a number of seconds: 0 is the whole Recording, 1000 is the closest zoom.
  const along = Number(view.zoom.value) / 1000;
  showWindow(tab, zoomedTo(tab.zoom, seconds, seconds * (closest / seconds) ** along));
});

/* ── Playback ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The SourceTrack that is playing, if any — one at a time in the whole window (ADR-0022), and always in the Tab on
 * screen, since showing another Tab stops it. `startedAt` is the audio clock's time of the first sample, so the
 * Playhead is read off the clock the sound runs on rather than off a timer that drifts from it.
 */
let playing: {
  tab: OpenTab;
  position: number;
  playback: Playback;
  /** Whether this sound skips what the cut removes, and so goes stale the moment the cut changes. */
  skipping: boolean;
  context: AudioContext;
  source: AudioBufferSourceNode;
  startedAt: number;
} | null = null;
/**
 * One AudioContext for the whole window, made on the first press and kept, rather than one per press: every press,
 * and every click on the waveform while listening, would otherwise get an audio device going again. How much that
 * saves is not measured — the browser pane throttles a hidden page to about one timer a second, so it cannot tell.
 */
let audio: AudioContext | null = null;

function sharedAudio(): AudioContext {
  audio ??= new AudioContext();
  if (audio.state === "suspended") void audio.resume();
  return audio;
}

/**
 * The SourceTrack of the Tab on screen whose Excerpt is on its way, so its button says so and a second press cancels
 * instead.
 */
let fetchingFor: number | null = null;
/** Counts presses, so an Excerpt arriving after the user pressed something else is dropped instead of played. */
let playRequest = 0;
let playheadFrame = 0;
/** Where the Playhead was on the frame before, so the view pages along only when the Playhead runs out of it. */
let lastHeard: number | null = null;
/** Where the sound on its way will start, so unfolding the picture while it is read asks for the picture from there. */
let startingFrom: number | null = null;
/**
 * The fastest Excerpt read of each Tab. A read that lost no time to frames being made beside it is the fastest there
 * has been, so it stands for a read without a picture — what the sound may be measured against (ADR-0028).
 */
const fastestExcerptMs = new Map<number, number>();

/** Stops the sound and forgets an Excerpt still on its way. */
function stopPlaying(): void {
  playRequest += 1;
  fetchingFor = null;
  startingFrom = null;
  cancelAnimationFrame(playheadFrame);
  const was = playing;
  playing = null;
  // The picture stops with the sound; the next draw puts the still frame where the sound stopped.
  pausePicture();
  if (!was) return;
  // The Playhead stays where the sound stopped, so the next press goes on from there.
  was.tab.playheadSeconds = heardIn(was);
  was.source.onended = null;
  was.source.stop();
  // The context stays for the next press; only this sound's node goes.
  was.source.disconnect();
}

/** The moment of the Recording a playing SourceTrack is at, read off the clock the sound runs on. */
function heardIn(sound: NonNullable<typeof playing>): number {
  return recordingSecondsAt(sound.playback, Math.max(sound.context.currentTime - sound.startedAt, 0));
}

/**
 * Redraws the playing SourceTrack's waveform every frame, so the Playhead moves — only that one canvas. When the
 * Playhead runs out of the right edge of the view, the view turns a page so the Playhead starts it again. It does
 * not when the user has moved the view away while listening: that would snatch the view back from them.
 */
function followPlayhead(): void {
  const now = playing;
  if (!now) return;
  const { tab } = now;
  const heard = heardIn(now);
  followPicture(now);
  const seconds = recordingSeconds(tab);
  const wasInView = lastHeard !== null && lastHeard >= tab.zoom.fromSeconds && lastHeard <= tab.zoom.toSeconds;
  lastHeard = heard;
  if (seconds && wasInView && heard > tab.zoom.toSeconds) {
    showWindow(tab, pannedBy(tab.zoom, seconds, heard - tab.zoom.fromSeconds));
  } else {
    const waveform = tab.waveforms.find((each) => each.position === now.position);
    const canvas = waveformCanvases.get(now.position);
    if (waveform && canvas?.isConnected) drawWaveform(tab, canvas, waveform);
  }
  playheadFrame = requestAnimationFrame(followPlayhead);
}

/**
 * Puts the Playhead where the user clicked a waveform. While a SourceTrack plays it jumps there and plays on, the
 * way a click on Premiere's timeline does.
 */
function placePlayhead(tab: OpenTab, canvas: HTMLCanvasElement, clientX: number): void {
  const seconds = recordingSeconds(tab);
  if (!seconds) return;
  const box = canvas.getBoundingClientRect();
  const span = tab.zoom.toSeconds - tab.zoom.fromSeconds;
  const clicked = Math.min(Math.max(tab.zoom.fromSeconds + ((clientX - box.left) / box.width) * span, 0), seconds);
  // A SourceTrack that plays, or whose Excerpt is still on its way, jumps there; with nothing playing the click only
  // moves the Playhead. Counting the one on its way is what keeps a second quick click from stopping the sound.
  const position = playing?.position ?? fetchingFor;
  // Stopping leaves the Playhead where the sound was, so the click is put back after it.
  stopPlaying();
  tab.playheadSeconds = clicked;
  if (position === null) {
    drawWaveforms();
    // Nothing plays, so the still frame goes to where the Playhead now is.
    drawPicture(tab);
  } else void play(position);
}

/**
 * Plays one SourceTrack of the Tab on screen over what the waveforms show — or the first three minutes of it, zoomed
 * out further than that — skipping what the cut removes when the switch says so. Pressing the row that plays, or
 * waits, stops it.
 */
async function play(position: number): Promise<void> {
  const busyWith = playing?.position ?? fetchingFor;
  stopPlaying();
  const tab = viewed();
  const seconds = recordingSeconds(tab);
  if (busyWith === position || !tab || !seconds) {
    draw();
    return;
  }

  const request = playRequest;
  // From the Playhead — unless it is not in view, or at the very end: then from the start of what the user sees.
  // Up to three minutes, past the edge of the view if need be; the view pages along (followPlayhead).
  const { zoom, playheadSeconds } = tab;
  const playheadUsable =
    playheadSeconds !== null &&
    playheadSeconds >= zoom.fromSeconds &&
    playheadSeconds <= zoom.toSeconds &&
    playheadSeconds < seconds - 0.05;
  const fromSeconds = playheadUsable ? (playheadSeconds as number) : zoom.fromSeconds;
  const toSeconds = Math.min(fromSeconds + LONGEST_EXCERPT_SECONDS, seconds);
  // The Playhead starts in view, so a start that skipping carries past the right edge still turns the page.
  lastHeard = fromSeconds;
  // The picture's frames are made from here while the Excerpt is read (ADR-0028), and unfolding it meanwhile asks for
  // the same place.
  startingFrom = fromSeconds;
  preparePicture(tab, fromSeconds);
  // The cut as it is on screen when the button is pressed; before a cut there is nothing to skip.
  const kept = tab.finished?.keptRanges ?? null;
  const skipping = view.skipRemoved.checked && kept !== null;
  fetchingFor = position;
  clearStatus(tab);
  draw();

  const readFrom = performance.now();
  const answer = await window.smarttrim.readExcerpt({ tabId: tab.id, position, fromSeconds, toSeconds });
  const readMs = performance.now() - readFrom;
  // Something else was pressed, another Tab was shown, or this one closed, while the Excerpt was on its way.
  if (request !== playRequest || !isOpen(tab)) return;
  fetchingFor = null;
  const excerpt = show(tab, answer, "Der Ton ließ sich nicht abspielen");
  if (!excerpt) {
    draw();
    return;
  }

  let playback: Playback;
  try {
    playback = playbackOf(excerpt, kept ?? [], skipping);
  } catch (error) {
    // Skipping is the one case in which nothing may be left to play; anything else is reported as what it is.
    say(
      tab,
      skipping
        ? "Hier wird alles herausgeschnitten – zum Anhören weiter herauszoomen oder „überspringen“ ausschalten."
        : `Der Ton ließ sich nicht abspielen: ${error instanceof Error ? error.message : String(error)}`,
    );
    draw();
    return;
  }

  // The sound waits a moment for the picture's first frames, so both start together — but only for what is left of the
  // owner's allowance after this read lost time to the frames being made beside it (ADR-0028). Until the sound starts it
  // still counts as on its way, so a click meanwhile jumps instead of finding nothing to stop.
  const fastest = fastestExcerptMs.get(tab.id) ?? null;
  fastestExcerptMs.set(tab.id, Math.min(fastest ?? readMs, readMs));
  fetchingFor = position;
  await waitForPicture(tab, playback, pictureWaitMs(readMs, fastest), () => request === playRequest && isOpen(tab));
  if (request !== playRequest || !isOpen(tab)) return;
  fetchingFor = null;
  startingFrom = null;

  // `play` runs detached from the button, so a failure here would otherwise vanish without a word.
  let sound: ReturnType<typeof startSound>;
  try {
    sound = startSound(playback);
  } catch (error) {
    say(tab, `Der Ton ließ sich nicht abspielen: ${error instanceof Error ? error.message : String(error)}`);
    draw();
    return;
  }
  playing = { tab, position, playback, skipping, ...sound };
  draw();
  followPlayhead();
}

/** Turns what is to be played into sound on the shared AudioContext and starts it a moment from now. */
function startSound(playback: Playback): { context: AudioContext; source: AudioBufferSourceNode; startedAt: number } {
  const context = sharedAudio();
  const frames = playback.channels[0]?.length ?? 0;
  const buffer = context.createBuffer(playback.channelCount, frames, playback.sampleRate);
  // Copied in whole per Channel. Converting sample by sample here froze the window for up to half a second (ADR-0028).
  playback.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.onended = () => {
    if (playing?.source !== source) return;
    stopPlaying();
    draw();
  };
  const startedAt = context.currentTime + 0.05;
  source.start(startedAt);
  return { context, source, startedAt };
}

// Switching while it plays — or while its Excerpt is on its way — starts the same SourceTrack again the new way,
// rather than leaving the old sound running or playing what arrives with the old setting.
view.skipRemoved.addEventListener("change", () => {
  const position = playing?.position ?? fetchingFor;
  if (position === null) return;
  stopPlaying();
  void play(position);
});

/**
 * The white frame in the overview strip is dragged, not only clicked. Grabbing inside it keeps the spot you took
 * hold of; grabbing outside it jumps there first and then drags on. Either way the frame follows the pointer while
 * it moves, rather than appearing somewhere else once the button is let go.
 */
view.overview.addEventListener("pointerdown", (event) => {
  const tab = viewed();
  const seconds = recordingSeconds(tab);
  if (!tab || !seconds) return;
  const box = view.overview.getBoundingClientRect();
  const secondAt = (clientX: number) => ((clientX - box.left) / box.width) * seconds;

  const span = tab.zoom.toSeconds - tab.zoom.fromSeconds;
  const grabbed = secondAt(event.clientX);
  const insideFrame = grabbed >= tab.zoom.fromSeconds && grabbed < tab.zoom.toSeconds;
  // Outside the frame the window centres on the pointer; inside it, the pointer keeps its place within the frame.
  const holdOffset = insideFrame ? grabbed - tab.zoom.fromSeconds : span / 2;
  view.overview.classList.add("dragging");

  const move = (moved: PointerEvent) => {
    showWindow(tab, pannedBy(tab.zoom, seconds, secondAt(moved.clientX) - holdOffset - tab.zoom.fromSeconds));
  };
  const stop = () => {
    view.overview.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
  // A press outside the frame should move there at once, not wait for the first movement.
  move(event);
});

/* ── Held stretches ────────────────────────────────────────────────────────────────────────────────────────── */

/* ── The picture ───────────────────────────────────────────────────────────────────────────────────────────── */

/** Where the window remembers whether the picture is unfolded, across starts. */
const PICTURE_OPEN_KEY = "smarttrim.pictureOpen";

/** Whether the picture is unfolded: one choice for every Tab, kept when SmartTrim starts again (ADR-0027). */
let pictureOpen = (() => {
  try {
    return localStorage.getItem(PICTURE_OPEN_KEY) !== "false";
  } catch {
    return true;
  }
})();
/*
 * The picture is drawn on a canvas from small JPEG frames that ffmpeg makes ahead in the main process (ADR-0028). Every
 * animation frame draws the frame due at the moment leaving the speakers, and the next half second is unpacked ahead,
 * so a Join is only another frame number: nothing seeks while the sound plays. Two <video> elements hitched 4–5 frames
 * at every Join, and a WebCodecs decoder was held to 63 frames a second while the window drew (ADR-0027).
 */

/** How far ahead of the sound frames are unpacked, so drawing never waits for one. */
const UNPACK_AHEAD_SECONDS = 0.5;
/** How much of the start the sound waits for, so the picture does not stop again right after it has begun. */
const PICTURE_START_SECONDS = 0.25;
/** How long a still frame is waited for before the picture is left as it is. */
const STILL_WAIT_MS = 5000;

const pictureContext = view.pictureCanvas.getContext("2d") as CanvasRenderingContext2D;
/** Frames unpacked and ready to draw, by number, all of the Recording of `pictureTabId`. */
const unpacked = new Map<number, ImageBitmap>();
/** Frames on their way from the main process, so none is asked for twice at once. */
const unpacking = new Set<number>();
/** Whether the frames ahead of the sound are being fetched, so animation frames do not pile requests on each other. */
let unpackingAhead = false;
/** The Tab whose picture is shown. */
let pictureTabId: number | null = null;
/** The frame on the canvas, so the same one is not drawn again every animation frame. */
let shownFrame: number | null = null;
/** Where the still frame was last asked for, so a redraw does not ask again. */
let stillAt: number | null = null;
/** Why the picture cannot be shown, when the main process refused to make it. */
let pictureFailed: string | null = null;

/** Lets go of every unpacked frame but `keep`. */
function keepUnpacked(keep: ReadonlySet<number>): void {
  for (const [index, bitmap] of unpacked) {
    if (keep.has(index)) continue;
    bitmap.close();
    unpacked.delete(index);
  }
}

/** Starts over for another Tab, or for none. */
function forgetPicture(tabId: number | null): void {
  pictureTabId = tabId;
  keepUnpacked(new Set());
  shownFrame = null;
  stillAt = null;
  pictureFailed = null;
  pictureContext.clearRect(0, 0, view.pictureCanvas.width, view.pictureCanvas.height);
}

/** Says under the frame why the picture cannot be shown. */
function sayAboutPicture(reason: string): void {
  const said = `Das Bild dieser Aufnahme lässt sich hier nicht zeigen: ${reason}`;
  if (pictureFailed === said) return;
  pictureFailed = said;
  drawPicture(viewed());
}

/** Asks the main process for the picture of a Tab from a moment on, unless the picture is folded away. */
function preparePicture(tab: OpenTab, seconds: number): void {
  if (!pictureOpen) return;
  pictureFailed = null;
  void window.smarttrim.wantPicture(tab.id, seconds).then((answer) => {
    if (answer.ok || pictureTabId !== tab.id) return;
    sayAboutPicture(answer.message);
  });
}

/** Lets the main process stop making frames and let go of the ones it holds: folded away, nobody sees them. */
function stopPictureFrames(): void {
  keepUnpacked(new Set());
  shownFrame = null;
  void window.smarttrim.stopPicture();
}

/** Fetches these frames from the main process and unpacks them. Frames not made yet stay missing until asked again. */
async function unpackFrames(tabId: number, indices: readonly number[]): Promise<void> {
  const wanted = indices.filter((index) => !unpacked.has(index) && !unpacking.has(index));
  if (wanted.length === 0) return;
  for (const index of wanted) unpacking.add(index);
  try {
    const answer = await window.smarttrim.pictureFrames(tabId, wanted);
    if (!answer.ok || pictureTabId !== tabId) return;
    // ffmpeg was given up on for this Recording: the reason belongs under the frame rather than nowhere.
    if (answer.value.failure !== null) sayAboutPicture(answer.value.failure);
    await Promise.all(
      answer.value.jpegs.map(async (jpeg, at) => {
        if (!jpeg) return;
        const index = wanted[at] as number;
        const bitmap = await createImageBitmap(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
        if (pictureTabId !== tabId || unpacked.has(index)) bitmap.close();
        else unpacked.set(index, bitmap);
      }),
    );
  } catch {
    // A frame that could not be unpacked is asked for again on the next animation frame.
  } finally {
    for (const index of wanted) unpacking.delete(index);
  }
}

/** Fetches frames until they are all unpacked, until nobody wants them any more, or until `limitMs` has passed. */
async function unpackUntil(tabId: number, indices: readonly number[], limitMs: number, stillWanted: () => boolean): Promise<boolean> {
  const since = performance.now();
  while (stillWanted() && performance.now() - since < limitMs) {
    await unpackFrames(tabId, indices);
    if (indices.every((index) => unpacked.has(index))) return true;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return indices.every((index) => unpacked.has(index));
}

/** Puts a frame on the canvas, if it is unpacked. A frame still missing leaves the one before on screen. */
function drawFrame(index: number): boolean {
  const bitmap = unpacked.get(index);
  if (!bitmap) return false;
  if (shownFrame !== index) {
    pictureContext.drawImage(bitmap, 0, 0, view.pictureCanvas.width, view.pictureCanvas.height);
    shownFrame = index;
  }
  return true;
}

/** The picture stops with the sound; the next draw puts the still frame where the sound stopped. */
function pausePicture(): void {
  stillAt = null;
}

/**
 * The picture of the Tab on screen: folded or not, and — while nothing plays — the still frame under the Playhead, or
 * the first frame while there is none. Zooming and dragging the view leave it where it is.
 */
function drawPicture(tab: OpenTab | null): void {
  const recording = tab?.session.recording ?? null;
  view.picture.hidden = !tab || !recording;
  if (!tab || !recording) {
    if (pictureTabId !== null) forgetPicture(null);
    return;
  }
  if (pictureTabId !== tab.id) forgetPicture(tab.id);
  // The canvas holds the frames at the size they are made, in the Recording's own shape; CSS fits it to the frame.
  const { width, height } = pictureSizeOf(recording);
  if (view.pictureCanvas.width !== width || view.pictureCanvas.height !== height) {
    view.pictureCanvas.width = width;
    view.pictureCanvas.height = height;
    shownFrame = null;
  }
  view.pictureToggle.textContent = pictureOpen ? "Bild ausblenden" : "Bild zeigen";
  view.pictureFrame.hidden = !pictureOpen;
  view.pictureNote.hidden = pictureFailed === null;
  view.pictureNote.textContent = pictureFailed ?? "";
  // As wide as the waveforms and no higher than the frames are made, in the Recording's own shape (PICTURE_HEIGHT).
  view.pictureFrame.style.aspectRatio = `${recording.width} / ${recording.height}`;
  view.pictureFrame.style.maxWidth = `${width}px`;
  // While a sound plays, or its Excerpt is on its way, the sound decides what is shown.
  if (!pictureOpen || playing?.tab === tab || fetchingFor !== null) return;
  const wanted = tab.playheadSeconds ?? 0;
  if (stillAt !== wanted) {
    stillAt = wanted;
    void showStill(tab, wanted);
  }
}

/** The still frame at a moment: asked for, then drawn once it is made and unpacked — at once where it already is. */
async function showStill(tab: OpenTab, seconds: number): Promise<void> {
  const recording = tab.session.recording;
  if (!recording) return;
  const index = frameAtSeconds(recording, seconds);
  preparePicture(tab, seconds);
  const stillWanted = () => stillAt === seconds && pictureTabId === tab.id && playing?.tab !== tab && pictureOpen;
  // Where ffmpeg has not been yet the frame takes a few hundred milliseconds; past STILL_WAIT_MS it is given up on and
  // whatever stands on the canvas is left there.
  if (!(await unpackUntil(tab.id, [index], STILL_WAIT_MS, stillWanted)) || !stillWanted()) return;
  drawFrame(index);
  keepUnpacked(new Set([index]));
}

/** The moment of what is played that is leaving the speakers now — later than the audio clock by the output latency. */
function audibleSecondsOf(sound: NonNullable<typeof playing>): number {
  const stamp = sound.context.getOutputTimestamp();
  if (!stamp.contextTime || !stamp.performanceTime) return sound.context.currentTime - sound.startedAt;
  return stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000 - sound.startedAt;
}

/** Keeps the picture with the sound, once per animation frame while a SourceTrack plays. The sound is the clock. */
function followPicture(sound: NonNullable<typeof playing>): void {
  const recording = sound.tab.session.recording;
  if (!pictureOpen || pictureTabId !== sound.tab.id || !recording) return;
  stillAt = null;
  const { due, ahead } = framesDue(sound.playback, audibleSecondsOf(sound), recording, UNPACK_AHEAD_SECONDS);
  drawFrame(due);
  keepUnpacked(new Set(ahead));
  if (unpackingAhead) return;
  unpackingAhead = true;
  void unpackFrames(sound.tab.id, ahead).finally(() => {
    unpackingAhead = false;
  });
}

/**
 * Lets the sound wait for the picture's first quarter second, so that both start together. How long it may wait is
 * what is left of the owner's allowance once the Excerpt read has lost time to the frames being made (`pictureWaitMs`).
 * Past that the sound starts anyway and the picture joins it as soon as its frames are there.
 */
async function waitForPicture(tab: OpenTab, playback: Playback, waitMs: number, stillWanted: () => boolean): Promise<void> {
  const recording = tab.session.recording;
  if (!pictureOpen || pictureTabId !== tab.id || !recording) return;
  const { ahead } = framesDue(playback, 0, recording, PICTURE_START_SECONDS);
  // Folded away while it waits, the picture takes the reason for waiting with it.
  await unpackUntil(tab.id, ahead, waitMs, () => stillWanted() && pictureOpen);
}

view.pictureToggle.addEventListener("click", () => {
  pictureOpen = !pictureOpen;
  try {
    localStorage.setItem(PICTURE_OPEN_KEY, String(pictureOpen));
  } catch {
    // Not remembered, then; the choice still holds until SmartTrim is closed.
  }
  pausePicture();
  if (!pictureOpen) {
    // Folded away, nothing is made for it: ffmpeg stops and the frames held are let go (ADR-0028).
    stopPictureFrames();
  } else if (playing) {
    // Unfolded while a SourceTrack plays, the picture is asked for from where the sound is — and while its Excerpt is
    // still on its way, from where that sound will start.
    preparePicture(playing.tab, heardIn(playing));
  } else if (startingFrom !== null) {
    const tab = viewed();
    if (tab) preparePicture(tab, startingFrom);
  }
  draw();
});

/** The moment "Anfang/Ende festhalten" mark: where the sound is while it plays, else where the Playhead waits. */
function playheadNow(tab: OpenTab): number | null {
  return playing?.tab === tab ? heardIn(playing) : tab.playheadSeconds;
}

/** A moment as the list shows it: minutes and seconds to a tenth, with hours in front when there are any. */
function clock(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const rest = decimals((tenths % 600) / 10, 1).padStart(4, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The two buttons and the list of held stretches under the waveforms (ADR-0023). */
function drawHeld(tab: OpenTab | null): void {
  // Offered wherever there are waveforms to mark on — and wherever something is held, so a reopened project shows its
  // held stretches before its audio has been read again, and still shows them if that read fails.
  view.held.hidden = !tab?.session.recording || (view.cutPicture.hidden && tab.session.lockedRanges.length === 0);
  // Emptied even while hidden: the list left standing would be another Tab's the moment this row shows again.
  view.heldList.replaceChildren();
  if (!tab || view.held.hidden) return;
  const anfang = tab.session.lockedRangeStart;
  // Enabled only on what cannot change without a redraw. The Playhead moves with the sound, and a state read from it
  // here went stale while listening: "Ende festhalten" stayed disabled for a whole playback. A click without a
  // Playhead, or an Ende on the Anfang, is answered with a sentence instead.
  view.holdStart.disabled = tab.working;
  view.holdEnd.disabled = tab.working || anfang === null;
  view.holdEnd.textContent = anfang === null ? "Ende festhalten" : `Ende festhalten (Anfang ${clock(anfang)})`;
  view.heldList.replaceChildren(
    ...tab.session.lockedRanges.map((range, index) => {
      const item = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = `Festgehalten: ${clock(range.startSeconds)} – ${clock(range.endSeconds)}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "link";
      remove.textContent = "entfernen";
      remove.disabled = tab.working;
      remove.addEventListener("click", () => {
        tab.session = removeLockedRange(tab.session, index);
        afterSettingChange(tab);
        draw();
      });
      item.append(text, remove);
      return item;
    }),
  );
}

view.holdStart.addEventListener("click", () => {
  const tab = viewed();
  if (!tab) return;
  const at = playheadNow(tab);
  if (at === null) {
    say(tab, "Setz zuerst den weißen Strich: ein Klick in die Wellenform, dann „Anfang festhalten“.");
    return;
  }
  tab.session = markLockedRangeStart(tab.session, at);
  draw();
});

view.holdEnd.addEventListener("click", () => {
  const tab = viewed();
  if (!tab) return;
  const at = playheadNow(tab);
  if (at === null) {
    say(tab, "Setz zuerst den weißen Strich an das Ende: ein Klick in die Wellenform, dann „Ende festhalten“.");
    return;
  }
  try {
    tab.session = markLockedRangeEnd(tab.session, at);
  } catch (error) {
    say(tab, `Das ließ sich nicht festhalten: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  // Holding a stretch only replans (ADR-0023), which a finished cut does at once and a pending one picks up.
  afterSettingChange(tab);
  draw();
});

/**
 * A press that moves less than this many pixels is a click that sets the Playhead, not a drag. A hand never clicks
 * without moving a pixel or two.
 */
const CLICK_SLOP_PX = 4;

/**
 * Dragging a waveform sideways slides the window; a click that barely moves puts the Playhead there instead; the
 * wheel zooms around where the pointer is.
 */
view.sourceTracks.addEventListener("pointerdown", (event) => {
  const canvas = (event.target as HTMLElement).closest("canvas");
  const tab = viewed();
  const seconds = recordingSeconds(tab);
  if (!canvas || !tab || !seconds) return;
  const box = canvas.getBoundingClientRect();
  const startX = event.clientX;
  let lastX = event.clientX;
  // How far the pointer got from where it went down.
  let travelled = 0;
  canvas.classList.add("dragging");

  const move = (moved: PointerEvent) => {
    travelled = Math.max(travelled, Math.abs(moved.clientX - startX));
    // Until the press is plainly a drag the view stays put, or a click would nudge it and the Playhead would land
    // beside the spot clicked. `lastX` stays at the press, so the drag catches up on the pixels held back.
    if (travelled < CLICK_SLOP_PX) return;
    const span = tab.zoom.toSeconds - tab.zoom.fromSeconds;
    // Dragging right pulls the Recording along with the pointer, so the window moves the other way.
    showWindow(tab, pannedBy(tab.zoom, seconds, -((moved.clientX - lastX) / box.width) * span));
    lastX = moved.clientX;
  };
  const stop = (ended: PointerEvent) => {
    canvas.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    if (ended.type === "pointerup" && travelled < CLICK_SLOP_PX && viewed() === tab) {
      placePlayhead(tab, canvas, ended.clientX);
    }
  };
  // On the window, not the canvas: a drag that wanders off the waveform keeps working, and it keeps working even
  // where capturing the pointer is refused — a silent stop mid-drag is worse than a drag that leaves the canvas.
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
});

view.sourceTracks.addEventListener(
  "wheel",
  (event) => {
    const canvas = (event.target as HTMLElement).closest("canvas");
    const tab = viewed();
    const seconds = recordingSeconds(tab);
    if (!canvas || !tab || !seconds) return;
    event.preventDefault();
    const span = tab.zoom.toSeconds - tab.zoom.fromSeconds;
    showWindow(tab, zoomedTo(tab.zoom, seconds, event.deltaY > 0 ? span * 1.25 : span / 1.25));
  },
  { passive: false },
);

// The canvases are sized in percent, so their pixel width changes with the window and they have to be redrawn.
window.addEventListener("resize", () => drawWaveforms());

/* ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────────────── */

/** A Tab's window-side record, fresh: nothing read, nothing drawn, nothing playing. */
function openTabFrom(work: TabWork, finished: CutSummary | null): OpenTab {
  return {
    ...work,
    finished,
    waveforms: [],
    zoom: { fromSeconds: 0, toSeconds: 1 },
    playheadSeconds: null,
    working: false,
    status: { text: "", bad: false },
    readingCount: { done: 0, total: 0 },
    redoTimer: undefined,
    redoing: null,
    skippedBy: null,
  };
}

/** Puts a Tab on screen. Only one sound plays in the window, and it belongs to the Tab that was on screen (ADR-0025). */
function viewTab(tabId: number): void {
  if (viewedId !== tabId) {
    stopPlaying();
    // The preset rows were opened for the Tab that was on screen.
    naming = false;
    asking = null;
  }
  viewedId = tabId;
  draw();
  // The Tab on screen goes first, so its read may be the next job.
  void pump();
}

/** × on a Tab: closes it, after asking when that would throw away held stretches no project holds. */
function requestClose(tab: OpenTab): void {
  if (askBeforeClosing(tab.session)) {
    // The Tab asked about is put on screen, so what the dialog talks about is what lies behind it.
    viewTab(tab.id);
    closeAsking = tab;
    draw();
    // Enter cancels, whatever the dialog offers: a stray Enter neither throws the held stretches away nor opens a
    // save dialog. Focusing "speichern" instead would land on "Abbrechen" whenever a replan is still pending.
    view.cancelClose.focus();
    return;
  }
  closeTab(tab);
}

function closeTab(tab: OpenTab): void {
  if (closeAsking === tab) closeAsking = null;
  if (!isOpen(tab)) return;
  if (viewed() === tab) stopPlaying();
  clearTimeout(tab.redoTimer);
  const nextViewed = viewedAfterClosing(
    tabs.map((each) => each.id),
    tab.id,
    viewedId,
  );
  tabs = tabs.filter((each) => each !== tab);
  // What the main process holds for it goes too; a job still running for it is refused when it finishes.
  void window.smarttrim.closeTab(tab.id);
  if (nextViewed !== viewedId) {
    naming = false;
    asking = null;
  }
  viewedId = nextViewed;
  draw();
  void pump();
}

function cancelClosing(): void {
  if (savingForClose) return;
  const tab = closeAsking;
  closeAsking = null;
  draw();
  // Back to the × that asked, so the keyboard is where the user left it.
  if (tab) [...view.tabStrip.querySelectorAll<HTMLButtonElement>(".tabClose")][tabs.indexOf(tab)]?.focus();
}

// Saves without a dialog — into the Tab's own project, else beside its Recording — and closes. The owner found a
// save dialog one question too many here, and one that opened behind the window left this dialog stuck (ADR-0025).
view.saveClose.addEventListener("click", async () => {
  const tab = closeAsking;
  if (!tab || savingForClose) return;
  savingForClose = true;
  draw();
  const saved = await saveProjectOf(tab);
  savingForClose = false;
  if (saved === undefined) {
    // The reason is in the Tab's status line, which the dialog would cover.
    closeAsking = null;
    draw();
    return;
  }
  // The Tab is about to go, so where its project landed is said where opening files reports.
  openNotes = [{ tone: "info", name: fileName(saved), text: "Als Projekt gespeichert.", detail: `Ordner: ${folderOf(saved)}` }];
  if (closeAsking === tab) closeTab(tab);
  else draw();
});

view.discardClose.addEventListener("click", () => {
  const tab = closeAsking;
  closeAsking = null;
  if (tab) closeTab(tab);
  else draw();
});

view.cancelClose.addEventListener("click", cancelClosing);
// A click on the dimmed window around the dialog, or Esc, is Abbrechen.
view.tabAsking.addEventListener("click", (event) => {
  if (event.target === view.tabAsking) cancelClosing();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && closeAsking) cancelClosing();
  if (event.key === "Escape" && takeOverAsking) closeTakeOver();
});

view.dismissNotes.addEventListener("click", () => {
  openNotes = [];
  draw();
});

/** A refused file in the user's words, with the core of what was reported beneath (ADR-0025). */
function refusalNote({ path, kind, detail }: Refusal): OpenNote {
  const name = fileName(path);
  const because = detail ? `Grund: ${detail}` : undefined;
  switch (kind) {
    case "missing":
      return { tone: "refused", name, text: "Die Datei gibt es nicht mehr." };
    case "folder":
      return { tone: "refused", name, text: "Das ist ein Ordner, keine Datei." };
    case "notARecording":
      return {
        tone: "refused",
        name,
        text: "Das ist keine Aufnahme. Darin ließ sich weder Bild noch Ton lesen.",
        detail: detail ? `ffprobe meldet: ${detail}` : undefined,
      };
    case "cannotCut":
      return { tone: "refused", name, text: "Diese Aufnahme kann SmartTrim nicht schneiden.", detail: because };
    case "notAProject":
      return { tone: "refused", name, text: "Das Projekt lässt sich nicht lesen.", detail: because };
    case "projectRecordingMissing":
      return {
        tone: "refused",
        name,
        text: "Die Aufnahme zu diesem Projekt ist nicht mehr da, wo sie beim Speichern lag.",
        detail: `Gesucht unter: ${detail}`,
      };
    case "otherProjectOpened":
      // Not an error: the Recording opens, only through the other project. Grey, not red.
      return {
        tone: "info",
        name,
        text: "Nicht geöffnet, weil zu derselben Aufnahme schon ein anderes Projekt geöffnet wird.",
        detail: `Geöffnet: ${fileName(detail)}`,
      };
    case "projectRecordingChanged":
      return {
        tone: "refused",
        name,
        text: "Die Aufnahme zu diesem Projekt hat sich seit dem Speichern verändert, die Schnitte würden nicht mehr passen.",
        detail: because,
      };
  }
}

/**
 * What opening files had to say. A Recording already open is shown rather than opened again; a project of one is not
 * loaded over the Tab, whose work would be lost (ADR-0025).
 */
function openingNotes(opened: OpenedInWindow): OpenNote[] {
  const notes: OpenNote[] = opened.refused.map(refusalNote);
  const alreadyOpen = opened.tabs.filter((one) => one.alreadyOpen);
  const recordings = alreadyOpen.filter((one) => one.kind === "recording");
  if (recordings.length === 1) {
    notes.push({ tone: "info", name: fileName(recordings[0]?.path ?? ""), text: "Ist schon offen." });
  }
  if (recordings.length > 1) notes.push({ tone: "info", name: "", text: `${recordings.length} Aufnahmen sind schon offen.` });
  for (const project of alreadyOpen.filter((one) => one.kind === "project")) {
    notes.push({
      tone: "info",
      name: fileName(project.path),
      text: "Nicht geladen, weil die Aufnahme dazu schon in einem Tab offen ist. Schließ diesen Tab zuerst, wenn du das Projekt öffnen willst.",
    });
  }
  return notes;
}

/**
 * The one way files reach the window, whether picked in a dialog or dropped. Each file opened gets a Tab at the end
 * of the strip; the first of them — or the Tab an already open Recording has — is put on screen.
 */
async function openAndShow(opening: () => Promise<Answer<OpenedInWindow | null>>): Promise<void> {
  const answer = await opening();
  if (!answer.ok) {
    openNotes = [{ tone: "refused", name: "", text: "Die Dateien ließen sich nicht öffnen.", detail: `Grund: ${answer.message}` }];
    draw();
    return;
  }
  // null means the user closed the dialog.
  if (!answer.value) return;
  const opened = answer.value;
  openNotes = openingNotes(opened);
  for (const one of opened.tabs) {
    if (one.alreadyOpen || tabById(one.tabId)) continue;
    tabs.push(
      one.kind === "recording"
        ? openTabFrom(recordingTab(one.tabId, one.recording), null)
        : openTabFrom(projectTab(one.tabId, one.project), one.summary),
    );
  }
  const first = opened.tabs[0];
  if (first && tabById(first.tabId)) viewTab(first.tabId);
  else draw();
}

view.chooseRecording.addEventListener("click", () => openAndShow(() => window.smarttrim.chooseRecording()));
view.openProject.addEventListener("click", () => openAndShow(() => window.smarttrim.openProject()));
// The drop area's own pair of buttons, shown while nothing is open, do the same as the header's.
view.emptyChoose.addEventListener("click", () => view.chooseRecording.click());
view.emptyOpen.addEventListener("click", () => view.openProject.click());
// A window made wider or narrower while a wait is shown gets its bars remade to the new width.
window.addEventListener("resize", () => {
  if (!view.reading.hidden) fillSoundBars(view.readingBars, [...view.readingBars.children].filter((bar) => bar.classList.contains("on")).length / Math.max(1, view.readingBars.children.length));
  if (!view.cutting.hidden) fillSoundBars(view.cuttingBars, 0);
});

// PROTOTYPE: which of the two layout drafts the window shows, remembered like the picture's fold.
const DRAFT_KEY = "smarttrim.draft";
const draftButtons = [...document.querySelectorAll<HTMLButtonElement>("#draftSwitch button")];
function showDraft(draft: string): void {
  document.documentElement.dataset["draft"] = draft;
  for (const button of draftButtons) button.classList.toggle("on", button.dataset["draft"] === draft);
  try {
    localStorage.setItem(DRAFT_KEY, draft);
  } catch {
    // Not remembered, then: the switch still works for this window.
  }
}
for (const button of draftButtons) button.addEventListener("click", () => showDraft(button.dataset["draft"] ?? "1"));
showDraft(
  (() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "1";
    } catch {
      return "1";
    }
  })(),
);

/* ── Dropping files ────────────────────────────────────────────────────────────────────────────────────────── */

/** Whether a drop may open something now: the same moments the two buttons above are enabled. */
const mayOpen = () => !preparing;
const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
/** dragenter and dragleave fire for every element the pointer crosses, so only their balance says it has left. */
let dragDepth = 0;

window.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  view.dropOverlay.hidden = !mayOpen();
});

window.addEventListener("dragover", (event) => {
  if (!carriesFiles(event)) return;
  // Without this the drop below never fires and Chromium opens the file itself, in place of SmartTrim.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = mayOpen() ? "copy" : "none";
});

window.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) view.dropOverlay.hidden = true;
});

window.addEventListener("drop", async (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  view.dropOverlay.hidden = true;
  const files = [...(event.dataTransfer?.files ?? [])];
  if (files.length === 0 || !mayOpen()) return;
  const paths = files.map((file) => window.smarttrim.pathOf(file)).filter((path) => path !== "");
  if (paths.length === 0) {
    openNotes = [{ tone: "refused", name: "", text: "Das lässt sich nicht öffnen: Es ist keine Datei auf diesem Rechner." }];
    draw();
    return;
  }
  await openAndShow(() => window.smarttrim.openFiles(paths));
});

// A drag over the window delivers no pointer events, so one arriving means no drag is going on. Should a leave ever be
// missed (the DevTools protocol's cancel sends none), the overlay goes as soon as the pointer moves again.
window.addEventListener("pointermove", () => {
  if (view.dropOverlay.hidden) return;
  dragDepth = 0;
  view.dropOverlay.hidden = true;
});

/* ── Cutting ───────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Cuts one Tab on its settings as they stand. The answer, or null when the Tab was closed meanwhile; a refusal is
 * already in the Tab's status line.
 */
async function cutTab(tab: OpenTab): Promise<Answer<CutSummary> | null> {
  tab.working = true;
  tab.skippedBy = null;
  // A sound skipping by the cut about to be replaced would go on skipping by it. Only the Tab on screen has one.
  if (viewed() === tab) stopPlaying();
  // A replan still waiting would reach the main process after the cut is taken away and come back refused; one on its
  // way is let arrive first, so its numbers do not land on top of the new cut.
  clearTimeout(tab.redoTimer);
  draw();
  if (tab.redoing) await tab.redoing;
  clearTimeout(tab.redoTimer);
  if (!isOpen(tab)) {
    tab.working = false;
    return null;
  }
  tab.finished = null;
  // The waveforms are kept: they belong to this Recording, and this analysis reuses what was read to draw them
  // (ADR-0020). They simply lose their colours until the new plan arrives.
  setStatus(tab, "Liest die Aufnahme …");
  draw();
  const answer = await window.smarttrim.cut(tab.id, analysisRequestFrom(tab.session));
  tab.working = false;
  if (!isOpen(tab)) return null;
  const summary = show(tab, answer, "Der Schnitt ging nicht");
  if (summary) {
    tab.finished = summary;
    // From here on, moving Luft or Pause only replans (ADR-0004).
    tab.session = cutFinished(tab.session);
    clearStatus(tab);
  }
  draw();
  if (summary) await loadWaveforms(tab);
  return answer;
}

view.cut.addEventListener("click", async () => {
  const tab = viewed();
  if (!tab || tab.working || cuttingAll || savingAll) return;
  await cutTab(tab);
});

/* ── All Tabs at once ──────────────────────────────────────────────────────────────────────────────────────── */

/** Why "Alle schneiden" or "Alle Premiere-Dateien speichern" passed a Tab over, in the user's words. */
const SKIPPED_BECAUSE = {
  skipNoVoice: "Übersprungen: Keine Tonspur steht auf „danach schneiden“.",
  skipNotCut: "Übersprungen: Noch nicht nach den jetzigen Einstellungen geschnitten.",
  skipNoExport: "Übersprungen: Keine Tonspur ist für Premiere angekreuzt.",
} as const;

/** "Alle schneiden: 8 geschnitten, 2 übersprungen" — each count with its words, the ones at nought left out. */
function allTabsHeading(action: string, counts: readonly (readonly [number, string])[]): string {
  const said = counts.filter(([count]) => count > 0).map(([count, words]) => `${count} ${words}`);
  return `${action}: ${said.length > 0 ? said.join(", ") : "nichts zu tun"}`;
}

/**
 * Puts up what an action on all Tabs had to say, under its heading. What something else put up while it ran — files
 * opened meanwhile — stays beneath instead of being replaced.
 */
function showAllTabsNotes(notes: readonly OpenNote[], heading: string, upBefore: OpenNote[]): void {
  openNotes = [...notes, ...(openNotes !== upBefore ? openNotes : [])];
  notesHeading = { notes: openNotes, text: heading };
}

/**
 * Whether the reason a Tab was last passed over still holds. It follows the rules that passed it over, so a role given
 * or a tick set counts at once.
 */
function stillPassedOver(tab: OpenTab): boolean {
  const hasCut = tab.finished !== null;
  if (tab.skippedBy === "cutAll") return cuttingAllDoes(tab.session, hasCut) === "skipNoVoice";
  if (tab.skippedBy === "saveAll") return savingAllDoes(tab.session, hasCut) !== "save";
  return false;
}

/** Takes the mark, and the status line saying why, off every Tab whose reason for being passed over is gone. */
function forgetSettledPassOvers(): void {
  for (const tab of tabs) {
    if (!tab.skippedBy || stillPassedOver(tab)) continue;
    tab.skippedBy = null;
    if (!tab.status.bad && tab.status.text.startsWith("Übersprungen")) {
      tab.status.text = "";
    }
  }
}

/**
 * Lets a replan waiting for this Tab run now, or one on its way arrive, so the Tab is judged on the cut it is about to
 * have — not passed over as not cut while it is only planning again, nor cut underneath a replan.
 */
async function settleRedo(tab: OpenTab): Promise<void> {
  clearTimeout(tab.redoTimer);
  tab.redoTimer = undefined;
  await redoNow(tab);
}

/**
 * "Alle schneiden": every Tab in the order of the strip, one after another, each on its own settings as they stand at
 * its turn. It only cuts, so each Tab's waveforms show its own cut; nothing is written (ADR-0026). A Tab that cannot be
 * cut is passed over and marked; one that fails does not stop the others.
 */
async function cutAllTabs(): Promise<void> {
  if (preparing || allTabsBusy()) return;
  const notesBefore = openNotes;
  const queue = [...tabs];
  cuttingAll = { done: 0, total: queue.length };
  let cutCount = 0;
  let alreadyCurrent = 0;
  const passedOver: OpenNote[] = [];
  const failed: OpenNote[] = [];
  draw();

  for (const tab of queue) {
    // A Tab closed while the ones before it were cut has nothing left to cut.
    if (isOpen(tab)) await settleRedo(tab);
    if (isOpen(tab)) {
      const name = fileName(tab.session.recording?.path ?? "");
      const step = cuttingAllDoes(tab.session, tab.finished !== null);
      tab.skippedBy = step === "skipNoVoice" ? "cutAll" : null;
      if (step === "skipNoVoice") {
        setStatus(tab, SKIPPED_BECAUSE[step]);
        passedOver.push({ tone: "info", name, text: SKIPPED_BECAUSE[step] });
      } else if (step === "nothing") {
        // Its cut already matches its settings: nothing was done, and the heading does not claim otherwise.
        alreadyCurrent += 1;
      } else {
        const cut = await cutTab(tab);
        if (cut?.ok) cutCount += 1;
        else if (cut) failed.push({ tone: "refused", name, text: "Der Schnitt ging nicht.", detail: `Grund: ${cut.message}` });
      }
    }
    cuttingAll = { done: cuttingAll.done + 1, total: queue.length };
    draw();
  }

  cuttingAll = null;
  showAllTabsNotes(
    [
      ...(cutCount + alreadyCurrent > 0
        ? [{ tone: "info", name: "", text: "Gespeichert ist noch nichts: dafür „Alle Premiere-Dateien speichern“ ganz unten." } as const]
        : []),
      ...failed,
      ...passedOver,
    ],
    allTabsHeading("Alle schneiden", [
      [cutCount, "geschnitten"],
      [alreadyCurrent, alreadyCurrent === 1 ? "war schon geschnitten" : "waren schon geschnitten"],
      [passedOver.length, "übersprungen"],
      [failed.length, failed.length === 1 ? "ging nicht" : "gingen nicht"],
    ]),
    notesBefore,
  );
  draw();
  void pump();
}

view.cutAll.addEventListener("click", () => void cutAllTabs());

/**
 * "Alle Premiere-Dateien speichern": every Tab whose cut matches its settings writes its Premiere file beside its
 * Recording, without a dialog and never over a file already there (ADR-0026). It never cuts; a Tab without a current
 * cut, or with nothing ticked for Premiere, is passed over and marked.
 */
async function saveAllTabs(): Promise<void> {
  if (preparing || allTabsBusy()) return;
  const notesBefore = openNotes;
  const queue = [...tabs];
  savingAll = { done: 0, total: queue.length };
  const saved: OpenNote[] = [];
  const passedOver: OpenNote[] = [];
  const failed: OpenNote[] = [];
  draw();

  for (const tab of queue) {
    // A replan still on its way for this Tab arrives first: it is planning, not uncut.
    if (isOpen(tab)) await settleRedo(tab);
    if (isOpen(tab)) {
      const name = fileName(tab.session.recording?.path ?? "");
      // Taken at its turn: the Tabs stay usable while the files before it are written.
      const step = savingAllDoes(tab.session, tab.finished !== null);
      tab.skippedBy = step === "save" ? null : "saveAll";
      if (step !== "save") {
        setStatus(tab, SKIPPED_BECAUSE[step]);
        passedOver.push({ tone: "info", name, text: SKIPPED_BECAUSE[step] });
      } else {
        const answer = await window.smarttrim.savePremiereBeside(tab.id, tab.session.exportSourceTracks);
        if (answer.ok) {
          // Written is written, whether or not the Tab was closed while it was: the file is there and is counted.
          if (isOpen(tab)) setStatus(tab, `Gespeichert: ${answer.value}`);
          saved.push({ tone: "info", name: fileName(answer.value), text: "Gespeichert.", detail: `Ordner: ${folderOf(answer.value)}` });
        } else if (isOpen(tab)) {
          say(tab, `Speichern ging nicht: ${answer.message}`);
          failed.push({ tone: "refused", name, text: "Nicht gespeichert.", detail: `Grund: ${answer.message}` });
        }
        // A refusal for a Tab closed meanwhile wrote nothing, and closing it was the user's call: nothing to report.
      }
    }
    savingAll = { done: savingAll.done + 1, total: queue.length };
    draw();
  }

  savingAll = null;
  showAllTabsNotes(
    [...failed, ...passedOver, ...saved],
    allTabsHeading("Alle Premiere-Dateien speichern", [
      [saved.length, "gespeichert"],
      [passedOver.length, "übersprungen"],
      [failed.length, failed.length === 1 ? "ging nicht" : "gingen nicht"],
    ]),
    notesBefore,
  );
  draw();
}

view.saveAll.addEventListener("click", () => void saveAllTabs());

/** The question before "Für alle übernehmen": whether every Recording has the same SourceTracks. */
function drawTakeOverQuestion(): void {
  const from = viewed();
  view.takeOverAsking.hidden = !takeOverAsking || !from;
  if (!takeOverAsking || !from) return;
  const others = tabs.length - 1;
  view.takeOverQuestion.textContent =
    `Die Regler von „${fileName(from.session.recording?.path ?? "")}“ gehen an ` +
    `${others === 1 ? "den anderen Tab" : `die ${others} anderen Tabs`}. ` +
    "Nur wenn die Tonspuren überall gleich belegt sind, sollen auch die Tonspur-Rollen und die Premiere-Häkchen mit. " +
    "Aufnahmen mit einer anderen Zahl an Tonspuren bekommen so oder so nur die Regler. Festgehaltene Stellen bleiben, wo sie sind.";
}

function closeTakeOver(): void {
  takeOverAsking = false;
  draw();
  view.takeOver.focus();
}

/** Takes the settings of the Tab on screen over into every other Tab (ADR-0026). */
function takeOverInto(what: TakenOver): void {
  const from = viewed();
  takeOverAsking = false;
  if (!from || allTabsBusy()) {
    draw();
    return;
  }
  const others = tabs.filter((tab) => tab !== from);
  const leftOut: OpenNote[] = [];
  for (const tab of others) {
    const { session, rolesLeftOut } = settingsCopied(from.session, tab.session, what);
    // Roles taken over ask for their SourceTracks' waveforms, so a Tab whose read was refused tries again (ADR-0025).
    if (what === "slidersAndRoles" && !rolesLeftOut) Object.assign(tab, roleGiven(tab, session));
    else tab.session = session;
    // A finished cut in that Tab is planned again, decided again, or stops being offered — as if moved by hand.
    afterSettingChange(tab);
    if (rolesLeftOut) {
      const sourceTracks = (count: number) => (count === 1 ? "eine Tonspur" : `${count} Tonspuren`);
      leftOut.push({
        tone: "info",
        name: fileName(tab.session.recording?.path ?? ""),
        text:
          `Nur die Regler übernommen: Diese Aufnahme hat ${sourceTracks(session.recording?.sourceTracks.length ?? 0)}, ` +
          `„${fileName(from.session.recording?.path ?? "")}“ hat ${sourceTracks(from.session.recording?.sourceTracks.length ?? 0)}.`,
      });
    }
  }
  const taken = what === "slidersAndRoles" ? "Regler und Tonspur-Rollen" : "Regler";
  openNotes = [
    {
      tone: "info",
      name: "",
      text: `${taken} von „${fileName(from.session.recording?.path ?? "")}“ in ${others.length === 1 ? "den anderen Tab" : `${others.length} Tabs`} übernommen. Festgehaltene Stellen sind geblieben.`,
    },
    ...leftOut,
  ];
  draw();
  void pump();
}

view.takeOver.addEventListener("click", () => {
  if (!viewed() || tabs.length < 2) return;
  takeOverAsking = true;
  draw();
  // Enter cancels: taking over overwrites the sliders of every other Tab.
  view.cancelTakeOver.focus();
});
view.takeOverRoles.addEventListener("click", () => takeOverInto("slidersAndRoles"));
view.takeOverSliders.addEventListener("click", () => takeOverInto("sliders"));
view.cancelTakeOver.addEventListener("click", closeTakeOver);
view.takeOverAsking.addEventListener("click", (event) => {
  if (event.target === view.takeOverAsking) closeTakeOver();
});

draw();

window.smarttrim.onReadProgress(({ tabId, done, total }) => {
  const tab = tabById(tabId);
  // Progress from a read the window no longer waits for — its Tab closed — has nowhere to go.
  if (!tab || job?.tabId !== tabId) return;
  tab.readingCount = { done, total };
  drawReading(tab);
});

// A first run has to fetch ffmpeg (172 MB) and the Silero model before anything can be read. Later runs find them
// and this is over before the window has finished drawing.
window.smarttrim.onToolsProgress(({ name, percent }) => {
  setStatus(null, `Lädt ${name} … ${percent} % (nur beim ersten Start)`);
});
// The user's own Presets are read once at startup; without them the dropdown shows only the built-in three.
void (async () => {
  const saved = show(null, await window.smarttrim.loadPresets(), "Die eigenen Voreinstellungen ließen sich nicht lesen");
  if (saved) ownPresets = saved;
  draw();
})();

void (async () => {
  const ready = show(null, await window.smarttrim.ensureTools(), "Die Werkzeuge fehlen");
  preparing = false;
  if (ready !== undefined) clearStatus(null);
  draw();
  void pump();
})();
