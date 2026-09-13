import { canCut, canExport, redoNeeded, type CutSession } from "./cutSession.ts";

/**
 * What "Alle schneiden" does with one Tab when its turn comes: cut it, leave the cut it already has, or pass it over
 * because no SourceTrack decides the cut. It only cuts — saving is "Alle Premiere-Dateien speichern" (ADR-0026).
 */
export type CuttingAllStep = "cut" | "nothing" | "skipNoVoice";

/**
 * Whether the window holds a cut for this Tab that matches its settings. `hasCut` comes from the window: a cut that was
 * refused leaves the settings it was asked with behind, so the session alone cannot tell.
 */
function cutIsCurrent(session: CutSession, hasCut: boolean): boolean {
  return hasCut && redoNeeded(session) === "nothing";
}

/** What cutting all Tabs does with this one, on its own settings as they stand at its turn (ADR-0026). */
export function cuttingAllDoes(session: CutSession, hasCut: boolean): CuttingAllStep {
  if (!canCut(session)) return "skipNoVoice";
  // Cutting again would read nothing new and give the same plan.
  return cutIsCurrent(session, hasCut) ? "nothing" : "cut";
}

/** What "Alle Premiere-Dateien speichern" does with one Tab: save its Premiere file, or pass it over with the reason. */
export type SavingAllStep = "save" | "skipNotCut" | "skipNoExport";

/**
 * What saving all Premiere files does with this Tab (ADR-0026). It never cuts: a file written from a cut that does not
 * match the settings on screen would not be the edit the user is looking at.
 */
export function savingAllDoes(session: CutSession, hasCut: boolean): SavingAllStep {
  if (!cutIsCurrent(session, hasCut)) return "skipNotCut";
  // A sequence without a single SourceTrack would look like an edit that lost its sound.
  return canExport(session) ? "save" : "skipNoExport";
}

/** What "Für alle übernehmen" hands over: the sliders alone, or the sliders and what each SourceTrack does. */
export type TakenOver = "sliders" | "slidersAndRoles";

/**
 * The settings of the Tab on screen, taken over into another Tab (ADR-0026). The sliders always come, with the Preset
 * they belong to. What each SourceTrack does — its role, and whether it goes to Premiere — comes only when asked for
 * and only into a Recording with as many SourceTracks: SourceTrack 5 of a six-track OBS capture is not SourceTrack 5
 * of a phone video. Held stretches never come: they are moments of one Recording.
 *
 * `rolesLeftOut` is true when the roles were asked for and could not come, so the window can say why that Tab differs.
 */
export function settingsCopied(
  from: CutSession,
  to: CutSession,
  what: TakenOver,
): { session: CutSession; rolesLeftOut: boolean } {
  const sliders: CutSession = {
    ...to,
    selectedPreset: from.selectedPreset,
    thresholdDbfs: from.thresholdDbfs,
    marginSeconds: from.marginSeconds,
    eventLeadSeconds: from.eventLeadSeconds,
    eventTailSeconds: from.eventTailSeconds,
    minimumDeadZoneSeconds: from.minimumDeadZoneSeconds,
  };
  if (what === "sliders") return { session: sliders, rolesLeftOut: false };

  const layoutMatches =
    from.recording !== null &&
    to.recording !== null &&
    from.recording.sourceTracks.length === to.recording.sourceTracks.length;
  if (!layoutMatches) return { session: sliders, rolesLeftOut: true };

  const listenTo = [...from.listenTo];
  const contentSourceTracks = [...from.contentSourceTracks];
  // A SourceTrack with a role decides what is kept, so it must not stay hidden as an EmptyTrack in this Tab.
  const roleOnHidden = [...listenTo, ...contentSourceTracks].some((position) => to.scan?.[position]?.carriesSound === false);
  return {
    session: {
      ...sliders,
      listenTo,
      contentSourceTracks,
      exportSourceTracks: [...from.exportSourceTracks],
      emptySourceTracksShown: to.emptySourceTracksShown || roleOnHidden,
    },
    rolesLeftOut: false,
  };
}
