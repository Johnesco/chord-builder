# ADR-002: Tone.js as the audio engine

**Status:** Accepted
**Date:** 2026-04-21

## Context

The app needs to play chords with precise timing, support polyphony, render audio offline (for WAV export), schedule articulation patterns, and accommodate multiple instrument timbres. Doing this directly against the Web Audio API is possible but verbose: manual oscillator/buffer wiring, manual scheduling, manual envelope handling.

## Decision

Use **Tone.js v14** as the audio layer. Specifically:

- `Tone.PolySynth` / later `Tone.Sampler` for instrument voices (see ADR-003)
- `triggerAttackRelease(notes, durationSec, absoluteStartTime)` for scheduling — same API across all voice types
- `Tone.Offline()` for rendering progressions to an `AudioBuffer` (used by WAV export)
- `Tone.start()` once per session to satisfy the browser's user-gesture requirement before audio plays

We do **not** use Tone.Transport, Tone.Sequence, or Tone.Pattern — chord scheduling uses plain `setTimeout` over an array of `{note, offsetSec, durationSec}` events (see ADR-006). The Transport added complexity without proportional benefit for our use case.

## Consequences

**Wins**
- Voice class polymorphism: `Synth`, `FMSynth`, `Sampler` all share `triggerAttackRelease`
- Offline rendering is a one-line API call
- Volume, release, envelope are all uniform parameters across voice types

**Costs**
- Library footprint (~250 KB minified)
- We're tied to Tone's audio context lifecycle; switching to raw Web Audio later would be a rewrite
- Some advanced Tone features (Transport, Effects buses) are unused, but the library still ships them

**When to revisit:** if WebMidi or Web Audio gain higher-level scheduling primitives that obsolete Tone's value-add.
