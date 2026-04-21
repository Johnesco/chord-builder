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

### 3. Audio via Tone.js, Music Theory via Tonal.js
- **Tone.js** (v14): `Tone.PolySynth` wraps voice classes like `Tone.Synth`, `Tone.FMSynth`, `Tone.AMSynth`, `Tone.PluckSynth`. We schedule notes via `triggerAttackRelease`.
- **Tonal.js** (v5): `Tonal.Chord.detect(pitchClasses)` returns possible chord names for a set of notes.

Both loaded from unpkg as UMD globals in `index.html`.

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
      duration: number   // seconds (0.1 – 10)
    }
  ],
  selectedChordId: string | null,    // the chord shown in the editor
  previousSelectedId: string | null, // preserved across playback
  isPlaying: boolean,
  playingIndex: number,              // -1 when idle, else index into state.chords
  instrument: string,                // key into INSTRUMENTS map
  synth: Tone.PolySynth | null       // lazily created on first audio gesture
}
```

Persisted keys: `chords`, `selectedChordId`, `instrument`. LocalStorage key: `chord-builder-state-v1`.

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

Eight voices defined in `app.js`. Each maps to a Tone.js voice class name (resolved at runtime via `Tone[name]`) plus options:

| Key | Voice Class | Character |
|---|---|---|
| `piano` | `Synth` (triangle) | Mellow default |
| `organ` | `AMSynth` | Sustained |
| `strings` | `Synth` (sine, slow attack) | Pad-like |
| `brass` | `Synth` (sawtooth) | Bright |
| `flute` | `Synth` (sine, medium attack) | Airy |
| `guitar` | `PluckSynth` | String pluck |
| `bell` | `FMSynth` | Metallic |
| `chiptune` | `Synth` (square) | 8-bit |

Adding a new preset: add an entry to `INSTRUMENTS` and a matching `<option>` in `index.html`. `createSynth()` handles the rest.

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

## What This Project Is NOT
- Not a DAW. No multi-track, no mixing, no export-to-audio.
- Not a sheet-music editor. No notation rendering.
- Not a lesson platform. No theory instruction, no exercises.
- Not a real-time jam tool. No MIDI input, no latency tuning beyond browser defaults.

It's a focused "compose a chord progression and hear it" web toy.
