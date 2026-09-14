import type { BackgroundJob } from "./tabs.ts";

/** The languages the window speaks (ADR-0030). */
export type Language = "de" | "en";

export const LANGUAGES: readonly Language[] = ["de", "en"];

/** What the three file dialogs of the main process say; handed over with the request, so main holds no texts. */
export interface DialogTexts {
  readonly chooseRecordings: { readonly title: string; readonly recordings: string; readonly allFiles: string };
  readonly openProjects: { readonly title: string; readonly project: string };
  readonly savePremiere: { readonly title: string; readonly premiereProject: string };
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
  readonly takeOverQuestion: (name: string, others: number) => string;
  readonly takeOverRoles: string;
  readonly takeOverSliders: string;
  readonly onlySlidersTaken: (thisTracks: number, fromName: string, fromTracks: number) => string;
  readonly takenOver: (what: "slidersAndRoles" | "sliders", fromName: string, others: number) => string;

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

  // The first start
  readonly loadingTool: (name: string, percent: number) => string;
  readonly toolsMissing: string;
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
  takeOverQuestion: (name, others) =>
    `Die Regler von „${name}“ gehen an ${others === 1 ? "den anderen Tab" : `die ${others} anderen Tabs`}. ` +
    "Nur wenn die Tonspuren überall gleich belegt sind, sollen auch die Tonspur-Rollen und die Premiere-Häkchen mit. " +
    "Aufnahmen mit einer anderen Zahl an Tonspuren bekommen so oder so nur die Regler. Festgehaltene Stellen bleiben, wo sie sind.",
  takeOverRoles: "Regler und Tonspur-Rollen",
  takeOverSliders: "Nur Regler",
  onlySlidersTaken: (thisTracks, fromName, fromTracks) => {
    const tracks = (count: number) => (count === 1 ? "eine Tonspur" : `${count} Tonspuren`);
    return `Nur die Regler übernommen: Diese Aufnahme hat ${tracks(thisTracks)}, „${fromName}“ hat ${tracks(fromTracks)}.`;
  },
  takenOver: (what, fromName, others) =>
    `${what === "slidersAndRoles" ? "Regler und Tonspur-Rollen" : "Regler"} von „${fromName}“ in ` +
    `${others === 1 ? "den anderen Tab" : `${others} Tabs`} übernommen. Festgehaltene Stellen sind geblieben.`,

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
  toolsMissing: "Die Werkzeuge fehlen",
};

const en: Texts = {
  locale: "en-US",
  dialogs: {
    chooseRecordings: { title: "Choose recordings", recordings: "Recordings", allFiles: "All files" },
    openProjects: { title: "Open SmartTrim projects", project: "SmartTrim project" },
    savePremiere: { title: "Save Premiere file", premiereProject: "Premiere project (FCP7 XML)" },
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
  takeOverQuestion: (name, others) =>
    `The sliders of “${name}” go to ${others === 1 ? "the other tab" : `the ${others} other tabs`}. ` +
    "Only if the tracks are laid out the same everywhere should the track roles and the Premiere ticks go along. " +
    "Recordings with a different number of tracks get the sliders only either way. Held stretches stay where they are.",
  takeOverRoles: "Sliders and track roles",
  takeOverSliders: "Sliders only",
  onlySlidersTaken: (thisTracks, fromName, fromTracks) => {
    const tracks = (count: number) => (count === 1 ? "one track" : `${count} tracks`);
    return `Sliders only: this recording has ${tracks(thisTracks)}, “${fromName}” has ${tracks(fromTracks)}.`;
  },
  takenOver: (what, fromName, others) =>
    `${what === "slidersAndRoles" ? "Sliders and track roles" : "Sliders"} of “${fromName}” applied to ` +
    `${others === 1 ? "the other tab" : `${others} tabs`}. Held stretches stayed where they were.`,

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
  toolsMissing: "The tools are missing",
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
