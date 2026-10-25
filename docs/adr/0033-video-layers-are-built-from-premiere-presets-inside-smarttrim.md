# A Recording can be exported as several VideoLayers, each a Nest dressed by PremierePresets set up in SmartTrim

Some of the owner's colleagues record 32:9: the game fills the left 16:9 half, the facecam the right one. In Premiere
they work with three copies of the picture: V1 shows the game half filling the frame, V2 a small facecam in the
bottom-left corner, V3 the facecam large, switched on only where it is wanted. Each copy carries a Premiere effect
preset, and each is nested. Done by hand after SmartTrim's cut, that means duplicating and dressing every KeepSegment
one by one. SmartTrim now writes that arrangement itself. Decided with the owner on 2026-10-25; what is built so far
is listed at the end, and writing the XML waits for fixture 5 (see Fixtures).

What the owner decided:

- Each Tab gets a section **"Videospuren"** ("Video tracks"). V1 is always there; "+ Videospur"
  adds another VideoLayer, as many as wanted. Each VideoLayer has two places for a PremierePreset, both optional: the
  **clip PremierePreset**, on the one clip of the whole Recording inside its Nest, and the **Nest PremierePreset**, on
  every piece of the Nest on the timeline. And a tick **"startet ausgeschaltet"**.
- PremierePresets ("Premiere-Vorgaben", "Premiere effect presets") are added from `.prfpset` files and managed like
  own Presets: added, deleted, kept across restarts. On adding, SmartTrim says which of their effects it carries into
  Premiere and which not; a PremierePreset with animation is refused, with the reason.
- The LayerSetup is remembered per aspect ratio: the next 32:9 Recording starts with the last 32:9 LayerSetup. It is
  saved in the TrimProject, and "Für alle übernehmen" carries it into every Tab of the same aspect ratio, with either
  button.
- Without a LayerSetup the export stays exactly as before. The picture in the window keeps showing the whole Recording
  (ADR-0028); the composed result is seen only in Premiere.
- With a LayerSetup on a Recording wider than 16:9 the sequence is 16:9 (below). 9:16 for shorts is left out for now.

## Everything is set up in SmartTrim, not taken from a template exported by Premiere

