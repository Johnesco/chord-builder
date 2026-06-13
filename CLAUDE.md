# Chord Builder — Claude Project Memory

Standalone browser-based chord progression composer. Build chords on a piano keyboard, arrange them in a draggable progression, and play them back with a choice of synth voices.

**Live:** https://johnesco.github.io/chord-builder/
**Repo:** https://github.com/Johnesco/chord-builder

## Core Design Principles

### 1. Vanilla, No Build Step
Plain HTML/CSS/JS. No bundler, no framework, no transpilation. Edit a file, refresh the browser. The only external dependencies are two CDN scripts (see below).

### 2. Single-Page App
Everything lives in three files at the repo root:
- `index.html` — markup + CDN scripts
- `style.css` — dark theme, piano layout, playback states
- `app.js` — state, audio, chord detection, rendering

No routing, no server, no backend. State persists to `localStorage`.

### 3. Libraries via CDN (UMD globals)
- **Tone.js** (v14): `Tone.Sampler` per instrument, loading sampled audio from a public soundfont CDN; notes scheduled via `triggerAttackRelease`. `Tone.Offline()` renders WAV exports (samplers are rebuilt inside the offline context). Loaded eagerly in `index.html`.
- **Tonal.js** (v5): `Tonal.Chord.detect(pitchClasses)` returns possible chord names for a set of notes. Loaded eagerly in `index.html`.
- **@tonejs/midi** (v2): exposes `Midi` global, used to build and serialize `.mid` files. **Lazy-loaded** by `loadScript()` on first MIDI export.
- **VexFlow** (v3): exposes `Vex.Flow.*` globals, used to render chord progressions as sheet-music SVG. **Lazy-loaded** by `loadScript()` on first sheet-music open.

Lazy loading mirrors the sampler cache: `scriptPromises: Map<src, Promise>` stores the load *promise* so concurrent calls share one download; a failed load is evicted so retry works. The export buttons show a loading state while the script downloads.

## File Structure

```
chord-builder/
├── CLAUDE.md           # This file
├── index.html          # Markup + CDN scripts
├── style.css           # All styles
└── app.js              # All logic
```

## State Shape (`app.js`)

```js
state = {
  chords: [              // array of chord objects (order = playback order)
    {
      id: string,        // unique; generated via uid()
      notes: string[],   // e.g. ['C4', 'E4', 'G4'], max 6, sorted by pitch
      customName: string | null,  // overrides detected name when set
      duration: number,  // BEATS (1 beat = quarter note); 0.0625–16
      articulation:
        'block' | 'up' | 'down' | 'updown' | 'downup'
      | 'alberti' | 'tremolo' | 'random',
      stagger: number    // ms between note onsets / tremolo hits; 10–500
    }
  ],
  selectedChordId: string | null,    // the chord shown in the editor
  previousSelectedId: string | null, // preserved across playback
  isPlaying: boolean,
  playingIndex: number,              // -1 when idle, else index into state.chords
  instrument: string,                // key into INSTRUMENTS map
  bpm: number,                       // 40–300; default 120
  timeSignature: { num, den },       // e.g. {num: 4, den: 4}; default 4/4
  transposeAll: boolean,             // transpose scope: true = all chords, false = selected only
  synth: Tone.Sampler | null,        // active sampler; swapped when Voice changes
  isLoadingInstrument: boolean       // true while samples for a new voice download
}
```

Persisted keys: `chords`, `selectedChordId`, `instrument`, `bpm`, `timeSignature`, `transposeAll`. LocalStorage key: `chord-builder-state-v1`.

### Time model — beats, not seconds

Chord duration is in **beats** where 1 beat = a quarter note. Playback seconds are derived via `beatsToSeconds(beats) = beats * (60 / state.bpm)`. This means:

- `duration: 1` at 120 BPM plays for 0.5s; at 60 BPM plays for 1.0s
- The sheet music renders whole/half/quarter/eighth/sixteenth notes using fixed beat thresholds in `durationToVex()`
- Chord cards display "1 beat" / "2 beats" / fractional values via `formatBeats()`
- MIDI export sets tempo + time-signature meta so DAWs open the file at the right speed/bar layout
- WAV export converts beats to seconds at current BPM before offline-rendering

