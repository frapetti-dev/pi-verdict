# pi-verdict

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://pi.dev)

**pi-verdict is a minimal permission gate for [pi](https://pi.dev) in the style of Claude Code's auto mode: every tool call gets checked before it runs — allow, deny, or ask you first.**

- Minimal — two TypeScript files, zero runtime dependencies, no build step
- Built-in danger rules (each one's action configurable, with your own rules addable) and your own allow/deny rules settle the clear cases first, at zero latency
- Everything else goes to a model classifier that sees the conversation context
- Any uncertainty or failure fails closed; nothing ever runs silently

## The problem

pi has no built-in permission prompts — every tool call executes with the permissions of the pi process ([pi security docs](https://pi.dev/docs/latest/security)).

pi-verdict adds the missing gate: a model decides whether each call should run, based on the conversation context and your intent.

## Why three states

**verdict is an adjudication, not a switch.** Most classifiers in this space output a binary allow/block. Three states matter: `ask` routes genuinely ambiguous actions to a human (and degrades to `deny` in non-interactive sessions), so "not sure" never silently becomes "go ahead" — the goal is safe automation, not maximum automation: both approval fatigue and silent unsafe execution lose.

## Design principles

- **Fail closed** — uncertainty produces friction, never permission.
- **Deterministic floor before AI** — hard denies are never overridden by the classifier or user allow rules.
- **Semantics over syntax** — the classifier judges what an action *does*, not how long it is.
- **Judgments, not proofs** — a classifier `allow` is an informed opinion; the floor exists because that is all it is.
- **Minimal trusted input** — no tool results in the transcript (#22), zero path plaintext to the classifier ([PP-6](docs/adjudication-rules.md#pp-6-plaintext-confinement)).
- **Canonical identity** — lexical + realpath dual-form matching; a workspace-*looking* path is not trusted as one (#20/#21).
- **A permission gate, not a sandbox** — stack OS isolation on top; this gate never replaces it.

Full statement in [docs/security-principles.md](docs/security-principles.md); the normative rules behind every behavior described here are in [docs/adjudication-rules.md](docs/adjudication-rules.md); terms are defined in [CONTEXT.md](CONTEXT.md).

## Screenshots

![Demo: protected-path ask declined](docs/demo.gif)

![Automode Status](docs/images/status.png)
![Ask Permission](docs/images/asked.png)

## Quick start

Published on the GitHub Package Registry as `@frapetti-dev/pi-verdict` (not npmjs.com). GitHub Packages requires an authenticated npm client even for public packages, so first point the scope at it and supply a token with `read:packages` — add to `~/.npmrc`:

```
@frapetti-dev:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

(`GITHUB_TOKEN` here is a personal access token — classic or fine-grained with `read:packages` — exported in your shell, or hardcode it in `~/.npmrc` instead of the env-var form.)

```bash
# install from GitHub Packages (pi):
pi install npm:@frapetti-dev/pi-verdict

# install from GitHub Packages (oh-my-pi / omp):
omp plugin install npm:@frapetti-dev/pi-verdict

# or directly from git — try it once
pi --extension ./extensions/pi-verdict.ts

```

### Hosts

pi-verdict runs on both [pi](https://github.com/badlogic/pi-mono) and [oh-my-pi](https://github.com/can1357/oh-my-pi) (omp) — it self-anchors to whichever agent tree it is installed in, and follows the extension copy's own location on dual-install machines. On omp 18 the classifier's completion call falls back to the pi-ai compat API (still fail-closed). Details: [docs/configuration.md](docs/configuration.md#host-notes-pi-and-oh-my-pi).

| | pi | omp |
|---|---|---|
| install | `pi install npm:@frapetti-dev/pi-verdict` | `omp plugin install npm:@frapetti-dev/pi-verdict` |
| extension copy | `~/.pi/agent/extensions/` | `~/.omp/plugins/node_modules/pi-verdict/` (omp 18.1+; ≤18.0: under `agent/`) |
| user rules | `~/.pi/agent/config/pi-verdict.json` | `~/.omp/agent/config/pi-verdict.json` |
| credential file (S0 hard deny) | `~/.pi/agent/auth.json` | `~/.omp/agent/auth.json` |

- `/automode` — open the approval settings menu (opens at session scope; `←/→` change the selected row, `Tab` cycles the scope badge global · local · session, percent thresholds step with a bar, `a` shows every mode's settings); without a UI it prints the status
- `/automode status` — read-only status: effective approval mode and where it comes from, thresholds, shadow-cache stats
- `/automode default|yolo|noautodeny|off` — set the **approval mode** for this session (persisted per session id)
- `ctrl+shift+y` — cycle the session mode `default → yolo → noAutoDeny → off → default` silently (the footer is the only feedback; rebind or disable via `toggleShortcut`)
- `/verdict [global|local|session]` — edit the list rules (`allow`, `deny`, `denyPaths`, `tools`, `rules`) in a menu: open a list page, add / edit / remove entries inline, saved to the chosen scope and applied to the running session at once (`session` adds are appended to the local/global list for this session only); also hosts the `.omp gate` on/off switch, the `footer` style and the `mode in status bar` switch at every scope. Other scalar keys stay hand-edited
- `/rule [description]` — describe a rule in plain words ("always allow cargo build and test"); the session model writes one `allow` / `deny` / `denyPaths` / `tools` / `rules` entry, which is checked before you see it (up to 3 attempts: an `allow` rule an earlier layer such as the `.omp` gate would still stop is rejected, then a model critic reviews it); the preview shows which of this session's recent tool calls it would match, and you save it to the session only, the project or the global config (or edit it / amend it with feedback first). Escape cancels the waiting panel
- `verdict_settings` (agent tool, not a command) — lets the agent read the gate settings and propose changes (`set` / `unset` / `add` / `remove` at the `global`, `local` or `session` scope); every change opens a confirmation dialog and nothing is written without your approval. `denyPaths` are only ever returned as a count, and the tool is refused in subagents and when there is no UI ([ST-1](docs/adjudication-rules.md#st-1-actions-and-keys) to [ST-5](docs/adjudication-rules.md#st-5-writes))
- `verdict_grant` (agent tool, not a command) — lets the agent request a session-long, natural-language permission grant (`request` / `release` / `list`), optionally with protected-path access entries (`{path, access: read|write|full}`). You approve in a dialog (I approve / I reject / ask for clarification or revision); in `yolo` the judge and the configured fallback classifier must both allow. Active grants are given to every classifier prompt as authoritative within their literal scope; protected-path entries only feed the coverage check before a `denyPaths` / `.omp` ask. A classifier, yolo-retry or declined block tells the agent it may request a grant ([GR-1](docs/adjudication-rules.md#gr-1-request-tool) to [GR-6](docs/adjudication-rules.md#gr-6-lifetime-revocation-and-visibility))
- `/grants [list|revoke <id>|revoke all]` — list the active permission grants or revoke them (bare call with a UI opens a menu); a revocation also tells the agent. While grants exist the footer shows a key segment with their count, and on omp the status bar shows `🔑 N` (`grantStatus` key, default on)
- built-in rules are configurable (`dangerRules`, `pathRules` in `pi-verdict.json`, or the `danger rules & path tiers` page of `/verdict`): every danger rule and path tier takes the action `deny`, `ask` or `allow` (`allow` = no judgment, the classifier decides); `false` removes a built-in danger rule and `{"pattern": …}` adds your own. A permission grant naming the rule id (`verdict_grant` `rules`) or the path can lift a built-in deny. Example: `{"dangerRules": {"gh-release": "ask", "npm-publish": {"pattern": "\\bnpm\\s+publish\\b"}}, "pathRules": {"s0-secret": "ask"}}` ([RL-5](docs/adjudication-rules.md#rl-5-danger-rules), [PG-3](docs/adjudication-rules.md#pg-3-s0-secrets), [GR-5](docs/adjudication-rules.md#gr-5-coverage-check))
- `/automode-setup [global|local|session]` — draft the **root rule**, the classifier's single baseline policy, from this session and the project (also reachable from the `/automode` panel with `r`): the menu holds the generator inputs — `strictness` (`relaxed` / `balanced` / `strict`), `history` (this session's user messages and tool calls, never tool output), `codebase` (project docs, manifests, CI files and git remotes with credentials removed; secret and `denyPaths` files are skipped) and your `clarifications` (trusted instructions, never sent to the classifier) — and `g` generates. The session model drafts the policy (up to 3 attempts with a model critic, at most 4000 characters), you review the preview and save it to the session, project or global config; your `rules` apply on top of it and win on conflict ([RR-1](docs/adjudication-rules.md#rr-1-storage-and-resolution) to [RR-4](docs/adjudication-rules.md#rr-4-loop-and-review))
- footer status (`footer` key): `full` = Nerd Font powerline blocks (gate state, risky settings, classifier model, verdict counters, badges), `compact` = one plain line, `off` = none; a switched-off gate always shows as `AUTO OFF · ungated`
- mode chip in the prompt status bar (`modeStatus` key, default on): `🛡 AUTO` / `🛡 YOLO` / `🛡 NO-AUTODENY` / `🛡 OFF · ungated` through `setStatus`; on omp it appears in the status line's `status` segment, on pi it is hidden while the footer is on (the footer already shows the mode) and shown with `footer: "off"`

| Option | Default | Description |
|---|---|---|
| `--verdict-mode default\|yolo\|noAutoDeny\|off` | config `mode` | approval mode for this session (session scope) |
| `--auto-mode-model provider/id` | session model | classifier model ("self-reflection" by default) |
| `--auto-mode-debug` | off | full verdict notifications |
| `PI_AUTO_MODE_MODEL` | — | env form of the model flag |
| `PI_AUTO_MODE_DEBUG=1` | off | env form of debug (flag wins) |

### Configuration (`<agentDir>/config/pi-verdict.json`)

A minimal config (the first run writes a fuller starter template, including a starter `tools` allowlist and a starter `denyPaths` list):

```json
{
  "allow": ["^ls\\b", "^git (status|log|diff)\\b"],
  "deny": ["^/etc/"],
  "denyPaths": ["~/.ssh/", "~/.gnupg"],
  "classifierModel": null
}
```

- `allow`/`deny` are JS regex arrays tested against the full command string (command tools) or the resolved path (file tools); **`deny` wins over `allow`**, both beat the classifier ([RL-2](docs/adjudication-rules.md#rl-2-evaluation-order), [RL-4](docs/adjudication-rules.md#rl-4-user-regexes)).
- `denyPaths` are plain paths you declare **protected**: any touch triggers a terminal ask you adjudicate (non-interactive → deny). The classifier never learns the paths themselves, only that they exist ([PP-5](docs/adjudication-rules.md#pp-5-hit-is-a-terminal-ask), [PP-6](docs/adjudication-rules.md#pp-6-plaintext-confinement), [PP-7](docs/adjudication-rules.md#pp-7-existence-hint)).
- There is no built-in **command** allowlist — every "always allow" claim for a command is yours ([why](docs/configuration.md#why-no-built-in-command-allowlist)); path grading does mechanically allow non-sensitive reads and in-project writes ([PG-4](docs/adjudication-rules.md#pg-4-reads), [PG-5](docs/adjudication-rules.md#pg-5-writes)).

Every key with its default, the approval modes, scopes (`session` > `local` > `global`), project trust, thresholds, the fallback cascade, the subagent gate, audit and the settings menus are in [docs/configuration.md](docs/configuration.md); the normative rules are in [docs/adjudication-rules.md](docs/adjudication-rules.md).

### Jev decisions backend (experimental)

1. Install a version that ships the adapter (v0.8+): `pi install npm:@frapetti-dev/pi-verdict`
2. Pick a transport (both serve the same decisions wire contract):
   - **OpenRouter (default)**: run `/login openrouter` inside pi, or `export OPENROUTER_API_KEY=sk-or-v1...` in your shell
   - **TypeSafe direct (official v1 API)**: grab a self-service key at console.typesafe.ai, then `export TYPESAFE_API_KEY=apikey_...` and `export PI_VERDICT_JEV_TRANSPORT=typesafe`
3. Point the classifier at jev (applies to new sessions)
   - persistent: edit `~/.pi/agent/config/pi-verdict.json` outside pi and set `{ "classifierModel": "typesafe/jev-latest" }`
   - or try it once: `PI_AUTO_MODE_MODEL=typesafe/jev-latest pi`

**Limits**:
- **Transports**: OpenRouter decisions (default) or TypeSafe direct — on the TypeSafe transport per-call cost shows $0 (its API does not report it)
- **Hosts**: pi and omp. On omp the model is registered by name and called directly, without omp's dispatch; it must never be selected as the session model (no text generation — selecting it warns) ([JV-5](docs/adjudication-rules.md#jv-5-omp-support), [JV-6](docs/adjudication-rules.md#jv-6-misuse-guard))
- **Escape hatch**: `PI_VERDICT_JEV_URL` overrides the active transport's endpoint (OpenRouter's is an alpha API)
- **Approve dialog**: in the interactive TUI the ask prompt shows the code under review (bash command, write content, edit blocks) as a syntax-highlighted block, and — when the ask comes straight from jev — a theme-colored allow/ask/deny probability bar with its percentages centered above it (pill caps with `footer: "full"`), a confidence bar beneath it (fill colored against the `confidenceThreshold` floor, tick and `min N%` at the floor), and a `concern:` line (jev's risk category for the action, from a second `concern` question sent in the same request). Other hosts and RPC mode fall back to the plain-text confirm.

jev's calibrated confidence is exactly what the confidence floor keys on — pair it with a second layer (`"confidenceThreshold": 50, "classifierFallbackModel": "anthropic/claude-haiku-4-5"`) so its low-confidence calls go to a deeper model instead of standing ([CS-1](docs/adjudication-rules.md#cs-1-confidence-floor)).

Requires pi ≥ 0.84. Works in interactive and non-interactive (`-p`/json/rpc) sessions; in non-interactive modes `ask` degrades to `deny`.

## How it compares

| | three-state verdict | classifier sees context | fail direction | runtime deps |
|---|---|---|---|---|
| **pi-verdict** | ✅ allow / ask / deny | ✅ recent user intent + tool calls | **closed** (errors/timeout/bad output → deny; headless ask → deny) | **0** |
| [@czottmann/pi-automode](https://github.com/czottmann/pi-automode) | rules 3-state, classifier 2-state | ✅ budgeted transcript | closed | 1 |
| [@zhushanwen/pi-permission](https://www.npmjs.com/package/@zhushanwen/pi-permission) | ✅ (outcome) | ❌ single-turn, no context | closed (→ ask) | 4 |
| [@gotgenes/pi-permission-system](https://github.com/gotgenes/pi-packages) | ✅ deterministic only | — (no built-in classifier) | closed | 3 |

Full landscape: [`research/pi-permission-landscape.md`](research/pi-permission-landscape.md) · convergence analysis with the closest architectural relative: [`research/pi-automode-convergence.md`](research/pi-automode-convergence.md).

Honest framing: pi-automode and pi-verdict have **converged on the same architecture** (deny floor → user rules → classifier, fail-closed — see the convergence analysis). What remains distinct here: a classifier that can say `ask` (runtime human-in-the-loop, not just rule-declared), a built-in floor you can turn off (`builtinDenyFloor` — user sovereignty), a zero-dependency single file ([one readable file](extensions/pi-verdict.ts), still one file on purpose), and the measurement habit — every design decision in this repo is backed by shipped research.

## Pipeline

```
tool_call
  │
  ├─ 1. Rule layer (deterministic, zero latency)
  │     ├─ your deny rules: first, beat your allow rules
  │     ├─ built-in rules (each action configurable: deny | ask | allow = classifier):
  │     │   command danger rules (dangerRules, add your own) and file path tiers S0–S3 (pathRules)
  │     │   a permission grant naming the rule id or the path can lift a built-in deny/ask
  │     ├─ gateOmpDir: any .omp directory access → terminal ask
  │     ├─ denyPaths: protected paths → terminal ask, before your allow rules;
  │     │   the classifier sees an existence hint only
  │     │   a permission grant that lists the path can lift the ask (grant coverage check:
  │     │   judge + fallback must both confirm the call is within the grant)
  │     ├─ your allow rules / tools allowlist / settings tool / grant tool → allow
  │     └─ no built-in command allowlist — every "always allow" claim for a command is yours
  │
  ├─ 2. Gray zone → model classifier (defaults to session model — "self-reflection")
  │     ├─ input: CC-style <transcript> — recent user intent + tool calls,
  │     │        action under review always last
  │     ├─ policy: root rule (baseline), your classification rules on top, then active permission grants
  │     ├─ output contract: <verdict>allow|ask|deny</verdict> prefix-anchored
  │     └─ confidence floor → mode thresholds → fallback cascade (shadow | enforce)
  │
  └─ 3. Three-state adjudication, shaped by the approval mode
        ├─ allow → pass
        ├─ deny  → block, reason returned to the agent
        └─ ask   → human confirm; non-interactive modes degrade to deny

  default = deny/ask/allow · yolo = deny/allow (uncertain → blocked with an explain/rewrite
  request, never a prompt) · noAutoDeny = ask/allow (denies become asks) · off = ungated (session-only)

  [shadow cache] observe-only telemetry alongside 2/3, never changes a verdict
```

**fail-closed**: classifier exception / timeout (25s per attempt, two attempts) / contract violation → deny. Never silently allow.

## Evidence-driven, not vibes-driven

Design decisions here are settled by measurement, and the lab notes ship with the repo:

- [`research/cache-sim`](research/cache-sim/README.md) — replayed 1.2k+ real classifier verdicts to measure verdict-cache hit rate (**3.2%** → cache deferred, shadow-mode telemetry built instead)
- [`research/thinking-param-blackhole.md`](research/thinking-param-blackhole.md) — three-layer forensic root-cause of thinking models burning the classifier budget; why the fix is `thinkingEnabled: false`
- [`research/rule-engine-sim`](research/rule-engine-sim/README.md) — measured a tree-sitter rule-engine port against 746 real bash calls (**absorbs 0 gray calls**) and rejected it
- [`research/pi-permission-landscape.md`](research/pi-permission-landscape.md) — the competitive landscape this README's positioning is checked against
- [`research/rule-layer-security-audit.md`](research/rule-layer-security-audit.md) — rule-layer bypass testing (8/8 reproduced → fixed architecturally in 0.2.0)
- [`research/pi-automode-convergence.md`](research/pi-automode-convergence.md) — where this project genuinely converges with pi-automode, and what remains distinct
- [`research/claude-code-classifier-prompts.md`](research/claude-code-classifier-prompts.md) — structural reconstruction of Claude Code's classifier design (via self-hosted Langfuse observations) that this extension's transcript contract descends from

## Status & limitations

- no built-in **command** allowlist by design (see the [bypass writeup](research/rule-layer-security-audit.md)); with an empty `allow` config most commands go to the classifier — point `--auto-mode-model` at a fast model if per-call latency matters
- path grading applies to file tools only: bash and powershell command strings are matched by the danger rules alone, so e.g. `cat ~/.ssh/id_rsa` goes to the classifier rather than the deterministic S0 deny (the file-tool spelling `read ~/.ssh/id_rsa` does deny) ([PG-6](docs/adjudication-rules.md#pg-6-commands-are-not-path-graded))
- on Windows the built-in rules cover bash-shaped patterns only — PowerShell-native dangerous commands (`Remove-Item -Recurse -Force`, `Invoke-Expression`, `Set-ExecutionPolicy`, …) rely on the classifier (fail-closed)
- AGENTS.md is not passed to the classifier as downweighted intent evidence (Claude Code does this)
- parallel gray-zone calls are adjudicated serially
- self-reflection means the session model adjudicates — point `--auto-mode-model` at a lighter model if verdict latency/cost matters (open question tracked in the issue tracker)
- shadow cache is observe-only by decision; the serving switch is a one-line change once measured hit rates justify it
- `denyPaths` bash extraction is token-level ([PP-2](docs/adjudication-rules.md#pp-2-candidate-extraction)): command substitution, base64-embedded paths and external script contents produce no hit signal — those calls fall back to the classifier's existence-hint vigilance. MCP and custom tools bypass the extractor entirely (their gray-zone adjudication still carries the hint). Protected-path matching is base-tier only ([PP-4](docs/adjudication-rules.md#pp-4-base-tier-only)): a nonexistent target written through a symlinked directory rebuilds no real form and produces no hit — that indirection falls to the hint vigilance too. Honest framing: the deterministic layer is obfuscatable, which is exactly why a hit routes to *you* rather than silently deciding
- `denyPaths` bash tokens contain no spaces: a *declared* path containing spaces cannot be spelled in a bash command in a way the extractor sees — `cat "/path with space/x"` splits into two tokens and never hits (file tools still hit, their path is not tokenized). A glob covering the final segment of a base (`cat /proj/pers*` against `denyPaths: ["/proj/personal"]`) also misses — the base's own name never appears literally. A recursive search issued from a shell misses in both spellings — no path argument (defaults to the cwd, e.g. a bare `rg foo`) or a parent-directory argument (`rg foo <parent-of-a-declared-path>`): an argument-less command contributes no token at all and bash tokens otherwise compare one-directionally, while the file tools' bidirectional subtree compare covers the same shapes issued through `grep`/`find`/`ls`. All three holes fall back to the classifier's existence hint, alongside substitution/base64 above
- the gate's own config and installed extension copy carry no special protection beyond the forced `.omp` gate ([PP-8](docs/adjudication-rules.md#pp-8-forced-omp-gate)): agent-side writes to them are graded like any other file, by the same rule layer and classifier as everything else

**verdict is not a sandbox.** It runs inside the pi process and adjudicates tool calls; it does not contain malicious code, protect against a compromised process, or guard manual `!` shell escapes. For isolation, use an OS-level sandbox.

The name: the three-state **verdict** is the core concept. The UX keeps `/automode` — the mode concept traces back to Claude Code's auto mode, which this project borrows its transcript design from.

## Development

```bash
bun install
bun run typecheck
bun test          # offline stub tests: deny floor, user rules, denyPaths, bypass regression, classifier retry, shadow cache, commands, toggle shortcut
```

Issue tracker: GitHub issues ("map" issue #1 indexes them). Rule changes are edits to [docs/adjudication-rules.md](docs/adjudication-rules.md) plus a `CHANGELOG.md` entry.

## License

[MIT](LICENSE)
