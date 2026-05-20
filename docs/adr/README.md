# Architecture Decision Records

Short records of the meaningful architectural choices made for the Chord Builder. Each ADR has three sections: **Context** (what forced the decision), **Decision** (what we chose), **Consequences** (what we live with as a result).

Add a new ADR when a decision:
- Constrains how future work has to be structured, **or**
- Picks one of several plausible options where the rejected ones aren't obvious from the code, **or**
- Sets a contract that downstream code relies on

Skip an ADR for cosmetic tweaks, refactors with no rejected alternatives, or anything self-evident from reading the source.

## Index

| # | Title | Status |
|---|---|---|
| [ADR-001](001-vanilla-js-no-build.md) | Vanilla JS, CDN libraries, no build step | Accepted |
| [ADR-002](002-tonejs-audio-engine.md) | Tone.js as the audio engine | Accepted |
| [ADR-003](003-sampled-instruments.md) | Sampled instruments via Tone.Sampler + midi-js-soundfonts | Accepted |
| [ADR-004](004-beats-time-model.md) | Chord duration in beats with BPM and time signature | Accepted |
| [ADR-005](005-per-chord-articulation.md) | Per-chord articulation as a first-class field | Accepted |
| [ADR-006](006-chord-to-events-contract.md) | `chordToEvents()` as the single playback/export contract | Accepted |
| [ADR-007](007-vexflow-grand-staff.md) | VexFlow for sheet music with a grand-staff layout | Accepted |
| [ADR-008](008-localstorage-persistence.md) | localStorage persistence with explicit schema migration | Accepted |
| [ADR-009](009-github-pages-deploy.md) | GitHub Pages from `main` as deployment target | Accepted |
