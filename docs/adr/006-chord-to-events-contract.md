# ADR-006: `chordToEvents()` as the single playback/export contract

**Status:** Accepted
**Date:** 2026-04-21

## Context

Three downstream consumers need to know "what notes does this chord play, when, and for how long?":

1. **Live playback** — schedules `triggerAttackRelease(...)` on the current sampler
2. **WAV offline render** — schedules the same calls inside `Tone.Offline`
3. **MIDI export** — emits `track.addNote({ name, time, duration })` records

Initially the articulation logic was inlined in each path. When we added the `updown` and `downup` articulations, we had to change three places and risked them drifting. When we added Alberti and tremolo, the cost was even higher.

## Decision

A single pure function:

```js
chordToEvents(chord) → [{ note, offsetSec, durationSec }, …]
```

Takes a chord and returns a flat list of timed note events relative to the chord's start. All articulation logic — block, up, down, updown, downup, alberti, tremolo, random — lives in this function. Stagger clamping, Alberti triad-fallback, and random shuffling all happen here.

Each consumer calls it and iterates:

- **Playback / WAV:** `events.forEach(e => synth.triggerAttackRelease(e.note, e.durationSec, startTime + e.offsetSec))`
- **MIDI:** `events.forEach(e => track.addNote({ name: e.note, time: t + e.offsetSec, duration: e.durationSec }))`

`scheduleChord(synth, chord, absoluteStartTime)` is a thin wrapper over the playback iteration.

## Consequences

**Wins**
- Adding a new articulation requires editing exactly one function
- The three outputs (audio, WAV, MIDI) are guaranteed consistent
- Unit-test-shaped — `chordToEvents` is pure and easy to reason about
- Edge cases (empty chord, single-note chord, non-triad Alberti) handle once

**Costs**
- Slight indirection — reading playback code requires understanding `chordToEvents` first
- Allocates a small array per chord per scheduling pass (negligible)

**When to revisit:** if a future articulation needs information `chordToEvents` doesn't have (e.g., context from neighboring chords for a comping pattern), the function signature has to grow or a multi-chord variant has to be added alongside.
