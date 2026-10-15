# Research: Competitive landscape of Pi tool-call permission auto-verdict tools (positioning baseline for pi-verdict)

> ⚠️ This document is a pre-0.2.0 snapshot (pi-verdict still had a built-in allowlist). For the current state, see `pi-automode-convergence.md` (2026-08-27, containing the architecture convergence conclusions and a graded list of residual differences).

> Related issue: #9 (README rewrite) / #1
> Research date: 2026-08-26. All data was collected first-hand on that day: npm registry API, GitHub API / README / source, locally unpacked source.
> Baseline: this repo's pi-verdict (`extensions/auto-mode.ts`, ~590-line single file, zero runtime dependencies, three-state verdicts, fail-closed, shadow-cache telemetry) -- existing facts are not restated by task convention and are used only for comparison.

## TL;DR

1. **The category has split into three schools, and none of the leaders is a "model verdict"**: (a) deterministic permission engines -- `@gotgenes/pi-permission-system` (29.0K monthly downloads, v27.0.1, pure rules with no built-in classifier) and `cc-safety-net` (20.6K monthly downloads, 1,505 stars, an LLM-free semantic-parsing interceptor supporting 11 CLIs); (b) two-stage model verdicts descended from CC auto mode -- `@czottmann/pi-automode` (2.7K monthly downloads, 96 stars, 3 releases in the month, highest activity and engineering maturity) and the stalled `r4vi/pi-auto-mode`; (c) hybrid pipelines -- `@zhushanwen/pi-permission` (AST + rules + single-turn classifier) and the defunct `wangzexi/pi-auto-approve`.
2. **pi-verdict's differentiated combination holds**: three-state classifier semantics (competitor classifiers are almost all two-state allow/block; ask exists only in the rule layer), CC-style transcript context carrying (the `<verdict>` prefix contract), fail-closed + non-interactive ask→deny, `thinkingEnabled: false` (backed by this repo's thinking-param-blackhole research; contrast czottmann, which explicitly requests a reasoning level), zero-dependency single file, shadow cache in observe-only mode. This **combination** has no second implementation in the category.
3. **But every single point has a predecessor, so README wording must avoid "first/only"**: two-stage classifier (czottmann/r4vi already have it), AST-level bash analysis (zhushanwen/gotgenes use tree-sitter, cc-safety-net a home-grown parser), path sensitivity tiers (gotgenes' directional path surface), denial-budget circuit breaker (r4vi's pause-session after 3 consecutive / 20 total denials). pi-verdict's truly unique assets are the **evidence-driven narrative** (three measured studies) and the combination of three-state × context × fail-closed; it should be positioned by the combination rather than by any single point.

---

## 2. Landscape comparison matrix

Download window 2026-07-27 → 2026-08-25 (api.npmjs.org). The "classifier" column means LLM gray-area verdicts.

### Table A: Verdict design

