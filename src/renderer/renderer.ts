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
  canExport,
  cutFinished,
  planFinished,
  planSettingsFrom,
  presetChoice,
  sourceTracksToRead,
  audioBackInMemory,
  projectOpened,
  redoNeeded,
  roleOf,
  savedChoicesFrom,
  chooseRecording,
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
import { bandsIn, keptShareByColumn, type CutBand } from "../waveform/cutShape.ts";
import { CLOSEST_WINDOW_SECONDS, pannedBy, zoomedTo, type ZoomWindow } from "../waveform/zoomWindow.ts";
import type { CutSummary, SourceTrackWaveform } from "../app/runCut.ts";
import { LONGEST_EXCERPT_SECONDS, playbackOf, recordingSecondsAt, type Playback } from "../playback/playback.ts";
import type { Answer, SmartTrimApi } from "../preload/api.ts";

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
  recordingInfo: element("recordingInfo"),
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
  cutPicture: element("cutPicture"),
  overview: element<HTMLCanvasElement>("overview"),
  zoom: element<HTMLInputElement>("zoom"),
  zoomValue: element("zoomValue"),
  skipRow: element("skipRow"),
  skipRemoved: element<HTMLInputElement>("skipRemoved"),
  status: element("status"),
  result: element("result"),
};

let session: CutSession = newCutSession();
/** The Presets the user saved themselves, as the main process last reported them. */
let ownPresets: readonly Preset[] = [];
/** True while the name field is open, so the dropdown does not fight the user for the same row. */
let naming = false;
/**
 * A question waiting for the user, asked as a row in the window. Electron's own `confirm()` is a Windows popup,
 * and closing one leaves the window without focus until the user clicks away and back (ADR-0018).
 */
let asking: { question: string; yes: () => void } | null = null;
/** True while the analysis runs, so nothing can be started twice or changed underneath it. */
let working = false;
/** True until ffmpeg and the model are there: on a first run they have to be downloaded first. */
let preparing = true;
/** The waveform of every SourceTrack the last analysis read. Empty until one has run. */
let waveforms: SourceTrackWaveform[] = [];
/** The stretch of the Recording the zoomed waveforms are showing. */
let zoom: ZoomWindow = { fromSeconds: 0, toSeconds: 1 };
/** The finished cut on screen, or null once a setting made it stale. */
let finished: CutSummary | null = null;

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

/** Says what went wrong instead of leaving the window silent, and never calls a refusal a success. */
function show<Value>(answer: Answer<Value>, ifRefused: string): Value | undefined {
  if (answer.ok) return answer.value;
  view.status.textContent = `${ifRefused}: ${answer.message}`;
  view.status.classList.add("bad");
  return undefined;
}

function clearStatus(): void {
  view.status.textContent = "";
  view.status.classList.remove("bad");
}

/** Puts a refusal the window worked out itself where the refusals from the main process go. */
function say(message: string): void {
  view.status.textContent = message;
  view.status.classList.add("bad");
}

/**
 * How long the Recording is, in seconds. Taken from the Recording itself rather than from the cut, because the
 * waveform is drawn as soon as a SourceTrack gets a role — long before there is a cut (ADR-0020).
 */
