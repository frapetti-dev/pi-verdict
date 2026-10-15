# pi-automode convergence comparison: pi-verdict@0.2.0 vs the current state of @czottmann/pi-automode

Collected 2026-08-27; comparison source is czottmann/pi-automode `main@718aa4f` (v1.13.0 + 2 commits that day, latest commit 2026-08-26 13:46 UTC: #30 classifier streaming-timeout enforcement). The pi-verdict side uses 0.2.0 baseline facts and was not re-researched.

## 1. TL;DR

1. **No essential difference in decision approach remains**: the core architecture "deterministic dangerous floor -> user rules -> deterministic allow fast path -> classifier fallback -> fail-closed on every path" has been czottmann's fixed design since v1.0.0 on 2026-06-14, and pi-verdict 0.2.0 independently converged on the same shape after removing the allowlist.
2. **The remaining differences are not architecture but three layers**: where ask sits semantically (three-state classifier vs rule layer + two-state classifier), rule-engine engineering depth (unbash AST vs regex), and the diagnostics/tamper-protection extras -- all three are "copyable"; the only things truly "not copyable" are the zero-dependency single-file form and the evidence-driven methodology.
3. **Verdict on the independent project's survival**: its value is mostly the methodology narrative + two experimental features not adopted upstream (three-state ask, shadow-cache telemetry); the positioning should shrink from "architectural differentiation" to "testbed + evidence base", while evaluating in parallel how to feed features upstream.

## 2. Convergence points (architecture-level)

| # | Convergence point | czottmann (path) | pi-verdict (path) |
|---|---|---|---|
| 1 | deny-first overall pipeline shape | present since the v1.0.0 (06-14) debut | reached in 0.2.0 (August) after removing the allowlist |
| 2 | deterministic dangerous floor before the model | v1.0.0: TLS weakening/profile/authorized_keys/cron/self-edit | 0.2.0: 14 dangerous bash regexes + path sensitivity S0-S5 |
| 3 | no built-in deterministic allowlist | `permissions.allow` defaults to `[]`; built-in allow only serves as a soft-deny exception in the classifier prompt (covers soft-deny only, never overrides hard-deny) | removed entirely in 0.2.0 (audit conclusion: soundness needs a shell AST) |
| 4 | floor overrides every allow path | the hard-deny check sits before the three allow tiers and cannot be bypassed by allow rules | floor sits before user allow |
| 5 | classifier evidence = user text + tool-call inputs, excluding tool results and assistant prose | token-budgeted selection (4000 each, keeps first and last user messages, marks omissions) | fixed window (last 5 user messages + 10 tool calls, action under review at the end) |
| 6 | bounded output + strict parsing contract | one-token `0/1` conservative gate -> strict JSON `{decision,tier,reason}`, malformed means block | `<verdict>allow|ask|deny</verdict>` prefix contract, malformed means deny |
| 7 | retry and timeout | detailed retries once (512/1200 two tiers); 20s per request, now also covering streaming | 512->1024 two-tier retry; 25s |
| 8 | classifier default = session model, can be configured separately | `classifierModel` else `ctx.model`; `/automode model` persists | defaults to introspecting the session model; `--auto-mode-model` |
| 9 | read-only tool routing is configurable | `classifyReadOnlyTools` (default false = read-only fast path) | no special case, always gray->classifier (equivalent to the other side turning this switch on) |
| 10 | fail-closed on every path | documented as the default posture; missing model/auth failure/parse failure/timeout/action exceeding context all block | same (timeout/parse failure -> deny) |

## 3. Residual differences

Grading: **essential** (structural, hard to copy) / **copyable** (makes up the current substantive behavioral difference, but the other side can copy it) / **superficial** (parameter-level).

| # | Dimension | pi-verdict@0.2.0 | czottmann current | Grade |
|---|---|---|---|---|
| 1 | where ask sits semantically | three-state classifier: the model can initiate ask, human confirms at runtime; non-interactive degrades to deny | two-state classifier allow/block; ask only in the rule layer (UI confirm), after acceptance it is forced through the classifier with all allow tiers disabled; "explicit user authorization" is modeled as the `explicit_intent` allow tier in the detailed re-review | copyable (both ways: the other side adds an ask enum / we add an ask rule layer, both small changes), but currently **the sharpest philosophical divergence**: runtime human involvement initiated by the model vs human involvement triggered only by user-predeclared rules |
| 2 | rule-matching syntax | regex; bash = full command string, file tools = absolute path | glob + unbash AST: bash multi-command needs full structural coverage, redirections need explicit coverage, `bash -c`/`eval` literal scripts are analyzed through, symlink/case/Unicode normalization, recursive grep/find domain checks; malformed deny/ask rules fail closed | copyable (needs an AST dependency or a home-grown one); currently a substantive engineering-depth gap |
| 3 | rule tamper protection | none | hard-deny editing its own security control files (`.pi` settings, extensions directory, its own config), including symlink and case-variant bypass detection (#24/#25) | copyable |
| 4 | floor optionality | `builtinDenyFloor:false` can turn it off entirely (user-sovereignty orientation) | floor cannot be turned off, only the whole extension disabled; all optionality is in the allow direction | **essential (philosophy)**: the other side will likely reject this design; one of our few "not copyable" points |
| 5 | thinking handling | `thinkingEnabled:false` turns it off explicitly | server default if unset; configurable low..max (`clampThinkingLevel`); the docs admit high levels can burn through 512/1200 tokens causing fail-closed | copyable (both ways); currently a substantive behavioral difference, and we have blackhole research backing us |
| 6 | caching | shadow-cache observe-only telemetry (LRU128 hit rate/disagreement count), no effective cache | **no decision cache**; `cacheRetention:"short"` + a stable session-hash ID is provider prompt-cache affinity (cost optimization). The "classifier cache" mentioned in the brief was verified in source to be this, not a verdict cache | neither side has a verdict cache; our "accumulate data before enabling" method is unique, and copyable |
| 7 | diagnostics and observability | `--auto-mode-debug`, `/automode on\|off` | `automode_inspect` read-only agent tool (registration-source check prevents spoofing) + a companion diagnostic skill; JSONL observation log (ccusage-compatible, `classifierIo` raw I/O); 12-entry denial history; status line `AM● a: d: ca: cd:` | copyable |
| 8 | engineering form | ~700-line single file / 0 dependencies / 36 stub tests / bilingual README | multi-file ~6700 lines / 1 dependency (unbash) / 10 test files / ADR x2 / 6 docs / npm Trusted Publishing + provenance | **essential** (minimalism is a value, not a feature) |
| 9 | maintenance activity | npm just published 0.2.0 | first release 06-14, 14 releases in 2.5 months, 3 external contributors, 97 stars, still committing on collection day | superficial (current gap, can change) |
| 10 | methodology narrative | five evidence-driven research notes on file; allowlist removal backed by a security-audit conclusion | "CC auto mode for pi" behavior replica + ADR records | **essential (not copyable)**, but not a functional difference |

## 4. Implications for positioning

- **The README comparison table must be rewritten**: the comparison table in `pi-permission-landscape.md` is based on the pre-0.2.0 snapshot ("allowlist 78+ dangerous regexes 13"). After the allowlist removal, any implication that "our floor/allowlist is thicker" no longer holds in reverse -- the other side's floor is thicker and cannot be turned off, and its rule engine is deeper. The differentiation narrative shrinks to four points: three-state ask (landscape confirmed unique across the whole category), `builtinDenyFloor` being switchable, zero-dependency single file, shadow cache + evidence base.
- **Collaboration assessment (toward czottmann, following the candidate-analysis approach of the landscape note)**:
  - **A. Feed features upstream**: three-state ask (the other side only needs to add an `ask` enum to its JSON contract + degrade to block when non-interactive), shadow-cache telemetry, research evidence for `thinkingEnabled:false`. Low cost; acceptance depends on the other side's philosophy -- the ask rule layer + forced re-review may be a deliberate design (the model does not initiate questions, humans intervene only where the user pre-declared).
  - **B. Stay independent, position as "testbed + evidence base"**: pi-verdict serves as a feature testbed, mature features are fed upstream; the minimal form keeps survival cost low.
  - **C. Merge/archive**: the other side has won on engineering maturity and community, and merging means giving up the methodology asset; only as an exit option.
  - Judgment: **B as the main line, A in parallel, C only as an exit**. The conclusion that "the independent project's value is mostly the methodology narrative + two experimental features" holds; no need to defend it.

## 5. Endnotes

- Collection date: 2026-08-27; comparison source state: `main@718aa4f` (v1.13.0 + 2 commits, including #30 streaming timeout).
- Sources: gh api repo metadata and releases; `README.md`; `docs/automode-classifier-flow.md` (15-step verdict flow); `docs/configuration.md`; `CHANGELOG.md`; `extensions/auto-mode/{classifier,constants,extension,hard-deny,package}.ts` (classifier.ts 754 lines, extension.ts 946 lines verified section by section); `package.json` (only 1 runtime dependency, unbash@4.0.10).
- One correction to the brief: czottmann has no "classifier (decision) cache"; its caching mechanism is provider prompt-cache affinity (source `cacheRetention:"short"` + `classifierCacheSessionId`).
- Incidental evidence: during this collection, the local pi-verdict floor successfully blocked an `rm -rf` command targeting a RamDisk, so the deny floor works correctly.
