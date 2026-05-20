# ADR-004: Chord duration in beats with BPM and time signature

**Status:** Accepted
**Date:** 2026-04-21

## Context

Initial data model stored each chord's duration as a number of **seconds** (`duration: 1.0`). This was convenient for the first cut — we could pass it straight to `triggerAttackRelease(notes, duration)` — but it didn't compose with downstream musical concepts:

- Sheet music wanted note values (whole, half, quarter) and bar lines based on a time signature
- MIDI export wanted tempo meta and time-signature meta
- A user thinking "two bars of Am" had to convert manually

Seconds are a *playback* unit, not a *musical* unit. Pinning the data model to playback locked us out of musical features.

## Decision

Switch `chord.duration` to **beats**, where 1 beat = a quarter note. Add two new pieces of state:

- `state.bpm` (default 120)
- `state.timeSignature: { num, den }` (default `{4, 4}`)

Playback seconds derive from beats via `beatsToSeconds(beats) = beats * (60 / state.bpm)`. All scheduling paths (live playback, `Tone.Offline` WAV render, MIDI `track.addNote`) convert at the boundary.

The sheet music renderer groups chords into measures using `state.timeSignature.num` as beats-per-measure (greedy fill, ties across barlines deferred), draws bar lines via `Vex.Flow.BarNote`, and maps each beat count to a VexFlow duration code (4 beats → whole, 2 → half, 1 → quarter, etc.).

MIDI export sets `midi.header.setTempo(bpm)` and pushes the time signature into `midi.header.timeSignatures`, so a DAW opens the file at the right tempo and bar layout.

### Migration

Existing localStorage entries had `duration` in seconds and no `bpm` field. `loadState()` detects the missing `bpm`, sets `state.bpm = 60`, and leaves the raw `duration` numbers untouched. At 60 BPM, "1 beat" = 1 second, so the audible playback timing of every saved progression stays identical post-migration. The unit shown in the UI changes, but the sound doesn't.

## Consequences

**Wins**
- BPM control changes tempo without re-editing every chord
- Time signature drives real bar lines on the sheet
- MIDI files carry proper tempo + time-sig meta
- Beat math composes with future features (swing, accent patterns, tuplets)

**Costs**
- Users have to think in beats, not seconds. Mitigated by a duration-preset dropdown (whole/half/quarter/eighth/sixteenth) and showing "N beats" on every chord card.
- Migration code in `loadState()` carries forward indefinitely
- Mixed time signatures (per-section) not supported — single global time-sig only

**When to revisit:** if we want mid-progression tempo or time-sig changes, the data model needs a per-section split.
