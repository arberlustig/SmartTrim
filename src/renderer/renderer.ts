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
  presetNameOf,
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
import type { CutSummary } from "../app/runCut.ts";
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
  deletePreset: element<HTMLButtonElement>("deletePreset"),
  presetNaming: element("presetNaming"),
  presetName: element<HTMLInputElement>("presetName"),
  confirmPreset: element<HTMLButtonElement>("confirmPreset"),
  cancelPreset: element<HTMLButtonElement>("cancelPreset"),
  eventSliders: element("eventSliders"),
  eventLead: element<HTMLInputElement>("eventLead"),
  eventLeadValue: element("eventLeadValue"),
  eventTail: element<HTMLInputElement>("eventTail"),
  eventTailValue: element("eventTailValue"),
  cut: element<HTMLButtonElement>("cut"),
  status: element("status"),
  result: element("result"),
};

let session: CutSession = newCutSession();
/** The Presets the user saved themselves, as the main process last reported them. */
let ownPresets: readonly Preset[] = [];
/** True while the name field is open, so the dropdown does not fight the user for the same row. */
let naming = false;
/**
 * The last of the user's own Presets they picked, so "Speichern unter …" offers that name again. Tweaking a
 * Preset and saving it back is the usual way one gets made, and by then the sliders match no Preset any more.
 * A built-in never lands here: offering "Gaming" would only be refused.
 */
let lastOwnPicked: string | null = null;
/** True while the analysis runs, so nothing can be started twice or changed underneath it. */
let working = false;
/** True until ffmpeg and the model are there: on a first run they have to be downloaded first. */
let preparing = true;
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
      session = setSourceTrackRole(session, index, role.value as TrackRole);
      afterSettingChange();
      draw();
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
  const matched = presetNameOf(session, ownPresets);
  view.preset.replaceChildren();
  const built = PRESETS.map((preset) => preset.name);
  for (const name of [...built, ...(matched ? [] : [OWN_SETTINGS])]) {
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
  view.preset.value = matched ?? OWN_SETTINGS;
  view.preset.disabled = working;
  view.savePreset.disabled = working || naming;
  // Only the user's own can be deleted; the built-in three are the ground to come back to.
  view.deletePreset.disabled = working || naming || !ownPresets.some((preset) => preset.name === matched);
  view.presetNaming.hidden = !naming;
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
  // "eigene" is not something to pick: it only describes sliders that match no Preset.
  if (!preset) return;
  if (ownPresets.some((each) => each.name === preset.name)) lastOwnPicked = preset.name;
  session = applyPreset(session, preset);
  afterSettingChange();
  draw();
});

view.savePreset.addEventListener("click", () => {
  clearStatus();
  naming = true;
  draw();
  // The own Preset they were last on is the likeliest one they mean to save over.
  const matched = presetNameOf(session, ownPresets);
  view.presetName.value = (matched && ownPresets.some((each) => each.name === matched) ? matched : lastOwnPicked) ?? "";
  view.presetName.focus();
  view.presetName.select();
});

view.cancelPreset.addEventListener("click", () => {
  naming = false;
  draw();
});

view.presetName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") view.confirmPreset.click();
  if (event.key === "Escape") view.cancelPreset.click();
});

view.confirmPreset.addEventListener("click", async () => {
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
  if (ownPresets.some((each) => each.name === name) && !confirm(`„${name}" gibt es schon. Überschreiben?`)) return;

  const saved = show(await window.smarttrim.savePreset(preset), "Die Voreinstellung ließ sich nicht speichern");
  if (!saved) return;
  ownPresets = saved;
  lastOwnPicked = name;
  naming = false;
  draw();
});

view.deletePreset.addEventListener("click", async () => {
  clearStatus();
  const name = presetNameOf(session, ownPresets);
  if (!name) return;
  if (!confirm(`„${name}" löschen?`)) return;

  const left = show(await window.smarttrim.deletePreset(name), "Die Voreinstellung ließ sich nicht löschen");
  if (!left) return;
  ownPresets = left;
  if (lastOwnPicked === name) lastOwnPicked = null;
  draw();
});

view.chooseRecording.addEventListener("click", async () => {
  clearStatus();
  const recording = show(await window.smarttrim.chooseRecording(), "Die Aufnahme ließ sich nicht lesen");
  // undefined is a refusal, null means the user closed the dialog.
  if (!recording) return;
  session = chooseRecording(session, recording);
  finished = null;
  draw();

  // The slices take a few seconds on a long Recording, so the Recording is on screen before they are measured.
  view.status.textContent = "Prüft die Tonspuren …";
  const scan = show(await window.smarttrim.scan(), "Die Tonspuren ließen sich nicht prüfen");
  if (scan) {
    session = chooseRecording(session, recording, scan);
    clearStatus();
  }
  draw();
});

view.openProject.addEventListener("click", async () => {
  clearStatus();
  const opened = show(await window.smarttrim.openProject(), "Das Projekt ließ sich nicht öffnen");
  // undefined is a refusal, null means the user closed the dialog.
  if (!opened) return;
  session = projectOpened(session, opened.project);
  finished = opened.summary;
  clearStatus();
  draw();
});

view.cut.addEventListener("click", async () => {
  clearStatus();
  working = true;
  finished = null;
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
});

draw();

// A first run has to fetch ffmpeg (172 MB) and the Silero model before anything can be read. Later runs find them
// and this is over before the window has finished drawing.
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
