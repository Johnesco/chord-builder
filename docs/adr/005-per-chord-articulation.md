# ADR-005: Per-chord articulation as a first-class field

**Status:** Accepted
**Date:** 2026-04-21

## Context

We needed to support more than "all notes simultaneously." Real chord-progression composition uses arpeggios, broken-chord patterns (Alberti bass), tremolo, and rolled chords. There were two natural places to attach this choice:

1. **Per-progression** (one articulation applies to all chords)
2. **Per-chord** (each chord carries its own articulation)

Per-progression would have been simpler but musically wrong — a real progression mixes block chords, arpeggios, and pattern-based figures freely within the same passage.

## Decision

Each chord carries:

- `articulation: 'block' | 'up' | 'down' | 'updown' | 'downup' | 'alberti' | 'tremolo' | 'random'`
- `stagger: number` (ms between note onsets or tremolo hits; 10–500)

| Value | Behavior |
|---|---|
| `block` | All notes at once |
| `up` / `down` | Ascending / descending arpeggio, staggered onsets |
| `updown` | Pyramid: `C-E-G` → `C-E-G-E-C` (top played once) |
| `downup` | Valley: `C-E-G` → `G-E-C-E-G` (bottom played once) |
| `alberti` | Classical 1-5-3-5 cycle; triad-only |
| `tremolo` | Full chord retriggered every `stagger` ms |
| `random` | Notes shuffled each playback |

The Alberti option is conditionally disabled in the editor when the chord isn't a triad. `chordToEvents()` (see ADR-006) double-guards by falling back to block playback for non-triad Alberti chords.

Sheet music attaches a per-articulation glyph: `ARPEGGIO_DIRECTIONLESS` (plain wavy line) for `up`/`updown`, `ROLL_DOWN` for `down`/`downup`, `Tremolo(3)` modifier for `tremolo`, italic "rand." annotation for `random`, no marker for `block` or `alberti` (the latter is a broken-chord pattern, not a roll).

## Consequences

**Wins**
- A single progression can mix block, arpeggio, and pattern-based articulations freely
- Each chord card shows its own articulation prefix (`↑`, `↓`, `≋`, `?`, etc.)
- Adding a new articulation is local: extend the enum, add a branch in `chordToEvents()`, optionally add a stroke in the sheet renderer

**Costs**
- More state per chord (extra fields to persist and migrate)
- Sheet notation can't perfectly represent every articulation — `updown` and `downup` reuse the dominant single-direction glyph as a best approximation
- A user changing notes might leave a non-triad chord with `articulation = 'alberti'`; we fall back to block playback rather than auto-revert, accepting that the card label can mislead until they pick a different articulation

**When to revisit:** if articulation grows into rhythmic patterns (Travis picking, waltz figures), per-chord articulation may not be enough — those are sequences across multiple chords. A separate "pattern" concept would be needed.
