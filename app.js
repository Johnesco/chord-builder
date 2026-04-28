// === Instruments ===
// Each preset maps to a Tone.js voice class + options passed to PolySynth.
const INSTRUMENTS = {
  piano: {
    name: 'Piano',
    voice: 'Synth',
    options: {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.5, sustain: 0.2, release: 1.0 }
    },
    volume: -6
  },
  organ: {
    name: 'Organ',
    voice: 'AMSynth',
    options: {
      harmonicity: 2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.04, decay: 0.05, sustain: 0.9, release: 0.3 },
      modulation: { type: 'sine' },
      modulationEnvelope: { attack: 0.5, decay: 0, sustain: 1, release: 0.5 }
    },
    volume: -12
  },
  strings: {
    name: 'Strings',
    voice: 'Synth',
    options: {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.3, decay: 0.1, sustain: 0.8, release: 1.5 }
    },
    volume: -8
  },
  brass: {
    name: 'Brass',
    voice: 'Synth',
    options: {
      oscillator: { type: 'sawtooth' },
      envelope: { attack: 0.08, decay: 0.2, sustain: 0.5, release: 0.6 }
    },
    volume: -14
  },
  flute: {
    name: 'Flute',
    voice: 'Synth',
    options: {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.1, decay: 0.1, sustain: 0.6, release: 0.5 }
    },
    volume: -6
  },
  guitar: {
    name: 'Guitar (Pluck)',
    voice: 'PluckSynth',
    options: {
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.9
    },
    volume: -4
  },
  bell: {
    name: 'Bell',
    voice: 'FMSynth',
    options: {
      harmonicity: 3.01,
      modulationIndex: 14,
      envelope: { attack: 0.001, decay: 0.8, sustain: 0.1, release: 1.5 },
      modulation: { type: 'square' },
      modulationEnvelope: { attack: 0.002, decay: 0.2, sustain: 0, release: 0.2 }
    },
    volume: -12
  },
  chiptune: {
    name: 'Chiptune',
    voice: 'Synth',
    options: {
      oscillator: { type: 'square' },
      envelope: { attack: 0.005, decay: 0.1, sustain: 0.3, release: 0.2 }
    },
    volume: -16
  }
};

const DEFAULT_INSTRUMENT = 'piano';

// General MIDI patch numbers per instrument preset (for MIDI export)
const GM_INSTRUMENTS = {
  piano: 0,     // Acoustic Grand Piano
  organ: 19,    // Church Organ
  strings: 48,  // String Ensemble 1
  brass: 61,    // Brass Section
  flute: 73,    // Flute
  guitar: 24,   // Acoustic Guitar (nylon)
  bell: 14,     // Tubular Bells
  chiptune: 80  // Lead 1 (square)
};

// Sheet-music layout
const SHEET_MEASURES_PER_SYSTEM = 2;
const SHEET_MEASURE_WIDTH = 300; // approximate — Formatter adjusts
const SHEET_LEFT_PADDING = 130;  // room for brace + clef + time sig
const SHEET_SYSTEM_HEIGHT = 220; // grand staff: treble + gap + bass + padding
const SHEET_STAVES_GAP = 90;     // vertical distance between treble and bass
const MIDDLE_C_MIDI = 60;        // C4 — split point between clefs

// === State ===
// chord.duration is now in BEATS (1 beat = quarter note). Playback seconds
// are derived via state.bpm. Migration from the old seconds-based format
// happens in loadState() by pinning bpm to 60 when the saved shape lacks it
// (so old 1.0 values keep their original playback length).
const state = {
  chords: [],
  selectedChordId: null,
  previousSelectedId: null,
  isPlaying: false,
  playingIndex: -1,
  instrument: DEFAULT_INSTRUMENT,
  bpm: 120,
  timeSignature: { num: 4, den: 4 },
  synth: null
};

function beatsToSeconds(beats) {
  return beats * (60 / state.bpm);
}

function formatBeats(beats) {
  const pretty = Number.isInteger(beats)
    ? beats.toString()
    : beats.toFixed(3).replace(/\.?0+$/, '');
  return `${pretty} beat${beats === 1 ? '' : 's'}`;
}

function groupChordsIntoMeasures(chords, beatsPerMeasure) {
  const measures = [];
  let current = [];
  let currentBeats = 0;
  chords.forEach(chord => {
    current.push(chord);
    currentBeats += chord.duration;
    if (currentBeats >= beatsPerMeasure) {
      measures.push(current);
      current = [];
      currentBeats = 0;
    }
  });
  if (current.length > 0) measures.push(current);
  return measures;
}

let playbackTimeouts = [];

// === Constants ===
const PIANO_OCTAVES = [3, 4];
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTE_AFTER = { 'C#': 0, 'D#': 1, 'F#': 3, 'G#': 4, 'A#': 5 };
const WHITE_KEY_WIDTH = 44;
const BLACK_KEY_WIDTH = 28;
const MAX_NOTES = 6;
const STORAGE_KEY = 'chord-builder-state-v1';