The first proposal was a template: build the arrangement once in Premiere on a short clip, export it as XML, and let
SmartTrim copy its tracks, Nests and effect blocks. The owner agreed, then withdrew it on seeing the whole picture: "ich
möchte nicht erstmal den Aufbau in Premiere haben, um dann es in die App reinzupacken, um dann wieder die XML
rauszubekommen". Reading the PremierePresets also sees more: a template holds only what survived Premiere's XML export
(Premiere writes an "FCP Translation Report" beside it, but none was found beside the owner's exports), while the
`.prfpset` holds every effect, so SmartTrim can name what does not reach Premiere.

## The Nest comes first, then the cut

Every VideoLayer becomes a Nest holding the whole uncut Recording once, with the clip PremierePreset on that one clip.
The timeline holds one piece per KeepSegment per VideoLayer: a clipitem of the Nest with the KeepSegment's in and out.
This is the owner's own order (duplicate, apply, nest, then cut) with SmartTrim doing the cut. It keeps handles:
pulling a piece's edge in Premiere brings back what was removed. And an effect that does not travel through the XML is
applied once inside the Nest instead of once per KeepSegment. Rejected: cutting first and nesting after, which leaves
one long block per VideoLayer and loses the handles.

## SmartTrim carries Motion, Crop and a pure Transform scale

Adobe's page "Importing XML files from Final Cut Pro 7 and Final Cut Pro X" lists what Premiere takes from FCP7 XML:
basic motion and opacity, and the filters Crop, the Eight- and Four-Point Garbage Mattes, Gaussian Blur, Luma Key and
the Three-Way Color Corrector; it exports the same set. SmartTrim translates only what a fixture shows: Basic Motion and
Crop. The owner's RAWCUT - V2 holds Crop, Roughen Edges, two Drop Shadows, Transform and Motion; Premiere's own export
of it (`fixtures/premiere/video-layers/3-presets-applied.xml`) writes Basic Motion and Crop and nothing else.

- **Crop** is carried only when it is the first standard effect in the stack. The imported Crop always lands first,
  and when the user re-applies the whole PremierePreset on top (below), its own Crop lands in its own place: the two
  cut the same only if nothing comes before the Crop. A Crop further down, or a second Crop, is named instead. RAWCUT -
  V2 has its Crop first.
- **Transform** (`AE.ADBE Geometry2`) folds into Motion's scale when it is a pure uniform scale around the clip
  centre: anchor and position 0.5:0.5, a positive scale (a negative one turns the picture over), equal height and width
  or Uniform Scale on, no skew, no rotation, opacity 100. It folds wherever it sits, because Premiere renders the
  standard effects first and Motion last, and re-applying the PremierePreset sets Motion back and adds the Transform
  again. Several pure Transforms multiply. RAWCUT - V2 has one at 90 %. Its parameter IDs: 1 Anchor Point, 2 Position,
  3 Scale Height, 4 Scale Width, 5 Skew, 6 Skew Axis, 7 Rotation, 8 Opacity, 11 Uniform Scale.
- **Everything else** (here Roughen Edges and the Drop Shadows; for any PremierePreset also Opacity and the filters
  above until a fixture shows them) is named when the PremierePreset is added, together with what is carried. A
  parameter of a carried effect that FCP7 XML cannot hold is named as a code the window words (Motion's anti-flicker
  and hidden crop, Crop's Zoom and Edge Feather), because the file labels some of them in Premiere's language and
  leaves Crop's Zoom blank. Audio effects saved into a PremierePreset are left alone: neither named nor checked for
  animation. After the export SmartTrim reminds the user to drag a clip PremierePreset with such effects once onto the
  clip inside that Nest. That sets Motion back to the preset's own values (RAWCUT - V2: scale 100) and adds Transform
  90 % again, so the size stays; the second Crop with the same percentages should change nothing. Neither is tested
  yet.
- A **Nest PremierePreset** with such effects is allowed too (owner, 2026-10-25). It sits on every piece, so the
  reminder asks the user to select all pieces of that VideoLayer and drop the PremierePreset onto one of them: Adobe's
  help "Apply effect presets" says a preset dropped onto a clip that is part of the selection goes to every selected
  clip. The owner's EDIT - V2 45 is Motion only and never needs it.
- Writing such effects under their Premiere match names would be undocumented; Apple only says an importer "may use a
  generic proxy effect". Not done.

### Reading a `.prfpset`

The real value of a parameter is the second field of `StartKeyframe`. `CurrentValue` is unreliable: RAWCUT - V1 stores
Scale 100 with `CurrentValue` 0. Parameter names are localised ("Skalieren"), so parameters are keyed by the effect's
`MatchName` and the parameter's `ParameterID`.

- `AE.ADBE Motion`: 1 Position, 2 Scale, 3 Scale Width, 4 Uniform Scale, 5 Rotation, 6 Anchor Point, 7 Anti-flicker,
  8 to 11 its hidden crop.
- `AE.ADBE AECrop`: 1 left, 2 top, 3 right, 4 bottom, in percent of the clip's frame, copied 1:1 into the FCP Crop
  filter (written `left`, `right`, `top`, `bottom`); 5 Zoom and 6 Edge Feather have no FCP counterpart.
- `StartKeyframe` matches the panel for Scale, Rotation and the Crop percentages. Position and Anchor Point are stored
  normalised, as a point `x:y`, where the panel shows pixels. Other effects store internal units (Drop Shadow opacity:
  255 stored, 100 shown).
- A non-empty `<Keyframes>` or `IsTimeVarying` true is animation and refused: a keyframe at a time in the preset means
  nothing on a piece that starts elsewhere.

### Converting Motion

S is the frame the clip sits in, C the clip's own unscaled frame: for the clip inside a Nest, S is the Nest frame and C
the Recording; for a piece on the timeline, S is the sequence frame and C the Nest frame. Position is normalised to S,
Anchor Point to C. Premiere writes:

```
centerOffset = anchor - 0.5
center       = (position * S - S/2) / C - centerOffset
scale        = Scale
```

It reproduces every Basic Motion block with the anchor at the clip centre to the printed digit (clipitems 23 to 25 in
`3-presets-applied.xml`, 31, 33 and 35 in `4-nested.xml`); dividing by S instead of C would not:

| Case | S / C | Position | Written center |
|---|---|---|---|
| RAWCUT - V1 | 1920x1080 / 3840x1080 | 0.99999999666, 0.50000005570 | 0.25, 5.56989e-08 |
| RAWCUT - V2 | same | -0.15625, 0.5185185075 | -0.328125, 0.0185185 |
| RAWCUT - V3 | same | 3.74e-08, 0.49999999565 | -0.25, -4.34723e-09 |

The one fixture with a moved anchor contradicts it: EDIT - V2 45 on the V2 Nest (clipitem-32: position about 0:1,
anchor about 0:1, scale 45) should give center 0 / 0 and is written as 0 / -1. Read back with the formula, that would
place the small facecam above the frame. No linear model fits both this and the only other moved-anchor export found,
a Premiere Pro 2018 export described in a comment on OpenTimelineIO issue 253 (it gives its frame as both 3200x1600 and
3200x1800; only 1800 reproduces its numbers).

SmartTrim therefore never writes a moved anchor. It computes where the clip centre lands and writes that with
`centerOffset` 0:

```
center = (position * S - S/2) / C + (0.5 - anchor) * motionScale/100
scale  = motionScale * transformScale/100
```

For EDIT - V2 45 that is -0.275 / 0.275: a 864x486 picture from x 0 to 864 and y 594 to 1080, the footprint of the
original. The anchor term uses Motion's own scale; a folded Transform scale enters only `scale`. The cost: in Premiere
the picture then scales around its centre, not its corner. Refused until a fixture shows them: Rotation other than 0,
and Uniform Scale off with Scale Width different from Scale (FCP's Basic Motion has one scale).

## The sequence frame is 16:9 at the Recording's height

The PremierePresets are built for a 16:9 sequence. With a LayerSetup on a Recording wider than 16:9 (width × 9 >
height × 16), the sequence and every Nest are 16:9 at the probed height, the width rounded to the nearest even number:
3840x1080 gives 1920x1080, 5120x1440 gives 2560x1440. Never a hardcoded size. Otherwise both stay the Recording's frame.
Because Position is normalised to the sequence and center to the clip, the same PremierePresets fit every Recording of
the same aspect ratio.

## What the XML looks like

- **Nests.** The first clipitem using a Nest carries the full `<sequence id="sequence-N">`, every later one
  `<sequence id="sequence-N"/>`. Apple's id convention implies the full definition comes first; OpenTimelineIO's
  `premiere_example.xml`, a Premiere export, shows such a reference, but only for the audio clipitems of one placement,
  never for several video clipitems with their own in and out. That is exactly this design, so it waits for fixture 5.
- Inside a Nest the Recording's clip starts at frame 0 with in 0, so Nest time is Recording time and each piece's in
  and out are the KeepSegment's position in the Recording. The clip sits on the Nest's first video track. Premiere
  keeps the original track index instead (the V3 Nest in `4-nested.xml` has empty tracks 1 and 2 and its clip on
  track 3) and writes duration 0 for two of the three Nests; SmartTrim writes the true length. Premiere also gives
  every Nest two empty stereo audio TimelineTracks; whether SmartTrim needs them, fixture 5 and the import show.
- The audio stays on the main timeline as before, with Channels counted as ADR-0008 requires, not Premiere's 1, 1, 2,
  2 that the video-layers fixtures repeat.
- A VideoLayer without a clip PremierePreset still gets an explicit Basic Motion (scale 100, center 0), so Premiere's
  media-scaling preference cannot step in.
- **Switched off.** The tick writes `<enabled>FALSE</enabled>` on that VideoLayer's piece of every KeepSegment, as
  `4-nested.xml` does for V3. The user switches single pieces on in Premiere.
- **Links.** ADR-0008 links every clip of a KeepSegment to all the others. Premiere's own exports never put a
  duplicate or a video Nest clipitem into a link group: in `2-duplicated.xml` V2 and V3 carry no links, and in
  `4-nested.xml` no Nest piece is linked, the audio only among itself. Premiere's interface links one video clip to
  several audio clips (Adobe help "Link multiple audio clips"). The owner's decision: SmartTrim writes the first of
  these that Premiere itself writes in fixture 5 — everything of a KeepSegment; V1's piece with the audio; the audio
  among itself. The second gives up linked moving for V2 and V3, the third for every VideoLayer.

## Words

The window says "Videospuren" / "Video tracks", mirroring "Tonspuren" / "Audio tracks", and "Premiere-Vorgaben" /
"Premiere effect presets". "Voreinstellung" stays SmartTrim's Preset, and in code a PremierePreset is always
`premierePreset`, never `preset`. "Spuren-Vorlage" and "Video-Vorlage" were proposed and dropped: "Spur" alone in the
window means a SourceTrack, and the English window already says "track layout" for how SourceTracks are laid out.

## Where it is kept

The PremierePresets and the remembered LayerSetups live together in `videoLayers.json` in the user data folder, not in
`presets.json`: a new field there would force its format 2 and lock older SmartTrims out of the owner's own Presets
(ADR-0018). It follows ADR-0018: written beside and renamed into place, a torn file read as empty, a newer or damaged
one refused.
The TrimProject goes to format 4 for a LayerSetup; a project without one is still written as format 3, so older
SmartTrims keep opening it.

## Chosen here, not asked

Smaller decisions taken while writing this down; the owner can overrule any of them.

- A Tab has a LayerSetup once it has more than V1, or V1 carries a PremierePreset or the tick. The "Videospuren"
  section sits in the right column below "Einstellungen", beside the other choices about the Premiere file.
- Deleting a PremierePreset does not ask first, unlike an own Preset: nothing is lost, since every Tab, remembered
  LayerSetup and project keeps its own copy, and adding the `.prfpset` again brings it back. A double click deletes
  one, not two.
- "Für alle übernehmen" names its two buttons "Mit Tonspur-Rollen" and "Ohne Tonspur-Rollen" ("With track roles",
  "Without track roles"), since both now carry more than the sliders; the question mentions the video tracks only
  when the Tab on screen has a LayerSetup, and handing one out makes it the remembered one of its shape.
- Changes to `videoLayers.json` from the window run one after another in the main process, so two close together
  (a double click) can neither lose one nor tear the file.
- A PremierePreset is kept as its name and parsed values, never as a path to the user's file. A LayerSetup and a
  TrimProject keep their own copy of the values, so deleting a PremierePreset only takes it out of the list.
- A `.prfpset` holding several presets adds all of them; one with no video effect is refused. Names are trimmed (the
  fixture's is "RAWCUT - V2 "); the same name again replaces in place, as ADR-0018 does for Presets. The window shows
  effect names as the file has them (`DisplayName`, in Premiere's language): data, not texts (ADR-0030). A `.prfpset`
  dropped on the window is added like one chosen with the button (ADR-0024).
- Motion 7 to 11 and Crop 5 and 6 away from their defaults are named as not carried, like Opacity. (`3-presets-applied`
  writes Basic Motion's own `antiflicker` and crop fields, all 0; whether Premiere reads them back is unknown.)
- The aspect ratio is the exact reduced width:height of the probed frame. The remembered LayerSetup follows every
  change, the last change in any Tab wins, and V1 alone without PremierePreset or tick is remembered as none. A
  format-3 project opens with no LayerSetup, as it was saved; a reopened Recording whose aspect ratio no longer matches
  its LayerSetup drops it with a note.
- "Für alle übernehmen" tells Tabs of another aspect ratio that the LayerSetup stayed behind, like `onlySlidersTaken`.
  A Tab without a LayerSetup hands over none: taking over the sliders never wipes out one built in another Tab.
- A PremierePreset holding a value that is no number (a Position without its second coordinate, say) is refused when
  it is added: saved, it would come back as null and take the whole library or project down with it.
- The LayerSetup belongs to the CutSession, like the export ticks. Changing it changes the file, never the CutPlan, so
  no new cut is needed (ADR-0014).
- VideoLayer rows other than V1 can be removed; they cannot be reordered yet. Nests are named after the Recording and
  the VideoLayer ("Name V2"); their sequence ids follow the main sequence's.
- The reminder after the export appears where the save is reported, for one Tab and for all; its sentences go into
  `texts.ts` in both languages, as do every new label and the changed "Für alle übernehmen" question.

## Fixtures

`fixtures/premiere/video-layers/` holds the owner's four exports of their manual steps on a 5-second 3840x1080
Recording in a 1920x1080 sequence (`1-raw`, `2-duplicated`, `3-presets-applied`, `4-nested`) and the four
PremierePresets (`raw-v1`, `raw-v2`, `raw-v3`, `edit-v2-45`). Only the Recording's name and path were replaced. Like
every fixture they show what Premiere writes, not what it reads.

Missing before building: **fixture 5**. The owner splits the `4-nested` sequence twice through every video track and
TimelineTrack, removes the middle piece and closes the gap, links each remaining piece as far as Premiere allows, and
exports it from the original project. It shows how Premiere writes several pieces of one Nest and whether it links
them. Asked for on 2026-10-25.

## To be tested

- The conversion against the three table rows, EDIT - V2 45 against -0.275 / 0.275, and the Transform fold.
- The `.prfpset` reader against the four fixture presets, including what it names as not carried for RAWCUT - V2.
- The XML against `4-nested.xml` and fixture 5; without a LayerSetup, the existing export tests unchanged.
- A checked-in format-3 `.smarttrim` that opens with no LayerSetup, as ADR-0016 does for format 1.

## Built so far

- `src/export/premierePreset.ts`: reads a `.prfpset` into PremierePresets or refusals, with what is carried and
  what not. Tested against the four fixture presets and variants of them.
- `src/export/videoLayerMotion.ts`: the Basic Motion a clip gets, including the centre-anchored encoding and the
  folded Transform. Tested against the centres in `3-presets-applied.xml` and worked examples.
- `src/export/layerSetup.ts`: the VideoLayer, when a Tab has a LayerSetup, the sequence frame, the aspect-ratio key,
  and reading VideoLayers back from a file.
- The CutSession's `videoLayers` with "+ Videospur", removing and changing one; saved in and reopened from the
  TrimProject (format 4, format 3 without a LayerSetup); carried by "Für alle übernehmen" (`src/app/allTabs.ts`).
- `src/app/videoLayerLibrary.ts` and `videoLayerStore.ts`: the PremierePresets and remembered LayerSetups in
  `videoLayers.json`. Choosing a Recording of another shape drops the Tab's LayerSetup.
- `fixtures/trimproject/version-3.smarttrim`: a project as SmartTrim wrote it before VideoLayers, which must keep
  opening with no LayerSetup.
- The window: the "Videospuren" section (`drawVideoLayers` in `src/renderer/renderer.ts`), adding `.prfpset` files
  through a dialog (`addPremierePresetFiles`, IPC `premierePresets:add`) and deleting them, a new Tab of a Recording
  starting with the remembered LayerSetup (`takeVideoLayers`), and the note when "Für alle übernehmen" leaves one
  behind. Until the XML is written, the section says plainly that the Premiere file does not have the video tracks
  yet. The window glue is untested by design (ADR-0012); it was checked in the built app over CDP with a generated
  3840x1080 Recording and a throwaway user-data folder, except the file dialog itself, which only a real click opens.

Not built yet: writing the XML (waits for fixture 5) and with it the reminder after the export; adding a `.prfpset`
by dropping it on the window; dropping the LayerSetup of a reopened project whose Recording changed shape.

## Consequences

- ADR-0008 is amended for a LayerSetup. Beyond a sequence frame other than the Recording's, filters, Nests and the link
  fallback, SmartTrim writes things no fixture shows or that differ from what Premiere writes: the centre-anchored
  encoding of a moved anchor, the folded Transform scale, the clip on the Nest's first video track, the true Nest
  length, and frames other than 1920x1080. Each is written pending the import check below rather than refused.
- ADR-0025 and ADR-0026 are amended: a new Tab can start with the remembered LayerSetup of its aspect ratio, and "Nur
  Regler" carries the LayerSetup too, so that button's label and question change.
- Passing tests prove nothing about the import. The owner must import a SmartTrim export with a LayerSetup and check:
  the small facecam sits bottom-left (the moved-anchor encoding), V3 arrives switched off, Crop and the Transform scale
  arrive, a VideoLayer without PremierePreset shows the picture at 100 %, and how far the links hold.
- The release carrying this gets a new version number.
