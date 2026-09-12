import {
  MARGIN_SECONDS,
  MINIMUM_DEAD_ZONE_SECONDS,
  THRESHOLD_DBFS,
  analysisRequestFrom,
  canCut,
  chooseRecording,
  newCutSession,
  setMarginSeconds,
  setMinimumDeadZoneSeconds,
  setThresholdDbfs,
  toggleSourceTrack,
  type CutSession,
} from "../app/cutSession.ts";
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
  recordingInfo: element("recordingInfo"),
  sourceTracks: element("sourceTracks"),
  sourceTracksHint: element("sourceTracksHint"),
  threshold: element<HTMLInputElement>("threshold"),
  thresholdValue: element("thresholdValue"),
  margin: element<HTMLInputElement>("margin"),
  marginValue: element("marginValue"),
  deadZone: element<HTMLInputElement>("deadZone"),
  deadZoneValue: element("deadZoneValue"),
  cut: element<HTMLButtonElement>("cut"),
  status: element("status"),
  result: element("result"),
};

let session: CutSession = newCutSession();
/** True while the analysis runs, so nothing can be started twice or changed underneath it. */
let working = false;
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
  recording.sourceTracks.forEach((sourceTrack, index) => {
    const label = document.createElement("label");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.checked = session.listenTo.includes(index);
    tick.disabled = working;
    tick.addEventListener("change", () => {
      session = toggleSourceTrack(session, index);
      staleNow();
      draw();
    });
    const text = document.createElement("div");
    text.textContent = `Tonspur ${index + 1}`;
    const detail = document.createElement("span");
    detail.textContent = `${channels(sourceTrack.channelCount)} · ${sourceTrack.sampleRate / 1000} kHz`;
    label.append(tick, text, detail);
    view.sourceTracks.append(label);
  });
  view.sourceTracksHint.textContent =
    session.listenTo.length === 0
      ? "Kreuze die Spur an, auf der du sprichst. Nach ihr wird geschnitten."
      : "Alles, was auf den angekreuzten Spuren laut genug ist, bleibt erhalten.";
}

function drawSettings(): void {
  view.threshold.value = String(session.thresholdDbfs);
  view.thresholdValue.textContent = `${decimals(session.thresholdDbfs, 0)} dB`;
  view.margin.value = String(session.marginSeconds);
  view.marginValue.textContent = `${decimals(session.marginSeconds, 2)} s`;
  view.deadZone.value = String(session.minimumDeadZoneSeconds);
  view.deadZoneValue.textContent = `${decimals(session.minimumDeadZoneSeconds, 2)} s`;
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

  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Premiere-Datei speichern …";
  save.addEventListener("click", async () => {
    save.disabled = true;
    clearStatus();
    const saved = show(await window.smarttrim.save(), "Speichern ging nicht");
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

  view.result.append(sentence, numbers, save);
}

function draw(): void {
  drawRecording();
  drawSourceTracks();
  drawSettings();
  drawResult();
  view.chooseRecording.disabled = working;
  view.threshold.disabled = working;
  view.margin.disabled = working;
  view.deadZone.disabled = working;
  view.cut.disabled = working || !canCut(session);
  view.cut.textContent = working ? "Arbeitet …" : "Schneiden";
}

/** A changed setting makes the plan on screen a plan for something else, so it stops being offered. */
function staleNow(): void {
  if (!finished) return;
  finished = null;
  view.status.textContent = "Einstellung geändert – noch einmal schneiden.";
  view.status.classList.remove("bad");
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
    staleNow();
    draw();
  });
}

slider(view.threshold, THRESHOLD_DBFS, (value) => (session = setThresholdDbfs(session, value)));
slider(view.margin, MARGIN_SECONDS, (value) => (session = setMarginSeconds(session, value)));
slider(view.deadZone, MINIMUM_DEAD_ZONE_SECONDS, (value) => (session = setMinimumDeadZoneSeconds(session, value)));

view.chooseRecording.addEventListener("click", async () => {
  clearStatus();
  const recording = show(await window.smarttrim.chooseRecording(), "Die Aufnahme ließ sich nicht lesen");
  // undefined is a refusal, null means the user closed the dialog.
  if (!recording) return;
  session = chooseRecording(session, recording);
  finished = null;
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
    clearStatus();
  }
  draw();
});

draw();
