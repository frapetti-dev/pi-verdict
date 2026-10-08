# pi-verdict

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/pi-verdict)](https://www.npmjs.com/package/pi-verdict)
[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://pi.dev)

**pi-verdict is a minimal permission gate for [pi](https://pi.dev) in the style of Claude Code's auto mode: every tool call gets checked before it runs — allow, deny, or ask you first.**

- Minimal — just 1k+ lines of code
- Built-in danger rules and your own allow/deny rules settle the clear cases first, at zero latency
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
- **Minimal trusted input** — no tool results in the transcript (#22), zero path plaintext to the classifier (ADR-0002).
- **Canonical identity** — lexical + realpath dual-form matching; a workspace-*looking* path is not trusted as one (#20/#21).
- **A permission gate, not a sandbox** — stack OS isolation on top; this gate never replaces it.

Full statement in [docs/security-principles.md](docs/security-principles.md).

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

- `/automode` — open the quick settings panel (cycling toggles for the mode and the enum keys, a slider for every percent threshold; a `scope` row picks session / project / user); without a UI it prints the status
- `/automode status` — read-only status: effective approval mode and where it comes from, thresholds, shadow-cache stats
- `/automode default|yolo|noautodeny|off` — set the **approval mode** for this session (persisted per session id)
- `ctrl+shift+y` — cycle the session mode `default → yolo → noAutoDeny → off → default` silently (the footer is the only feedback; rebind or disable via `toggleShortcut`)
- `/verdict [user|local]` — edit the list rules (`allow`, `deny`, `denyPaths`, `tools`, `rules`) of the global (`user`) or project (`local`) config interactively: add / edit / remove entries, saved to disk and applied to the running session at once; also hosts the `gateOmpDir` on/off switch and the `footer` style. Other scalar keys stay hand-edited
- footer status (`footer` key): `full` = Nerd Font powerline blocks (gate state, risky settings, classifier model, verdict counters, badges), `compact` = one plain line, `off` = none; a switched-off gate always shows as `AUTO OFF · ungated`

| Option | Default | Description |
|---|---|---|
| `--verdict-mode default\|yolo\|noAutoDeny\|off` | config `mode` | approval mode for this session (session scope) |
| `--auto-mode-model provider/id` | session model | classifier model ("self-reflection" by default) |
| `--auto-mode-debug` | off | full verdict notifications |
| `PI_AUTO_MODE_MODEL` | — | env form of the model flag |
| `PI_AUTO_MODE_DEBUG=1` | off | env form of debug (flag wins) |

### User rules (`~/.pi/agent/config/pi-verdict.json`)

```json
{
  "allow": ["^ls\\b", "^git (status|log|diff)\\b"],
  "deny":  ["rm ", "docker ", "^/etc/"],
  "denyPaths": [
    "~/.ssh/",
    "~/.profile",
    "~/.gnupg",
    "~/.mc",
    "~/.zshrc",
    "~/.bashrc"
  ],
  "builtinDenyFloor": true,
  "gateOmpDir": true,
  "footer": "full",
  "classifierModel": null,
  "explainGateModel": null,
  "explainGatePrompt": null,
  "toggleShortcut": "ctrl+shift+y",
  "audit": false,
  "notifyAllows": false,
  "mode": "default",
  "confidenceThreshold": null,
  "defaultDenyThreshold": null,
  "defaultAllowThreshold": null,
  "yoloDenyThreshold": null,
  "noAutoDenyAllowThreshold": null,
  "yoloDenyPaths": "deny",
  "yoloOmpDir": "deny",
  "classifierFallbackModel": null,
  "classifierFallbackMode": "shadow",
  "subagentGate": "off",
  "subagentAskTimeoutMs": 60000
}
```

- `allow`/`deny` are JS regex arrays; **`deny` wins over `allow`**, both beat the classifier
- `denyPaths` are plain paths you declare **protected** — touches trigger a terminal ask you adjudicate (non-interactive → deny); the classifier never learns the paths themselves, only that they exist. `grep`/`find`/`ls` compare their whole **search scope**: an omitted `path` (pi's default: the current directory) or a parent directory of a declared path triggers the ask as well. A fresh install pre-fills a **starter list** (`~/.ssh/`, `~/.gnupg`, `~/.mc`, shell rc/profile files), active from the first session after the initial run (any config change applies to new sessions) — a pre-filled *user declaration*, not a built-in floor: edit or empty it freely, add your own (`~/Documents/private`, …) alongside; existing configs are never rewritten
- `builtinDenyFloor: false` turns off the built-in danger/path floor (your risk)
- `gateOmpDir` (default `true`) is the **forced `.omp` gate**: any file-tool path or bash command touching a `.omp` directory (lexical or symlink-resolved; `~/.omp`, `<project>/.omp`, …) triggers a terminal ask you adjudicate (non-interactive → deny). It runs after the built-in floor and your `deny` rules and before `denyPaths`/`allow`, so an `allow` regex cannot skip it. `false` disables it; toggle it from `/verdict`. `grep`/`find`/`ls` are checked on their own target only (a recursive search that merely traverses a nested `.omp` is not an access)
- `footer` (default `"full"`): style of the footer status. `"full"` renders Nerd Font powerline blocks — approval mode chip (`AUTO` / `YOLO` / `NO-AUTODENY` / `AUTO OFF · ungated`), risky settings (`floor off`, `.omp gate off`, in yolo `denyPaths allow` / `.omp allow`), the classifier model (`↺` = inherited session model, `⚠ ↺` = configured model unavailable so the session model is used, `↳ <id>·shadow|enforce` = fallback model), per-session verdict counters (allow / ask / deny: final pipeline verdicts of root-session calls, reset at session start) and info badges (`≥N%` for `confidenceThreshold`, `deny≥N%` / `allow≥N%` for the active mode's thresholds, `subagent normal|auto`). `"compact"` is one plain text line with the same content minus counters; `"off"` clears the status. Hosts whose theme lacks `bg`/`getBgAnsi` render compact. The footer never shows command or path text (ADR-0002). Editable from `/verdict`; an invalid value warns and falls back to `"full"`.
- `classifierModel` pins the classifier model, e.g. `"zai/glm-5.3-flash:low"` (thinking suffix supported; default: session model with thinking off)
- `classifierModel: "typesafe/jev-latest"` opts into the bundled **jev decisions adapter** — gray-zone verdicts via TypeSafe's jev (OpenRouter by default, or TypeSafe's official API directly with `PI_VERDICT_JEV_TRANSPORT=typesafe`); experimental, see [ADR-0003](docs/adr/0003-jev-decisions-adapter.md)
- `explainGateModel` / `explainGatePrompt` configure the **EXPLAIN-GATE role** behind two extra options of the interactive ask dialog. **Explain…** asks an optional question of the EXPLAIN-GATE model (default: session model; `provider/id[:thinking]`) together with the held action and the gate's stated reason; the answer appears in the re-opened dialog (advisory — never sent to the agent), and with an empty question the default prompt (`explainGatePrompt`, built-in: "Explain what this action does and why the gate held it for confirmation.") is used. **No** is an inline text field while highlighted (`→ No, <text>`): Enter with empty text is a plain decline, with text it declines and tells the agent why (`user declined, saying: "…"`); Escape declines without text. Explain is **not offered for protected-path asks** (`denyPaths`, `.omp` gate) because their path plaintext must not reach a model provider ([ADR-0002](docs/adr/0002-deny-paths-deterministic-ask.md)). RPC mode and hosts without the rich dialog keep the plain Yes/No confirm
- The ask dialog always shows the tool call's code (bash command, write content, edit blocks); code over 40 lines / 4000 chars / 3 edit blocks is truncated and `ctrl+o` expands or collapses it inside the dialog (on a host exposing `getToolsExpanded`/`setToolsExpanded` the dialog follows the host's tool expansion, which is restored on close). The `verdict` widget row shows `awaiting your approval` while it waits, and every allowed call that did not pass by one of your own rules gets a one-line label row after its block (`<shield> bash <icon> classifier`, plus a probability bar and `allow 92%` for jev verdicts) so you can see how it passed; rule allows are recorded but not rendered. On omp the label is an aside message the agent also sees; on pi it is TUI-only. It never contains the reason or any path.
- `audit: true` records every **gray-zone adjudication** (the full transcript sent to the classifier, its raw response, the parsed verdict) as JSONL under `~/.pi/agent/verdicts/<sessionId>.jsonl` — one file per session, the 20 most recent kept. Interactive asks also record your answer (`userAnswer` ground truth, written after the confirm resolves), and protected-path asks are recorded too (#62); rule allow/deny stays unaudited. Local-only and full-fidelity (protected-path plaintext may appear — it never leaves your machine; [ADR-0002](docs/adr/0002-deny-paths-deterministic-ask.md) boundary note); the agent can neither read nor write the directory. `/automode` shows the audit state and path while on
- `notifyAllows: true` notifies on every **classifier allow** (reason + action line — e.g. jev's probability breakdown); default `false` keeps passes silent. Mechanical passes (your own allow rules, protected-path confirms) never notify; shadow-cache annotations stay debug-only; with both switches on the notification appears once
- `mode` (default `"default"`) is the **approval mode**: `default` = deny / ask / allow; `yolo` = deny / allow, never prompts — an uncertain call is blocked with an *explain or rewrite* request (block tag `yolo-retry`) and the classifier is told no human is available; `noAutoDeny` = ask / allow — every auto-review deny (floor, `deny` rules, classifier) becomes a confirmation prompt (non-interactive still denies); `off` = ungated, **session-only** (`/automode off` / the shortcut; a `mode: "off"` in a config file is ignored with a warning). Every approval key can be set at **user** (this file), **project** (trusted `<project>/.pi|.omp/pi-verdict.json`) or **session** scope — session wins, is persisted under `<agentDir>/config/pi-verdict-sessions/<sessionId>.json` (50 newest kept) and survives `/reload`; `/automode status` shows where each value comes from. In yolo, `yoloDenyPaths` / `yoloOmpDir` (`deny` default | `allow`) decide what a `denyPaths` / `.omp` gate hit does — never a prompt, never path plaintext in the block ([ADR-0005](docs/adr/0005-approval-modes.md))
- `confidenceThreshold` (optional, [ADR-0004](docs/adr/0004-classifier-fallback-cascade.md); formerly `classifierMinConfidence`) sets the **confidence floor**: a jev verdict below it is demoted — cascaded to `classifierFallbackModel` if set (`shadow` = the second layer records its opinion and you are asked; `enforce` = the second layer adjudicates, except a demoted deny can never be auto-allowed), otherwise asked of you directly. At/above the floor the first layer is autonomous. A natural pairing: jev first + a haiku-class fallback
- `defaultDenyThreshold` / `defaultAllowThreshold` (default mode), `yoloDenyThreshold` (yolo), `noAutoDenyAllowThreshold` (noAutoDeny) — optional 0–100 **jev probability thresholds**: deny / allow only when jev's probability for that verdict reaches the threshold (default: deny first, then allow, else ask; yolo: deny else allow; noAutoDeny: allow else ask). `null` = jev's own choice. Applies to the first-layer jev verdict only; in yolo / noAutoDeny the jev question itself is restricted to the verdicts the mode can use
- `subagentGate` (omp only) decides what happens to `ask`s raised inside **subagents**, which have no UI of their own: `"off"` (default) leaves subagents ungated; `"normal"` shows the confirmation dialog on the root session's UI, labeled with the subagent; unanswered within `subagentAskTimeoutMs` (default 60000 ms) or with no root UI, it resolves via `classifierFallbackModel` — only an explicit `allow` from it permits the call, everything else denies; `"auto"` never prompts and always resolves that way. Protected-path / `.omp` asks never auto-allow. Set omp's `extensionHandlers.toolCallTimeoutMs` ≥ `subagentAskTimeoutMs + 60000`

No built-in allowlist — every "always allow" claim is yours ([why](docs/configuration.md#why-no-built-in-allowlist)). Full reference: [docs/configuration.md](docs/configuration.md).

### Jev decisions backend (experimental — [ADR-0003](docs/adr/0003-jev-decisions-adapter.md))

1. Install a version that ships the adapter (v0.8+): `pi install npm:@frapetti-dev/pi-verdict`
2. Pick a transport (both serve the same decisions wire contract):
   - **OpenRouter (default)**: run `/login openrouter` inside pi, or `export OPENROUTER_API_KEY=sk-or-v1...` in your shell
   - **TypeSafe direct (official v1 API)**: grab a self-service key at console.typesafe.ai, then `export TYPESAFE_API_KEY=apikey_...` and `export PI_VERDICT_JEV_TRANSPORT=typesafe`
3. Point the classifier at jev (applies to new sessions)
   - persistent: edit `~/.pi/agent/config/pi-verdict.json` outside pi and set `{ "classifierModel": "typesafe/jev-latest" }`
   - or try it once: `PI_AUTO_MODE_MODEL=typesafe/jev-latest pi`

**Limits**:
- **Transports**: OpenRouter decisions (default) or TypeSafe direct — on the TypeSafe transport per-call cost shows $0 (its API does not report it)
- **Hosts**: pi only. On omp the setting warns and falls back to the session model; and it must never be selected as the session model (no text generation — selecting it warns)
- **Escape hatch**: `PI_VERDICT_JEV_URL` overrides the active transport's endpoint (OpenRouter's is an alpha API)
- **Approve dialog**: in the interactive TUI the ask prompt shows the code under review (bash command, write content, edit blocks) as a syntax-highlighted block, and — when the ask comes straight from jev — a theme-colored allow/ask/deny probability bar with its percentages centered above it (pill caps with `footer: "full"`), a confidence bar beneath it (fill colored against the `confidenceThreshold` floor, tick and `min N%` at the floor), and a `concern:` line (jev's risk category for the action, from a second `concern` question sent in the same request). Other hosts and RPC mode fall back to the plain-text confirm.

jev's calibrated confidence is exactly what the confidence floor keys on — pair it with a second layer (`"confidenceThreshold": 50, "classifierFallbackModel": "anthropic/claude-haiku-4-5"`) so its low-confidence calls go to a deeper model instead of standing ([ADR-0004](docs/adr/0004-classifier-fallback-cascade.md)).

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
  │     ├─ built-in deny floor: bash danger regexes + path sensitivity S0–S5
  │     ├─ your rules: user deny beats user allow
  │     ├─ gateOmpDir: any .omp directory access → terminal ask, before denyPaths
  │     ├─ denyPaths (ADR-0002): protected paths → terminal ask,
  │     │   before user allow; classifier sees an existence hint only
  │     └─ no built-in allowlist — every "always allow" claim is yours to make
  │
  ├─ 2. Gray zone → model classifier (defaults to session model — "self-reflection")
  │     ├─ input: CC-style <transcript> — recent user intent + tool calls,
  │     │        action under review always last
  │     └─ output contract: <verdict>allow|ask|deny</verdict> prefix-anchored
  │
  └─ 3. Three-state adjudication
        ├─ allow → pass
        ├─ deny  → block, reason returned to the agent
        └─ ask   → human confirm; non-interactive modes degrade to deny

  Approval mode reshapes step 3: default = deny/ask/allow · yolo = deny/allow (uncertain → blocked
  with an explain/rewrite request, never a prompt) · noAutoDeny = ask/allow (denies become asks)

  [shadow cache] observe-only telemetry alongside 2/3, never changes a verdict
```

**fail-closed**: classifier exception / timeout (25s) / contract violation → deny. Never silently allow.

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

- no built-in allowlist by design (see the [bypass writeup](research/rule-layer-security-audit.md)); with an empty `allow` config most commands go to the classifier — point `--auto-mode-model` at a fast model if per-call latency matters
- the path sensitivity floor applies to file tools only: bash command strings are matched by the danger regexes alone, so e.g. `cat ~/.ssh/id_rsa` goes to the classifier rather than the deterministic S0 deny (the file-tool spelling `read ~/.ssh/id_rsa` does deny)
- on Windows the built-in floor covers bash-shaped patterns only — PowerShell-native dangerous commands (`Remove-Item -Recurse -Force`, `Invoke-Expression`, `Set-ExecutionPolicy`, …) rely on the classifier (fail-closed)
- AGENTS.md is not passed to the classifier as downweighted intent evidence (Claude Code does this)
- parallel gray-zone calls are adjudicated serially
- self-reflection means the session model adjudicates — point `--auto-mode-model` at a lighter model if verdict latency/cost matters (open question tracked in the issue tracker)
- shadow cache is observe-only by decision; the serving switch is a one-line change once measured hit rates justify it
- `denyPaths` bash extraction is token-level ([ADR-0002](docs/adr/0002-deny-paths-deterministic-ask.md)): command substitution, base64-embedded paths and external script contents produce no hit signal — those calls fall back to the classifier's existence-hint vigilance. MCP and custom tools bypass the extractor entirely (their gray-zone adjudication still carries the hint). Path normalization is base-tier only (ADR-0002): a nonexistent target written through a symlinked directory rebuilds no real form and produces no hit — that indirection falls to the hint vigilance too. Honest framing: the deterministic layer is obfuscatable, which is exactly why a hit routes to *you* rather than silently deciding
- `denyPaths` bash tokens contain no spaces: a *declared* path containing spaces cannot be spelled in a bash command in a way the extractor sees — `cat "/path with space/x"` splits into two tokens and never hits (file tools still hit, their path is not tokenized). A glob covering the final segment of a base (`cat /proj/pers*` against `denyPaths: ["/proj/personal"]`) also misses — the base's own name never appears literally. A recursive search issued from a shell misses in both spellings — no path argument (defaults to the cwd, e.g. a bare `rg foo`) or a parent-directory argument (`rg foo <parent-of-a-declared-path>`): an argument-less command contributes no token at all and bash tokens otherwise compare one-directionally, while the file tools' bidirectional subtree compare covers the same shapes issued through `grep`/`find`/`ls`. All three holes fall back to the classifier's existence hint, alongside substitution/base64 above
- the gate's own config and installed extension copy carry no special protection — agent-side writes to them are graded like any other file, by the same rule layer and classifier as everything else (self-protection removed, see [ADR-0001](docs/adr/0001-self-protection-layer.md))

**verdict is not a sandbox.** It runs inside the pi process and adjudicates tool calls; it does not contain malicious code, protect against a compromised process, or guard manual `!` shell escapes. For isolation, use an OS-level sandbox.

The name: the three-state **verdict** is the core concept. The UX keeps `/automode` — the mode concept traces back to Claude Code's auto mode, which this project borrows its transcript design from.

## Development

```bash
bun install
bun run typecheck
bun test          # offline stub tests: deny floor, user rules, denyPaths, bypass regression, classifier retry, shadow cache, commands, toggle shortcut
```

Issue tracker and decision records live in the GitHub issues ("map" issue #1 indexes them).

## License

[MIT](LICENSE)
