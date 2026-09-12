import { PRESETS, type CutSession, type Preset } from "./cutSession.ts";

/**
 * The format number of the preset file, raised whenever a field is added that an older SmartTrim would drop. A file
 * from a newer version is refused rather than half read: saving over it would throw away what this version cannot
 * see, and unlike a project file this one holds settings the user built up over months.
 */
const FORMAT = 1;

const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);

/** Reads one Preset, refusing anything whose five settings are not all numbers. */
function presetFrom(value: unknown): Preset {
  if (typeof value !== "object" || value === null) throw new Error("Diese Voreinstellung ist unlesbar.");
  const each = value as Record<string, unknown>;
  const name = each["name"];
  if (typeof name !== "string" || name.trim() === "") throw new Error("Eine Voreinstellung hat keinen Namen.");
  for (const field of ["thresholdDbfs", "marginSeconds", "eventLeadSeconds", "eventTailSeconds", "minimumDeadZoneSeconds"]) {
    if (!isNumber(each[field])) throw new Error(`Der Voreinstellung ${name} fehlt ${field}.`);
  }
  return {
    name,
    thresholdDbfs: each["thresholdDbfs"] as number,
    marginSeconds: each["marginSeconds"] as number,
    eventLeadSeconds: each["eventLeadSeconds"] as number,
    eventTailSeconds: each["eventTailSeconds"] as number,
    minimumDeadZoneSeconds: each["minimumDeadZoneSeconds"] as number,
  };
}

/** Writes the user's own Presets as the text of the preset file. */
export function ownPresetsText(own: readonly Preset[]): string {
  // The format comes first so the file says what it is in its first line, as a `.smarttrim` project does.
  return JSON.stringify({ smarttrimPresets: FORMAT, presets: own }, undefined, 1);
}

/**
 * Reads the text of the preset file.
 *
 * Two kinds of damage, two answers. Text that is not a preset file — torn off mid-write, or something else
 * entirely — reads as no own Presets: there is nothing in it to rescue, and the user carries on with the built-in
 * three. A file that *is* one but whose contents are wrong is refused instead, because saving over it would
 * destroy Presets the user built up (ADR-0018).
 */
export function readOwnPresets(text: string): readonly Preset[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) return [];
  const file = parsed as Record<string, unknown>;
  const format = file["smarttrimPresets"];
  if (!isNumber(format)) return [];
  if ((format as number) > FORMAT) {
    throw new Error(
      `Diese Voreinstellungen stammen aus einer neueren SmartTrim-Version (Format ${format as number}, diese liest ${FORMAT}).`,
    );
  }
  const presets = file["presets"];
  if (!Array.isArray(presets)) throw new Error("Diese Datei enthält keine Voreinstellungen.");
  return presets.map(presetFrom);
}

/**
 * Refuses a name the user cannot have. The built-in three are the ground the user can always come back to, so they
 * are never overwritten; a blank name would sit in the dropdown as nothing at all.
 */
function checkName(name: string): void {
  if (name.trim() === "") throw new Error("Diese Voreinstellung braucht einen Namen.");
  if (PRESETS.some((built) => built.name === name)) {
    throw new Error(`${name} ist eine eingebaute Voreinstellung und kann nicht überschrieben werden.`);
  }
}

/**
 * Puts a Preset into the user's own ones. A name the user has already used is replaced where it stands, so that
 * saving twice under the same name leaves one Preset and does not reorder the list under the user's cursor.
 */
export function withPreset(own: readonly Preset[], preset: Preset): readonly Preset[] {
  checkName(preset.name);
  const at = own.findIndex((each) => each.name === preset.name);
  if (at === -1) return [...own, preset];
  return own.map((each, position) => (position === at ? preset : each));
}

/**
 * Reads the sliders as a Preset under the given name — what "Speichern unter …" hands to `withPreset`. All five
 * settings go in, including the two for ContentEvents that the window only shows next to a Content SourceTrack: a
 * Preset means the same five settings whatever happened to be on screen when it was saved. The name is checked
 * here so a refusal reaches the user before anything is written.
 */
export function presetFromSliders(session: CutSession, name: string): Preset {
  checkName(name);
  return {
    name,
    thresholdDbfs: session.thresholdDbfs,
    marginSeconds: session.marginSeconds,
    eventLeadSeconds: session.eventLeadSeconds,
    eventTailSeconds: session.eventTailSeconds,
    minimumDeadZoneSeconds: session.minimumDeadZoneSeconds,
  };
}

/**
 * Every Preset the user can pick, built-in ones first. The order is the dropdown's: the three the app ships with
 * are the ground to come back to, the user's own sit underneath in the order they were saved.
 */
export function allPresets(own: readonly Preset[]): readonly Preset[] {
  return [...PRESETS, ...own];
}

/** Takes one of the user's own Presets out of the list. The built-in three cannot be deleted (ADR-0018). */
export function withoutPreset(own: readonly Preset[], name: string): readonly Preset[] {
  if (PRESETS.some((built) => built.name === name)) {
    throw new Error(`${name} ist eine eingebaute Voreinstellung und kann nicht gelöscht werden.`);
  }
  if (!own.some((each) => each.name === name)) throw new Error(`Es gibt keine Voreinstellung namens ${name}.`);
  return own.filter((each) => each.name !== name);
}
