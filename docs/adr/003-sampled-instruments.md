# ADR-003: Sampled instruments via Tone.Sampler + midi-js-soundfonts

**Status:** Accepted
**Date:** 2026-04-21

## Context

The original instrument set used `Tone.PolySynth` with eight preset voices, each defined as a Tone synth class (Synth, AMSynth, FMSynth, PluckSynth) plus oscillator options and an envelope. In practice the voices sounded near-identical to each other and not much like the instruments they were named after. Piano, organ, strings, and brass were all variations on "an oscillator with a different envelope." This produced low perceived variety even though the configuration space was wide.

Real instrument fidelity requires sampled audio rather than synthesis.

## Decision

Replace synth presets with **Tone.Sampler** instances loading sampled MP3 audio from the **MusyngKite** soundfont, hosted on the public CDN at `https://gleitz.github.io/midi-js-soundfonts/MusyngKite/`. The instrument list expanded from 8 synthetic voices to **19 sampled instruments** grouped into six families: Keys, Organs, Strings, Guitars, Brass & Winds, Synth.

For each instrument we load **9 samples** covering the C3–C5 piano range every ~3 semitones (`C, Eb, Gb, A` in octaves 3–4, plus `C5`). Tone.Sampler pitch-shifts to fill the gaps; max interpolation distance is 1.5 semitones, which sounds clean for chord work.

**Lazy load + cache**: `samplerCache: Map<instrumentKey, Promise<Tone.Sampler>>` keeps each instrument's load promise. Switching voices triggers a download only on first selection; subsequent selections resolve instantly. The default voice (`piano`) pre-loads in the background on init via `preloadInstrument()`, so the first interaction doesn't stall on a network round-trip.

A retired-key migration table (`INSTRUMENT_MIGRATION`) maps old synth keys (`organ`, `brass`, `bell`) to their closest sampled equivalents (`drawbar_organ`, `trumpet`, `vibraphone`) so existing localStorage data still selects a valid voice.

## Consequences

**Wins**
- Each voice has an unmistakable identity
- 19 instruments × 6 families gives real variety
- Pre-loading + caching means most user interactions feel instant
- MIDI export carries the right `track.instrument.number` (GM patch from the `gm` field on each preset)

**Costs**
- First click of a new instrument has a 500–1000 ms download
- WAV offline render with an un-cached voice has ~1–3 s of extra render time, because `Tone.Offline` runs in a fresh `OfflineAudioContext` and the sampler must rebuild + re-download samples there
- New third-party CDN dependency (`gleitz.github.io`). If it goes down, no audio at all.
- Each instrument adds ~500 KB–1 MB of MP3 data per user session

**When to revisit:** if MusyngKite becomes unreachable, we'd need to either self-host the samples (significant repo size cost) or fall back to a degraded-synth path.
