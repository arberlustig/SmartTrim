import type { PremierePresetRefusal, UncarriedParameter } from "../export/premierePreset.ts";
import type { BackgroundJob } from "./tabs.ts";

/** Effect names in order, each named once with how often it occurs: "Kanten aufrauen, Schlagschatten (2×)". */
function countedNames(names: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts].map(([name, count]) => (count === 1 ? name : `${name} (${count}×)`)).join(", ");
}

/** The languages the window speaks (ADR-0030). */
export type Language = "de" | "en";

export const LANGUAGES: readonly Language[] = ["de", "en"];

/** What the four file dialogs of the main process say; handed over with the request, so main holds no texts. */
export interface DialogTexts {
  readonly chooseRecordings: { readonly title: string; readonly recordings: string; readonly allFiles: string };
  readonly openProjects: { readonly title: string; readonly project: string };
  readonly savePremiere: { readonly title: string; readonly premiereProject: string };
  readonly addPremierePresets: { readonly title: string; readonly premierePresets: string };
}

/**
 * Every sentence the window shows, in one language. Fixed sentences are strings; sentences with something of the
 * user's in them are functions, so the two languages can put the number or the name where their grammar wants it.
 */
export interface Texts {
  readonly locale: string;
  readonly dialogs: DialogTexts;

  // Numbers and lengths
  readonly duration: (seconds: number) => string;
  readonly minutes: (count: number) => string;
  readonly channels: (count: number) => string;
  readonly counted: (done: number, total: number) => string;

  // The top of the window and the Tabs
  readonly chooseRecordings: string;
  readonly openProject: string;
  readonly dismiss: string;
  readonly closeTab: (name: string) => string;
  readonly filesNotOpened: (count: number) => string;
  readonly closeQuestionTitle: (name: string) => string;
  readonly closeQuestion: (heldCount: number, canSave: boolean) => string;
  readonly saveAndClose: string;
  readonly dontSave: string;
  readonly cancel: string;
  readonly heldMore: (count: number) => string;

  // The empty window and the Recording
  readonly dropTitle: string;
  readonly dropSubtitle: string;
  readonly dropHere: string;
  readonly dropWhat: string;
  readonly sectionRecording: string;
  readonly sectionSourceTracks: string;
  readonly sectionSettings: string;
  readonly noRecordingOpen: string;
  readonly recordingFacts: (facts: { duration: string; width: number; height: number; fps: string; sourceTracks: number }) => string;
  readonly openRecordingFirst: string;

  // The SourceTracks
  readonly headRole: string;
  readonly headExport: string;
  readonly sourceTrack: (number: number) => string;
  readonly roleTitle: (number: number) => string;
  readonly roles: { readonly ignored: string; readonly voice: string; readonly content: string };
  readonly exportTick: (number: number) => string;
  readonly soundHint: { readonly none: string; readonly throughout: string; readonly inPlaces: string };
  readonly stopTrack: (number: number) => string;
  readonly playTrack: (number: number, minutes: string) => string;
  readonly waveformTitle: (number: number) => string;
  readonly hintChooseVoice: string;
  readonly hintTickExport: string;
  readonly hintMoments: string;
  readonly hintContent: string;
  readonly hideEmpty: string;
  readonly showEmpty: (hidden: number, exported: number) => string;
  readonly cutHint: (longest: string) => string;
  readonly zoom: string;
  readonly skipRemoved: string;
  readonly hidePicture: string;
  readonly showPicture: string;
  readonly pictureFailed: (reason: string) => string;
  readonly holdStart: string;
  readonly holdStartTitle: string;
  readonly holdEnd: string;
  readonly holdEndTitle: string;
  readonly holdHint: string;
  readonly remove: string;
  readonly holdStartFirst: string;
  readonly holdEndFirst: string;
  readonly holdFailed: (reason: string) => string;
  readonly holdEndWithStart: (start: string) => string;
  readonly heldRange: (from: string, to: string) => string;

  // The settings
  readonly preset: string;
  readonly ownSettings: string;
  readonly changed: (name: string) => string;
  readonly ownPresets: string;
  readonly presetSave: string;
  readonly presetSaveTitle: string;
  readonly presetNewTitle: string;
  readonly presetDelete: string;
  readonly presetNameLabel: string;
  readonly presetNamePlaceholder: string;
  readonly presetAdd: string;
  readonly yes: string;
  readonly overwriteAsk: (name: string) => string;
  readonly deleteAsk: (name: string) => string;
  readonly presetSaveFailed: string;
  readonly presetDeleteFailed: string;
  readonly presetsLoadFailed: string;
  readonly sliders: {
    readonly threshold: { readonly label: string; readonly small: string };
    readonly margin: { readonly label: string; readonly small: string };
    readonly deadZone: { readonly label: string; readonly small: string };
    readonly eventLead: { readonly label: string; readonly small: string };
    readonly eventTail: { readonly label: string; readonly small: string };
  };
  readonly otherTabs: string;
  readonly takeOver: string;
  readonly takeOverTitle: string;
  readonly takeOverQuestionTitle: string;
  readonly takeOverQuestion: (name: string, others: number, withVideoLayers: boolean) => string;
  readonly takeOverRoles: string;
  readonly takeOverSliders: string;
  readonly onlySlidersTaken: (thisTracks: number, fromName: string, fromTracks: number) => string;
  readonly takenOver: (
    what: "slidersAndRoles" | "sliders",
    fromName: string,
    others: number,
    videoLayersCarried: boolean,
  ) => string;
  readonly layerSetupStayedBehind: (fromName: string) => string;