| Project | Verdict semantics | Pipeline layers | Fail direction | Classifier context | Output contract | Model selection |
|---|---|---|---|---|---|---|
| **pi-verdict** (baseline) | three-state allow/ask/deny | rules (allowlist 78 + danger 13 + paths S0-S5) → gray-area classifier | **closed** (exception→deny; non-interactive ask→deny) | CC-style transcript (last 5 user + 10 tool calls) | `<verdict>` prefix, two-tier retry 512→1024 | default introspection (inherits session model), overridable with `--auto-mode-model` |
| @czottmann/pi-automode | rule layer three-state; **classifier two-state** allow/block | deny rules→ask rules→deterministic hard-deny→path denial→three allow tiers→one-token conservative filter→structured re-review | **closed** (model/parse failure→block) | token-budgeted transcript selection | one token (0/1)→structured JSON; 512/1200 two tiers | dedicated classifier model (`/automode model`), can request a reasoning level |
| @gotgenes/pi-permission-system | three-state allow/ask/deny (**purely deterministic**) | path surface→CWD boundary surface→per-tool→bash patterns, strictest wins | **closed** (gate internal error→block; unparseable bash→ask) | **no classifier** (LLM only optionally attached via authorizerChain) | no LLM contract; link contract allow/deny/defer | optionally supplied by a chain link (e.g. pi-permission-model-judge) |
| cc-safety-net | block / allow (parser) | semantic command analysis (nested wrappers 10 levels, interpreter one-liners)→secret path protection→rulebook | **closed** (malformed input block; Strict tier blocks on unparseable) | no LLM | none | none |
| r4vi/pi-auto-mode | two-state (YES/NO→shouldBlock); interactive three-way choice after a denial | read-only allowlist→hard-deny→two-stage classifier | **configurable failOpen, default true (fail-open!)** | `<transcript>` session branch carried | stage one YES/NO; stage two `{"shouldBlock","reason","thinking"}` | dedicated model (`/auto-mode model` selector) |
| flaxodev/pi-perms | no verdict (mode switching) | dangerous-bash regex confirmation table (per mode) | none (passes if not intercepted) | no LLM | none | none |
| @zhushanwen/pi-permission | three-state (outcome includes ask) | tree-sitter AST→rules→classifier (races human approval) | **closed** (exception→ask; headless ask→deny) | **single turn, no context** | JSON four fields `{outcome,risk_level,reasoning,confidence}` | `classifier.model:"auto"` (first scoped model with credentials) or exact specification |
| wangzexi/pi-auto-approve | two-state allow/block | 15 allow regexes→7 block regexes→introspective re-review | **open** (timeout/error/parse failure→allow) | full conversation context (toolCall/toolResult stripped, command wrapped in CDATA) | exactly two keys `{"verdict","reason"}` | introspection (same session model), reuses main-session prefix cache |

### Table B: Engineering and operations