// === Audio ===
function createSynth(instrumentKey) {
  const preset = INSTRUMENTS[instrumentKey] || INSTRUMENTS[DEFAULT_INSTRUMENT];
  try {
    const VoiceClass = Tone[preset.voice] || Tone.Synth;
    const synth = new Tone.PolySynth(VoiceClass, preset.options).toDestination();
    synth.volume.value = preset.volume;
    return synth;
  } catch (e) {
    console.warn('Instrument init failed, falling back to default', e);
    const fb = INSTRUMENTS[DEFAULT_INSTRUMENT];
    const synth = new Tone.PolySynth(Tone.Synth, fb.options).toDestination();
    synth.volume.value = fb.volume;
    return synth;
  }
}

function initSynth() {
  if (!state.synth) {
    state.synth = createSynth(state.instrument);
  }
}

function setInstrument(key) {
  if (!INSTRUMENTS[key]) return;
  state.instrument = key;
  saveState();

  if (state.synth) {
    try { state.synth.releaseAll(); } catch (e) { /* ignore */ }
    try { state.synth.dispose(); } catch (e) { /* ignore */ }
    state.synth = null;
  }
  if (typeof Tone !== 'undefined' && Tone.context && Tone.context.state === 'running') {
    initSynth();
  }
}

async function ensureAudio() {
  await Tone.start();
  initSynth();
}

