# ADR-007: VexFlow for sheet music with a grand-staff layout

**Status:** Accepted
**Date:** 2026-04-21

## Context

A printable sheet-music view of the progression is genuinely useful — for sharing, for practice, for export to PDF. Three approaches were viable:

1. **Roll our own SVG renderer** — full control but enormous scope (clefs, accidentals, ledger lines, beaming…)
2. **Image-based** (render to canvas, draw chord glyphs by hand) — limited fidelity
3. **Use a music-engraving library**

## Decision

Use **VexFlow v3** (CDN-loaded) for SVG rendering. Render layout as a **grand staff** rather than a single treble or bass stave:

- Each chord's notes split at middle C (MIDI 60). Notes at or above middle C render on the treble stave; below on the bass stave.
- Empty clefs get rests of matching duration so both staves stay time-aligned.
- Chord display names annotate the treble row only (not doubled on the bass) for a consistent top line of labels.
- A `Vex.Flow.StaveConnector` brace plus single-line connectors at each system's left and right edge tie the two staves visually.
- Within a system, `SHEET_MEASURES_PER_SYSTEM = 2` measures, separated by an internal `Vex.Flow.BarNote` so the formatter draws a bar line at the measure boundary.

Why grand staff and not single treble: most progressions span an octave or more around middle C. A single treble clef forces lots of ledger lines for bass notes; grand staff keeps both halves readable.

Why VexFlow v3 specifically: v4 changed several method signatures (`addAccidental` → `addModifier`, etc.) and we use the v3 API consistently throughout `buildStaveNoteForClef()`.

## Consequences

**Wins**
- Engraver-quality output in the browser
- SVG is native print-target — "Save as PDF" uses the OS print dialog, no extra library
- Accidentals, stems, beaming, rests, articulation glyphs (rolls, tremolo) all handled
- Each chord's articulation gets the appropriate stroke (see ADR-005)

**Costs**
- VexFlow library footprint (~400 KB)
- v3-specific API; an upgrade to v4 would touch every modifier call
- Chord durations crossing bar lines aren't tied across measures (v1 simplification — landed entirely in one measure)
- Long chords don't auto-split — a 5-beat chord in 4/4 produces a measure with 5 beats and the formatter spaces it accordingly

**When to revisit:** if we want correct cross-barline ties, key signatures, or chord-symbol notation (jazz lead-sheet style), a bigger pass through the VexFlow APIs is needed.
