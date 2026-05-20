# ADR-001: Vanilla JS, CDN libraries, no build step

**Status:** Accepted
**Date:** 2026-04-21

## Context

The Chord Builder is a single-purpose web toy maintained by one developer. Iteration speed matters more than codebase scale. The site is hosted on GitHub Pages, which serves static files directly from the repo with no build pipeline.

## Decision

Ship as plain HTML, CSS, and JS files. No bundler, no transpiler, no package.json, no `node_modules`. All third-party libraries (Tone.js, Tonal.js, @tonejs/midi, VexFlow) load from CDN URLs via `<script>` tags. ES2020-era JavaScript is the floor — we target evergreen browsers.

## Consequences

**Wins**
- Editing a file and hitting refresh is the entire dev loop
- Deploying is `git push` — Pages serves what's in the repo
- No build artifacts, lockfiles, or version drift
- Anyone can read `app.js` directly without sourcemaps

**Costs**
- All libraries ship in full; no tree-shaking
- Offline use is impossible without manual bundling
- No TypeScript checks; correctness is on us
- CDN outages mean a broken site (mitigated by major libs being on stable CDNs like jsdelivr/unpkg)

**When to revisit:** if the codebase outgrows a single file per concern, or if a CDN dependency becomes flaky enough to need self-hosting.