// === Utilities ===
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function noteToMidi(note) {
  const m = note.match(/^([A-G])([#b]?)(\d+)$/);
  if (!m) return 0;
  const semis = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let n = semis[m[1]];
  if (m[2] === '#') n++;
  else if (m[2] === 'b') n--;
  return (parseInt(m[3], 10) + 1) * 12 + n;
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => noteToMidi(a) - noteToMidi(b));
}

// === Chord domain ===
function createChord(notes = [], duration = 1.0, customName = null) {
  return {
    id: uid(),
    notes: sortNotes(notes),
    customName,
    duration,
    articulation: 'block', // 'block' | 'up' | 'down'
    stagger: 60            // ms between note onsets when articulation != 'block'
  };
}

// Visual prefix shown on chord cards per articulation.
const ARTICULATION_SYMBOLS = {
  block:   '',
  up:      '↑',
  down:    '↓',
  updown:  '↑↓',
  downup:  '↓↑',
  alberti: 'A',
  tremolo: '≋',
  random:  '?'
};
const VALID_ARTICULATIONS = Object.keys(ARTICULATION_SYMBOLS);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Convert a chord into a flat list of {note, offsetSec, durationSec} events.
// Single source of truth for playback, Tone.Offline (WAV), and MIDI export.
//
// Articulations:
//   block     – all notes simultaneously, full duration
//   up/down   – notes ordered low-to-high or high-to-low, staggered onsets
//   updown    – C-E-G → C-E-G-E-C (top played once)
//   downup    – C-E-G → G-E-C-E-G (bottom played once)
//   alberti   – classical 1-5-3-5 cycle, triad only; falls back to block if
//               the chord doesn't have exactly 3 notes (option is disabled
//               in the editor in that case, but we double-guard here)
//   tremolo   – the full chord retriggered every `stagger` ms across the
//               chord's duration
//   random    – notes shuffled each playback (non-deterministic)
//
// All staggered offsets clamp to `duration - 50ms` so even a too-large
// stagger keeps every note inside the chord's slot.
function chordToEvents(chord) {
  if (!chord || chord.notes.length === 0) return [];

  const totalDur = beatsToSeconds(chord.duration);
  const articulation = chord.articulation || 'block';
  const staggerSec = Math.max(0.005, (chord.stagger || 60) / 1000);

  const playAsBlock =
    articulation === 'block'
    || chord.notes.length <= 1
    || (articulation === 'alberti' && chord.notes.length !== 3);

  if (playAsBlock) {
    return chord.notes.map(note => ({ note, offsetSec: 0, durationSec: totalDur }));
  }

  if (articulation === 'tremolo') {
    const events = [];
    let t = 0;
    while (t < totalDur) {
      const hitDur = Math.min(staggerSec, totalDur - t);
      chord.notes.forEach(note => events.push({ note, offsetSec: t, durationSec: hitDur }));
      t += staggerSec;
    }
    return events;
  }

  if (articulation === 'alberti') {
    const [low, mid, high] = chord.notes;
    const pattern = [low, high, mid, high]; // canonical Alberti figure
    const events = [];
    let i = 0;
    let t = 0;
    while (t < totalDur) {
      const note = pattern[i % pattern.length];
      const noteDur = Math.min(staggerSec, totalDur - t);
      events.push({ note, offsetSec: t, durationSec: noteDur });
      t += staggerSec;
      i++;
    }
    return events;
  }

  // Linear orderings (up / down / updown / downup / random)
  let order;
  switch (articulation) {
    case 'up':
      order = chord.notes;
      break;
    case 'down':
      order = [...chord.notes].reverse();
      break;
    case 'updown':
      order = chord.notes.length <= 1
        ? [...chord.notes]
        : [...chord.notes, ...chord.notes.slice(0, -1).reverse()];
      break;
    case 'downup': {
      if (chord.notes.length <= 1) {
        order = [...chord.notes];
      } else {
        const desc = [...chord.notes].reverse();
        order = [...desc, ...desc.slice(0, -1).reverse()];
      }
      break;
    }
    case 'random':
      order = shuffle(chord.notes);
      break;
    default:
      order = chord.notes;
  }

  return order.map((note, i) => {
    const rawOffset = i * staggerSec;
    const offsetSec = Math.min(rawOffset, Math.max(0, totalDur - 0.05));
    const durationSec = Math.max(0.05, totalDur - offsetSec);
    return { note, offsetSec, durationSec };
  });
}

function scheduleChord(synth, chord, absoluteStartTime) {
  const events = chordToEvents(chord);
  events.forEach(({ note, offsetSec, durationSec }) => {
    synth.triggerAttackRelease(note, durationSec, absoluteStartTime + offsetSec);
  });
}

function getSelectedChord() {
  return state.chords.find(c => c.id === state.selectedChordId) || null;
}

function detectChordNames(notes) {
  if (!notes || notes.length < 2) return [];
  const pcs = [...new Set(notes.map(n => n.replace(/\d+$/, '')))];
  if (typeof Tonal !== 'undefined' && Tonal.Chord && Tonal.Chord.detect) {
    try {
      return Tonal.Chord.detect(pcs);
    } catch (e) { return []; }
  }
  return [];
}

function getDisplayName(chord) {
  if (!chord) return '';
  if (chord.customName) return chord.customName;
  const detected = detectChordNames(chord.notes);
  if (detected.length > 0) return detected[0];
  if (chord.notes.length === 0) return '';
  return '?';
}

// === Mutations (blocked during playback to avoid timing chaos) ===
function addChord() {
  if (state.isPlaying) return;
  const chord = createChord();
  state.chords.push(chord);
  state.selectedChordId = chord.id;
  saveState();
  render();
}

function removeChord(id) {
  if (state.isPlaying) return;
  const idx = state.chords.findIndex(c => c.id === id);
  if (idx === -1) return;
  state.chords.splice(idx, 1);
  if (state.selectedChordId === id) {
    const next = state.chords[Math.min(idx, state.chords.length - 1)];
    state.selectedChordId = next ? next.id : null;
  }
  saveState();
  render();
}

function moveChord(fromId, toId) {
  if (state.isPlaying) return;
  const fromIdx = state.chords.findIndex(c => c.id === fromId);
  const toIdx = state.chords.findIndex(c => c.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = state.chords.splice(fromIdx, 1);
  state.chords.splice(toIdx, 0, moved);
  saveState();
  render();
}

function toggleNote(note) {
  if (state.isPlaying) return;
  const chord = getSelectedChord();
  if (!chord) return;
  const idx = chord.notes.indexOf(note);
  if (idx >= 0) {
    chord.notes.splice(idx, 1);
  } else {
    if (chord.notes.length >= MAX_NOTES) return;
    chord.notes.push(note);
    chord.notes = sortNotes(chord.notes);
    previewNote(note);
  }
  saveState();
  render();
}

function previewNote(note) {
  ensureAudio().then(() => {
    if (state.synth) state.synth.triggerAttackRelease(note, 0.4);
  });
}

// === Playback ===
function playChord(chord) {
  if (state.isPlaying || !chord || chord.notes.length === 0) return;
  ensureAudio().then(() => {
    if (state.synth) scheduleChord(state.synth, chord, Tone.now());
  });
}

async function playProgression() {
  if (state.isPlaying || state.chords.length === 0) return;
  await ensureAudio();
  state.isPlaying = true;
  state.previousSelectedId = state.selectedChordId;
  render();

  let time = 0; // seconds
  state.chords.forEach((chord, i) => {
    const durationSec = beatsToSeconds(chord.duration);
    const fireTime = time * 1000;
    const t = setTimeout(() => {
      state.playingIndex = i;
      state.selectedChordId = chord.id;
      // Read state.synth fresh so mid-playback instrument swaps land on the
      // next chord. scheduleChord handles block/arpeggio articulation.
      if (state.synth && chord.notes.length > 0) {
        scheduleChord(state.synth, chord, Tone.now());
      }
      render();
    }, fireTime);
    playbackTimeouts.push(t);
    time += durationSec;
  });

  const tEnd = setTimeout(() => finishPlayback(), time * 1000);
  playbackTimeouts.push(tEnd);
}

function finishPlayback() {
  state.isPlaying = false;
  state.playingIndex = -1;
  if (state.previousSelectedId && state.chords.find(c => c.id === state.previousSelectedId)) {
    state.selectedChordId = state.previousSelectedId;
  }
  state.previousSelectedId = null;
  render();
}

function stopPlayback() {
  playbackTimeouts.forEach(clearTimeout);
  playbackTimeouts = [];
  if (state.synth) {
    try { state.synth.releaseAll(); } catch (e) { /* ignore */ }
  }
  finishPlayback();
}

// === Export: WAV ===
async function exportWav() {
  if (state.chords.length === 0) return;
  if (state.isPlaying) stopPlayback();

  const btn = document.getElementById('export-wav-btn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Rendering…';

  try {
    // Make sure the audio context is started at least once so Tone.Offline
    // has access to defaults.
    await Tone.start();

    const totalDuration = state.chords.reduce(
      (sum, c) => sum + beatsToSeconds(c.duration), 0
    );
    const renderDuration = totalDuration + 2; // room for the release tail

    const preset = INSTRUMENTS[state.instrument] || INSTRUMENTS[DEFAULT_INSTRUMENT];

    const buffer = await Tone.Offline(() => {
      const VoiceClass = Tone[preset.voice] || Tone.Synth;
      const synth = new Tone.PolySynth(VoiceClass, preset.options).toDestination();
      synth.volume.value = preset.volume;

      let t = 0;
      state.chords.forEach(chord => {
        scheduleChord(synth, chord, t);
        t += beatsToSeconds(chord.duration);
      });
    }, renderDuration);

    const audioBuffer = (buffer && typeof buffer.get === 'function') ? buffer.get() : buffer;
    const wavBlob = audioBufferToWav(audioBuffer);
    downloadBlob(wavBlob, 'chord-progression.wav');
  } catch (e) {
    console.error('WAV export failed', e);
    alert('WAV export failed: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const length = buffer.length;

  // Interleave channel data
  const interleaved = new Float32Array(length * numChannels);
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      interleaved[i * numChannels + ch] = channelData[i];
    }
  }

  const dataLength = interleaved.length * bytesPerSample;
  const ab = new ArrayBuffer(44 + dataLength);
  const view = new DataView(ab);

  writeWavString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeWavString(view, 8, 'WAVE');
  writeWavString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);            // PCM chunk size
  view.setUint16(20, 1, true);             // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeWavString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    offset += 2;
  }

  return new Blob([ab], { type: 'audio/wav' });
}

function writeWavString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

// === Export: MIDI ===
function exportMidi() {
  if (state.chords.length === 0) return;
  if (typeof Midi === 'undefined') {
    alert('MIDI library failed to load.');
    return;
  }

  const midi = new Midi();
  midi.name = 'Chord Builder Progression';

  // Tempo + time signature meta so a DAW opens at the right speed and bar layout
  if (typeof midi.header.setTempo === 'function') {
    midi.header.setTempo(state.bpm);
  } else if (midi.header.tempos) {
    midi.header.tempos.push({ bpm: state.bpm, ticks: 0 });
  }
  if (midi.header.timeSignatures) {
    midi.header.timeSignatures.push({
      ticks: 0,
      timeSignature: [state.timeSignature.num, state.timeSignature.den]
    });
  }

  const track = midi.addTrack();
  track.name = INSTRUMENTS[state.instrument]?.name || 'Chords';
  if (track.instrument) {
    track.instrument.number = GM_INSTRUMENTS[state.instrument] ?? 0;
  }

  let t = 0;
  state.chords.forEach(chord => {
    const events = chordToEvents(chord);
    events.forEach(({ note, offsetSec, durationSec }) => {
      track.addNote({
        name: note,
        time: t + offsetSec,
        duration: durationSec,
        velocity: 0.8
      });
    });
    t += beatsToSeconds(chord.duration);
  });

  const blob = new Blob([midi.toArray()], { type: 'audio/midi' });
  downloadBlob(blob, 'chord-progression.mid');
}

// === Sheet Music (VexFlow) ===
function vexKey(note) {
  const m = note.match(/^([A-G])([#b]?)(\d+)$/);
  if (!m) return 'c/4';
  return `${m[1].toLowerCase()}${m[2]}/${m[3]}`;
}

function durationToVex(beats) {
  // beats → VexFlow duration codes. 1 beat = quarter note.
  if (beats >= 4) return 'w';
  if (beats >= 2) return 'h';
  if (beats >= 1) return 'q';
  if (beats >= 0.5) return '8';
  return '16';
}

function buildStaveNoteForClef(chord, clef) {
  const dur = durationToVex(chord.duration);
  const clefNotes = chord.notes.filter(n => {
    const m = noteToMidi(n);
    return clef === 'treble' ? m >= MIDDLE_C_MIDI : m < MIDDLE_C_MIDI;
  });

  // Empty clef gets a rest of the right duration (at a neutral staff position)
  if (clefNotes.length === 0) {
    const restKey = clef === 'bass' ? 'd/3' : 'b/4';
    const rest = new Vex.Flow.StaveNote({
      keys: [restKey],
      duration: dur + 'r',
      clef
    });
    // Still annotate the treble row with the chord name even when that clef is a rest
    if (clef === 'treble') {
      annotateWithName(rest, chord);
    }
    return rest;
  }

  const note = new Vex.Flow.StaveNote({
    keys: clefNotes.map(vexKey),
    duration: dur,
    clef
  });

  clefNotes.forEach((n, i) => {
    const acc = n.match(/^[A-G]([#b])/);
    if (acc) note.addAccidental(i, new Vex.Flow.Accidental(acc[1]));
  });

  // Notation per articulation. Pyramid/valley reuse the dominant initial
  // direction's stroke (standard notation has no single symbol for round-trip
  // arpeggios). Random gets the directionless wavy line. Tremolo gets stem
  // slashes. Alberti has no canonical stroke — it's a broken-chord pattern,
  // not a roll — so it renders unmarked.
  const artic = chord.articulation || 'block';
  if (artic === 'up' || artic === 'updown') {
    try {
      note.addStroke(0, new Vex.Flow.Stroke(Vex.Flow.Stroke.Type.ROLL_UP));
    } catch (e) { /* ignore */ }
  } else if (artic === 'down' || artic === 'downup') {
    try {
      note.addStroke(0, new Vex.Flow.Stroke(Vex.Flow.Stroke.Type.ROLL_DOWN));
    } catch (e) { /* ignore */ }
  } else if (artic === 'random') {
    try {
      note.addStroke(0, new Vex.Flow.Stroke(Vex.Flow.Stroke.Type.ARPEGGIO_DIRECTIONLESS));
    } catch (e) { /* ignore */ }
  } else if (artic === 'tremolo') {
    try {
      const tremolo = new Vex.Flow.Tremolo(3); // 3 slashes — unmeasured tremolo
      note.addModifier(0, tremolo);
    } catch (e) { /* ignore if Tremolo unsupported in this VexFlow build */ }
  }

  // Only annotate on the treble so chord names form a consistent top row
  if (clef === 'treble') annotateWithName(note, chord);

  return note;
}

function annotateWithName(note, chord) {
  const name = getDisplayName(chord);
  if (!name) return;
  const annotation = new Vex.Flow.Annotation(name)
    .setFont('Arial', 11, 'bold')
    .setJustification(Vex.Flow.Annotation.Justify.CENTER)
    .setVerticalJustification(Vex.Flow.Annotation.VerticalJustify.TOP);
  note.addAnnotation(0, annotation);
}

function renderSheet() {
  const container = document.getElementById('sheet-container');
  container.innerHTML = '';

  if (typeof Vex === 'undefined' || !Vex.Flow) {
    container.textContent = 'Notation library failed to load.';
    return;
  }

  if (state.chords.length === 0) {
    container.textContent = 'Add some chords to see them as sheet music.';
    return;
  }

  const beatsPerMeasure = state.timeSignature.num;
  const measures = groupChordsIntoMeasures(state.chords, beatsPerMeasure);
  const timeSigStr = `${state.timeSignature.num}/${state.timeSignature.den}`;

  const systemCount = Math.ceil(measures.length / SHEET_MEASURES_PER_SYSTEM);
  const systemWidth = SHEET_LEFT_PADDING + SHEET_MEASURES_PER_SYSTEM * SHEET_MEASURE_WIDTH;
  const totalHeight = 30 + systemCount * SHEET_SYSTEM_HEIGHT;

  const renderer = new Vex.Flow.Renderer(container, Vex.Flow.Renderer.Backends.SVG);
  renderer.resize(systemWidth + 20, totalHeight);
  const ctx = renderer.getContext();

  for (let sys = 0; sys < systemCount; sys++) {
    const measureStart = sys * SHEET_MEASURES_PER_SYSTEM;
    const systemMeasures = measures.slice(
      measureStart,
      measureStart + SHEET_MEASURES_PER_SYSTEM
    );
    const y = 30 + sys * SHEET_SYSTEM_HEIGHT;

    const trebleStave = new Vex.Flow.Stave(10, y, systemWidth);
    const bassStave = new Vex.Flow.Stave(10, y + SHEET_STAVES_GAP, systemWidth);

    trebleStave.addClef('treble');
    bassStave.addClef('bass');
    if (sys === 0) {
      trebleStave.addTimeSignature(timeSigStr);
      bassStave.addTimeSignature(timeSigStr);
    }

    trebleStave.setContext(ctx).draw();
    bassStave.setContext(ctx).draw();

    new Vex.Flow.StaveConnector(trebleStave, bassStave)
      .setType(Vex.Flow.StaveConnector.type.BRACE)
      .setContext(ctx).draw();
    new Vex.Flow.StaveConnector(trebleStave, bassStave)
      .setType(Vex.Flow.StaveConnector.type.SINGLE_LEFT)
      .setContext(ctx).draw();
    new Vex.Flow.StaveConnector(trebleStave, bassStave)
      .setType(Vex.Flow.StaveConnector.type.SINGLE_RIGHT)
      .setContext(ctx).draw();

    // Flatten measures into a single tickables array per clef, with a
    // BarNote between consecutive measures so the formatter places a
    // barline at the measure boundary.
    const trebleNotes = [];
    const bassNotes = [];
    systemMeasures.forEach((measureChords, idx) => {
      measureChords.forEach(chord => {
        trebleNotes.push(buildStaveNoteForClef(chord, 'treble'));
        bassNotes.push(buildStaveNoteForClef(chord, 'bass'));
      });
      if (idx < systemMeasures.length - 1) {
        trebleNotes.push(new Vex.Flow.BarNote());
        bassNotes.push(new Vex.Flow.BarNote());
      }
    });

    Vex.Flow.Formatter.FormatAndDraw(ctx, trebleStave, trebleNotes);
    Vex.Flow.Formatter.FormatAndDraw(ctx, bassStave, bassNotes);
  }
}

function openSheetModal() {
  if (state.isPlaying) stopPlayback();
  renderSheet();
  document.getElementById('sheet-modal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheetModal() {
  document.getElementById('sheet-modal').hidden = true;
  document.body.style.overflow = '';
}

function printSheet() {
  document.body.classList.add('printing-sheet');
  // Let the class apply before invoking print
  setTimeout(() => {
    window.print();
  }, 50);
}

// === Persistence ===
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      chords: state.chords,
      selectedChordId: state.selectedChordId,
      instrument: state.instrument,
      bpm: state.bpm,
      timeSignature: state.timeSignature
    }));
  } catch (e) { /* quota or disabled — ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);

    if (data.instrument && INSTRUMENTS[data.instrument]) {
      state.instrument = data.instrument;
    }

    // Migration: old format had no bpm field and stored durations as seconds.
    // Pinning bpm to 60 means the raw duration numbers now interpreted as
    // beats play back at the same audible length as before.
    if (typeof data.bpm === 'number') {
      state.bpm = data.bpm;
    } else {
      state.bpm = 60;
    }

    if (data.timeSignature && typeof data.timeSignature.num === 'number') {
      state.timeSignature = data.timeSignature;
    }

    if (Array.isArray(data.chords) && data.chords.length > 0) {
      state.chords = data.chords.map(c => ({
        id: c.id || uid(),
        notes: Array.isArray(c.notes) ? c.notes : [],
        customName: c.customName || null,
        duration: typeof c.duration === 'number' ? c.duration : 1.0,
        articulation: VALID_ARTICULATIONS.includes(c.articulation) ? c.articulation : 'block',
        stagger: typeof c.stagger === 'number' ? c.stagger : 60
      }));
      state.selectedChordId = data.selectedChordId || state.chords[0].id;
      return true;
    }
  } catch (e) { /* ignore */ }
  return false;
}

// === Rendering ===
function renderChordList() {
  const container = document.getElementById('chord-list');
  // Keep the persistent "+ Add chord" card; remove only real chord cards
  // so we can insert the latest set just before the add button.
  const addBtn = container.querySelector('.chord-card--add');
  Array.from(container.querySelectorAll('.chord-card:not(.chord-card--add)'))
    .forEach(c => c.remove());

  state.chords.forEach((chord, i) => {
    const card = document.createElement('div');
    card.className = 'chord-card';
    card.draggable = !state.isPlaying;
    card.dataset.id = chord.id;
    if (chord.id === state.selectedChordId) card.classList.add('selected');
    if (i === state.playingIndex) card.classList.add('playing');

    const name = getDisplayName(chord);
    const isEmpty = !name;

    const articRaw = ARTICULATION_SYMBOLS[chord.articulation || 'block'] || '';
    const articSymbol = articRaw ? `${articRaw} ` : '';
    card.innerHTML = `
      <button class="delete-btn" title="Delete chord" aria-label="Delete chord">×</button>
      <div class="name ${isEmpty ? 'empty' : ''}">${escapeHtml(name || '(empty)')}</div>
      <div class="duration">${articSymbol}${formatBeats(chord.duration)}</div>
    `;

    card.addEventListener('click', (e) => {
      if (state.isPlaying) return;
      if (e.target.closest('.delete-btn')) return;
      state.selectedChordId = chord.id;
      saveState();
      render();
    });

    card.querySelector('.delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      removeChord(chord.id);
    });

    card.addEventListener('dragstart', (e) => {
      if (state.isPlaying) { e.preventDefault(); return; }
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', chord.id);
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.chord-card.drag-over').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== chord.id) moveChord(fromId, chord.id);
    });

    // Insert before the persistent "+ Add chord" card so it stays at the end.
    if (addBtn) container.insertBefore(card, addBtn);
    else container.appendChild(card);
  });
}

function renderPiano() {
  const piano = document.getElementById('piano');
  piano.innerHTML = '';

  const [startOctave, endOctave] = PIANO_OCTAVES;

  for (let oct = startOctave; oct <= endOctave; oct++) {
    WHITE_NOTES.forEach(note => {
      const noteName = `${note}${oct}`;
      const key = document.createElement('div');
      key.className = 'white-key';
      key.dataset.note = noteName;
      key.textContent = noteName;
      key.addEventListener('click', () => toggleNote(noteName));
      piano.appendChild(key);
    });
  }
  const finalNote = `C${endOctave + 1}`;
  const extraC = document.createElement('div');
  extraC.className = 'white-key';
  extraC.dataset.note = finalNote;
  extraC.textContent = finalNote;
  extraC.addEventListener('click', () => toggleNote(finalNote));
  piano.appendChild(extraC);

  for (let oct = startOctave; oct <= endOctave; oct++) {
    Object.entries(BLACK_NOTE_AFTER).forEach(([note, whiteIdx]) => {
      const noteName = `${note}${oct}`;
      const globalIdx = (oct - startOctave) * 7 + whiteIdx;
      const key = document.createElement('div');
      key.className = 'black-key';
      key.dataset.note = noteName;
      key.textContent = noteName;
      key.style.left = `${(globalIdx + 1) * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2}px`;
      key.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleNote(noteName);
      });
      piano.appendChild(key);
    });
  }
}

function updatePianoSelection() {
  const chord = getSelectedChord();
  const notes = chord ? chord.notes : [];
  document.querySelectorAll('.white-key, .black-key').forEach(key => {
    key.classList.toggle('active', notes.includes(key.dataset.note));
  });
}

function renderEditor() {
  const chord = getSelectedChord();
  const notesDisplay = document.getElementById('notes-display');
  const detectedDisplay = document.getElementById('detected-display');
  const customName = document.getElementById('custom-name');
  const durationInput = document.getElementById('duration');
  const articulationSelect = document.getElementById('articulation');
  const staggerInput = document.getElementById('stagger');
  const spreadWrap = document.getElementById('spread-wrap');
  const playChordBtn = document.getElementById('play-chord-btn');
  const clearNotesBtn = document.getElementById('clear-notes-btn');
  const editorChordName = document.getElementById('editor-chord-name');

  if (!chord) {
    if (editorChordName) {
      editorChordName.textContent = 'no chord selected';
      editorChordName.classList.add('empty');
    }
    notesDisplay.textContent = '—';
    detectedDisplay.textContent = '—';
    customName.value = '';
    customName.disabled = true;
    durationInput.disabled = true;
    articulationSelect.disabled = true;
    staggerInput.disabled = true;
    playChordBtn.disabled = true;
    clearNotesBtn.disabled = true;
    updatePianoSelection();
    return;
  }

  // Populate the "Editing: <name>" heading so the editor visibly reflects the
  // currently selected chord card.
  if (editorChordName) {
    const editingName = getDisplayName(chord);
    if (editingName) {
      editorChordName.textContent = editingName;
      editorChordName.classList.remove('empty');
    } else {
      editorChordName.textContent = 'empty chord';
      editorChordName.classList.add('empty');
    }
  }

  const lockedForPlayback = state.isPlaying;
  customName.disabled = lockedForPlayback;
  durationInput.disabled = lockedForPlayback;
  articulationSelect.disabled = lockedForPlayback;
  staggerInput.disabled = lockedForPlayback;
  playChordBtn.disabled = lockedForPlayback || chord.notes.length === 0;
  clearNotesBtn.disabled = lockedForPlayback || chord.notes.length === 0;

  const articulation = chord.articulation || 'block';
  if (document.activeElement !== articulationSelect) {
    articulationSelect.value = articulation;
  }
  if (document.activeElement !== staggerInput) {
    staggerInput.value = chord.stagger != null ? chord.stagger : 60;
  }

  // Alberti is only meaningful for 3-note chords. The option stays in the
  // dropdown so it's discoverable, but it's disabled when the current chord
  // isn't a triad — and chordToEvents() falls back to block playback if a
  // non-triad somehow has alberti set.
  const albertiOption = articulationSelect.querySelector('option[value="alberti"]');
  if (albertiOption) albertiOption.disabled = chord.notes.length !== 3;

  // Hide spread input for block (no stagger needed). Alberti on a non-triad
  // also won't use the spread, but we keep the input visible so the user can
  // pre-set a value before adding/removing notes to make it a triad.
  spreadWrap.classList.toggle('hidden', articulation === 'block');

  notesDisplay.textContent = chord.notes.length > 0
    ? chord.notes.join(', ')
    : '(no notes selected)';

  const detected = detectChordNames(chord.notes);
  detectedDisplay.textContent = detected.length > 0
    ? detected.slice(0, 3).join(', ')
    : '(none)';

  if (document.activeElement !== customName) {
    customName.value = chord.customName || '';
  }
  if (document.activeElement !== durationInput) {
    // Show an integer value when possible so "1" doesn't appear as "1.000"
    durationInput.value = Number.isInteger(chord.duration)
      ? chord.duration.toString()
      : chord.duration.toFixed(3).replace(/\.?0+$/, '');
  }

  updatePianoSelection();
}

function updatePlayButtons() {
  document.getElementById('play-all-btn').disabled = state.isPlaying || state.chords.length === 0;
  document.getElementById('stop-btn').disabled = !state.isPlaying;
  document.getElementById('add-chord-btn').disabled = state.isPlaying;
}

function render() {
  document.body.classList.toggle('is-playing', state.isPlaying);
  renderChordList();
  renderEditor();
  updatePlayButtons();
}

// === Init ===
function init() {
  renderPiano();

  if (!loadState()) {
    const seed = [
      createChord(['C4', 'E4', 'G4'], 1.0),
      createChord(['A3', 'C4', 'E4'], 1.0),
      createChord(['F3', 'A3', 'C4'], 1.0),
      createChord(['G3', 'B3', 'D4'], 1.0)
    ];
    state.chords = seed;
    state.selectedChordId = seed[0].id;
  }

  const instrumentSelect = document.getElementById('instrument-select');
  instrumentSelect.value = state.instrument;
  instrumentSelect.addEventListener('change', (e) => setInstrument(e.target.value));

  const bpmInput = document.getElementById('bpm-input');
  bpmInput.value = state.bpm;
  bpmInput.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 40 && val <= 300) {
      state.bpm = val;
      saveState();
    }
  });

  const timeSigSelect = document.getElementById('time-sig-select');
  timeSigSelect.value = `${state.timeSignature.num}/${state.timeSignature.den}`;
  timeSigSelect.addEventListener('change', (e) => {
    const [num, den] = e.target.value.split('/').map(n => parseInt(n, 10));
    if (!isNaN(num) && !isNaN(den)) {
      state.timeSignature = { num, den };
      saveState();
    }
  });

  document.getElementById('add-chord-btn').addEventListener('click', addChord);
  document.getElementById('play-all-btn').addEventListener('click', playProgression);
  document.getElementById('stop-btn').addEventListener('click', stopPlayback);
  document.getElementById('play-chord-btn').addEventListener('click', () => {
    playChord(getSelectedChord());
  });
  document.getElementById('clear-notes-btn').addEventListener('click', () => {
    if (state.isPlaying) return;
    const chord = getSelectedChord();
    if (chord) {
      chord.notes = [];
      saveState();
      render();
    }
  });
  document.getElementById('custom-name').addEventListener('input', (e) => {
    if (state.isPlaying) return;
    const chord = getSelectedChord();
    if (chord) {
      chord.customName = e.target.value.trim() || null;
      saveState();
      renderChordList();
    }
  });
  document.getElementById('duration').addEventListener('input', (e) => {
    if (state.isPlaying) return;
    const chord = getSelectedChord();
    if (chord) {
      const val = parseFloat(e.target.value);
      if (!isNaN(val) && val >= 0.0625 && val <= 16) {
        chord.duration = val;
        saveState();
        renderChordList();
      }
    }
  });

  document.getElementById('duration-preset').addEventListener('change', (e) => {
    if (state.isPlaying) return;
    const val = e.target.value;
    if (!val) return;
    const chord = getSelectedChord();
    if (chord) {
      chord.duration = parseFloat(val);
      saveState();
      render();
    }
    e.target.value = ''; // reset the dropdown back to "Preset…"
  });

  document.getElementById('articulation').addEventListener('change', (e) => {
    if (state.isPlaying) return;
    const chord = getSelectedChord();
    if (!chord) return;
    if (VALID_ARTICULATIONS.includes(e.target.value)) {
      chord.articulation = e.target.value;
      saveState();
      render();
    }
  });

  document.getElementById('stagger').addEventListener('input', (e) => {
    if (state.isPlaying) return;
    const chord = getSelectedChord();
    if (!chord) return;
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val >= 10 && val <= 500) {
      chord.stagger = val;
      saveState();
      renderChordList();
    }
  });

  document.getElementById('export-wav-btn').addEventListener('click', exportWav);
  document.getElementById('export-midi-btn').addEventListener('click', exportMidi);
  document.getElementById('view-sheet-btn').addEventListener('click', openSheetModal);
  document.getElementById('close-sheet-btn').addEventListener('click', closeSheetModal);
  document.getElementById('print-sheet-btn').addEventListener('click', printSheet);
  document.getElementById('sheet-modal').addEventListener('click', (e) => {
    if (e.target.id === 'sheet-modal') closeSheetModal();
  });
  window.addEventListener('afterprint', () => {
    document.body.classList.remove('printing-sheet');
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Escape' && !document.getElementById('sheet-modal').hidden) {
      closeSheetModal();
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isPlaying) stopPlayback();
      else playProgression();
    }
  });

  render();
}

window.addEventListener('DOMContentLoaded', init);
