# MinimumDeadZone is measured after Margin

A stretch without speech is removed only if what remains after keeping Margin on both sides still lasts at least the MinimumDeadZone. With a 2 s MinimumDeadZone and 0.3 s Margin, a 2.2 s pause leaves 1.6 s and stays in the edit; the pause must reach 2.6 s before anything is removed. At the start and end of the Recording, Margin is kept only on the side that has speech, and the rule is the same.

The owner chose this so the setting means what it says: nothing SmartTrim removes is ever shorter than the MinimumDeadZone, and a small setting cannot produce a string of removals a few frames long.

## Considered Options

- **Measure the raw pause, then keep Margin** — the 2.2 s pause qualifies and 1.6 s is removed. Removed stretches can then be arbitrarily short (a MinimumDeadZone below twice the Margin yields removals of a few frames), and the effective setting differs from the one the user sees.

## Consequences

The raw pause needed for a removal is MinimumDeadZone + 2 × Margin. Presets must pick their MinimumDeadZone with that in mind. This looks like an off-by-margin bug to anyone expecting the raw-pause ordering; it is deliberate.

The same measurement applies around ContentEvents, where EventLead and EventTail take the place of Margin, and beside a LockedRange, whose edges add no Margin at all.
