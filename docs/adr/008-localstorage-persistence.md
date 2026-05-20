# ADR-008: localStorage persistence with explicit schema migration

**Status:** Accepted
**Date:** 2026-04-21

## Context

The app should remember the user's chord progression, selected voice, BPM, time signature, and which chord they were last editing — so a reload doesn't wipe an in-progress composition. There's no backend (GitHub Pages, static-only) and no user accounts, so storage has to be client-side.

The data model has also evolved several times: chord duration went from seconds to beats, articulation and stagger fields were added, the instrument key set changed when synth presets were replaced by samplers.

## Decision

Serialize state to `localStorage` under the key `chord-builder-state-v1`. The persisted shape:

```js
{
  chords: [{ id, notes, customName, duration, articulation, stagger }],
  selectedChordId,
  instrument,
  bpm,
  timeSignature: { num, den }
}
```

`saveState()` writes synchronously on every mutation. `loadState()` runs on init and is **shape-tolerant**: every field is read defensively with a fallback default, so newer code reading older saves never crashes.

### Migration strategy

Schema evolutions are handled inline in `loadState()`, not as a versioned migration pipeline:

- **Seconds → beats** (ADR-004): when `data.bpm` is missing, force `state.bpm = 60`. The raw `duration` numbers (originally seconds) now mean beats, but at 60 BPM the audible timing stays identical.
- **Synth-preset → sampled-instrument keys** (ADR-003): `INSTRUMENT_MIGRATION` maps retired keys (`organ`, `brass`, `bell`) to their nearest sampled equivalent before validating.
- **Missing fields** (`articulation`, `stagger`) get defaults applied per-chord.

The storage key is suffixed `-v1`. When (if) a breaking schema change can't be migrated inline, we'd switch to `-v2` and the old data would simply be ignored (and lost). That's an explicit choice: we'd rather lose stale data than ship a complex migration system.

## Consequences

**Wins**
- Zero backend; data lives in the user's browser
- Survives reloads transparently
- Schema evolution is handled where it's understood (in `loadState`)
- No "stuck on bad data" failure modes — defensive reads always produce a valid state

**Costs**
- No cross-device sync — the same user on a different browser starts fresh
- Browser storage clearing (private mode, "clear site data") wipes everything
- ~5–10 MB localStorage limit per origin — not a concern for chord data, but capped
- The `-v1` key is the implicit migration anchor; future breaking changes risk data loss

**When to revisit:** if cross-device sync becomes a requirement, we'd need a backend or a sync URL scheme (e.g., serializing state into a sharable URL fragment).
