## General

- Language convention: code comments, docs, CHANGELOG entries, and release notes are written in English; Chinese only in README.zh-CN.md. Do not mass-rewrite existing Chinese content — convert when a file is touched anyway.
- Technical writing must use precise, standard terminology; don't invent colloquial metaphors. If a concept needs a short form, use the standard term, or annotate its precise meaning in parentheses on first use.
- YOU MUST: keep docs in sync with functional changes — README.md / README.zh-CN.md / CHANGELOG.md (`[Unreleased]`) / CONTEXT.md when terminology changes / docs/adr/ for architectural decisions / config template `_hint` copy.

## Project

This repository is **pi-verdict**: a minimal permission-gate extension for Pi (rule layer + model classifier). For domain terminology or design decisions, read `CONTEXT.md` (glossary) and `docs/adr/` first; design conclusions are backed by in-repo measurements under `research/` (a measurement habit).

### Installed copies (historical: ADR-0001)

ADR-0001's self-protection layer (a runtime rule-layer deny on agent writes to `<agentDir>/config/pi-verdict.json` and the installed copies under `<agentDir>/extensions/`) was removed (see the ADR's final revision) — there is no longer a mechanism in the gate itself that blocks this. The manual-only workflow remains project convention regardless:

- The agent should not write `<agentDir>/config/pi-verdict.json` or the installed copies under `<agentDir>/extensions/` — these are the user's live, installed gate; changes to them belong to the user, by hand, outside the repo.
- To test a new build: the user runs `cp extensions/pi-verdict.ts extensions/jev-adapter.ts ~/.pi/agent/extensions/` in a terminal and restarts pi (`jev-adapter.ts` is optional, needed only for the jev classifier backend). The same applies to editing user rules — manual edit only.

### Release

- Release sequence: a `chore(release): bump version` commit + annotated tag + GitHub Release; `gh release` commands are blocked by the built-in deny floor as a final backstop, so the user runs them from their own terminal.
- Package publishing is automated: GitHub Release published → `.github/workflows/publish.yml` (tag/version double-check + typecheck + tests + publish to the GitHub Package Registry).

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five default triage labels — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` — each label string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: a root `CONTEXT.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## Git conventions

- Feature branch naming: feat/description-with-dash-separated-and-MAY-contains-issue-number
- YOU MUST: use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for git commit messages.
- YOU MUST: update CHANGELOG before merging to main, following [Keep a Changelog](https://keepachangelog.com/).
- YOU MUST: do not run `git commit` without the user's permission.

## Tools

- When you need to look at another GitHub project's source, you can always use the locally installed GitHub CLI (bash: `gh api`).
- When you need to temporarily `git clone` an open-source project, always use `/Volumes/RamDisk` instead of `/tmp` as the temp directory.
