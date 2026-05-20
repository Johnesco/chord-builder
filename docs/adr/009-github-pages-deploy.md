# ADR-009: GitHub Pages from `main` as deployment target

**Status:** Accepted
**Date:** 2026-04-21

## Context

The Chord Builder is a static client-side app — see ADR-001 (no build) and ADR-008 (no backend). It needs a hosting target that:

- Serves static files
- Has HTTPS (Web Audio API and `localStorage` both behave better on secure contexts)
- Has zero ongoing cost
- Deploys via git push, not a separate CI step

## Decision

Use **GitHub Pages**, serving the repository root from the `main` branch. The published URL is `https://johnesco.github.io/chord-builder/`. Enabled via the GitHub Pages API at repo creation (`gh api repos/Johnesco/chord-builder/pages -X POST -f "source[branch]=main" -f "source[path]=/"`).

Each push to `main` triggers a rebuild (~30 s typical). There is no staging environment.

### Workflow norm: branches for risky changes

Because every push to `main` deploys, changes that are risky-in-production go through a feature branch first. Pattern:

1. `git switch -c feature/<name>` — work locally
2. Iterate against `http://localhost:8080` (Python `http.server`)
3. When stable: commit, `git push -u origin feature/<name>`, then `git switch main && git merge feature/<name> && git push`
4. Delete the branch

Small UI tweaks and isolated fixes still go directly to `main` — the branching overhead isn't worth it for changes where "does this break in production?" isn't a real question.

## Consequences

**Wins**
- Free, HTTPS, fast, no infra
- Push-to-deploy with the toolchain we already use (git, gh CLI)
- Reverting is `git revert` + push — broken state lives for ~30 s if caught quickly
- Public repo doubles as deployment artifact storage

**Costs**
- No staging environment — `main` is production
- ~30 s rebuild delay; can't pre-warm before announcing a change
- Custom domain support is possible but adds DNS setup; not currently used
- Bandwidth limits (100 GB/month soft cap) are far beyond what a hobby project hits, but exist

**When to revisit:** if the app needs a backend (e.g., for sharing progressions across users), Pages won't suffice and we'd move to a static host with serverless functions (Cloudflare Pages + Workers, Vercel, Netlify).
