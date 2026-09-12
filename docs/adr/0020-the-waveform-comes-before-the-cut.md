# The waveform appears when a SourceTrack gets a role, not when the cut is pressed

Giving a SourceTrack a role — *danach schneiden* or *Momente behalten* — reads its audio at once and draws its
waveform. Until something is cut the waveform is plain, one colour on a neutral band: it is a preview of the sound,
not of a plan. Green and dark red arrive with the first cut and then follow every slider.

The owner asked for it after using the window: "sobald man die Spur aktiviert, dass man sie schneiden möchte, wird
eine Vorschau der Waveform gezeigt". They had also asked whether the waveform could follow the sliders — it already
did, but with nothing on screen before a cut there was nothing to see it happen on. Both halves were the same
request.

## The reading starts when the Recording is chosen, not when a role is given

The owner used it and asked for the wait to move earlier still: "kann man das Einlesen der ganzen Spuren schon im
Vorneherein machen? Also sobald ich die Datei eingefügt habe?" So every SourceTrack the scan found sound on is read
as soon as the scan finishes, while the user is still looking at the list. Giving a role afterwards costs nothing
at all.

**In the background, not behind a loading screen.** The owner chose this over a blocking screen: the window stays
usable — ticks, sliders, Presets — and a line says `Liest den Ton der Tonspuren … 2 von 5 fertig`. A loading screen
would take the app away for half a minute to do work that does not block any of it.

SourceTracks the scan found nothing on are skipped: reading silence costs the same time and memory as reading
sound. One that was misjudged as empty is still read on demand, the moment the user reveals it and gives it a role.

Choosing another Recording while a read is running makes that read refuse rather than file its audio under the new
Recording's positions.

### Measured, because the owner was promised a number

`bench/decode_speed.ts` on long-recording.mp4 (23.5 GB, 2.5 hours, six stereo SourceTracks) **from the slow external drive**:
**26.7 s for all six**, against 23.7 s from the internal SSD. The drive is not the bottleneck — ffmpeg is, and the
six run side by side. Each SourceTrack is 278 MB of PCM, so six are **1.7 GB held** for the session, with a peak
near 4 GB while decoding.

That peak is the real cost of reading everything up front, and it is why the empty SourceTracks are skipped.

## It costs nothing, because it is the same read

Reading one SourceTrack of a 2.5-hour Recording takes about a minute (ADR-0011). That minute was already being
spent, just later, behind the Schneiden button. Moving it earlier means:

- the user waits with something to look at instead of with a disabled window,
- the cut afterwards is almost instant, because its audio is already in memory,
- and ADR-0004's rule holds unchanged: **the Recording is read once**, not once for the picture and once for the cut.

`analyseRecording(request, tools, alreadyRead)` takes the SourceTracks that were read for the waveform and decodes
only what is missing. A reused SourceTrack that did not belong to the one being cut would quietly cut on the wrong
sound, so `runCut.test.ts` compares a cut built on audio read earlier against one that reads the file itself: same
CutPlan, same summary, and the very same PCM object — proof it was reused rather than read again.

## What is read is kept; what is drawn follows the role

`sourceTracksToRead(session, alreadyRead)` names the SourceTracks with a role that nobody has read yet. Taking a
role away does **not** throw the audio out: the user who tries a role for a moment and changes their mind would
otherwise pay the minute again. The waveform disappears from the row, the audio stays, and putting the role back
draws it instantly.

The main process holds that audio in a Map beside `chosen`, and empties it when another Recording is chosen — a
position in one Recording says nothing about the next.

## Schneiden stays pressable while a SourceTrack is being read

The owner chose this: you wait for the same minute either way, and a disabled button reads as "busy with something
else" when the app is doing exactly what you are about to ask for.

The cost is a race nobody has hit yet: pressing Schneiden while a waveform read is still in flight can read that
one SourceTrack twice, because the first read has not reached the Map yet. It wastes time, nothing else — the file
is only ever read, never written (ADR-0006), and both reads produce the same samples.

## Not tested, on purpose

The drawing, the progress line and the role dropdown, as with everything visible (ADR-0012). Tested are the two
rules that would be expensive to get wrong: which SourceTracks still need reading, and that a cut built on audio
read earlier is the same cut.
