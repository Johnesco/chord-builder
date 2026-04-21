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

// === State ===
const state = {
  chords: [],
  selectedChordId: null,
  previousSelectedId: null, // restored after playback ends
  isPlaying: false,
  playingIndex: -1,
  instrument: DEFAULT_INSTRUMENT,
  synth: null
};

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
  return { id: uid(), notes: sortNotes(notes), customName, duration };
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
    if (state.synth) state.synth.triggerAttackRelease(chord.notes, chord.duration);
  });
}

async function playProgression() {
  if (state.isPlaying || state.chords.length === 0) return;
  await ensureAudio();
  state.isPlaying = true;
  state.previousSelectedId = state.selectedChordId;
  render();

  let time = 0;
  state.chords.forEach((chord, i) => {
    const fireTime = time * 1000;
    const t = setTimeout(() => {
      state.playingIndex = i;
      state.selectedChordId = chord.id;
      // Trigger at fire time so instrument swaps mid-progression take effect.
      if (state.synth && chord.notes.length > 0) {
        state.synth.triggerAttackRelease(chord.notes, chord.duration);
      }
      render();
    }, fireTime);
    playbackTimeouts.push(t);
    time += chord.duration;
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

// === Persistence ===
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      chords: state.chords,
      selectedChordId: state.selectedChordId,
      instrument: state.instrument
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
    if (Array.isArray(data.chords) && data.chords.length > 0) {
      state.chords = data.chords.map(c => ({
        id: c.id || uid(),
        notes: Array.isArray(c.notes) ? c.notes : [],
        customName: c.customName || null,
        duration: typeof c.duration === 'number' ? c.duration : 1.0
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
  container.innerHTML = '';

  state.chords.forEach((chord, i) => {
    const card = document.createElement('div');
    card.className = 'chord-card';
    card.draggable = !state.isPlaying;
    card.dataset.id = chord.id;
    if (chord.id === state.selectedChordId) card.classList.add('selected');
    if (i === state.playingIndex) card.classList.add('playing');

    const name = getDisplayName(chord);
    const isEmpty = !name;

    card.innerHTML = `
      <button class="delete-btn" title="Delete chord" aria-label="Delete chord">×</button>
      <div class="name ${isEmpty ? 'empty' : ''}">${escapeHtml(name || '(empty)')}</div>
      <div class="duration">${chord.duration.toFixed(1)}s</div>
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

    container.appendChild(card);
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
  const playChordBtn = document.getElementById('play-chord-btn');
  const clearNotesBtn = document.getElementById('clear-notes-btn');

  if (!chord) {
    notesDisplay.textContent = '—';
    detectedDisplay.textContent = '—';
    customName.value = '';
    customName.disabled = true;
    durationInput.disabled = true;
    playChordBtn.disabled = true;
    clearNotesBtn.disabled = true;
    updatePianoSelection();
    return;
  }

  const lockedForPlayback = state.isPlaying;
  customName.disabled = lockedForPlayback;
  durationInput.disabled = lockedForPlayback;
  playChordBtn.disabled = lockedForPlayback || chord.notes.length === 0;
  clearNotesBtn.disabled = lockedForPlayback || chord.notes.length === 0;

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
    durationInput.value = chord.duration.toFixed(1);
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
      if (!isNaN(val) && val >= 0.1 && val <= 10) {
        chord.duration = val;
        saveState();
        renderChordList();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isPlaying) stopPlayback();
      else playProgression();
    }
  });

  render();
}

window.addEventListener('DOMContentLoaded', init);
