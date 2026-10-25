import { DOMParser, type Element } from "@xmldom/xmldom";

/** A point normalised to a frame: 0:0 is the top-left corner, 1:1 the bottom-right one. */
export interface NormalisedPoint {
  x: number;
  y: number;
}

/**
 * Premiere's Motion, as SmartTrim carries it: Position normalised to the frame the clip sits in, Anchor Point to the
 * clip itself.
 */
export interface Motion {
  position: NormalisedPoint;
  /** Percent. */
  scale: number;
  anchor: NormalisedPoint;
}

/** What SmartTrim carries of one Premiere effect preset into the XML (ADR-0033). */
export interface PremierePreset {
  name: string;
  motion: Motion;
  /** Percent of the clip's frame cut away on each side, or undefined when the preset has no Crop. */
  crop: { left: number; top: number; right: number; bottom: number } | undefined;
  /** The uniform scale of a Transform that folds into Motion, in percent; 100 when there is none. */
  transformScale: number;
  /** The effects that reach Premiere, in the order Premiere stacks them, named as the file names them. */
  carried: readonly string[];
  /** Effects, or parameters of carried ones, that do not reach Premiere. */
  notCarried: readonly NotCarried[];
}

/**
 * A parameter of a carried effect that FCP7 XML cannot hold. The file labels some of them in Premiere's language and
 * leaves others blank, so the window words them itself (ADR-0030).
 */
export type UncarriedParameter = "motionAntiFlicker" | "motionCrop" | "cropZoom" | "cropEdgeFeather";

/** An effect that does not reach Premiere, named as the file names it, or one parameter of an effect that does. */
export interface NotCarried {
  effect: string;
  parameter?: UncarriedParameter;
}

/** Why a PremierePreset is refused; the window words each reason itself (ADR-0030). */
export type PremierePresetRefusal = "animated" | "rotated" | "nonUniformScale" | "noVideoEffect" | "brokenValue";

export type PremierePresetReading =
  | { kind: "read"; premierePreset: PremierePreset }
  | { kind: "refused"; name: string; why: PremierePresetRefusal };

/** Motion as Premiere starts it: the clip centred, at full size. */
const MOTION_AT_REST: Motion = { position: { x: 0.5, y: 0.5 }, scale: 100, anchor: { x: 0.5, y: 0.5 } };

/** Every object in a .prfpset is one element with an ObjectID; the others point at it by ObjectRef. */
type Objects = ReadonlyMap<string, Element>;

function childElements(element: Element, name?: string): Element[] {
  const children: Element[] = [];
  for (let node = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.ELEMENT_NODE && (name === undefined || node.nodeName === name)) {
      children.push(node as Element);
    }
  }
  return children;
}

function child(element: Element, name: string): Element | undefined {
  return childElements(element, name)[0];
}

function childText(element: Element, name: string): string | undefined {
  return child(element, name)?.textContent ?? undefined;
}

function referenced(objects: Objects, element: Element | undefined): Element | undefined {
  const ref = element?.getAttribute("ObjectRef");
  return ref ? objects.get(ref) : undefined;
}

/** The value a parameter holds when it does not change over time: the second field of its StartKeyframe. */
function startValue(parameter: Element): string {
  return (childText(parameter, "StartKeyframe") ?? "").split(",")[1] ?? "";
}

function pointOf(value: string): NormalisedPoint {
  const [x, y] = value.split(":").map(Number);
  return { x: x ?? Number.NaN, y: y ?? Number.NaN };
}

/** The parameters of an effect component, in order; their Names are in Premiere's language and not used. */
function parametersOf(objects: Objects, component: Element): Element[] {
  const params = child(child(component, "Component") ?? component, "Params");
  return (params ? childElements(params, "Param") : [])
    .map((param) => referenced(objects, param))
    .filter((parameter) => parameter !== undefined);
}

/** One effect of a preset with its parameters' start values, in the order Premiere stacks them. */
interface Effect {
  matchName: string;
  displayName: string;
  /** Premiere saves a video effect as a VideoFilterComponent. */
  video: boolean;
  /** Whether any parameter changes over time: keyframes, or IsTimeVarying. */
  animated: boolean;
  value(id: number): string | undefined;
}

