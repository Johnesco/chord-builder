// === State ===
const state = {
  chords: [],
  selectedChordId: null,
  isPlaying: false,
  playingIndex: -1,
  synth: null
};

let playbackTimeouts = [];

// === Constants ===
const PIANO_OCTAVES = [3, 4]; // [start, end] inclusive; +1 extra C at the end
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTE_AFTER = { 'C#': 0, 'D#': 1, 'F#': 3, 'G#': 4, 'A#': 5 };
const WHITE_KEY_WIDTH = 44;
const BLACK_KEY_WIDTH = 28;
const MAX_NOTES = 6;
const STORAGE_KEY = 'chord-builder-state-v1';

// === Audio ===
function initSynth() {
  if (!state.synth) {
    state.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.02, decay: 0.12, sustain: 0.4, release: 0.9 }
    }).toDestination();
    state.synth.volume.value = -8;
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

// === Mutations ===
function addChord() {
  const chord = createChord();
  state.chords.push(chord);
  state.selectedChordId = chord.id;
  saveState();
  render();
}

function removeChord(id) {
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
  const fromIdx = state.chords.findIndex(c => c.id === fromId);
  const toIdx = state.chords.findIndex(c => c.id === toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;
  const [moved] = state.chords.splice(fromIdx, 1);
  state.chords.splice(toIdx, 0, moved);
  saveState();
  render();
}

function toggleNote(note) {
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
    state.synth.triggerAttackRelease(note, 0.4);
  });
}

// === Playback ===
async function playChord(chord) {
  if (!chord || chord.notes.length === 0) return;
  await ensureAudio();
  state.synth.triggerAttackRelease(chord.notes, chord.duration);
}

async function playProgression() {
  if (state.isPlaying || state.chords.length === 0) return;
  await ensureAudio();
  state.isPlaying = true;
  updatePlayButtons();

  let time = 0;
  state.chords.forEach((chord, i) => {
    if (chord.notes.length > 0) {
      state.synth.triggerAttackRelease(chord.notes, chord.duration, Tone.now() + time);
    }
    const t = setTimeout(() => {
      state.playingIndex = i;
      renderChordList();
    }, time * 1000);
    playbackTimeouts.push(t);
    time += chord.duration;
  });

  const tEnd = setTimeout(() => {
    state.isPlaying = false;
    state.playingIndex = -1;
    render();
  }, time * 1000);
  playbackTimeouts.push(tEnd);
}

function stopPlayback() {
  playbackTimeouts.forEach(clearTimeout);
  playbackTimeouts = [];
  if (state.synth) state.synth.releaseAll();
  state.isPlaying = false;
  state.playingIndex = -1;
  render();
}

// === Persistence ===
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      chords: state.chords,
      selectedChordId: state.selectedChordId
    }));
  } catch (e) { /* quota or disabled — ignore */ }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
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
    card.draggable = true;
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

  // White keys
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
  // Final C as a nicer endpoint
  const finalNote = `C${endOctave + 1}`;
  const extraC = document.createElement('div');
  extraC.className = 'white-key';
  extraC.dataset.note = finalNote;
  extraC.textContent = finalNote;
  extraC.addEventListener('click', () => toggleNote(finalNote));
  piano.appendChild(extraC);

  // Black keys (positioned absolutely over the white keys)
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

  customName.disabled = false;
  durationInput.disabled = false;
  playChordBtn.disabled = chord.notes.length === 0;
  clearNotesBtn.disabled = chord.notes.length === 0;

  notesDisplay.textContent = chord.notes.length > 0
    ? chord.notes.join(', ')
    : '(no notes selected)';

  const detected = detectChordNames(chord.notes);
  detectedDisplay.textContent = detected.length > 0
    ? detected.slice(0, 3).join(', ')
    : '(none)';

  // Avoid clobbering user's cursor while typing
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
  renderChordList();
  renderEditor();
  updatePlayButtons();
}

// === Init ===
function init() {
  renderPiano();

  if (!loadState()) {
    // Seed with the I–vi–IV–V progression in C major
    const seed = [
      createChord(['C4', 'E4', 'G4'], 1.0),
      createChord(['A3', 'C4', 'E4'], 1.0),
      createChord(['F3', 'A3', 'C4'], 1.0),
      createChord(['G3', 'B3', 'D4'], 1.0)
    ];
    state.chords = seed;
    state.selectedChordId = seed[0].id;
  }

  document.getElementById('add-chord-btn').addEventListener('click', addChord);
  document.getElementById('play-all-btn').addEventListener('click', playProgression);
  document.getElementById('stop-btn').addEventListener('click', stopPlayback);
  document.getElementById('play-chord-btn').addEventListener('click', () => {
    playChord(getSelectedChord());
  });
  document.getElementById('clear-notes-btn').addEventListener('click', () => {
    const chord = getSelectedChord();
    if (chord) {
      chord.notes = [];
      saveState();
      render();
    }
  });
  document.getElementById('custom-name').addEventListener('input', (e) => {
    const chord = getSelectedChord();
    if (chord) {
      chord.customName = e.target.value.trim() || null;
      saveState();
      renderChordList();
    }
  });
  document.getElementById('duration').addEventListener('input', (e) => {
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

  // Spacebar shortcut for play/stop (when not typing in an input)
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (state.isPlaying) stopPlayback();
      else playProgression();
    }
  });

  render();
}

window.addEventListener('DOMContentLoaded', init);