### Articulation — block / arpeggios / alberti / tremolo / random

Each chord has an `articulation` field and a `stagger` value (ms between successive onsets / tremolo hits). The single source of truth for playback, WAV (`Tone.Offline`), and MIDI export is `chordToEvents(chord)`, which returns a flat list of `{note, offsetSec, durationSec}` events relative to the chord's start. `scheduleChord(synth, chord, absoluteStartTime)` is just `chordToEvents` + `triggerAttackRelease`. MIDI export iterates the same list and feeds `track.addNote`.

| Value | Behavior | Sheet notation |
|---|---|---|
| `block` | All notes simultaneously, full duration | (no marker) |
| `up` | Low → high, each offset by `stagger * i` | `Stroke.ARPEGGIO_DIRECTIONLESS` (plain wavy line — ascending is the default arpeggio direction in piano notation, so no arrow is conventional) |
| `down` | High → low, each offset by `stagger * i` | `Stroke.ROLL_DOWN` (wavy line + down arrow — descending is the non-default direction, requires the explicit arrow) |
| `updown` | Pyramid: `C-E-G` → `C-E-G-E-C` (top played once) | `Stroke.ARPEGGIO_DIRECTIONLESS` (best approx; standard notation has no single round-trip glyph) |
| `downup` | Valley: `C-E-G` → `G-E-C-E-G` (bottom played once) | `Stroke.ROLL_DOWN` |
| `alberti` | Triad-only canonical 1-5-3-5 cycle (`low, high, mid, high`) repeating across the duration. Falls back to `block` if `notes.length !== 3` (the editor option is disabled for non-triads, but `chordToEvents` double-guards) | (no marker — Alberti is a broken-chord pattern, not a roll) |
| `tremolo` | The full chord retriggered every `stagger` ms across the chord's window | `Tremolo(3)` modifier — three slashes through the stem |
| `random` | Notes shuffled each playback (non-deterministic). Each play = different order | Small italic "rand." text annotation below the bass stave (no standard glyph exists; we use text to keep it distinguishable from the plain ascending squiggle) |

For staggered articulations (up/down/updown/downup/random), each note's release is aligned to the chord-window end (`noteDur = durationSec - offset`), so earlier notes sustain while later notes enter — natural arpeggio overlap. Offsets clamp to `durationSec - 0.05` so even a too-large stagger keeps every note inside the slot.

For sustained patterns (tremolo, alberti), the cycle is generated until time `t >= durationSec`, with each hit lasting `min(stagger, remaining)`.