function effectOf(objects: Objects, component: Element): Effect {
  const parameters = parametersOf(objects, component);
  const byId = new Map(parameters.map((parameter) => [Number(childText(parameter, "ParameterID")), parameter]));
  return {
    matchName: childText(component, "MatchName") ?? "",
    displayName: (childText(child(component, "Component") ?? component, "DisplayName") ?? "").trim(),
    video: component.nodeName === "VideoFilterComponent",
    // Every parameter counts, also one whose ParameterID another parameter shares.
    animated: parameters.some(
      (parameter) =>
        childText(parameter, "IsTimeVarying") === "true" || (childText(parameter, "Keyframes") ?? "").trim() !== "",
    ),
    value: (id) => {
      const parameter = byId.get(id);
      return parameter ? startValue(parameter) : undefined;
    },
  };
}

const near = (value: number, expected: number) => Math.abs(value - expected) < 1e-6;
const nearPoint = (point: NormalisedPoint, x: number, y: number) => near(point.x, x) && near(point.y, y);

/** Whether a parameter holds something other than its default; one the file does not have is at its default. */
function awayFromDefault(effect: Effect, id: number, atDefault: string): boolean {
  const value = effect.value(id);
  if (value === undefined) return false;
  const number = Number(value);
  return Number.isNaN(number) ? value !== atDefault : !near(number, Number(atDefault));
}

/** For each parameter SmartTrim cannot write, the ParameterIDs it covers and their defaults. */
type UncarriedDefaults = Partial<Record<UncarriedParameter, Record<number, string>>>;

/** The parameters of a carried effect that SmartTrim cannot write, each named once when away from its default. */
function uncarriedParameters(effect: Effect, defaults: UncarriedDefaults): NotCarried[] {
  return (Object.entries(defaults) as [UncarriedParameter, Record<number, string>][])
    .filter(([, ids]) => Object.entries(ids).some(([id, atDefault]) => awayFromDefault(effect, Number(id), atDefault)))
    .map(([parameter]) => ({ effect: effect.displayName, parameter }));
}

/** Motion 7 Anti-flicker, 8 to 11 its hidden crop (left, top, right, bottom). */
const MOTION_UNCARRIED: UncarriedDefaults = {
  motionAntiFlicker: { 7: "0" },
  motionCrop: { 8: "0", 9: "0", 10: "0", 11: "0" },
};

/** Crop 5 Zoom, 6 Edge Feather. */
const CROP_UNCARRIED: UncarriedDefaults = { cropZoom: { 5: "false" }, cropEdgeFeather: { 6: "0" } };

function motionOf(effect: Effect): Motion {
  return {
    position: pointOf(effect.value(1) ?? "0.5:0.5"),
    scale: Number(effect.value(2) ?? 100),
    anchor: pointOf(effect.value(6) ?? "0.5:0.5"),
  };
}

/**
 * The scale of a Transform that only scales uniformly around the clip centre, or undefined for any other Transform.
 * AE.ADBE Geometry2: 1 Anchor Point, 2 Position, 3 Scale Height, 4 Scale Width, 5 Skew, 7 Rotation, 8 Opacity,
 * 11 Uniform Scale. With Uniform Scale on, Scale Width is ignored and may hold a stale value.
 */
function pureTransformScale(effect: Effect): number | undefined {
  const number = (id: number, fallback: number) => Number(effect.value(id) ?? fallback);
  const height = number(3, 100);
  const uniform = effect.value(11) !== "false";
  // A negative scale turns the picture over, which FCP's scale (0 to 1000) cannot say.
  const pure =
    height > 0 &&
    nearPoint(pointOf(effect.value(1) ?? "0.5:0.5"), 0.5, 0.5) &&
    nearPoint(pointOf(effect.value(2) ?? "0.5:0.5"), 0.5, 0.5) &&
    (uniform || near(number(4, 100), height)) &&
    near(number(5, 0), 0) &&
    near(number(7, 0), 0) &&
    near(number(8, 100), 100);
  return pure ? height : undefined;
}