function recordingSeconds(): number | null {
  const { recording } = session;
  if (!recording) return null;
  return (recording.durationFrames * recording.frameRate.denominator) / recording.frameRate.numerator;
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

function drawRecording(): void {
  const { recording } = session;
  if (!recording) {
    view.recordingInfo.textContent = "Noch keine Aufnahme gewählt.";
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

function drawSourceTracks(): void {
  view.sourceTracks.replaceChildren();
  const { recording } = session;
  if (!recording) {
    view.sourceTracksHint.textContent = "Wähle zuerst eine Aufnahme.";
    return;
  }
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
      tick.disabled = working;
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
    role.disabled = working;
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
      // An ignored SourceTrack loses its row's waveform and with it the only button that could stop its sound.
      if (role.value === "ignored" && playing?.position === index) stopPlaying();
      session = setSourceTrackRole(session, index, role.value as TrackRole);
      afterSettingChange();
      draw();
      // A SourceTrack that just got a role shows its waveform straight away, before anything is cut (ADR-0020).
      void readWaveforms();
    });

    row.append(
      role,
      // Changing this changes the file, not the cut, so a finished cut stays on screen.
      box(session.exportSourceTracks.includes(index), `Tonspur ${index + 1} nach Premiere übernehmen`, () => {
        session = toggleExportSourceTrack(session, index);
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
    const waveform = roleOf(session, index) === "ignored" ? undefined : waveforms.find((each) => each.position === index);
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
      : `Tonspur ${index + 1} ab dem weißen Strich anhören (höchstens 3 Minuten)`;
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
  reveal.disabled = working;
  reveal.addEventListener("click", () => {
    session = revealEmptySourceTracks(session, !session.emptySourceTracksShown);
    draw();
  });
  view.sourceTracksHint.append(document.createElement("br"), reveal);
}

/** The Preset dropdown. "eigene" is what the sliders are once one of them has been moved off a Preset. */
const OWN_SETTINGS = "eigene";

function drawSettings(): void {
  const choice = presetChoice(session, ownPresets);
  const chosenIsOwn = choice !== null && ownPresets.some((preset) => preset.name === choice.name);
  const busy = working || naming || asking !== null;

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

function drawResult(): void {
  view.result.replaceChildren();
  view.result.hidden = finished === null;
  if (!finished) return;
  const cut = finished;

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
  save.disabled = !canExport(session);
  save.addEventListener("click", async () => {
    save.disabled = true;
    clearStatus();
    const saved = show(await window.smarttrim.save(session.exportSourceTracks), "Speichern ging nicht");
    save.disabled = false;
    // undefined is a refusal, already on screen; null means the user closed the dialog.
    if (saved === undefined || saved === null) return;
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
  saveProject.textContent = "Projekt speichern …";
  // While a redo is still pending the numbers on screen and the plan behind them are one step apart.
  saveProject.disabled = redoNeeded(session) !== "nothing";
  saveProject.addEventListener("click", async () => {
    saveProject.disabled = true;
    clearStatus();
    const saved = show(await window.smarttrim.saveProject(savedChoicesFrom(session)), "Speichern ging nicht");
    saveProject.disabled = redoNeeded(session) !== "nothing";
    if (saved === undefined || saved === null) return;
    view.status.textContent = `Projekt gespeichert: ${saved}`;
  });

  buttons.append(save, saveProject);
  view.result.append(sentence, numbers, buttons);
}

function draw(): void {
  drawRecording();
  drawSourceTracks();
  drawSettings();
  drawResult();
  // The colours over the waveform come from the plan, so every redraw of the numbers redraws them too.
  drawWaveforms();
  view.chooseRecording.disabled = working || preparing;
  view.openProject.disabled = working || preparing;
  view.threshold.disabled = working;
  view.margin.disabled = working;
  view.deadZone.disabled = working;
  view.eventLead.disabled = working;
  view.eventTail.disabled = working;
  view.cut.disabled = working || preparing || !canCut(session);
  view.cut.textContent = working ? "Arbeitet …" : "Schneiden";
}

/** Waiting for the sliders to come to rest, so one drag is one job and not fifty. */
let redoTimer: ReturnType<typeof setTimeout> | undefined;
let redoing = false;

/**
 * What a changed setting costs. Luft and Pause are planned again from what the analysis already found, which takes
 * milliseconds and no reading; the threshold and the SourceTracks decide what is found at all, so the cut on screen
 * stops being offered until it is made again (ADR-0004).
 */
function afterSettingChange(): void {
  if (!finished) return;
  const redo = redoNeeded(session);
  if (redo === "nothing") return;
  if (redo === "analyse") {
    finished = null;
    view.status.textContent = "Einstellung geändert – noch einmal schneiden.";
    view.status.classList.remove("bad");
    return;
  }
  scheduleRedo(redo);
}

function scheduleRedo(redo: "replan" | "redecide"): void {
  view.status.textContent = redo === "replan" ? "Plant neu …" : "Rechnet neu …";
  view.status.classList.remove("bad");
  clearTimeout(redoTimer);
  redoTimer = setTimeout(() => void redoNow(), 120);
}

/** The settings a redo was asked for, so numbers from a slider position the user has left behind are not called current. */
const settingsNow = () => ({ thresholdDbfs: session.thresholdDbfs, ...planSettingsFrom(session) });

async function redoNow(): Promise<void> {
  const redo = redoNeeded(session);
  if (redoing || (redo !== "replan" && redo !== "redecide")) return;
  redoing = true;
  const used = settingsNow();
  const answer =
    redo === "replan" ? await window.smarttrim.replan(used) : await window.smarttrim.redecide(used);
  const summary = show(answer, redo === "replan" ? "Das Neuplanen ging nicht" : "Das Neurechnen ging nicht");
  redoing = false;
  if (summary) {
    finished = summary;
    const now = settingsNow();
    // The sliders may have moved on while this ran; then these numbers are already one step behind.
    if (
      now.thresholdDbfs === used.thresholdDbfs &&
      now.marginSeconds === used.marginSeconds &&
      now.minimumDeadZoneSeconds === used.minimumDeadZoneSeconds
    ) {
      session = planFinished(session);
      clearStatus();
    }
  }
  draw();
  const next = redoNeeded(session);
  if (next === "replan" || next === "redecide") scheduleRedo(next);
}

function slider(
  input: HTMLInputElement,
  range: { min: number; max: number; step: number },
  change: (value: number) => void,
): void {
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.addEventListener("input", () => {
    change(Number(input.value));
    afterSettingChange();
    draw();
  });
}

slider(view.threshold, THRESHOLD_DBFS, (value) => (session = setThresholdDbfs(session, value)));
slider(view.margin, MARGIN_SECONDS, (value) => (session = setMarginSeconds(session, value)));
slider(view.deadZone, MINIMUM_DEAD_ZONE_SECONDS, (value) => (session = setMinimumDeadZoneSeconds(session, value)));
slider(view.eventLead, EVENT_LEAD_SECONDS, (value) => (session = setEventLeadSeconds(session, value)));
slider(view.eventTail, EVENT_TAIL_SECONDS, (value) => (session = setEventTailSeconds(session, value)));

view.preset.addEventListener("change", () => {
  const preset = allPresets(ownPresets).find((each) => each.name === view.preset.value);
  // "eigene" is not something to pick: it only describes sliders that belong to no Preset.
  if (!preset) return;
  session = applyPreset(session, preset);
  afterSettingChange();
  draw();
});


/* ── The waveforms ─────────────────────────────────────────────────────────────────────────────────────────── */

/** Kept stretches are green, removed ones a dark red that is also plainly darker, so the two differ without hue. */
const KEPT_BAND = "#1f3a2e";
const REMOVED_BAND = "#2a1416";
const KEPT_WAVE = "#7fd6b4";
/** Before anything is cut there is nothing to colour, so the waveform is drawn plain (ADR-0020). */
const PLAIN_BAND = "#1c1f25";
const PLAIN_WAVE = "#8b96a3";
const REMOVED_WAVE = "#7a4046";
/** Over a stretch the playing sound jumps across, so a Join is seen as it is heard. Neither green nor red. */
const JOIN_MARK = "#e8b04a";
const PLAYHEAD = "#e8eaed";

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

/** The strip over the whole Recording: brightness is how much of that column survives, plus the zoom window. */
/**
 * The loudest thing any shown SourceTrack does in each column of the strip. The strip spans the whole Recording,
 * so one column is minutes wide; taking the loudest across the SourceTracks answers "is there any sound here at
 * all", which is what the strip is for.
 */
/**
 * The last answer of `overviewPeaks`. It depends only on which waveforms are shown and how wide the strip is —
 * neither changes when a slider moves — so without this it rescanned 1.08 million peaks on every redraw.
 */
let overviewPeaksCache: { key: string; peaks: number[] } | null = null;

function overviewPeaks(columns: number, recordingSeconds: number): number[] {
  const shown = shownWaveforms();
  const key = `${columns}|${shown.map((waveform) => waveform.position).join(",")}`;
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

function drawOverview(): void {
  const seconds = recordingSeconds();
  if (!seconds) return;
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
  const peaks = overviewPeaks(width, seconds);
  const middle = height / 2;
  for (let column = 0; column < width; column += 1) {
    const loudest = peaks[column] as number;
    if (loudest <= 0) continue;
    const half = Math.max(loudest * (middle - 1.5), 0.5);
    paint.fillStyle = !finished ? PLAIN_WAVE : (share[column] as number) > 0.5 ? KEPT_WAVE : REMOVED_WAVE;
    paint.fillRect(column, middle - half, 1, half * 2);
  }

  // Where the zoom below is looking.
  const left = (zoom.fromSeconds / seconds) * width;
  const right = (zoom.toSeconds / seconds) * width;
  paint.strokeStyle = "#e8eaed";
  paint.lineWidth = 1.5;
  paint.strokeRect(left + 0.75, 0.75, Math.max(right - left - 1.5, 1), height - 1.5);
}

/** One SourceTrack's waveform across the zoom window, with the cut painted behind it. */
function drawWaveform(canvas: HTMLCanvasElement, waveform: SourceTrackWaveform): void {
  const seconds = recordingSeconds();
  if (!seconds) return;
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

  // The Playhead. While this SourceTrack plays: a bar over every stretch the sound jumps across, and the line at the
  // moment being heard, read off the clock the sound itself runs on (ADR-0022). While nothing plays: the line on
  // every waveform, where listening starts next. While another SourceTrack plays, this one shows none.
  const now = playing;
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
    lineAt = cursorSeconds;
  }
  if (lineAt === null) return;
  const x = xOf(lineAt);
  if (x >= 0 && x <= width) {
    paint.fillStyle = PLAYHEAD;
    paint.fillRect(x - 1, 0, 2, height);
  }
}

/** Rebuilds one row per SourceTrack the analysis read, and draws them all. */
/**
 * The canvas of one SourceTrack's waveform, made once and kept. The SourceTrack rows are rebuilt on every draw, so
 * a canvas made fresh each time would be cleared constantly and would drop the pointer in the middle of a drag.
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
function shownWaveforms(): SourceTrackWaveform[] {
  return waveforms.filter((waveform) => roleOf(session, waveform.position) !== "ignored");
}

function drawWaveforms(): void {
  const seconds = recordingSeconds();
  // No SourceTrack with a role means nothing to picture — an empty strip would sit there claiming to show a cut.
  view.cutPicture.hidden = shownWaveforms().length === 0 || !seconds;
  if (view.cutPicture.hidden) return;

  view.zoom.min = "0";
  view.zoom.max = "1000";
  view.zoom.step = "1";
  // The slider runs from the whole Recording at the left to the closest zoom at the right, and the ends are far
  // apart, so it moves in steps of a fixed ratio rather than of a fixed number of seconds.
  const widest = seconds as number;
  const closest = Math.min(CLOSEST_WINDOW_SECONDS, widest);
  const span = zoom.toSeconds - zoom.fromSeconds;
  view.zoom.value = String(Math.round((Math.log(widest / span) / Math.log(widest / closest)) * 1000));
  view.zoomValue.textContent = duration(span);
  // Before a cut there is nothing removed to skip, so the switch would promise something it cannot do.
  view.skipRow.hidden = finished === null;

  for (const waveform of waveforms) {
    const canvas = waveformCanvases.get(waveform.position);
    // A canvas the row has not put on screen yet has no width to draw into.
    if (canvas?.isConnected) drawWaveform(canvas, waveform);
  }
  drawOverview();
}

/** Moves the zoom window and redraws, without touching anything else on screen. */
function showWindow(next: ZoomWindow): void {
  zoom = next;
  drawWaveforms();
}

/** True while a SourceTrack is being read, so two role changes in a row do not start two reads at once. */
let reading = false;
/** The SourceTracks being read ahead of anyone asking for them. Belongs to the Recording that is open now. */
let readAhead: readonly number[] = [];
/** How far that read has got, for the line the window shows while it runs. */
let readingCount = { done: 0, total: 0 };

/** Says how far reading the SourceTracks has got, without taking the status line away from a refusal. */
function drawReading(): void {
  if (!reading || view.status.classList.contains("bad")) return;
  const { done, total } = readingCount;
  view.status.textContent =
    total === 1
      ? "Liest den Ton der Tonspur …"
      : `Liest den Ton der Tonspuren … ${done} von ${total} fertig`;
}

/**
 * Reads whatever SourceTrack has a role and no waveform yet, and draws it (ADR-0020). This is the same read the
 * cut needs, only earlier: what it brings in is kept in the main process and the cut reuses it.
 */
async function readWaveforms(ahead: readonly number[] = []): Promise<void> {
  // Positions belong to one Recording. Read ahead for a Recording that is no longer open would ask for the old
  // one's SourceTracks against the new one's file, so the list is replaced rather than added to.
  if (ahead.length > 0) readAhead = ahead;
  const seconds = recordingSeconds();
  if (reading || !seconds) return;
  const have = waveforms.map((waveform) => waveform.position);
  const missing = [...new Set([...sourceTracksToRead(session, have), ...readAhead.filter((one) => !have.includes(one))])];
  if (missing.length === 0) return;

  reading = true;
  readingCount = { done: 0, total: missing.length };
  drawReading();
  const drawn = show(await window.smarttrim.readSourceTracks(missing), "Die Tonspur ließ sich nicht lesen");
  reading = false;
  if (!drawn) {
    // A refusal leaves `missing` exactly as it was, so trying again would ask for the same thing for ever — one
    // ffmpeg on a 23 GB file per turn. The user retries by giving a role again or choosing the Recording again.
    readAhead = [];
    draw();
    return;
  }
  {
    // Everything read is kept, whether or not its role survived the read: that is what makes putting a role back
    // instant. Which of them is drawn is decided by the role, in `drawSourceTracks`.
    waveforms = [...waveforms, ...drawn].filter(
      (waveform, at, all) => all.findIndex((each) => each.position === waveform.position) === at,
    );
    if (zoom.toSeconds <= 1) zoom = { fromSeconds: 0, toSeconds: seconds };
    // Only the reading line is cleared. A warning such as "noch einmal schneiden" belongs to the settings, not to
    // this read, and wiping it would leave stale numbers on screen with nothing saying so.
    if (view.status.textContent?.startsWith("Liest den Ton")) clearStatus();
  }
  draw();
  // A role changed, or another Recording was chosen, while this was running: both leave more to read.
  await readWaveforms();
}

/**
 * Fetches the waveforms of the analysis that just finished and starts the zoom showing the whole Recording. The
 * shape of the sound does not change with a slider, so this is asked for once per analysis (ADR-0019).
 */
async function loadWaveforms(recordingSeconds: number): Promise<void> {
  const drawn = show(await window.smarttrim.waveforms(), "Die Wellenform ließ sich nicht zeichnen");
  if (!drawn) return;
  // Merged, not replaced: the analysis only decoded the SourceTracks with a role, while the read-ahead brought in
  // every one that carries sound. Replacing would throw those away and make switching roles slow again (ADR-0020).
  waveforms = [...drawn, ...waveforms].filter(
    (waveform, at, all) => all.findIndex((each) => each.position === waveform.position) === at,
  );
  // The zoom is only set up when there was nothing to look at yet. Since the waveform now exists before the cut
  // (ADR-0020), a user who zoomed to a suspect spot and pressed Schneiden must stay there.
  if (zoom.toSeconds <= 1) zoom = { fromSeconds: 0, toSeconds: recordingSeconds };
  // A full redraw, not just the picture: the SourceTrack rows are what put each waveform's canvas on screen, and
  // they were built while there was still nothing to draw.
  draw();
}

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

/** Takes the Presets the main process reports back, and puts the saved one on the dropdown. */
function presetsSaved(saved: readonly Preset[], chosen: Preset): void {
  ownPresets = saved;
  // The sliders already carry these values, so this only marks which Preset they now belong to.
  session = applyPreset(session, chosen);
  closePresetRow();
}

view.newPreset.addEventListener("click", () => {
  clearStatus();
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
  clearStatus();
  const name = view.presetName.value.trim();
  let preset: Preset;
  try {
    // Refuses a built-in name or a blank one here, before the main process is asked to write anything.
    preset = presetFromSliders(session, name);
  } catch (reason) {
    say((reason as Error).message);
    return;
  }

  const write = async () => {
    const saved = show(await window.smarttrim.savePreset(preset), "Die Voreinstellung ließ sich nicht speichern");
    if (saved) presetsSaved(saved, preset);
  };
  if (ownPresets.some((each) => each.name === name)) {
    naming = false;
    ask(`\u201E${name}\u201C gibt es schon. \u00DCberschreiben?`, () => void write());
    return;
  }
  void write();
});

// Writing the sliders back into the Preset they were changed from. No question first: the button only exists while
// there is something to write back, and pressing it says plainly enough what is meant.
view.savePreset.addEventListener("click", async () => {
  clearStatus();
  const choice = presetChoice(session, ownPresets);
  if (!choice) return;
  const preset = presetFromSliders(session, choice.name);
  const saved = show(await window.smarttrim.savePreset(preset), "Die Voreinstellung ließ sich nicht speichern");
  if (saved) presetsSaved(saved, preset);
});

view.deletePreset.addEventListener("click", () => {
  clearStatus();
  const choice = presetChoice(session, ownPresets);
  if (!choice) return;
  ask(`\u201E${choice.name}\u201C l\u00F6schen?`, async () => {
    const left = show(await window.smarttrim.deletePreset(choice.name), "Die Voreinstellung ließ sich nicht l\u00F6schen");
    if (!left) return;
    ownPresets = left;
    // The sliders keep their values; only the name they belonged to is gone.
    session = { ...session, selectedPreset: null };
    draw();
  });
});


/* ── Zooming, dragging and the strip ───────────────────────────────────────────────────────────────────────── */

view.zoom.addEventListener("input", () => {
  const seconds = recordingSeconds();
  if (!seconds) return;
  const closest = Math.min(CLOSEST_WINDOW_SECONDS, seconds);
  // The slider is a ratio, not a number of seconds: 0 is the whole Recording, 1000 is the closest zoom.
  const along = Number(view.zoom.value) / 1000;
  showWindow(zoomedTo(zoom, seconds, seconds * (closest / seconds) ** along));
});

/* ── Playback ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * The SourceTrack that is playing, if any — one at a time (ADR-0022). `startedAt` is the audio clock's time of the
 * first sample, so the playhead is read off the clock the sound runs on rather than off a timer that drifts from it.
 */
let playing: {
  position: number;
  playback: Playback;
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

/** The SourceTrack whose Excerpt is on its way, so its button says so and a second press cancels instead. */
let fetchingFor: number | null = null;
/** Counts presses, so an Excerpt arriving after the user pressed something else is dropped instead of played. */
let playRequest = 0;
let playheadFrame = 0;
/**
 * The Playhead while nothing plays: where listening starts next, shared by every waveform because they all show the
 * same stretch of the Recording. Set by clicking a waveform, left where the sound stopped. Null until either happens.
 */
let cursorSeconds: number | null = null;
/** Where the Playhead was on the frame before, so the view pages along only when the Playhead runs out of it. */
let lastHeard: number | null = null;

/** Stops the sound and forgets an Excerpt still on its way. */
function stopPlaying(): void {
  playRequest += 1;
  fetchingFor = null;
  cancelAnimationFrame(playheadFrame);
  const was = playing;
  playing = null;
  if (!was) return;
  // The Playhead stays where the sound stopped, so the next press goes on from there.
  cursorSeconds = heardIn(was);
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
  const heard = heardIn(now);
  const seconds = recordingSeconds();
  const wasInView = lastHeard !== null && lastHeard >= zoom.fromSeconds && lastHeard <= zoom.toSeconds;
  lastHeard = heard;
  if (seconds && wasInView && heard > zoom.toSeconds) {
    showWindow(pannedBy(zoom, seconds, heard - zoom.fromSeconds));
  } else {
    const waveform = waveforms.find((each) => each.position === now.position);
    const canvas = waveformCanvases.get(now.position);
    if (waveform && canvas?.isConnected) drawWaveform(canvas, waveform);
  }
  playheadFrame = requestAnimationFrame(followPlayhead);
}

/**
 * Puts the Playhead where the user clicked a waveform. While a SourceTrack plays it jumps there and plays on, the
 * way a click on Premiere's timeline does.
 */
function placePlayhead(canvas: HTMLCanvasElement, clientX: number): void {
  const seconds = recordingSeconds();
  if (!seconds) return;
  const box = canvas.getBoundingClientRect();
  const span = zoom.toSeconds - zoom.fromSeconds;
  const clicked = Math.min(Math.max(zoom.fromSeconds + ((clientX - box.left) / box.width) * span, 0), seconds);
  const position = playing?.position;
  // Stopping leaves the Playhead where the sound was, so the click is put back after it.
  stopPlaying();
  cursorSeconds = clicked;
  if (position === undefined) drawWaveforms();
  else void play(position);
}

/**
 * Plays one SourceTrack over what the waveforms show — or the first three minutes of it, zoomed out further than
 * that — skipping what the cut removes when the switch says so. Pressing the row that plays, or waits, stops it.
 */
async function play(position: number): Promise<void> {
  const busyWith = playing?.position ?? fetchingFor;
  stopPlaying();
  const seconds = recordingSeconds();
  if (busyWith === position || !seconds) {
    draw();
    return;
  }

  const request = playRequest;
  // From the Playhead — unless it is not in view, or at the very end: then from the start of what the user sees.
  // Up to three minutes, past the edge of the view if need be; the view pages along (followPlayhead).
  const cursorUsable =
    cursorSeconds !== null &&
    cursorSeconds >= zoom.fromSeconds &&
    cursorSeconds <= zoom.toSeconds &&
    cursorSeconds < seconds - 0.05;
  const fromSeconds = cursorUsable ? (cursorSeconds as number) : zoom.fromSeconds;
  const toSeconds = Math.min(fromSeconds + LONGEST_EXCERPT_SECONDS, seconds);
  lastHeard = null;
  // The cut as it is on screen when the button is pressed; before a cut there is nothing to skip.
  const kept = finished?.keptRanges ?? null;
  const skipping = view.skipRemoved.checked && kept !== null;
  fetchingFor = position;
  clearStatus();
  draw();

  const answer = await window.smarttrim.readExcerpt({ position, fromSeconds, toSeconds });
  // Something else was pressed, or the Recording changed, while the Excerpt was on its way.
  if (request !== playRequest) return;
  fetchingFor = null;
  const excerpt = show(answer, "Der Ton ließ sich nicht abspielen");
  if (!excerpt) {
    draw();
    return;
  }

  let playback: Playback;
  try {
    playback = playbackOf(excerpt, kept ?? [], skipping);
  } catch {
    say("Hier wird alles herausgeschnitten – zum Anhören weiter herauszoomen oder „überspringen“ ausschalten.");
    draw();
    return;
  }

  const context = sharedAudio();
  const frames = playback.samples.length / playback.channelCount;
  const buffer = context.createBuffer(playback.channelCount, frames, playback.sampleRate);
  for (let channel = 0; channel < playback.channelCount; channel += 1) {
    const out = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame += 1) {
      out[frame] = (playback.samples[frame * playback.channelCount + channel] as number) / 32768;
    }
  }
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
  playing = { position, playback, context, source, startedAt };
  draw();
  followPlayhead();
}

// Switching while it plays starts the same SourceTrack again the new way, rather than leaving the old sound running.
view.skipRemoved.addEventListener("change", () => {
  const position = playing?.position;
  if (position === undefined) return;
  stopPlaying();
  void play(position);
});

/**
 * The white frame in the overview strip is dragged, not only clicked. Grabbing inside it keeps the spot you took
 * hold of; grabbing outside it jumps there first and then drags on. Either way the frame follows the pointer while
 * it moves, rather than appearing somewhere else once the button is let go.
 */
view.overview.addEventListener("pointerdown", (event) => {
  const seconds = recordingSeconds();
  if (!seconds) return;
  const box = view.overview.getBoundingClientRect();
  const secondAt = (clientX: number) => ((clientX - box.left) / box.width) * seconds;

  const span = zoom.toSeconds - zoom.fromSeconds;
  const grabbed = secondAt(event.clientX);
  const insideFrame = grabbed >= zoom.fromSeconds && grabbed < zoom.toSeconds;
  // Outside the frame the window centres on the pointer; inside it, the pointer keeps its place within the frame.
  const holdOffset = insideFrame ? grabbed - zoom.fromSeconds : span / 2;
  view.overview.classList.add("dragging");

  const move = (moved: PointerEvent) => {
    showWindow(pannedBy(zoom, seconds, secondAt(moved.clientX) - holdOffset - zoom.fromSeconds));
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

/**
 * Dragging a waveform sideways slides the window; a click that barely moves puts the Playhead there instead; the
 * wheel zooms around where the pointer is.
 */
view.sourceTracks.addEventListener("pointerdown", (event) => {
  const canvas = (event.target as HTMLElement).closest("canvas");
  const seconds = recordingSeconds();
  if (!canvas || !seconds) return;
  const box = canvas.getBoundingClientRect();
  const startX = event.clientX;
  let lastX = event.clientX;
  // How far the pointer got from where it went down. A hand never clicks without moving a pixel or two.
  let travelled = 0;
  canvas.classList.add("dragging");

  const move = (moved: PointerEvent) => {
    travelled = Math.max(travelled, Math.abs(moved.clientX - startX));
    const span = zoom.toSeconds - zoom.fromSeconds;
    // Dragging right pulls the Recording along with the pointer, so the window moves the other way.
    showWindow(pannedBy(zoom, seconds, -((moved.clientX - lastX) / box.width) * span));
    lastX = moved.clientX;
  };
  const stop = (ended: PointerEvent) => {
    canvas.classList.remove("dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    if (ended.type === "pointerup" && travelled < 4) placePlayhead(canvas, ended.clientX);
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
    const seconds = recordingSeconds();
    if (!canvas || !seconds) return;
    event.preventDefault();
    const span = zoom.toSeconds - zoom.fromSeconds;
    showWindow(zoomedTo(zoom, seconds, event.deltaY > 0 ? span * 1.25 : span / 1.25));
  },
  { passive: false },
);

// The canvases are sized in percent, so their pixel width changes with the window and they have to be redrawn.
window.addEventListener("resize", () => drawWaveforms());

view.chooseRecording.addEventListener("click", async () => {
  stopPlaying();
  clearStatus();
  const recording = show(await window.smarttrim.chooseRecording(), "Die Aufnahme ließ sich nicht lesen");
  // undefined is a refusal, null means the user closed the dialog.
  if (!recording) return;
  session = chooseRecording(session, recording);
  finished = null;
  // The waveforms and the read-ahead list belong to the Recording that was open before this one.
  waveforms = [];
  readAhead = [];
  // A moment in the Recording that was open before means nothing in this one.
  cursorSeconds = null;
  zoom = { fromSeconds: 0, toSeconds: 1 };
  draw();

  // The slices take a few seconds on a long Recording, so the Recording is on screen before they are measured.
  view.status.textContent = "Prüft die Tonspuren …";
  const scan = show(await window.smarttrim.scan(), "Die Tonspuren ließen sich nicht prüfen");
  if (scan) {
    session = chooseRecording(session, recording, scan);
    clearStatus();
  }
  draw();
  if (!scan) return;

  // Every SourceTrack that carries sound is read now, while the user is still deciding what to do with them: it is
  // the same read the cut needs, and choosing a role afterwards then costs nothing (ADR-0020). SourceTracks the
  // scan found nothing on are left out — reading them would spend time and memory on a SourceTrack with no sound.
  await readWaveforms(
    scan.flatMap((sourceTrack, position) => (sourceTrack.carriesSound ? [position] : [])),
  );
});

view.openProject.addEventListener("click", async () => {
  stopPlaying();
  clearStatus();
  const opened = show(await window.smarttrim.openProject(), "Das Projekt ließ sich nicht öffnen");
  // undefined is a refusal, null means the user closed the dialog.
  if (!opened) return;
  session = projectOpened(session, opened.project);
  finished = opened.summary;
  waveforms = [];
  cursorSeconds = null;
  clearStatus();
  draw();

  // The project holds what the analysis found, not the audio, so the waveform has to be read again. It runs in the
  // background: the sliders and the numbers are already usable, and the waveform appears when it arrives.
  view.status.textContent = "Liest den Ton für die Wellenform …";
  const drawn = show(await window.smarttrim.readProjectAudio(), "Der Ton ließ sich nicht nachlesen");
  if (drawn) {
    waveforms = drawn;
    if (zoom.toSeconds <= 1) zoom = { fromSeconds: 0, toSeconds: opened.summary.recordingSeconds };
    // What a threshold is decided from is back in memory, so moving it decides again instead of asking for a whole
    // new cut.
    // Not `cutFinished`: that would also claim the sliders as they stand now are what this cut was planned with,
    // swallowing a replan the user asked for by moving one while the read ran.
    session = audioBackInMemory(session);
    if (view.status.textContent?.startsWith("Liest den Ton")) clearStatus();
  }
  draw();
});

view.cut.addEventListener("click", async () => {
  stopPlaying();
  clearStatus();
  working = true;
  finished = null;
  // The waveforms are kept: they belong to this Recording, and this analysis reuses what was read to draw them
  // (ADR-0020). They simply lose their colours until the new plan arrives.
  draw();
  view.status.textContent = "Liest die Aufnahme …";
  const summary = show(await window.smarttrim.cut(analysisRequestFrom(session)), "Der Schnitt ging nicht");
  working = false;
  if (summary) {
    finished = summary;
    // From here on, moving Luft or Pause only replans (ADR-0004).
    session = cutFinished(session);
    clearStatus();
  }
  draw();
  if (summary) await loadWaveforms(summary.recordingSeconds);
});

draw();

// A first run has to fetch ffmpeg (172 MB) and the Silero model before anything can be read. Later runs find them
// and this is over before the window has finished drawing.
window.smarttrim.onReadProgress((progress) => {
  readingCount = progress;
  drawReading();
});

window.smarttrim.onToolsProgress(({ name, percent }) => {
  view.status.textContent = `Lädt ${name} … ${percent} % (nur beim ersten Start)`;
});
// The user's own Presets are read once at startup; without them the dropdown shows only the built-in three.
void (async () => {
  const saved = show(await window.smarttrim.loadPresets(), "Die eigenen Voreinstellungen ließen sich nicht lesen");
  if (saved) ownPresets = saved;
  draw();
})();

void (async () => {
  const ready = show(await window.smarttrim.ensureTools(), "Die Werkzeuge fehlen");
  preparing = false;
  if (ready !== undefined) clearStatus();
  draw();
})();