The Alberti option is special-cased in `renderEditor()`: the `<option>` stays visible (so it's discoverable) but its `disabled` attribute toggles based on `chord.notes.length !== 3`. The `valid articulations` list (`VALID_ARTICULATIONS`) and the per-card prefix table (`ARTICULATION_SYMBOLS`) live next to `chordToEvents` for easy maintenance.

### Migration from the pre-beats format

Older localStorage shapes had `duration` in seconds and no `bpm` field. On load:
1. If `data.bpm` is missing, `state.bpm` is forced to **60**.
2. Raw `duration` numbers are kept as-is.

Result: "1.0" is now interpreted as 1 beat, but at 60 BPM that still plays for 1 second — same audible length as before the refactor. Users keep their progressions with zero perceived change; only the units shown in the UI shift.

## Key Patterns

### Lazy Audio Init
`Tone.start()` must be called from a user gesture (browser autoplay policy). `ensureAudio()` awaits `Tone.start()` then lazily constructs the synth via `initSynth()`. Called before any note trigger.

### Instrument Swap Mid-Playback
Playback uses `setTimeout` (not `Tone.Transport.schedule`) so each chord's trigger reads `state.synth` **at fire time**, not at scheduling time. When the user changes instrument:
1. `setInstrument()` disposes the current synth
2. Creates a new one (if audio context is already running)
3. Next scheduled chord fires on the new synth

Trade-off: setTimeout timing is slightly less precise than Tone.Transport, but for chord-duration (≥0.1s) ticks it's fine, and it enables clean hot-swapping.

### Editor Sync During Playback
`state.selectedChordId` is set to the playing chord on each tick, so the piano key highlights and info panel update in real time. On playback end (or stop), `state.previousSelectedId` is restored so the user's pre-play selection returns.

### Editor Lock During Playback
- JS: every mutator (`addChord`, `removeChord`, `moveChord`, `toggleNote`, `clearNotes`, input handlers) guards with `if (state.isPlaying) return;`
- CSS: `body.is-playing` disables `pointer-events` on `.chord-card`, `.piano-wrapper`, `.editor-controls`, `.chord-info`
- Instrument select stays live (the whole point of the feature)

### Undo / Redo
`undoHistory = { past: [], future: [] }` holds snapshots of the *composition* (`chords` + `selectedChordId`) — global settings (BPM, voice, time signature, transpose scope) are deliberately outside history. Every mutator calls `pushHistory()` before changing state; capacity is `HISTORY_LIMIT` (50). High-frequency text inputs pass a tag (`name:<chordId>`) so a typing burst coalesces into one undo step; `resetHistoryCoalescing()` on selection change breaks the merge. Inside text inputs the browser's native undo applies (the global handler skips form controls). UI: ↺/↻ buttons in the progression header + Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y.

### Transpose
▼/▲ buttons in the progression settings shift notes ±1 semitone. Scope is `state.transposeAll` ("all" checkbox): every chord, or just the selected one. `canTranspose(semitones)` bounds the shift so every affected note stays on the displayed piano (MIDI 48–72, C3–C5) — buttons disable at the edges. `customName` is preserved (it may be a label like "intro"); detected names re-derive automatically.

### Targeted card updates (perf)
The custom-name / duration / stagger input handlers call `updateChordCard(chord)` + `updateEditorChordName(chord)` instead of `renderChordList()` — each keystroke patches text nodes rather than rebuilding every card and re-attaching listeners. Structural changes (add/remove/move/duplicate/transpose) still do a full `render()`.

### Drag & drop reorder
`moveChordBefore(fromId, targetId)` — the dragged chord is inserted **before** the drop target in both drag directions, matching the insertion-line indicator (`.drag-over::before`). `targetId === null` = move to end; the persistent add-chord card doubles as the end-of-list drop zone. No-op moves are detected pre-mutation and skipped so they don't pollute undo history.

### Keyboard shortcuts
Global (skipped while focus is in an input/select/textarea): `Space` play/stop · `Esc` close modal, else stop playback · `←`/`→` select previous/next chord · `Del`/`Backspace` remove selected · `Ctrl+D` duplicate selected · `Ctrl+Z` undo · `Ctrl+Shift+Z`/`Ctrl+Y` redo. Chord cards are tabbable (`role="button"`, `aria-pressed`); `Enter` selects a focused card, and the hover-revealed ＋/× buttons also appear on `:focus-within`. Touch devices (`hover: none`) show the card buttons permanently at 24px.

### Chord Detection
`detectChordNames(notes)` strips octaves (`C4` → `C`), dedupes, and passes to `Tonal.Chord.detect(pcs)`. Returns an array like `["CM"]` or `["CM7", "Em#5/C"]`. First result is used as the default display name; `customName` overrides.

### Piano Layout
White keys render in a flex row inside `#piano`. Black keys are absolutely positioned on top using `BLACK_NOTE_AFTER` offsets:

```
blackKeyLeft = (globalWhiteIdx + 1) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2
```

where `globalWhiteIdx = (octave - startOctave) * 7 + whiteIdx`.

Current range: C3 – C5 (two octaves plus a trailing C).

## Instrument Presets (`INSTRUMENTS`)

19 sampled voices grouped into 6 families. Each preset references a General MIDI soundfont name (`soundfont` field) and a GM patch number (`gm` field — used by MIDI export so DAWs open with the matching voice).

| Group | Keys |
|---|---|
| Keys | piano, electric_piano, harpsichord, vibraphone, celesta |
| Organs | church_organ, drawbar_organ |
| Strings | violin, cello, strings, pizzicato, harp |
| Guitars | guitar (nylon), steel_guitar |
| Brass & Winds | trumpet, french_horn, flute, clarinet |
| Synth | chiptune (square lead) |

### How playback works

Each instrument is a `Tone.Sampler` loaded lazily from [midi-js-soundfonts/MusyngKite](https://gleitz.github.io/midi-js-soundfonts/MusyngKite/). The URL pattern is:

```
https://gleitz.github.io/midi-js-soundfonts/MusyngKite/{soundfont}-mp3/{note}.mp3
```

We load a sparse set (`SAMPLER_URLS`) of 9 samples per instrument covering C3–C5 every ~3 semitones (C, Eb, Gb, A in octaves 3 and 4, plus C5). Tone.Sampler pitch-shifts to fill the gaps; the max interpolation distance is 1.5 semitones, which sounds clean for chord work.

### Lazy load + cache

`samplerCache: Map<instrumentKey, Promise<Tone.Sampler>>` caches the load *promise* (not the resolved sampler), so concurrent requests for the same instrument share one download. `createSampler()` wraps `Tone.Sampler`'s `onload` callback in a Promise; `getSampler(key)` returns the cached promise or starts a new load. `preloadInstrument()` is called on init to kick off the default voice's download in the background.

### Loading-state UI

`state.isLoadingInstrument` toggles around the `await getSampler(...)` in `setInstrument()`. A `#instrument-loading` indicator next to the Voice select shows during loads, and `updatePlayButtons()` disables Play All / Play This Chord while loading. For cached instruments, the loading state appears and disappears within the same microtask — no visible flicker.

### Migration

`INSTRUMENT_MIGRATION` maps the retired synth-preset keys (`organ`, `brass`, `bell`) to their closest sampled equivalents (`drawbar_organ`, `trumpet`, `vibraphone`). `loadState()` runs values through this map before validating, so existing users' saved Voice selection survives the refactor.

### WAV offline render

`Tone.Offline` runs in a fresh `OfflineAudioContext`, so the sampler is recreated and its samples re-downloaded into that context. The `Tone.Offline` callback is async and awaits the sampler's `onload` before scheduling notes, which keeps the rendered audio deterministic. Trade-off: first WAV export per instrument adds ~1–3s of sample-download time.

### Adding a new instrument

1. Add an entry to `INSTRUMENTS` with a valid GM soundfont name (see [the soundfont list](https://github.com/gleitz/midi-js-soundfonts/tree/master/MusyngKite)) and GM patch number.
2. Add a matching `<option>` inside the appropriate `<optgroup>` in `index.html`.
3. Done — `getSampler()` handles the rest. No further wiring.

## Development

### Local serving
```bash
cd c:/code/chord-builder && python -m http.server 8080
```
Visit http://localhost:8080/

Any static server works. The file: protocol works too, but CDN scripts may behave better over HTTP.

### Deployment
GitHub Pages serves from `main` branch root.

```bash
git add -A
git commit -m "..."
git push
```

Pages rebuilds automatically (~30s). Check status:

```bash
"C:\Program Files\GitHub CLI\gh.exe" api repos/Johnesco/chord-builder/pages/builds/latest
```

### gh CLI Path (Windows)
`gh` is not on PATH. Full path: `C:\Program Files\GitHub CLI\gh.exe`

## Instructions for Claude

### Tone and style
- Edit in place; keep the three-file structure unless a feature genuinely requires more.
- No build step. No npm. No framework. If a library helps (audio DSP, music theory), load it via CDN.
- Dark theme is deliberate — don't invert it without asking.
- Match existing CSS variable usage (`--accent`, `--bg-card`, etc.).

### When changing playback
- Always account for the instrument-swap case (synth referenced fresh at fire time).
- Always restore `previousSelectedId` on both clean end AND user-triggered stop.
- Keep the editor-lock invariant (mutators check `state.isPlaying`).

### Safety
- `escapeHtml()` for any user-entered text rendered into the DOM (chord custom names).
- No `innerHTML` with unescaped user input.

## Export Features

### WAV
`exportWav()` uses `Tone.Offline()` to render the progression to an `AudioBuffer` using the current instrument preset, then encodes to 16-bit PCM WAV via the in-file `audioBufferToWav()` encoder (no extra dependency). Downloaded as `chord-progression.wav`.

Render window = total progression length + 2s tail for release.

### MIDI
`exportMidi()` builds a `Midi` object from `@tonejs/midi`. Each chord becomes one simultaneous group of notes; chord durations map directly (in seconds) to MIDI note durations. `track.instrument.number` is set from `INSTRUMENTS[state.instrument].gm` so a DAW opens the file with roughly the right patch.

### Sheet Music
`renderSheet()` draws SVG via VexFlow into a modal as a **grand staff** (treble + bass joined by a brace). Each chord's notes split by `MIDDLE_C_MIDI` (60 / C4): notes at or above middle C render on the treble stave, below on the bass. When a clef has no notes for a given chord, a rest of matching duration is placed there. Chord display names are annotated above the treble row only (not doubled on the bass) for a consistent top line of labels.

Layout is driven by the time signature: `groupChordsIntoMeasures()` accumulates chords greedily until their beats sum reaches `state.timeSignature.num`, then starts a new measure. `SHEET_MEASURES_PER_SYSTEM` (= 2) measures per system; a `Vex.Flow.BarNote` is inserted between measures within a system so the Formatter draws an internal bar line. The time signature is shown on the first system only. Accidentals added per note via `addAccidental`. Brace + left/right StaveConnectors bound each system.

Long chords crossing measure boundaries aren't tied across barlines yet — they're placed entirely in whichever measure the greedy grouper lands them in. This is a known v1 simplification.

Duration mapping (`durationToVex`): beats → VexFlow code + dot. 4 = whole, 2 = half, 1 = quarter, 0.5 = eighth, 0.25 = sixteenth; the ×1.5 values render dotted (6 = w., 3 = h., 1.5 = q., 0.75 = 8., 0.375 = 16.). In-between values round down to the nearest plain note. `makeSheetNote()` handles the dotted construction (duration string `'qd'` for ticks + `addDotToAll()` for the glyph) with an undotted fallback if the VexFlow build rejects it; dotted rests work the same way.

Printing: the Print button adds `body.printing-sheet`, which a `@media print` block uses to hide everything except the modal's sheet body. `afterprint` removes the class. "Save as PDF" is available by choosing it as the print destination.

## Architecture Decision Records

Significant architectural choices are recorded in [`docs/adr/`](docs/adr/README.md). Read these before making changes that might conflict with an established decision.

Current ADRs:
- [ADR-001](docs/adr/001-vanilla-js-no-build.md) — Vanilla JS, CDN libraries, no build step
- [ADR-002](docs/adr/002-tonejs-audio-engine.md) — Tone.js as the audio engine
- [ADR-003](docs/adr/003-sampled-instruments.md) — Sampled instruments via Tone.Sampler + midi-js-soundfonts
- [ADR-004](docs/adr/004-beats-time-model.md) — Chord duration in beats with BPM and time signature
- [ADR-005](docs/adr/005-per-chord-articulation.md) — Per-chord articulation as a first-class field
- [ADR-006](docs/adr/006-chord-to-events-contract.md) — `chordToEvents()` as the single playback/export contract
- [ADR-007](docs/adr/007-vexflow-grand-staff.md) — VexFlow for sheet music with a grand-staff layout
- [ADR-008](docs/adr/008-localstorage-persistence.md) — localStorage persistence with explicit schema migration
- [ADR-009](docs/adr/009-github-pages-deploy.md) — GitHub Pages from `main` as deployment target

## What This Project Is NOT
- Not a DAW. No multi-track, no mixing, no export-to-audio.
- Not a sheet-music editor. No notation rendering.
- Not a lesson platform. No theory instruction, no exercises.
- Not a real-time jam tool. No MIDI input, no latency tuning beyond browser defaults.

It's a focused "compose a chord progression, hear it, and take it with you" web toy — playback in-browser, export to WAV/MIDI/sheet-music for anywhere else.