function readingOf(objects: Objects, item: Element): PremierePresetReading | undefined {
  const base = child(item, "TreeItemBase");
  const filterPresetItem = referenced(objects, base && child(base, "Data"));
  const filterPresets = filterPresetItem && child(filterPresetItem, "FilterPresets");
  if (!base || !filterPresets) return undefined;
  const name = (childText(base, "Name") ?? "").trim();

  const allEffects: Effect[] = [];
  for (const entry of childElements(filterPresets, "FilterPreset")) {
    const component = referenced(objects, child(referenced(objects, entry) ?? entry, "Component"));
    if (component) allEffects.push(effectOf(objects, component));
  }
  // An audio effect saved along has nothing to do with the picture: it is neither named nor checked.
  const effects = allEffects.filter((effect) => effect.video);
  if (effects.length === 0) return { kind: "refused", name, why: "noVideoEffect" };
  // A keyframe sits at a time in the preset; on a piece that starts elsewhere in the Recording it means nothing.
  if (effects.some((effect) => effect.animated)) return { kind: "refused", name, why: "animated" };
  // No fixture shows how Premiere writes a rotated Motion, so it is refused rather than guessed (ADR-0008).
  const motionEffect = effects.findLast((effect) => effect.matchName === "AE.ADBE Motion");
  if (motionEffect && !near(Number(motionEffect.value(5) ?? 0), 0)) return { kind: "refused", name, why: "rotated" };
  // Motion 2 Scale, 3 Scale Width, 4 Uniform Scale: with the tick on, Scale Width is ignored and may be stale.
  if (
    motionEffect &&
    motionEffect.value(4) === "false" &&
    !near(Number(motionEffect.value(3) ?? 100), Number(motionEffect.value(2) ?? 100))
  ) {
    return { kind: "refused", name, why: "nonUniformScale" };
  }

  let motion = MOTION_AT_REST;
  let crop: PremierePreset["crop"];
  let transformScale = 100;
  const carried: string[] = [];
  const notCarried: NotCarried[] = [];
  // Premiere renders the standard effects in their order and Motion, a fixed effect, last. The imported Crop lands
  // first in the stack, and the user re-applies the whole PremierePreset on top of it, which adds its own Crop in its
  // own place. The two crop the same only if nothing comes before the Crop, so only a Crop at the top is carried.
  // A pure Transform scale folds into Motion wherever it sits: re-applying sets Motion back and adds it again.
  const standardEffects = effects.filter((effect) => effect.matchName !== "AE.ADBE Motion");
  for (const effect of effects) {
    if (effect.matchName === "AE.ADBE Motion") {
      motion = motionOf(effect);
      carried.push(effect.displayName);
      notCarried.push(...uncarriedParameters(effect, MOTION_UNCARRIED));
    } else if (effect.matchName === "AE.ADBE AECrop" && effect === standardEffects[0]) {
      const side = (id: number) => Number(effect.value(id) ?? 0);
      crop = { left: side(1), top: side(2), right: side(3), bottom: side(4) };
      carried.push(effect.displayName);
      notCarried.push(...uncarriedParameters(effect, CROP_UNCARRIED));
    } else if (effect.matchName === "AE.ADBE Geometry2" && pureTransformScale(effect) !== undefined) {
      transformScale = (transformScale * (pureTransformScale(effect) ?? 100)) / 100;
      carried.push(effect.displayName);
    } else {
      notCarried.push({ effect: effect.displayName });
    }
  }
  // A value that is no number would be saved as null and refused on the next start, taking the user's whole
  // library or project with it; it is refused here, where it came in.
  const numbers = [motion.position.x, motion.position.y, motion.scale, motion.anchor.x, motion.anchor.y, transformScale];
  if (![...numbers, ...(crop ? Object.values(crop) : [])].every(Number.isFinite)) {
    return { kind: "refused", name, why: "brokenValue" };
  }
  return { kind: "read", premierePreset: { name, motion, crop, transformScale, carried, notCarried } };
}

/**
 * Reads the text of a `.prfpset` file: one reading per effect preset in it, however deep in bins it sits. Text that
 * is not a Premiere preset file reads as none.
 */
export function readPremierePresets(text: string): readonly PremierePresetReading[] {
  let root: Element | null;
  try {
    // Premiere writes no byte-order mark, but a file re-saved by an editor may start with one.
    const xml = text.replace(/^﻿/, "");
    root = new DOMParser({ onError: () => {} }).parseFromString(xml, "text/xml").documentElement;
  } catch {
    return []; // xmldom throws on text with no element at all
  }
  if (!root || root.nodeName !== "PremiereData") return [];

  const objects = new Map<string, Element>();
  for (const element of childElements(root)) {
    const id = element.getAttribute("ObjectID");
    if (id) objects.set(id, element);
  }
  const readings: PremierePresetReading[] = [];
  for (const item of childElements(root, "TreeItem")) {
    const reading = readingOf(objects, item);
    if (reading) readings.push(reading);
  }
  return readings;
}