  // The video tracks (ADR-0033)
  readonly sectionVideoLayers: string;
  readonly videoLayerLabel: (number: number) => string;
  readonly clipPremierePreset: string;
  readonly nestPremierePreset: string;
  readonly noPremierePreset: string;
  readonly premierePresetGone: (name: string) => string;
  readonly startsSwitchedOff: string;
  readonly addVideoLayer: string;
  readonly removeVideoLayer: (number: number) => string;
  readonly addPremierePresets: string;
  readonly premierePresetsHeading: string;
  readonly deletePremierePreset: (name: string) => string;
  /** What reaches Premiere of a PremierePreset and what does not, effect names as the file has them. */
  readonly premierePresetSummary: (carried: readonly string[], notCarried: readonly string[]) => string;
  /** A parameter of a carried effect that does not reach Premiere, shown after the effect's own name. */
  readonly uncarriedParameters: Readonly<Record<UncarriedParameter, string>>;
  readonly notCarriedParameter: (effect: string, parameter: string) => string;
  /** What a screen reader says for a VideoLayer's select or tick, so the rows can be told apart. */
  readonly videoLayerPlaceLabel: (number: number, place: "clip" | "nest") => string;
  readonly videoLayerSwitchedOffLabel: (number: number) => string;
  readonly premierePresetRefusals: Readonly<Record<PremierePresetRefusal, string>>;
  readonly premierePresetFileEmpty: string;
  readonly premierePresetFileUnreadable: string;
  readonly premierePresetsAdded: (count: number) => string;
  readonly sequenceFrameNote: (width: number, height: number) => string;
  readonly videoLayersNotWrittenYet: string;
  readonly premierePresetsLoadFailed: string;
  readonly premierePresetsAddFailed: string;
  readonly premierePresetDeleteFailed: string;
  readonly layerSetupRememberFailed: string;

  // Cutting, waiting, the result
  readonly cut: string;
  readonly working: string;
  readonly cutAll: string;
  readonly cutAllTitle: string;
  readonly cuttingCount: (counted: string) => string;
  readonly saveAll: string;
  readonly savingCount: (counted: string) => string;
  readonly saveAllHint: string;
  readonly settingChanged: string;
  readonly replanning: string;
  readonly redeciding: string;
  readonly replanFailed: string;
  readonly redecideFailed: string;
  readonly jobLines: Record<BackgroundJob["kind"], string>;
  readonly cutting: string;
  readonly readingOne: string;
  readonly readingCount: (done: number, total: number) => string;
  readonly readingRecording: string;
  readonly scanFailed: string;
  readonly readFailed: string;
  readonly projectAudioFailed: string;
  readonly waveformFailed: string;
  readonly cutFailed: string;
  readonly resultSentence: (facts: { total: string; kept: string; removedPercent: string }) => string;
  readonly resultNumbers: (pieces: string, removed: string) => string;
  readonly savePremiere: string;
  readonly savingFailed: string;
  readonly savedAt: (path: string) => string;
  readonly showInFolder: string;
  readonly saveProject: string;
  readonly saveProjectTitle: string;
  readonly projectSavedAt: (path: string) => string;
  readonly savedAsProject: string;
  readonly playFailed: string;
  readonly nothingKeptHere: string;
  readonly because: (detail: string) => string;

  // Opening files
  readonly fileMissing: string;
  readonly isFolder: string;
  readonly notARecording: string;
  readonly ffprobeSays: (detail: string) => string;
  readonly cannotCut: string;
  readonly notAProject: string;
  readonly projectRecordingMissing: string;
  readonly lookedUnder: (path: string) => string;
  readonly otherProjectOpened: string;
  readonly openedAs: (name: string) => string;
  readonly projectRecordingChanged: string;
  readonly alreadyOpen: string;
  readonly recordingsAlreadyOpen: (count: number) => string;
  readonly projectNotLoaded: string;
  readonly filesFailed: string;
  readonly notAFileHere: string;

  // Actions on all Tabs
  readonly skipped: { readonly skipNoVoice: string; readonly skipNotCut: string; readonly skipNoExport: string };
  readonly nothingSavedYet: string;
  readonly cutAllHeading: (counts: { cut: number; alreadyCut: number; skipped: number; failed: number }) => string;
  readonly saveAllHeading: (counts: { saved: number; skipped: number; failed: number }) => string;
  readonly savedDot: string;
  readonly folderIs: (folder: string) => string;

  // The first start, and the first start after an update that pins other tools (ADR-0031)
  readonly loadingTool: (name: string, percent: number) => string;
  readonly reloadingTool: (name: string, percent: number) => string;
  readonly checkingTool: (name: string, percent: number) => string;
  readonly toolsMissing: string;

  // SmartTrim's own update (ADR-0032)
  readonly updateLoading: (version: string, percent: number) => string;
  readonly updateReady: (version: string) => string;
  readonly updateFailed: (version: string) => string;
  readonly restartNow: string;
  readonly restartWaits: string;
  readonly restartLosesHeld: (tabCount: number) => string;
  readonly restartAnyway: string;
  readonly restartFailed: string;
}

/** Counts with their words, the ones at nought left out; "nothing to do" when every count is nought. */
function heading(action: string, said: readonly string[], nothing: string): string {
  return `${action}: ${said.length > 0 ? said.join(", ") : nothing}`;
}

const numbers = (locale: string) => (value: number, digits: number) =>
  value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });

const de: Texts = {
  locale: "de-DE",
  dialogs: {
    chooseRecordings: { title: "Aufnahmen wählen", recordings: "Aufnahmen", allFiles: "Alle Dateien" },
    openProjects: { title: "SmartTrim-Projekte öffnen", project: "SmartTrim-Projekt" },
    savePremiere: { title: "Premiere-Datei speichern", premiereProject: "Premiere-Projekt (FCP7 XML)" },
    addPremierePresets: { title: "Premiere-Vorgaben hinzufügen", premierePresets: "Premiere-Vorgaben" },
  },

  duration: (seconds) => {
    if (seconds < 60) return `${numbers("de-DE")(seconds, 1)} Sek`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} Min`;
    return `${Math.floor(minutes / 60)} Std ${String(minutes % 60).padStart(2, "0")} Min`;
  },
  minutes: (count) => `${count} ${count === 1 ? "Minute" : "Minuten"}`,
  channels: (count) => (count === 2 ? "Stereo" : count === 1 ? "Mono" : `${count} Kanäle`),
  counted: (done, total) => `${done} von ${total}`,

  chooseRecordings: "Aufnahmen wählen …",
  openProject: "Projekt öffnen …",
  dismiss: "Ausblenden",
  closeTab: (name) => `${name} schließen`,
  filesNotOpened: (count) => (count === 1 ? "Eine Datei ließ sich nicht öffnen" : `${count} Dateien ließen sich nicht öffnen`),
  closeQuestionTitle: (name) => `„${name}“ schließen?`,
  closeQuestion: (heldCount, canSave) =>
    (heldCount === 1
      ? "Du hast hier eine Stelle festgehalten, die in keinem gespeicherten Projekt steht. Ohne Speichern ist sie weg."
      : `Du hast hier ${heldCount} Stellen festgehalten, die in keinem gespeicherten Projekt stehen. Ohne Speichern sind sie weg.`) +
    (canSave ? "" : " Als Projekt speichern lässt sich erst nach dem Schneiden."),
  saveAndClose: "Speichern und schließen",
  dontSave: "Nicht speichern",
  cancel: "Abbrechen",
  heldMore: (count) => `und ${count} weitere`,

  dropTitle: "Aufnahme hierher ziehen",
  dropSubtitle: "eine Aufnahme, mehrere, oder ein ganzer Ordner",
  dropHere: "Hier ablegen",
  dropWhat: "Eine Aufnahme oder ein SmartTrim-Projekt",
  sectionRecording: "Aufnahme",
  sectionSourceTracks: "Tonspuren",
  sectionSettings: "Einstellungen",
  noRecordingOpen: "Noch keine Aufnahme offen.",
  recordingFacts: ({ duration, width, height, fps, sourceTracks }) =>
    `${duration} · ${width}×${height} · ${fps} Bilder/s · ${sourceTracks} Tonspuren`,
  openRecordingFirst: "Öffne zuerst eine Aufnahme.",

  headRole: "Diese Spur …",
  headExport: "Nach Premiere",
  sourceTrack: (number) => `Tonspur ${number}`,
  roleTitle: (number) => `Was Tonspur ${number} zum Schnitt beiträgt`,
  roles: { ignored: "wird ignoriert", voice: "danach schneiden", content: "Momente behalten" },
  exportTick: (number) => `Tonspur ${number} nach Premiere übernehmen`,
  soundHint: { none: " · kein Ton gefunden", throughout: " · Ton durchgehend", inPlaces: " · Ton stellenweise" },
  stopTrack: (number) => `Tonspur ${number} anhalten`,
  playTrack: (number, minutes) => `Tonspur ${number} ab dem weißen Strich anhören (höchstens ${minutes})`,
  waveformTitle: (number) => `Tonspur ${number} · klicken setzt den Strich, ziehen verschiebt, Mausrad zoomt`,
  hintChooseVoice: 'Stell bei der Spur, auf der du sprichst, "danach schneiden" ein. Rechts, was in Premiere landen soll.',
  hintTickExport: "Kreuze rechts mindestens eine Spur an, sonst hat das Premiere-Projekt keinen Ton.",
  hintMoments:
    'Alles, was auf den Schnitt-Spuren laut genug ist, bleibt erhalten. "Momente behalten" hält Knaller am Leben, bei denen keiner redet.',
  hintContent:
    "Auf den Momente-Spuren bleibt, was deutlich aus dem eigenen Grundton ausbricht — Explosionen, Fanfaren, abrupte Stille.",
  hideEmpty: "Leere Tonspuren ausblenden",
  showEmpty: (hidden, exported) =>
    `${hidden} leere ${hidden === 1 ? "Tonspur" : "Tonspuren"} zeigen ` +
    (exported === 0
      ? `(${hidden === 1 ? "kommt" : "kommen"} nicht nach Premiere)`
      : `(${exported} davon ${exported === 1 ? "kommt" : "kommen"} nach Premiere)`),
  cutHint: (longest) =>
    "Grün bleibt stehen, dunkelrot wird herausgeschnitten. Den weißen Rahmen ziehen oder in die Leiste klicken, um " +
    `woanders hinzuschauen. Ein Klick in die Wellenform setzt den weißen Strich, ▶ spielt die Spur ab dort, höchstens ${longest}.`,
  zoom: "Ausschnitt",
  skipRemoved: "Beim Abspielen überspringen, was herausgeschnitten wird",
  hidePicture: "Bild ausblenden",
  showPicture: "Bild zeigen",
  pictureFailed: (reason) => `Das Bild dieser Aufnahme lässt sich hier nicht zeigen: ${reason}`,
  holdStart: "Anfang festhalten",
  holdStartTitle: "Hält ab dem weißen Strich fest",
  holdEnd: "Ende festhalten",
  holdEndTitle: "Hält bis zum weißen Strich fest",
  holdHint: "Festgehaltenes bleibt immer im Schnitt, egal wie die Regler stehen.",
  remove: "entfernen",
  holdStartFirst: "Setz zuerst den weißen Strich: ein Klick in die Wellenform, dann „Anfang festhalten“.",
  holdEndFirst: "Setz zuerst den weißen Strich an das Ende: ein Klick in die Wellenform, dann „Ende festhalten“.",
  holdFailed: (reason) => `Das ließ sich nicht festhalten: ${reason}`,
  holdEndWithStart: (start) => `Ende festhalten (Anfang ${start})`,
  heldRange: (from, to) => `Festgehalten: ${from} – ${to}`,

  preset: "Voreinstellung",
  ownSettings: "eigene",
  changed: (name) => `${name} (geändert)`,
  ownPresets: "Eigene",
  presetSave: "sichern",
  presetSaveTitle: "Die Änderungen in diese Voreinstellung übernehmen",
  presetNewTitle: "Eigene Voreinstellung aus den jetzigen Reglern anlegen",
  presetDelete: "löschen",
  presetNameLabel: "Name",
  presetNamePlaceholder: "z. B. Abend",
  presetAdd: "Hinzufügen",
  yes: "Ja",
  overwriteAsk: (name) => `„${name}“ gibt es schon. Überschreiben?`,
  deleteAsk: (name) => `„${name}“ löschen?`,
  presetSaveFailed: "Die Voreinstellung ließ sich nicht speichern",
  presetDeleteFailed: "Die Voreinstellung ließ sich nicht löschen",
  presetsLoadFailed: "Die eigenen Voreinstellungen ließen sich nicht lesen",
  sliders: {
    threshold: { label: "Lautstärke ab", small: "Leiseres gilt als Pause" },
    margin: { label: "Luft an den Schnitten", small: "Bleibt vor und nach dem Ton stehen" },
    deadZone: { label: "Pausen entfernen ab", small: "Kürzere Pausen bleiben drin" },
    eventLead: { label: "Vorlauf bei Momenten", small: "Bleibt vor einem Knall stehen" },
    eventTail: { label: "Nachlauf bei Momenten", small: "Bleibt danach stehen" },
  },
  otherTabs: "Andere Tabs",
  takeOver: "Für alle übernehmen",
  takeOverTitle: "Diese Einstellungen in alle anderen Tabs übernehmen",
  takeOverQuestionTitle: "Haben alle Aufnahmen dieselbe Tonspur-Aufteilung?",
  takeOverQuestion: (name, others, withVideoLayers) =>
    `Die Regler von „${name}“ gehen an ${others === 1 ? "den anderen Tab" : `die ${others} anderen Tabs`}. ` +
    "Nur wenn die Tonspuren überall gleich belegt sind, sollen auch die Tonspur-Rollen und die Premiere-Häkchen mit. " +
    "Aufnahmen mit einer anderen Zahl an Tonspuren bekommen so oder so keine Tonspur-Rollen. " +
    (withVideoLayers
      ? "Die Videospuren gehen mit beiden Knöpfen mit, aber nur in Aufnahmen mit demselben Seitenverhältnis. "
      : "") +
    "Festgehaltene Stellen bleiben, wo sie sind.",
  takeOverRoles: "Mit Tonspur-Rollen",
  takeOverSliders: "Ohne Tonspur-Rollen",
  onlySlidersTaken: (thisTracks, fromName, fromTracks) => {
    const tracks = (count: number) => (count === 1 ? "eine Tonspur" : `${count} Tonspuren`);
    return `Ohne Tonspur-Rollen übernommen: Diese Aufnahme hat ${tracks(thisTracks)}, „${fromName}“ hat ${tracks(fromTracks)}.`;
  },
  takenOver: (what, fromName, others, videoLayersCarried) =>
    `${what === "slidersAndRoles" ? "Regler und Tonspur-Rollen" : "Regler"}${videoLayersCarried ? " samt Videospuren" : ""} ` +
    `von „${fromName}“ in ` +
    `${others === 1 ? "den anderen Tab" : `${others} Tabs`} übernommen. Festgehaltene Stellen sind geblieben.`,
  layerSetupStayedBehind: (fromName) =>
    `Die Videospuren von „${fromName}“ gingen nicht mit: Diese Aufnahme hat ein anderes Seitenverhältnis.`,

  sectionVideoLayers: "Videospuren",
  videoLayerLabel: (number) => `V${number}`,
  clipPremierePreset: "auf den Clip",
  nestPremierePreset: "auf die Verschachtelung",
  noPremierePreset: "keine Premiere-Vorgabe",
  premierePresetGone: (name) => `${name} (nicht in der Liste)`,
  startsSwitchedOff: "startet ausgeschaltet",
  addVideoLayer: "+ Videospur",
  removeVideoLayer: (number) => `V${number} entfernen`,
  addPremierePresets: "Premiere-Vorgaben hinzufügen …",
  premierePresetsHeading: "Premiere-Vorgaben",
  deletePremierePreset: (name) => `„${name}“ löschen`,
  premierePresetSummary: (carried, notCarried) =>
    `Kommt mit: ${carried.length > 0 ? countedNames(carried) : "nichts"}.` +
    (notCarried.length > 0 ? ` Kommt nicht mit: ${countedNames(notCarried)}.` : ""),
  // Premiere's own labels, so they can be found in its effect controls.
  uncarriedParameters: {
    motionAntiFlicker: "Anti-Flimmer-Filter",
    motionCrop: "Zuschneiden",
    cropZoom: "Zoom",
    cropEdgeFeather: "Weiche Kanten",
  },
  notCarriedParameter: (effect, parameter) => `${effect} (${parameter})`,
  videoLayerPlaceLabel: (number, place) =>
    `V${number}: Premiere-Vorgabe ${place === "clip" ? "auf den Clip" : "auf die Verschachtelung"}`,
  videoLayerSwitchedOffLabel: (number) => `V${number} startet ausgeschaltet`,
  premierePresetRefusals: {
    animated:
      "Abgelehnt: Die Vorgabe verändert sich mit der Zeit, und eine Animation passt nicht auf Teile, die woanders in der " +
      "Aufnahme anfangen.",
    rotated: "Abgelehnt: Die Vorgabe dreht das Bild. Wie Premiere eine Drehung aus der Premiere-Datei liest, ist noch nicht geklärt.",
    nonUniformScale:
      "Abgelehnt: Die Vorgabe streckt das Bild nur in eine Richtung, die Premiere-Datei kennt aber nur eine Größe für beide.",
    noVideoEffect: "Abgelehnt: Die Vorgabe enthält keinen Videoeffekt.",
    brokenValue: "Abgelehnt: Ein Wert darin ist keine Zahl.",
    unnamed: "Abgelehnt: Die Vorgabe hat keinen Namen.",
  },
  premierePresetFileEmpty: "Enthält keine Premiere-Vorgabe.",
  premierePresetFileUnreadable: "Ließ sich nicht lesen.",
  premierePresetsAdded: (count) =>
    count === 0 ? "Keine Premiere-Vorgabe hinzugefügt" : count === 1 ? "Eine Premiere-Vorgabe hinzugefügt" : `${count} Premiere-Vorgaben hinzugefügt`,
  sequenceFrameNote: (width, height) => `Dann wird die Premiere-Sequenz ${width} × ${height}.`,
  videoLayersNotWrittenYet:
    "Noch schreibt SmartTrim die Videospuren nicht in die Premiere-Datei. Das kommt in einer der nächsten Fassungen.",
  premierePresetsLoadFailed: "Die Premiere-Vorgaben ließen sich nicht lesen",
  premierePresetsAddFailed: "Die Premiere-Vorgaben ließen sich nicht hinzufügen",
  premierePresetDeleteFailed: "Die Premiere-Vorgabe ließ sich nicht löschen",
  layerSetupRememberFailed: "Die Videospuren ließen sich nicht für die nächste Aufnahme merken",

  cut: "Schneiden",
  working: "Arbeitet …",
  cutAll: "Alle schneiden",
  cutAllTitle: "Jeden Tab mit seinen eigenen Einstellungen schneiden",
  cuttingCount: (counted) => `Schneidet ${counted} …`,
  saveAll: "Alle Premiere-Dateien speichern",
  savingCount: (counted) => `Speichert ${counted} …`,
  saveAllHint: "Legt jede Premiere-Datei neben ihre Aufnahme und überschreibt nichts.",
  settingChanged: "Einstellung geändert – noch einmal schneiden.",
  replanning: "Plant neu …",
  redeciding: "Rechnet neu …",
  replanFailed: "Das Neuplanen ging nicht",
  redecideFailed: "Das Neurechnen ging nicht",
  jobLines: {
    scan: "Prüft die Tonspuren …",
    read: "Liest den Ton der Tonspuren …",
    projectAudio: "Liest den Ton für die Wellenform …",
  },
  cutting: "Schneidet …",
  readingOne: "Liest den Ton der Tonspur …",
  readingCount: (done, total) => `Liest den Ton der Tonspuren … ${done} von ${total} fertig`,
  readingRecording: "Liest die Aufnahme …",
  scanFailed: "Die Tonspuren ließen sich nicht prüfen",
  readFailed: "Die Tonspur ließ sich nicht lesen",
  projectAudioFailed: "Der Ton ließ sich nicht nachlesen",
  waveformFailed: "Die Wellenform ließ sich nicht zeichnen",
  cutFailed: "Der Schnitt ging nicht",
  resultSentence: ({ total, kept, removedPercent }) => `Von ${total} bleiben ${kept} übrig – ${removedPercent} % sind weg.`,
  resultNumbers: (pieces, removed) => `${pieces} Teile, ${removed} entfernt.`,
  savePremiere: "Premiere-Datei speichern …",
  savingFailed: "Speichern ging nicht",
  savedAt: (path) => `Gespeichert: ${path}`,
  showInFolder: "Im Ordner zeigen",
  saveProject: "Projekt speichern",
  saveProjectTitle: "Speichert neben der Aufnahme – oder in das Projekt, aus dem dieser Tab kommt",
  projectSavedAt: (path) => `Projekt gespeichert: ${path}`,
  savedAsProject: "Als Projekt gespeichert.",
  playFailed: "Der Ton ließ sich nicht abspielen",
  nothingKeptHere: "Hier wird alles herausgeschnitten – zum Anhören weiter herauszoomen oder „überspringen“ ausschalten.",
  because: (detail) => `Grund: ${detail}`,

  fileMissing: "Die Datei gibt es nicht mehr.",
  isFolder: "Das ist ein Ordner, keine Datei.",
  notARecording: "Das ist keine Aufnahme. Darin ließ sich weder Bild noch Ton lesen.",
  ffprobeSays: (detail) => `ffprobe meldet: ${detail}`,
  cannotCut: "Diese Aufnahme kann SmartTrim nicht schneiden.",
  notAProject: "Das Projekt lässt sich nicht lesen.",
  projectRecordingMissing: "Die Aufnahme zu diesem Projekt ist nicht mehr da, wo sie beim Speichern lag.",
  lookedUnder: (path) => `Gesucht unter: ${path}`,
  otherProjectOpened: "Nicht geöffnet, weil zu derselben Aufnahme schon ein anderes Projekt geöffnet wird.",
  openedAs: (name) => `Geöffnet: ${name}`,
  projectRecordingChanged:
    "Die Aufnahme zu diesem Projekt hat sich seit dem Speichern verändert, die Schnitte würden nicht mehr passen.",
  alreadyOpen: "Ist schon offen.",
  recordingsAlreadyOpen: (count) => `${count} Aufnahmen sind schon offen.`,
  projectNotLoaded:
    "Nicht geladen, weil die Aufnahme dazu schon in einem Tab offen ist. Schließ diesen Tab zuerst, wenn du das Projekt öffnen willst.",
  filesFailed: "Die Dateien ließen sich nicht öffnen.",
  notAFileHere: "Das lässt sich nicht öffnen: Es ist keine Datei auf diesem Rechner.",

  skipped: {
    skipNoVoice: "Übersprungen: Keine Tonspur steht auf „danach schneiden“.",
    skipNotCut: "Übersprungen: Noch nicht nach den jetzigen Einstellungen geschnitten.",
    skipNoExport: "Übersprungen: Keine Tonspur ist für Premiere angekreuzt.",
  },
  nothingSavedYet: "Gespeichert ist noch nichts: dafür „Alle Premiere-Dateien speichern“ ganz unten.",
  cutAllHeading: ({ cut, alreadyCut, skipped, failed }) =>
    heading(
      "Alle schneiden",
      [
        [cut, "geschnitten"],
        [alreadyCut, alreadyCut === 1 ? "war schon geschnitten" : "waren schon geschnitten"],
        [skipped, "übersprungen"],
        [failed, failed === 1 ? "ging nicht" : "gingen nicht"],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, words]) => `${count} ${words}`),
      "nichts zu tun",
    ),
  saveAllHeading: ({ saved, skipped, failed }) =>
    heading(
      "Alle Premiere-Dateien speichern",
      [
        [saved, "gespeichert"],
        [skipped, "übersprungen"],
        [failed, failed === 1 ? "ging nicht" : "gingen nicht"],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, words]) => `${count} ${words}`),
      "nichts zu tun",
    ),
  savedDot: "Gespeichert.",
  folderIs: (folder) => `Ordner: ${folder}`,

  loadingTool: (name, percent) => `Lädt ${name} … ${percent} % (nur beim ersten Start)`,
  reloadingTool: (name, percent) => `Lädt ${name} neu … ${percent} %`,
  checkingTool: (name, percent) => `Prüft ${name} … ${percent} %`,
  toolsMissing: "Die Werkzeuge fehlen",

  updateLoading: (version, percent) => `SmartTrim ${version} wird geladen … ${percent} %`,
  updateReady: (version) => `SmartTrim ${version} ist bereit und wird beim Schließen installiert.`,
  updateFailed: (version) => `SmartTrim ${version} ließ sich nicht laden – SmartTrim versucht es später wieder.`,
  restartNow: "Jetzt neu starten",
  restartWaits: "Geht, sobald nichts mehr läuft",
  restartLosesHeld: (tabCount) =>
    tabCount === 1
      ? "In einem Tab sind festgehaltene Stellen nicht gespeichert – beim Neustart sind sie weg."
      : `In ${tabCount} Tabs sind festgehaltene Stellen nicht gespeichert – beim Neustart sind sie weg.`,
  restartAnyway: "Trotzdem neu starten",
  restartFailed: "Der Neustart ging nicht",
};

const en: Texts = {
  locale: "en-US",
  dialogs: {
    chooseRecordings: { title: "Choose recordings", recordings: "Recordings", allFiles: "All files" },
    openProjects: { title: "Open SmartTrim projects", project: "SmartTrim project" },
    savePremiere: { title: "Save Premiere file", premiereProject: "Premiere project (FCP7 XML)" },
    addPremierePresets: { title: "Add Premiere effect presets", premierePresets: "Premiere effect presets" },
  },

  duration: (seconds) => {
    if (seconds < 60) return `${numbers("en-US")(seconds, 1)} s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
  },
  minutes: (count) => `${count} ${count === 1 ? "minute" : "minutes"}`,
  channels: (count) => (count === 2 ? "Stereo" : count === 1 ? "Mono" : `${count} channels`),
  counted: (done, total) => `${done} of ${total}`,

  chooseRecordings: "Choose recordings …",
  openProject: "Open project …",
  dismiss: "Dismiss",
  closeTab: (name) => `Close ${name}`,
  filesNotOpened: (count) => (count === 1 ? "One file could not be opened" : `${count} files could not be opened`),
  closeQuestionTitle: (name) => `Close “${name}”?`,
  closeQuestion: (heldCount, canSave) =>
    (heldCount === 1
      ? "You held a stretch here that no saved project holds. Without saving it is lost."
      : `You held ${heldCount} stretches here that no saved project holds. Without saving they are lost.`) +
    (canSave ? "" : " Saving as a project is only possible after cutting."),
  saveAndClose: "Save and close",
  dontSave: "Don't save",
  cancel: "Cancel",
  heldMore: (count) => `and ${count} more`,

  dropTitle: "Drop a recording here",
  dropSubtitle: "one recording, several, or a whole folder",
  dropHere: "Drop here",
  dropWhat: "A recording or a SmartTrim project",
  sectionRecording: "Recording",
  sectionSourceTracks: "Audio tracks",
  sectionSettings: "Settings",
  noRecordingOpen: "No recording open yet.",
  recordingFacts: ({ duration, width, height, fps, sourceTracks }) =>
    `${duration} · ${width}×${height} · ${fps} fps · ${sourceTracks} audio tracks`,
  openRecordingFirst: "Open a recording first.",

  headRole: "This track …",
  headExport: "To Premiere",
  sourceTrack: (number) => `Track ${number}`,
  roleTitle: (number) => `What track ${number} contributes to the cut`,
  roles: { ignored: "is ignored", voice: "decides the cut", content: "keeps moments" },
  exportTick: (number) => `Export track ${number} to Premiere`,
  soundHint: { none: " · no sound found", throughout: " · sound throughout", inPlaces: " · sound in places" },
  stopTrack: (number) => `Stop track ${number}`,
  playTrack: (number, minutes) => `Play track ${number} from the white line (at most ${minutes})`,
  waveformTitle: (number) => `Track ${number} · click sets the line, drag moves the view, the mouse wheel zooms`,
  hintChooseVoice: 'Set the track you speak on to "decides the cut". On the right, tick what should go to Premiere.',
  hintTickExport: "Tick at least one track on the right, or the Premiere project will have no sound.",
  hintMoments:
    'Everything loud enough on the deciding tracks is kept. "keeps moments" keeps the bangs alive where nobody speaks.',
  hintContent:
    "On the moments tracks, whatever clearly breaks out of its own baseline stays — explosions, fanfares, sudden silence.",
  hideEmpty: "Hide empty tracks",
  showEmpty: (hidden, exported) =>
    `Show ${hidden} empty ${hidden === 1 ? "track" : "tracks"} ` +
    (exported === 0
      ? `(${hidden === 1 ? "does" : "do"} not go to Premiere)`
      : `(${exported} of them ${exported === 1 ? "goes" : "go"} to Premiere)`),
  cutHint: (longest) =>
    "Green stays, dark red is cut out. Drag the white frame or click the strip to look elsewhere. A click in the " +
    `waveform sets the white line, ▶ plays the track from there, at most ${longest}.`,
  zoom: "View",
  skipRemoved: "Skip what is cut out while playing",
  hidePicture: "Hide picture",
  showPicture: "Show picture",
  pictureFailed: (reason) => `The picture of this recording cannot be shown here: ${reason}`,
  holdStart: "Hold from here",
  holdStartTitle: "Holds from the white line on",
  holdEnd: "Hold up to here",
  holdEndTitle: "Holds up to the white line",
  holdHint: "What is held always stays in the cut, whatever the sliders say.",
  remove: "remove",
  holdStartFirst: "Set the white line first: click the waveform, then “Hold from here”.",
  holdEndFirst: "Set the white line at the end first: click the waveform, then “Hold up to here”.",
  holdFailed: (reason) => `That could not be held: ${reason}`,
  holdEndWithStart: (start) => `Hold up to here (from ${start})`,
  heldRange: (from, to) => `Held: ${from} – ${to}`,

  preset: "Preset",
  ownSettings: "custom",
  changed: (name) => `${name} (changed)`,
  ownPresets: "Your own",
  presetSave: "save",
  presetSaveTitle: "Write the changes into this preset",
  presetNewTitle: "Make a preset of your own from the sliders as they are",
  presetDelete: "delete",
  presetNameLabel: "Name",
  presetNamePlaceholder: "e.g. Evening",
  presetAdd: "Add",
  yes: "Yes",
  overwriteAsk: (name) => `“${name}” already exists. Overwrite it?`,
  deleteAsk: (name) => `Delete “${name}”?`,
  presetSaveFailed: "The preset could not be saved",
  presetDeleteFailed: "The preset could not be deleted",
  presetsLoadFailed: "Your own presets could not be read",
  sliders: {
    threshold: { label: "Loudness from", small: "Anything quieter counts as a pause" },
    margin: { label: "Air at the cuts", small: "Kept before and after the sound" },
    deadZone: { label: "Remove pauses from", small: "Shorter pauses stay in" },
    eventLead: { label: "Lead before moments", small: "Kept before a bang" },
    eventTail: { label: "Tail after moments", small: "Kept after it" },
  },
  otherTabs: "Other tabs",
  takeOver: "Apply to all",
  takeOverTitle: "Apply these settings to every other tab",
  takeOverQuestionTitle: "Do all recordings have the same track layout?",
  takeOverQuestion: (name, others, withVideoLayers) =>
    `The sliders of “${name}” go to ${others === 1 ? "the other tab" : `the ${others} other tabs`}. ` +
    "Only if the tracks are laid out the same everywhere should the track roles and the Premiere ticks go along. " +
    "Recordings with a different number of tracks get no track roles either way. " +
    (withVideoLayers ? "The video tracks go along with either button, but only into recordings of the same aspect ratio. " : "") +
    "Held stretches stay where they are.",
  takeOverRoles: "With track roles",
  takeOverSliders: "Without track roles",
  onlySlidersTaken: (thisTracks, fromName, fromTracks) => {
    const tracks = (count: number) => (count === 1 ? "one track" : `${count} tracks`);
    return `Track roles left out: this recording has ${tracks(thisTracks)}, “${fromName}” has ${tracks(fromTracks)}.`;
  },
  takenOver: (what, fromName, others, videoLayersCarried) =>
    `${what === "slidersAndRoles" ? "Sliders and track roles" : "Sliders"}${videoLayersCarried ? " with video tracks" : ""} ` +
    `of “${fromName}” applied to ` +
    `${others === 1 ? "the other tab" : `${others} tabs`}. Held stretches stayed where they were.`,
  layerSetupStayedBehind: (fromName) =>
    `The video tracks of “${fromName}” did not come along: this recording has a different aspect ratio.`,

  sectionVideoLayers: "Video tracks",
  videoLayerLabel: (number) => `V${number}`,
  clipPremierePreset: "on the clip",
  nestPremierePreset: "on the nest",
  noPremierePreset: "no effect preset",
  premierePresetGone: (name) => `${name} (not in your list)`,
  startsSwitchedOff: "starts switched off",
  addVideoLayer: "+ Video track",
  removeVideoLayer: (number) => `Remove V${number}`,
  addPremierePresets: "Add Premiere effect presets …",
  premierePresetsHeading: "Premiere effect presets",
  deletePremierePreset: (name) => `Delete “${name}”`,
  premierePresetSummary: (carried, notCarried) =>
    `Carried over: ${carried.length > 0 ? countedNames(carried) : "nothing"}.` +
    (notCarried.length > 0 ? ` Not carried over: ${countedNames(notCarried)}.` : ""),
  uncarriedParameters: {
    motionAntiFlicker: "Anti-flicker Filter",
    motionCrop: "Crop",
    cropZoom: "Zoom",
    cropEdgeFeather: "Edge Feather",
  },
  notCarriedParameter: (effect, parameter) => `${effect} (${parameter})`,
  videoLayerPlaceLabel: (number, place) => `V${number}: effect preset ${place === "clip" ? "on the clip" : "on the nest"}`,
  videoLayerSwitchedOffLabel: (number) => `V${number} starts switched off`,
  premierePresetRefusals: {
    animated: "Refused: it changes over time, and an animation does not fit pieces that start elsewhere in the recording.",
    rotated: "Refused: it rotates the picture. How Premiere reads a rotation from the Premiere file is not settled yet.",
    nonUniformScale: "Refused: it stretches the picture one way only, but the Premiere file knows one size for both.",
    noVideoEffect: "Refused: it holds no video effect.",
    brokenValue: "Refused: a value in it is not a number.",
    unnamed: "Refused: the preset has no name.",
  },
  premierePresetFileEmpty: "Holds no Premiere effect preset.",
  premierePresetFileUnreadable: "Could not be read.",
  premierePresetsAdded: (count) =>
    count === 0 ? "No Premiere effect preset added" : count === 1 ? "One Premiere effect preset added" : `${count} Premiere effect presets added`,
  sequenceFrameNote: (width, height) => `The Premiere sequence will then be ${width} × ${height}.`,
  videoLayersNotWrittenYet:
    "SmartTrim does not write the video tracks into the Premiere file yet. That comes in one of the next versions.",
  premierePresetsLoadFailed: "The Premiere effect presets could not be read",
  premierePresetsAddFailed: "The Premiere effect presets could not be added",
  premierePresetDeleteFailed: "The Premiere effect preset could not be deleted",
  layerSetupRememberFailed: "The video tracks could not be remembered for the next recording",

  cut: "Cut",
  working: "Working …",
  cutAll: "Cut all",
  cutAllTitle: "Cut every tab with its own settings",
  cuttingCount: (counted) => `Cutting ${counted} …`,
  saveAll: "Save all Premiere files",
  savingCount: (counted) => `Saving ${counted} …`,
  saveAllHint: "Puts each Premiere file next to its recording and overwrites nothing.",
  settingChanged: "Setting changed – cut again.",
  replanning: "Replanning …",
  redeciding: "Recomputing …",
  replanFailed: "Replanning failed",
  redecideFailed: "Recomputing failed",
  jobLines: {
    scan: "Checking the tracks …",
    read: "Reading the tracks' sound …",
    projectAudio: "Reading the sound for the waveform …",
  },
  cutting: "Cutting …",
  readingOne: "Reading the track's sound …",
  readingCount: (done, total) => `Reading the tracks' sound … ${done} of ${total} done`,
  readingRecording: "Reading the recording …",
  scanFailed: "The tracks could not be checked",
  readFailed: "The track could not be read",
  projectAudioFailed: "The sound could not be read again",
  waveformFailed: "The waveform could not be drawn",
  cutFailed: "The cut failed",
  resultSentence: ({ total, kept, removedPercent }) => `Of ${total}, ${kept} remain – ${removedPercent} % are gone.`,
  resultNumbers: (pieces, removed) => `${pieces} pieces, ${removed} removed.`,
  savePremiere: "Save Premiere file …",
  savingFailed: "Saving failed",
  savedAt: (path) => `Saved: ${path}`,
  showInFolder: "Show in folder",
  saveProject: "Save project",
  saveProjectTitle: "Saves next to the recording – or into the project this tab came from",
  projectSavedAt: (path) => `Project saved: ${path}`,
  savedAsProject: "Saved as a project.",
  playFailed: "The sound could not be played",
  nothingKeptHere: "Everything here is cut out – zoom out to listen, or switch off “skip”.",
  because: (detail) => `Reason: ${detail}`,

  fileMissing: "The file no longer exists.",
  isFolder: "That is a folder, not a file.",
  notARecording: "That is not a recording. Neither picture nor sound could be read from it.",
  ffprobeSays: (detail) => `ffprobe reports: ${detail}`,
  cannotCut: "SmartTrim cannot cut this recording.",
  notAProject: "The project cannot be read.",
  projectRecordingMissing: "The recording of this project is no longer where it was when the project was saved.",
  lookedUnder: (path) => `Looked for it at: ${path}`,
  otherProjectOpened: "Not opened, because another project of the same recording is being opened.",
  openedAs: (name) => `Opened: ${name}`,
  projectRecordingChanged: "The recording of this project has changed since the project was saved; the cuts would no longer fit.",
  alreadyOpen: "Already open.",
  recordingsAlreadyOpen: (count) => `${count} recordings are already open.`,
  projectNotLoaded:
    "Not loaded, because its recording is already open in a tab. Close that tab first if you want to open the project.",
  filesFailed: "The files could not be opened.",
  notAFileHere: "That cannot be opened: it is not a file on this computer.",

  skipped: {
    skipNoVoice: "Skipped: no track is set to “decides the cut”.",
    skipNotCut: "Skipped: not yet cut with the current settings.",
    skipNoExport: "Skipped: no track is ticked for Premiere.",
  },
  nothingSavedYet: "Nothing is saved yet: use “Save all Premiere files” at the bottom for that.",
  cutAllHeading: ({ cut, alreadyCut, skipped, failed }) =>
    heading(
      "Cut all",
      [
        [cut, "cut"],
        [alreadyCut, "already cut"],
        [skipped, "skipped"],
        [failed, "failed"],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, words]) => `${count} ${words}`),
      "nothing to do",
    ),
  saveAllHeading: ({ saved, skipped, failed }) =>
    heading(
      "Save all Premiere files",
      [
        [saved, "saved"],
        [skipped, "skipped"],
        [failed, "failed"],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, words]) => `${count} ${words}`),
      "nothing to do",
    ),
  savedDot: "Saved.",
  folderIs: (folder) => `Folder: ${folder}`,

  loadingTool: (name, percent) => `Loading ${name} … ${percent} % (first start only)`,
  reloadingTool: (name, percent) => `Loading ${name} again … ${percent} %`,
  checkingTool: (name, percent) => `Checking ${name} … ${percent} %`,
  toolsMissing: "The tools are missing",

  updateLoading: (version, percent) => `Loading SmartTrim ${version} … ${percent} %`,
  updateReady: (version) => `SmartTrim ${version} is ready and will be installed when you close it.`,
  updateFailed: (version) => `SmartTrim ${version} could not be loaded – SmartTrim will try again later.`,
  restartNow: "Restart now",
  restartWaits: "Possible once nothing is running",
  restartLosesHeld: (tabCount) =>
    tabCount === 1
      ? "Held stretches in one tab are not saved – restarting loses them."
      : `Held stretches in ${tabCount} tabs are not saved – restarting loses them.`,
  restartAnyway: "Restart anyway",
  restartFailed: "The restart failed",
};

export const TEXTS: Record<Language, Texts> = { de, en };

/** Whether a saved value names a language the window speaks. */
export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * The language the window speaks: the one the user chose, if they chose one; else German on a German system and
 * English anywhere else (ADR-0030).
 */
export function languageOf(chosen: unknown, systemLanguage: string): Language {
  if (isLanguage(chosen)) return chosen;
  return systemLanguage.toLowerCase().startsWith("de") ? "de" : "en";
}

/** Numbers the way the language writes them: `1,5` in German, `1.5` in English. */
export function decimalsIn(texts: Texts): (value: number, digits: number) => string {
  return numbers(texts.locale);
}