| Project | Rule-layer capability | Modes/UX | Config surface | Dependencies/size | Tests | Cache/telemetry | Monthly downloads | Activity (as of 08-26) | License |
|---|---|---|---|---|---|---|---|---|---|
| **pi-verdict** | allowlist 78 + danger regexes 13 + path sensitivity S0-S5 | /automode on\|off; footer; --auto-mode-debug | CLI flag + JSON (see repo) | **0 runtime dependencies**; ~590-line single file | repo tests | shadow-cache telemetry (observe-only) + three measured studies | not published to npm | this repo | MIT |
| @czottmann/pi-automode | CC permissions.deny/ask/allow + hard-deny + deniedPaths glob (symlink resolution, recursive grep/find domain checks) | 8 /automode subcommands; status line `AM● a: d: ca: cd:`; `automode_inspect` read-only agent tool + companion skill; ADR docs | global + project local (after trust) + env; **shared project files cannot weaken policy (tamper-proof)** | 1 dependency (unbash); 262KB | 10 test files (including classifier routing / staged parsing and cache / symlinks) | classifier cache; denial counters; observable logs | 2,725 | v1.13.0 (08-25); first released 6-14, 17 versions; still pushing that day | MIT |
| @gotgenes/pi-permission-system | tree-sitter bash gate; **directional path surface** (read/write separated); MCP/skill-granularity gates; hides banned tools; subagent integration | inline hotkey approval dialog (y/s/n/r double-press confirm); session-level approval; event broadcast | global + project (trust-gated) + per-agent frontmatter; last match wins | 3 dependencies (tree-sitter×2+zod); 1.37MB; 144 src files | **147 test files** | review-log (gate_error etc.) audit | **28,976** | v27.0.1 (08-24); first released 5-03, 186 versions | MIT |
| cc-safety-net | semantic parsing (reordered flags / wrappers / one-liner interpreter escape detection); secret protection (SSH/.env/.aws/credential stores, cross-tool); SHA-256-locked rulebook | Standard/Strict/Paranoid presets; status/doctor/explain/logs/gui CLI; Web GUI | rulebook (user/project) + presets | 1 dependency (zod); 1.76MB; spans 11 CLIs | CI+codecov (README badge) | **local JSONL audit log (redacted, 30 days by default)** | 20,563 | v2.2.2 (08-25, 3 releases that day); first released 2026-01, 37 versions | MIT |
| r4vi/pi-auto-mode | read-only allowlist (merges .claude settings allowlists)+hard-deny; **denial budget** (3 consecutive / 20 total denials→pause session) | footer; denial-history widget; three-way choice after denial (block/allow once/turn off auto mode and allow); system prompt injection | auto-mode.example.json | 0 dependencies (but peer pinned to the old @mariozechner/* namespace); 50KB; 1,171-line single file | has CI (publish.yml); no tests seen | denial counters/history | 6x | v0.1.2 (**2026-05-16, stalled for 3 months**) | MIT |
| flaxodev/pi-perms | hard-coded dangerous bash regex table (rm -rf/sudo/git push/curl\|sh/DDL, etc.) | **Shift+Tab four-mode cycle** (normal/accept edits/plan/bypass) + footer indicator; persists across restarts; /perms | no config file | 0 dependencies; single file extensions/index.ts | none seen | none | not on npm (npm `pi-perms` belongs to Mearman) | repo pushed 08-25, but no npm publishing channel | MIT |
| @zhushanwen/pi-permission | tree-sitter AST (11-node allowlist, Codex bash.rs port)+50 unconditional/9 conditional safe commands+12 danger regexes+**TUI rule editor** | four modes yolo/auto/approve/strict; statusline coloring | `<agentDir>/config/permission-ext-config.json` (auto-generated on first launch) | 4 dependencies + 3 peers; 568KB | **25 test files** (counted locally with find) | no cache | 1,326 | v1.3.3 (08-24); 3 releases in August | MIT |
| wangzexi/pi-auto-approve | 15 allow + 7 block regexes | /autoapprove switch; toast shows cache hit rate | env debug variable only | single file; depends on the old pi-ai package-root export (**broken on pi-ai@0.84.3, measured undefined**) | none seen | cache-hit-rate toast | not on npm (404) | no push since 06-20; **broken at runtime** | not stated (no LICENSE found in the repo checkout) |

---

## 3. Per-project highlights (core mechanisms + sources)

### 3.1 @czottmann/pi-automode (a focus named by the user)

- A standalone reimplementation of CC auto mode; explicit disclaimers: "It is not a sandbox" and it does not guard the user's `!`/`!!` commands. The README admits the real CC classifier is private, and this package implements "the documented precedence and configuration behavior". (Source: github.com/czottmann/pi-automode README)
- A 15-step verdict flow: deny rules→ask rules (after acceptance, **forced through the classifier**)→deterministic hard-deny (shell profile/authorized_keys/cron/TLS weakening/self-modification)→path denial (including symlink aliases and recursive search domains)→three allow tiers (inside CWD/permissions.allow/read-only tools)→**one-token conservative filter** (passes if safe, blocks if malformed)→structured re-review. **Fail-closed by default**. (Source: docs/automode-classifier-flow.md)
- Three head-to-head contrasts with pi-verdict: (1) classifier two-state vs three-state; (2) `classifierReasoningLevel` explicitly **requests** reasoning (low ≈ Codex Auto Review) vs pi-verdict `thinkingEnabled:false` explicitly turning thinking off (backed by the thinking-param-blackhole research); (3) config tamper-proofing (shared project files can only tighten, never relax) is ahead.
- Engineering maturity benchmark: `automode_inspect` read-only agent tool + companion diagnostic skill, status-line telemetry, 8 subcommands, ADR, npm Trusted Publishing + provenance, 10 test files. 1 runtime dependency (unbash, bash AST parsing).
- Maintenance activity: first released 6-14, 2.7K monthly downloads in August, 96 stars, v1.13.0 (08-25), pushed that day. (Source: npm API, GitHub API)

### 3.2 @gotgenes/pi-permission-system (category download leader)

- A deep fork of MasuRii/pi-permission-system; **a purely deterministic permission engine with no built-in LLM classifier**; LLM verdicts can only be attached optionally via `authorizerChain` (first-party reference implementation pi-permission-model-judge, a "deny-first reviewer"; the third-party pi-permission-ai-guard also uses this seam). (Source: gotgenes/pi-packages packages/pi-permission-system README)
- Four layers, strictest wins: path cross-cutting surface (read/write direction separated path_read/path_write)→ external_directory (CWD boundary, directional)→ per-tool mode → bash mode (tree-sitter parsing; indirect wrappers such as `bash -c`/`eval`/`sudo`/`env`/`xargs`/`find -exec` always ask). Since v16 the bash gate is fail-closed; a gate internal error→block and records a gate_error audit.
- Unique capabilities: **hiding banned tools** before the agent starts; MCP server/tool and skill-name granularity gates; native integration with pi-subagents (subagent ask bubbles up to the parent session); event bus broadcast.
- Scale: 144 src files / 147 test files / 3 dependencies / 1.37MB / 186 versions (since 5-03). Project config is loaded only after the project is trusted (an untrusted repo cannot relax the global policy).
- One-line difference from pi-verdict: it is "the strictest gate that never asks a model", while pi-verdict is "where rules run out, let a model decide with context" -- the former wins on determinism and coverage, the latter on gray-area resolution.

### 3.3 cc-safety-net (cross-CLI ecosystem, not Pi-native)

- Positioning: a PreToolUse interceptor across 11 coding CLIs (Claude Code/Codex/Cursor/Gemini CLI/OpenCode/Pi, etc.); **no LLM**, relying on semantic command parsing: flag reordering, shell wrappers (nested 10 levels), and interpreter one-liners (`os.system("rm -rf /")` inside `python -c`) cannot escape it; it can tell `git checkout -b` (allow) from `git checkout --` (block). (Source: github.com/kenryu42/cc-safety-net README)
- **The Pi integration is an in-process extension** (`pi install npm:cc-safety-net`), not a hook subprocess; but the Pi adapter only analyzes the built-in `bash` tool as a shell command, other tools get only protected-path checks, and custom shell tools are unsupported -- coverage is narrower than Pi-native extensions. (Source: ccsafetynet.com/docs/installation, Pi section)
- fail-closed: malformed hook input is blocked; Strict tier blocks on unparseable; **corrupted config does not block** (falls back to protective defaults and reports) -- same direction as pi-verdict but lenient toward config errors.
- Heaviest operations: three preset tiers, SHA-256-locked rulebook, local redacted JSONL audit (30 days by default), a full doctor/explain/logs/gui CLI set, a docs site in Chinese, English, and Japanese. 1,505 stars, first released 2026-01 (earliest in the category).
- One-line difference from pi-verdict: it is "a model-free cross-CLI interception net", complementary to gray-area model verdicts rather than the same kind; its secret protection and audit log are productized models that pi-verdict's shadow-cache telemetry can benchmark against.

### 3.4 r4vi/pi-auto-mode (npm: pi-auto-mode -- the placeholder holder of this repo's former name)

- A pi port of lghupan/cc-automode: read-only allowlist (merging allowlists from `.claude/settings*.json`)→deterministic hard-deny→**two-stage classifier** (stage one YES/NO conservative filter, "Err toward YES if uncertain"; stage two `{"shouldBlock","reason","thinking"}` JSON). Both stages carry `<transcript>` (taken from sessionManager.getBranch). (Source: github.com/r4vi/pi-auto-mode README + extensions/auto-mode.ts:585-658)
- **`failOpen` defaults to true** (source :53, exception path :1085-1096) -- the only active implementation in the category that allows by default; the README does not state this default.
- Denial budget: 3 consecutive / 20 total denials→auto-pause the session (source :828-832); interactive three-way choice after denial (block/allow once/turn off auto mode and allow).
- Current state: stalled after v0.1.2 (05-16), 61 monthly downloads, peer dependency still pinned to the old `@mariozechner/*` namespace. **The name collision is a reality this repo's README must address**: npm `pi-auto-mode` has the same name as this repo's former name but belongs to someone else.

### 3.5 flaxodev/pi-perms (note the naming conflict with Mearman/pi-perms)

- A CC-style permission mode switcher: Shift+Tab cycles the four modes normal/accept edits/plan/bypass, with a colored footer indicator, persistence across restarts, and a /perms selector. "Dangerous bash" is a hard-coded regex table (rm -rf, sudo, git push, npm publish, curl|sh, DDL, etc.), with no AST, no LLM, and no fail semantics. (Source: github.com/flaxodev/pi-perms README)
- **npm `pi-perms` is unrelated to it**: that package name belongs to Joseph Mearman (Mearman/pi-perms, Apache-2.0, v2.1.0 stalled since 05-12) and is a different project -- it loads cross-agent policy from `.agents/permissions.json`, evaluates deny→ask→allow, and is a thin pure-rule wrapper over the agent-perms library. (Source: npm view pi-perms maintainers/repository; github.com/Mearman/pi-perms README)
- One-line difference from pi-verdict: mode switching is orthogonal to automatic verdicts (plan/bypass are session postures, not per-call verdicts) and they can coexist; what it fills in is the CC shortcut-key experience that pi lacks.

### 3.6 @zhushanwen/pi-permission@1.3.3 (verified against local source)

- Four modes (yolo/auto/approve/strict) × three-layer pipeline: tree-sitter AST (11-node allowlist, faithful Codex bash.rs port; >65536 characters or parse failure→fail-closed)→rules (50 unconditional + 9 conditional safe commands, 12 danger regexes, user rules + TUI editor)→classifier (**single turn, no context**, four-field JSON contract, autoDenyHighRisk can force a high+allow to deny; **races** human approval, aborting the AI as soon as the user answers first). (Source: locally unpacked `~/tmp/pi-permission-pkg/package`, and this repo's research/pi-model-call-and-ref-implementations.md §3.1)
- fail-closed: any exception→ask; headless ask→deny. No cache.
- Local verification corrections: 4 runtime dependencies (tree-sitter-bash, web-tree-sitter, @zhushanwen/pi-extension-logger, @zhushanwen/pi-llm-shared) + 3 peers; `*.test.*` files measured at **25** (src/__tests__ 15 + subdirectories 10).
- One-line difference from pi-verdict: it is a hybrid that is "heaviest on AST, lightest on the model" (the classifier is a single-turn blind judge), and pi-verdict is the reverse (light rules, heavy context classification) -- the two are mirror images in pipeline emphasis.

### 3.7 wangzexi/pi-auto-approve (reusing this repo's existing extraction)

- Three layers: 15 allow regexes→7 block regexes→introspective re-review (same session model + full conversation context, toolCall/toolResult stripped to prevent format crosstalk, command wrapped in CDATA, `cacheRetention:"short"`+sessionId reusing the main-session prefix cache, toast showing hit rate). The contract is exactly two keys `{"verdict","reason"}`. (Source: research/pi-model-call-and-ref-implementations.md §3.3; github.com/wangzexi/pi-auto-approve)
- **fail-open**: 30s timeout/error/parse failure all allow (block only when there is no UI or no model) -- the opposite direction from pi-verdict.
- Dead: not on npm (404), no push since 06-20, and the `completeSimple` import no longer exists at the pi-ai@0.84.3 package root (measured in the existing extraction).
- One-line difference from pi-verdict: the only fail-open one in the category and the only experiment that reuses the main-session cache prefix for the classifier; they serve as pi-verdict's negative example and cache-design reference respectively.

---

## 4. Implications for the #9 README

**Positioning copy**

1. The main keyword should avoid "auto mode": npm `pi-auto-mode` is r4vi's stalled package, `@czottmann/pi-automode` is the active strong player, and both SEO and mindshare are taken; "permission" is taken by pi-permission/pi-permission-system. **verdict is an unoccupied name, and the three-state semantics explain themselves** -- the naming paragraph in #9 is directionally right and should be promoted to the positioning axis: "most competitors' classifiers can only do binary allow/block; verdict is a verdict, not a switch".
2. Suggested one-line positioning skeleton: "Pi defaults to YOLO. verdict gives every tool call a three-state verdict: allow / ask / deny -- rules first, gray areas go to a classifier with full context, and any failure fails closed." (Consistent with requirement 1 of #9, verified not to collide with any competitor's wording)
3. Borrow two mature disclaimers: czottmann's "It is not a sandbox" and cc-safety-net's "Why not just use a sandbox?" -- the category leaders all explicitly state they are not a security boundary, and the pi-verdict README should make the same statement; this is a category consensus, not a show of weakness.

**What to emphasize** (ordered by strength of evidence)

4. Combination rather than single points: the four-piece "three-state × transcript context × fail-closed × zero-dependency single file" has no second implementation -- Table A can be trimmed directly into a lightweight README comparison table (suggest keeping only 4 columns: three-state? / carries context? / fail direction / runtime dependencies).
5. Evidence-driven branding: the three measured studies are an asset unique in the whole category (no competitor README attaches measured data); the cache-sim hit-rate data, thinking-param's three-layer forensics, and rule-engine-sim's port rejection respectively answer the question competitors cannot, "why is the default configured this way". czottmann's honest "Known limits" section is a model; pi-verdict can replace verbal admissions with research links.
6. `thinkingEnabled: false` deserves a one-line selling point: in contrast to czottmann explicitly requesting reasoning (its docs admit that a high reasoning level burns through the 512/1200 tokens and causes fail-closed), pi-verdict's choice is backed by the blackhole research -- but phrase it as "we measured it" rather than naming and belittling.

**What to avoid**

7. Do not use superlatives like "first/only/lightest": cc-safety-net has existed since 2026-01, and gotgenes has shipped 186 versions since May; "zero-dependency single file" can be said, "lightest" cannot (r4vi's 50KB is smaller).
8. Do not cite download/star comparisons (not published to npm, we lose on the data), and do not use "safer than X" style attacks naming a competitor.
9. Do not use fail-open competitors as a target: wangzexi is defunct, r4vi defaults to failOpen but it is configurable -- the attack point will go stale; state only your own fail-closed semantics positively (including non-interactive ask→deny, a detail no competitor README emphasizes).
10. Do not imply a lead in rule coverage: allowlist of 78 vs zhushanwen's 59 safe commands + AST, gotgenes' four-layer gate -- rule volume is not the differentiator, resolution (gray-area three-state) is.

---

## Endnote: data and sources

- Collection date: 2026-08-26 (npm download window 2026-07-27 → 2026-08-25; GitHub pushed_at / stars are that day's snapshot).
- npm registry: `npm view <pkg>` and api.npmjs.org/downloads -- @czottmann/pi-automode, @gotgenes/pi-permission-system, cc-safety-net, @zhushanwen/pi-permission, pi-auto-mode (r4vi), pi-perms (Mearman).
- GitHub README / docs (github.com):
  - czottmann/pi-automode (README, docs/automode-classifier-flow.md, docs/configuration.md)
  - gotgenes/pi-packages (packages/pi-permission-system/README.md, git trees counts)
  - kenryu42/cc-safety-net (README) + ccsafetynet.com/docs/installation (Pi integration section)
  - r4vi/pi-auto-mode (README, extensions/auto-mode.ts@master source, 1,171 lines)
  - flaxodev/pi-perms, Mearman/pi-perms, wangzexi/pi-auto-approve (README)
- Local source: `~/tmp/pi-permission-pkg/package` (@zhushanwen/pi-permission@1.3.3 npm tarball, unpacked; dependency and test counts re-checked that day).
- Reused from this repo: research/pi-model-call-and-ref-implementations.md §3.1 (zhushanwen), §3.3 (wangzexi), §3.4 (gotgenes Authorizer chain seam).
