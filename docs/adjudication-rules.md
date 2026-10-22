# Adjudication Rules

This document is the normative definition of pi-verdict's gate behavior. The key words MUST, MUST NOT / NEVER, and SHOULD are used as in RFC 2119. Terms are defined in [CONTEXT.md](../CONTEXT.md) and used here verbatim. The code in `extensions/` is the reference implementation: a disagreement between this file and the code is a documentation bug, fixed by editing this file. Rule changes are recorded by editing this file plus a `CHANGELOG.md` entry; there is no ADR directory. Rule IDs are stable: a new rule takes the next free number in its section, and IDs are never renumbered.

Each rule is a `####` heading followed by a normative statement, then `Why:` (the reason, with a link when the reason is a measurement), `Code:` (implementing symbols, no line numbers) and `Pinned by:` (the `describe › test` titles in `tests/` that assert the rule, or `unpinned`).

Contents: [RL Rule layer](#rl-rule-layer) · [PG Path grading](#pg-path-grading) · [PP Protected paths and the forced .omp gate](#pp-protected-paths-and-the-forced-omp-gate) · [CL Classifier](#cl-classifier) · [JV jev adapter](#jv-jev-adapter) · [CS Confidence floor, mode thresholds, fallback cascade](#cs-confidence-floor-mode-thresholds-fallback-cascade) · [MD Approval modes](#md-approval-modes) · [PR Outcome and presentation](#pr-outcome-and-presentation) · [SG Subagent gate](#sg-subagent-gate) · [CF Configuration, scopes, trust](#cf-configuration-scopes-trust) · [AU Audit log and shadow cache](#au-audit-log-and-shadow-cache) · [RG Rule generator](#rg-rule-generator) · [RR Root rule](#rr-root-rule) · [ST Settings tool](#st-settings-tool) · [Decision tables](#decision-tables)

## RL: Rule layer

#### RL-1: Tool families

Every tool name belongs to at most one family. `bash` and `powershell` are command tools; `read`, `write`, `edit`, `grep`, `find` and `ls` are file tools; every other name (MCP, custom, other host tools) is outside both families. `grep`, `find` and `ls` are scope tools: their `path` is optional, an omitted or empty path means the cwd, and the search covers that directory subtree.

Why: the scope-tool cwd default closed a bypass where an omitted `path` produced no rule target and no protected-path candidate (#48).
Code: `toolKind`, `isScopeTool`
Pinned by: denyPaths (PP-1–PP-9) › omitted path hits in both directions for grep/find/ls (cwd subtree scope)

#### RL-2: Evaluation order

The rule layer MUST evaluate a tool call in this order and stop at the first terminal result: (1) user `deny` regexes → deny (before the built-in rules); (2) the built-in rules at their configured action — RL-5 danger rules for command tools, PG path tiers for file tools; a built-in deny is terminal: neither a user `allow` nor a gate overrides it, only a permission grant can lift it (GR-5); (3) the forced `.omp` gate (PP-8) → ask; (4) `denyPaths` (PP-5) → ask; (5) user `allow` regexes → allow (this beats a built-in ask, never a built-in deny); (6) the base result: a built-in ask (no gate: dialog with a UI, deny without, MD-4 in unattended), a path-grading allow, a `tools` allowlist allow (RL-7), the settings-tool allow (RL-8), or gray (the call goes to the classifier, CL-1). When the `.omp` gate or `denyPaths` replaces a built-in ask, the built-in hits stay attached so a grant can still cover them (GR-5) and unattended can still refuse them (MD-4). Steps 1 and 3–5 run only when the call has a rule target (RL-3).
A remembered approval (PR-9) for the exact call is checked after the rule layer and before the grant coverage check (GR-5).

Why: a protected path is the user's exception to their own allow rules ("not even my allow list may touch these"), and a built-in deny must not depend on user allow rules; a user deny states the user's own policy and is cheaper to explain than a built-in reason, so it is evaluated first; deny-beats-allow follows the rule-layer audit ([research/rule-layer-security-audit.md](../research/rule-layer-security-audit.md)). A built-in ask is a prompt, which the user's explicit allow regex may pre-answer.
Code: `classifyByRules`
Pinned by: built-in rules (RL-5, RL-6, PG) › floor NOT overridable by user allow; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › user deny precedes the built-in rules; user allow beats a built-in ask but never a built-in deny; user rules (deny > allow > gray) › user deny beats user allow; denyPaths (PP-1–PP-9) › priority: user deny beats denyPaths (deny reason, zero confirms); denyPaths (PP-1–PP-9) › priority: denyPaths hit overrides user allow (^ls\\b + ls over denyPath → confirm); permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › unattended: a gate whose unattended action is allow still refuses a built-in ask underneath

#### RL-3: Rule target

The rule target is what user regexes are tested against. A command tool's target is the full command string (empty when absent). A file tool's target is its `path` resolved against the cwd with `~` expanded, in rule form: POSIX separators and no drive letter on win32; it is NOT realpath-resolved. A scope tool without a path targets the cwd. A `read`, `write` or `edit` call with an empty path, and every tool outside both families, has no target and skips steps 2–5 of RL-2.

Why: user regexes are string patterns whose normalization the user owns; only the rule form is applied so one pattern works across hosts.
Code: `userRuleTarget`, `toRuleForm`
Pinned by: user rules (deny > allow > gray) › user allow matches full command string → zero-latency allow; user rules (deny > allow > gray) › user deny beats path-based rule allow (directory semantics); user rules (deny > allow > gray) › user rules do not apply to uncovered tools (MCP stays gray)

#### RL-4: User regexes

`allow` and `deny` entries are JavaScript regular expressions compiled without flags and tested unanchored with `RegExp.test` against the rule target, in config order; the first `deny` match denies and the first `allow` match allows. Non-string entries and entries that fail to compile are skipped with a warning (CF-6).

Why: invalid configuration never disables the gate (#25).
Code: `loadUserRules`, `classifyByRules`
Pinned by: user rules (deny > allow > gray) › invalid regexes are skipped, valid ones still apply

#### RL-5: Danger rules

Every danger rule has an id, a pattern, a reason and an action (`deny`, `ask` or `allow`); the built-in rules below default to `deny`. The effective list is the built-ins with their configured action (`dangerRules`, CF-4), minus removed ones, plus user-added custom rules (a custom rule is an entry `{"pattern", "action"?, "reason"?, "flags"?}`; the action defaults to `deny`, the reason to `custom danger rule`, the pattern is compiled case-insensitively unless `flags` says otherwise, and `g`/`y` flags are rejected). A command tool call is matched on its first 8192 characters (characters beyond the cap are not examined) against every rule whose action is not `allow`; a rule set to `allow` passes no judgment and is skipped (the call goes on, to the classifier if nothing else decides). If any hit is `deny` the call is denied, otherwise if any hit exists it asks (built-in ask: RL-2 step 6); the reason lists every hit of the winning action as `rule <id>: <reason>`, joined by `; `. An empty or whitespace-only command is allowed with reason `empty command`. Every other command is gray: there is no built-in command allowlist.

| id | matches |
|---|---|
| `rm-recursive` | `rm` with `-r`/`-rf`/`-fr` style flags or `--recursive`, unless every operand resolves strictly inside the workspace (session cwd) or the temp directory (`os.tmpdir()`, `/tmp` on non-Windows): then the rule makes no judgment (`rmEscapesScope`). Unresolvable operands (`$VAR`, backticks, `{}`, `~user`, relative operands after `cd`/`pushd`/`popd`, no operands), the scope roots themselves, and a filesystem-root or home-directory cwd still hit |
| `rm-root` | `rm` of `/`, `/etc`, `/usr`, `/var`, `~` or `$HOME` |
| `sudo` | the word `sudo` |
| `chmod-777` | `chmod` with `777`, `a+rwx`, `ugo+rwx`, `ugo=rwx` or setuid/setgid (`u+s`, `g+s`) |
| `raw-device` | redirect or `of=` to `/dev/sd*`, `hd*`, `nvme*`, `mmcblk*`, `vd*`, `xvd*`; `mkfs.*` |
| `git-push-force` | `git push` with `-f` or `--force` |
| `git-reset-hard` | `git reset --hard` |
| `git-clean-force` | `git clean` with `-f`/`--force` |
| `git-checkout-dot` | `git checkout .` (discard the working tree) |
| `git-restore` | any `git restore` |
| `remote-exec` | `curl`/`wget` piped to `sh`, `bash`, `zsh` or `dash` (optionally via `sudo`) |
| `gh-repo` | `gh repo create`, `delete`, `rename`, `archive` |
| `gh-release` | `gh release create`, `delete`, `edit` |
| `fork-bomb` | `:(){` |

Why: command-string regex allowlists were bypassed in all audited payloads ([research/rule-layer-security-audit.md](../research/rule-layer-security-audit.md)), so only deny-by-default rules ship and everything else is judged by meaning (CL-1); each rule's action is configurable because what is dangerous depends on the user's workflow, and `allow` means "no judgment" rather than "allowed" so a configuration can never make the rule layer auto-approve a command; the cap bounds regex backtracking on long separator-free strings (#25).
Code: `BASH_DANGER_RULES`, `DangerRule`, `parseDangerRules`, `parseDangerRuleEntry`, `classifyBash`, `rmEscapesScope`, `rmOperandsInScope`, `rmScopeBases`, `BASH_MAX_MATCH_LEN`
Pinned by: built-in rules (RL-5, RL-6, PG) › danger regex (rm -rf) → deny, zero model calls; built-in rules (RL-5, RL-6, PG) › no built-in whitelist: ls → gray → classifier; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › danger rule set to ask: dialog with a UI, block with the grant hint headless, block in unattended without a dialog; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › action allow (or removal with false) passes no judgment: the call goes to the classifier; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › custom rule: case-insensitive by default, flags override, reason defaults; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › all hits count: a deny beats an ask and the reason names every hit of the winning action; user rules (deny > allow > gray) › bash commands longer than the match cap are truncated before rule matching
Pinned by (rm-recursive scope): built-in rules (RL-5, RL-6, PG) › rm-recursive workspace/temp scope › targets inside the workspace or temp directory pass to the classifier; built-in rules (RL-5, RL-6, PG) › rm-recursive workspace/temp scope › targets outside, unresolvable, or the scope roots themselves still deny; built-in rules (RL-5, RL-6, PG) › rm-recursive workspace/temp scope › a home-directory cwd gives no workspace exemption; built-in rules (RL-5, RL-6, PG) › rm-recursive workspace/temp scope › the waiver applies at any configured action (user override to ask)

#### RL-6: builtinDenyFloor

`builtinDenyFloor: false` is the master switch of the built-in rules: it sets the action of every built-in danger rule and every path tier to `allow` (no judgment, so the call goes to the classifier); it NEVER turns a deny into an allow, and it does not change the allows of path grading (PG-4, PG-5). Custom danger rules (RL-5) stay active. It has no effect on user rules, the forced `.omp` gate (PP-8) or `denyPaths` (PP-5).

Why: the switch turns off the built-in claims, not the user's own declarations (documented risk acceptance by the user).
Code: `parseDangerRules`, `parsePathRules`, `classifyBash`, `classifyPath`, `UserRules.builtinDenyFloor`
Pinned by: user rules (deny > allow > gray) › builtinDenyFloor: false disables the whole built-in deny floor (risk accepted by user); user rules (deny > allow > gray) › builtinDenyFloor: false downgrades S0 path deny to gray (never to allow); built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › builtinDenyFloor:false sets built-in rules to allow; custom rules stay active; denyPaths (PP-1–PP-9) › builtinDenyFloor:false does not disable denyPaths

#### RL-7: tools allowlist

A `tools` entry is an exact, case-sensitive tool name. It applies only to tools outside both families (RL-1) and allows the call with reason `user tools allow rule`, skipping the classifier. Listing `bash`, `read` or any other family tool has no effect. Because such calls have no rule target (RL-3), neither user regexes nor gates are consulted for them.

Why: MCP and custom tools default to the classifier; `tools` is the user's exact-name exception declaration, and the starter list holds only tools without side effects of their own (code comment on `UserRules.tools` and `DEFAULT_ALLOWED_TOOLS`).
Code: `classifyByRules`, `UserRules.tools`, `DEFAULT_ALLOWED_TOOLS`
Pinned by: denyPaths (PP-1–PP-9) › template ships the starter tools allowlist, active from the next session

#### RL-8: Settings tool

A call to the tool named `verdict_settings` is allowed by the rule layer with reason `pi-verdict settings tool (confirms every change with the user)`, without a classifier call and silently (PR-3). It sits where the `tools` allowlist sits (RL-2 step 6) and needs no `tools` entry. The tool has no rule target (RL-3), so user regexes, the `.omp` gate and `denyPaths` are not consulted for it.

Why: the tool's own confirmation dialog is the human gate for every change (ST-2); a classifier call or a second gate prompt would only duplicate it.
Code: `classifyByRules`, `SETTINGS_TOOL_NAME`
Pinned by: settings tool (ST-1–ST-5) › tool call is a mechanical allow, no classifier call

#### RL-9: Grant tool

A call to the tool named `verdict_grant` is allowed by the rule layer with reason `pi-verdict permission grant tool (the user or both models approve every grant)`, without a classifier call and silently (PR-3). It sits where the `tools` allowlist sits (RL-2 step 6); like RL-8 it has no rule target (RL-3).

Why: the tool's own dialog (GR-2) or unattended consensus (GR-3) is its gate; the permission to ask for permission must itself be mechanical.
Code: `classifyByRules`, `GRANT_TOOL_NAME`
Pinned by: permission grants (GR-1–GR-6) › GR-1: the tool call itself is a mechanical allow


## PG: Path grading

#### PG-1: Applicability

Path grading is the built-in base for file tools. `read`, `write` and `edit` are always graded (an empty path resolves to the cwd); `write` and `edit` use write grading (PG-5), every other graded tool uses read grading (PG-4). `grep`, `find` and `ls` are graded only when given a non-empty path; without one the base result is allow.

Why: a scope tool without a path searches the cwd, which the rule layer treats as the effective target (RL-3) rather than as a graded path.
Code: `classifyByRules`, `classifyPath`
Pinned by: denyPaths (PP-1–PP-9) › negative: omitted path with an unrelated cwd → no ask, rule-layer allow

#### PG-2: Forms

A path is graded against every one of its rebuilt forms (the rebuilt tier): the lexical absolute form, its realpath form when it exists, and a form rebuilt from the realpath of the nearest existing ancestor when it does not. Each form is converted to rule form and matched case-insensitively against the grade patterns; a hit on any form counts.

Why: a project-local symlink aliasing `~/.ssh` or a `.git/hooks` directory must not pass the floor on its lexical spelling (#20); case variants name the same file on case-insensitive filesystems (#21).
Code: `rebuiltForms`, `classifyPath`
Pinned by: path floor dual-form matching (#20) › write of a new key file via that symlink denies via the real form; S-rule case folding + firmlink prefixes (#21) › case-insensitive filesystem: .SSH/ID_RSA read denies (S0 /i)

#### PG-3: S0 secrets

A path matching any S0 pattern is graded by the path tier `s0-secret` (default action `deny`) for every file tool, read or write (grep/find/ls with a path included). A tier set to `ask` or `deny` carries the reason `tier s0-secret: S0 secrets/credential path: <path>`; set to `allow` it is gray (the call goes to the classifier). Every path tier works this way (PG-4, PG-5): the tier ids are `s0-secret`, `s1-system-read`, `s1-system-write`, `s2-user-rc-write` and `s3-git-meta-write`, with default actions `deny`, `allow`, `deny`, `allow` and `deny`, configurable per id (`pathRules`, CF-4); the first matching tier wins. A path-tier ask is a built-in ask (RL-2 step 6) and never offers Explain (PP-9) because its reason embeds the path. S0 patterns, in plain words: `.ssh`, `.aws` or `.gnupg` followed by a separator or the end; `.env` or `.env.*` as a file name; `credential`/`credentials` followed by `.`, a separator or the end; file names starting `id_rsa`; names ending `.pem` or `_history`; `.config/gh`; `.pi/agent/auth.json` and `.omp/agent/auth.json`; the files `.netrc`, `.npmrc`, `.pypirc`, `.envrc` and `.vault-token`; `.kube`; `.docker/config.json`; `.gem/credentials`.

Why: credential files are the exfiltration route the audit expanded the list for ([research/rule-layer-security-audit.md](../research/rule-layer-security-audit.md), V8); S0 is an author-vetted, false-positive-tuned set, which is why it denies by default while user-declared protected paths ask (PP-5); the `tier <id>:` prefix tells the agent what to name in a permission grant (GR-1).
Code: `S0_SECRET`, `classifyPath`, `PATH_TIER_IDS`, `PATH_TIER_DEFAULTS`
Pinned by: built-in rules (RL-5, RL-6, PG) › write to S0 secret path → deny; security audit regression (all payloads must NOT be rule-allowed) › V8 read ~/.npmrc → S0 deny (list expanded); built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › path tiers: ask opens the dialog, deny blocks with the tier id in the reason; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › invalid pathRules entries are skipped with a warning

#### PG-4: Reads

For read grading, after S0 (PG-3): a path under an S1 system prefix (`/etc`, `/private/etc`, `/private/var`, `/usr`, `/var`, `/System`, or a file named `authorized_keys`) is graded by the path tier `s1-system-read` (default `allow` = gray, reason prefix `tier s1-system-read:` when it is set to `ask` or `deny`); every other path is allowed without the classifier. Reads outside S0 and S1 are therefore mechanically allowed, including paths outside the cwd.

Why: reads change nothing on disk; only credential reads (S0) and system configuration reads (S1) carry the risk the grading targets (code comment on `classifyPath`).
Code: `classifyPath`, `S1_SYSTEM`
Pinned by: S-rule case folding + firmlink prefixes (#21) › read /private/etc/sudoers grades gray like /etc/sudoers (firmlink prefix); path floor dual-form matching (#20) › ordinary direct-path behavior unchanged; built-in rules (RL-5, RL-6, PG) › configurable actions, custom rules, merge and order › path tiers: ask opens the dialog, deny blocks with the tier id in the reason

#### PG-5: Writes

For write grading, after S0 (PG-3), in this order: an S1 path (PG-4) → tier `s1-system-write` (default `deny`); an S3 git-metadata path (`.git/hooks`, `.git/config`, `.git/modules`, `.gitmodules`) → tier `s3-git-meta-write` (default `deny`); an S2 user-persistence path (names ending `.bashrc`, `.zshrc`, `.profile`, `.bash_profile`, `.gitconfig`; any path containing `crontab`; `Library/LaunchAgents`; `.config/systemd`) → tier `s2-user-rc-write` (default `allow` = gray); otherwise, if every form of the path lies inside the cwd (lexical or realpath base form) → allow; otherwise gray. A tier set to `allow` is gray and ends the grading (the first matching tier wins); `ask`/`deny` carry the `tier <id>:` reason prefix.

Why: `.git` hooks and config are executable entry points (code comment on `classifyPath`); a lexical prefix hit whose real form escapes the project grades as an outside-cwd write (#20).
Code: `classifyPath`, `S1_SYSTEM`, `S2_USER_RC`, `S3_GIT_META`
Pinned by: built-in rules (RL-5, RL-6, PG) › write inside CWD → rule allow, zero model calls; path floor dual-form matching (#20) › write via symlink into .git/hooks denies (S3 via real form); path floor dual-form matching (#20) › write via symlink to a plain outside dir is no longer rule-allowed (gray → classifier); S-rule case folding + firmlink prefixes (#21) › write to a case-variant user rc path inside cwd grades gray (S2 /i flips in-cwd allow to gray)

#### PG-6: Commands are not path-graded

`bash` and `powershell` calls are NEVER path-graded: a command that reads a credential file is judged only by the danger rules (RL-5), user rules, the protected-path token extraction (PP-2) and the classifier.

Why: shell semantics (substitution, scripts, indirection) make command-to-path grading unsound; the audit reproduced bypasses of string-level analysis ([research/rule-layer-security-audit.md](../research/rule-layer-security-audit.md)) and a tree-sitter rule engine absorbed no gray calls ([research/rule-engine-sim/README.md](../research/rule-engine-sim/README.md)).
Code: `classifyBash`, `classifyByRules`
Pinned by: security audit regression (all payloads must NOT be rule-allowed) › ${name} → reaches classifier (gray)

## PP: Protected paths and the forced .omp gate

#### PP-1: Declaration normalization and anchoring

Each `denyPaths` entry is a trimmed, non-empty string. Normalization: a leading `$HOME` is read as `~`, `~` expands to the home directory, the result is resolved against the session cwd, and its base forms are taken (lexical plus realpath when it exists; PP-4). Entries are anchored once at session start and re-anchored only when rules are reloaded (`/verdict`, `/rule`, `/automode` saves); they are never re-derived per call.

Why: mid-session symlink creation or cwd drift must not change what a declaration covers.
Code: `denyPathForms`, `anchorDenyPaths`, `SessionState.reloadRules`, `SessionState.anchoredDenyPathBases`
Pinned by: denyPaths (PP-1–PP-9) › normalization matrix: ~, $HOME, relative, .., and glob spellings hit the same base; denyPaths (PP-1–PP-9) › relative denyPath entry stays anchored to the session cwd after session_start

#### PP-2: Candidate extraction

The path candidates of a call are: a file tool's `path`; the cwd for a scope tool without a path; for a command tool, every path-like token of the command string (`~/…`, `$HOME/…`, absolute paths, `./` and `../` forms, and `word/word` relative forms, with backslashes unified to `/` on win32); none for tools outside both families. The extractor produces evidence only. It NEVER reads the contents of external scripts and does not resolve command substitution or encoded paths.

Why: recursive script scanning is unsound by construction (scripts spawning scripts, dynamic evaluation), and a partial implementation would advertise coverage it does not have; holes fall back to the existence hint (PP-7).
Code: `denyPathCandidates`, `BASH_PATH_TOKENS`
Pinned by: denyPaths (PP-1–PP-9) › obfuscation payloads: base64-embedded path falls to the classifier with the hint; literal-in-$() and quoted $HOME still hit

#### PP-3: Matching

A candidate hits when any of its base forms equals a declared base form or lies below it on a path-segment boundary (a sibling sharing a string prefix does not hit). Comparison is case-folded on win32 and darwin. For scope tools the comparison is also bidirectional: a declared base lying inside the searched subtree hits too. Command-token and single-target file candidates compare in one direction only.

Why: a recursive search over a directory containing a protected path returns its contents, so the search scope is the target (#48); false positives ask, which is the safe direction.
Code: `hitDenyPaths`, `pathEquals`, `pathStartsWith`, `fold`
Pinned by: denyPaths (PP-1–PP-9) › negative: sibling sharing a prefix does not hit (segment boundary); denyPaths (PP-1–PP-9) › omitted path hits in both directions for grep/find/ls (cwd subtree scope); denyPaths (PP-1–PP-9) › explicit parent-directory path hits (bidirectional compare)

#### PP-4: Base tier only

Protected-path matching MUST use the base tier (lexical plus whole-path realpath) and NEVER the ancestor rebuild of PG-2. A nonexistent target reached through a symlinked alias therefore does not hit and falls to the classifier with the existence hint (PP-7).

Why: ancestor rebuild is reserved for decisions where a false allow is costly (path grading); protected-path matching keeps the base tier by ruling (#41).
Code: `baseForms`, `denyPathForms`, `rebuiltForms`
Pinned by: denyPaths (PP-1–PP-9) › tier discipline pinned: nonexistent target through a symlinked alias does NOT hit denyPaths (base tier, #41 ruling)

#### PP-5: Hit is a terminal ask

A protected-path hit is a terminal ask with reason `user-declared protected path (denyPaths) [path withheld; see pi-verdict.json]`. It sits after user `deny` and the `.omp` gate and before user `allow` (RL-2), so it overrides the user's own allow rules. The matched path is carried only as UI-only `detail` (PP-6). Without a UI the ask degrades to deny (PR-1). `builtinDenyFloor: false` does not affect it (RL-6).

Why: the user who declared the path is the right adjudicator of the exception, so the extractor routes to a human instead of denying or deferring to a probabilistic judge; the deliberate inconsistency with S0 (deny) is that the source of a declaration decides who owns its exception.
Code: `classifyByRules`, `hitDenyPaths`
Pinned by: denyPaths (PP-1–PP-9) › read of a denyPath → interactive ask: one confirm, zero model calls, allow on confirm; denyPaths (PP-1–PP-9) › headless hit → ask degrades to deny, zero confirms; denyPaths (PP-1–PP-9) › priority: denyPaths hit overrides user allow (^ls\\b + ls over denyPath → confirm); denyPaths (PP-1–PP-9) › builtinDenyFloor:false does not disable denyPaths

#### PP-6: Plaintext confinement

The matched protected path MAY appear only in the local ask dialog and in the local audit record (AU-1). It NEVER appears in a block reason, a notification, a classifier, fallback, EXPLAIN-GATE or rule-generator model call, the status widget, or a verdict label. Notifications of protected-path outcomes omit the action line, which can embed the path; the ask reason is the fixed text `user-declared protected path (denyPaths) [path withheld; see pi-verdict.json]`. The one exception is the grant coverage check (GR-5): when an active grant lists protected-path access entries, the judge and fallback calls of that check receive the call, the covering grants and their entries, because the user approved those paths in the grant dialog. No other call carries them (GR-4), and an uncovered call never reaches a model.

Why: reasons and notifications flow back into the agent context and prompts leave the machine for the model provider; the audit log is a local record in the same trust domain as `pi-verdict.json`.
Code: `Verdict.detail`, `RuleResult.detail`, `presentVerdict`, `generateRule`, `critiqueRule`
Pinned by: denyPaths (PP-1–PP-9) › path plaintext appears only in the confirm dialog, never in block reason or notifications; denyPaths (PP-1–PP-9) › headless block reason and notify carry no path plaintext either; adjudicate pipeline (interface level) › denyPaths zero-leak regression: no protected-path plaintext in any reason or notification (PP-6)

#### PP-7: Existence hint

When `denyPaths` is non-empty, the system prompt of the LLM first layer, of the fallback classifier and of a subagent second-model consultation carries one fixed sentence stating that protected paths are configured and that edge-probing behavior (copy-then-read, archiving, indirection) must be denied or asked about. It contains no path text. The jev adapter never receives it (JV-3). Calls that hit never reach a classifier.

Why: path plaintext in a prompt leaves the machine and an unreliable model-side comparison adds nothing; the hint captures the behavioral value at zero leakage.
Code: `DENY_PATHS_HINT`, `classifyWithModel`
Pinned by: denyPaths (PP-1–PP-9) › classifier existence hint: present when denyPaths non-empty, absent when empty; zero path plaintext

#### PP-8: Forced .omp gate

With `gateOmpDir` (default `true`), a call that touches a `.omp` directory is a terminal ask with reason `forced gate: access to a .omp directory (gateOmpDir)`. A command tool hits when the command contains `.omp` as a shell word (not preceded or followed by a word character, `.` or `-`) or any extracted token (PP-2) has a base form with `.omp` as a whole path segment; a file tool hits on its path's base forms; a scope tool is checked on its own target only, so a recursive search that merely traverses a nested `.omp` does not hit. The gate sits after user `deny` and before `denyPaths` and user `allow` (RL-2); the path is UI-only detail (PP-6).

Why: backstop for the host's own tree, which holds this gate's configuration and installed copy now that no self-protection layer exists (AGENTS.md); false positives ask, the safe direction.
Code: `hitOmpDir`, `OMP_DIR_SEGMENT`, `OMP_DIR_IN_COMMAND`, `UserRules.gateOmpDir`
Pinned by: gateOmpDir forced gate › bash: .omp as a path component or bare word asks; lookalike names do not; gateOmpDir forced gate › scope tools: explicit .omp target asks; omitted path with a cwd inside .omp asks; a plain project root does not; gateOmpDir forced gate › beats user allow rules but not user deny rules

#### PP-9: No Explain for gate asks

The ask dialog of a protected-path or `.omp` gate ask NEVER offers Explain… (PR-5); its decline path accepts inline text but makes no model call. The permission grant dialog (GR-2) never offers it either.

Why: the explanation request would send protected-path content to a model provider (PP-6).
Code: `presentVerdict`, `confirmAsk`
Pinned by: EXPLAIN-GATE role and decline explanation › the dialog merges No and the explanation; Explain only for asks whose content may reach a model; EXPLAIN-GATE role and decline explanation › protected-path ask: declining with inline text works, and no model call is made

## CL: Classifier

#### CL-1: Gray zone

The gray zone is every call the rule layer leaves undecided (RL-2 step 6): commands matching no rule, S1 reads, S2 writes and writes outside the cwd, path-grading denies downgraded by `builtinDenyFloor: false`, and tools outside both families that are not in `tools`. Only gray calls reach the classifier; rule allows, rule denies and gate asks never do.

Why: deterministic rules establish the floor; the classifier handles only the remaining semantic ambiguity ([docs/security-principles.md](security-principles.md)).
Code: `adjudicate`, `classifyByRules`
Pinned by: built-in rules (RL-5, RL-6, PG) › no built-in whitelist: ls → gray → classifier; user rules (deny > allow > gray) › user rules do not apply to uncovered tools (MCP stays gray)

#### CL-2: Classifier model resolution

The first set source wins: the `--auto-mode-model` flag, the `PI_AUTO_MODE_MODEL` environment variable (an empty value selects the session model explicitly), the omp `judge` role (only when it resolves to a model pi-verdict can call: a chat or kind-less model, or omp's OpenRouter-hosted jev judge model with api `openrouter-decisions`; any other kind is skipped with one warning), `classifierModel`, the session model. A role selector is resolved through omp's `ctx.models.resolve`, which searches chat models only, and then entry by entry as a `provider/id` registry lookup with a configured-auth check, so a judge-kind model such as `openrouter/typesafe/jev-1.14` is found. A selected model that does not resolve or lacks credentials falls back to the session model with one warning per session; an unresolvable `judge` role falls back to the session model, not to `classifierModel`. With no model at all the call is fail-closed (CS-3). Resolution happens lazily, only for gray calls. On omp an `openrouter-decisions` model is called directly over the decisions endpoint on the openrouter transport with its own id as the wire model (whatever `PI_VERDICT_JEV_TRANSPORT` says); the same callability rule applies to the `verdict-fallback` and `explain-gate` roles, where a non-callable model counts as unavailable.

Why: code comment on `classifierPick`/`resolveClassifier`: self-reflection (the session model) is the default and explicit selections must degrade visibly, not silently.
Code: `classifierPick`, `resolveClassifier`
Pinned by: classifier model resolution › CLI flag beats config; classifier model resolution › invalid config model falls back to session model with one-time warning; omp model roles › the judge role beats classifierModel and carries its thinking suffix; omp model roles › an unresolvable judge role warns once and falls back to the session model, not to classifierModel; omp model roles › a judge role resolving to a native judgment runner is skipped with one warning; a kind-less jev model is used; omp model roles › a judge-kind OpenRouter jev model on the judge role (invisible to ctx.models.resolve) is found in the registry and called over the openrouter decisions endpoint with its own id; omp model roles › a non-callable judge-kind model on the verdict-fallback role counts as unavailable: one warning, no fallback call

#### CL-3: Thinking level

A model spec is `provider/id` with an optional `:level` suffix, level one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`; for a role assignment the suffix of its first comma-separated selector is used. Without a suffix reasoning is explicitly disabled. `minimal` is sent as `low`. An invalid suffix is ignored (reasoning off) with one warning. The same grammar applies to `classifierFallbackModel` and `explainGateModel`.

Why: reasoning off keeps latency and token use inside the 512-token first attempt, and the retry tier covers models that ignore it (CL-7); pi parameter findings in [research/thinking-param-blackhole.md](../research/thinking-param-blackhole.md).
Code: `parseModelSpec`, `callClassifierOnce`, `THINKING_LEVELS`
Pinned by: classifier model resolution › pi-native thinking suffix: zai/flash:low → effort low (adaptive); classifier model resolution › suffix minimal maps to effort low; no suffix stays explicit off; classifier model resolution › invalid suffix warned once and ignored

#### CL-4: Input transcript

The classifier's user message is a `<transcript>` block of line-structured text: the last 5 user-message lines (`User: …`), then the last 10 tool-call lines (`name: command`, `name: path`, or `name: <JSON args>`), then the action under review as the LAST line. Every line is sanitized: zero-width characters stripped, entries over 1000 characters cut to the first 600 plus the last 400, and every line break (`\n`, `\r`, U+2028, U+2029, U+0085) escaped to a literal `\n` so a payload cannot forge a structural line. Assistant narration, thinking and tool results NEVER enter the transcript.

Why: tool results and assistant text are the main indirect-injection surface; the condensed transcript with the action pinned last follows the Claude Code classifier design ([research/claude-code-classifier-prompts.md](../research/claude-code-classifier-prompts.md)); line forging was closed in #22.
Code: `buildTranscript`, `collectTranscriptParts`, `sanitize`, `transcriptSafe`
Pinned by: transcript line injection (#22) › multi-line user message cannot forge a second User line; genuine content survives; transcript line injection (#22) › path branch goes through sanitize: zero-width chars stripped, overlong entries truncated

#### CL-5: System prompt composition

The system prompt is built from the effective verdict set of the approval mode (MD-1): the criteria of the allowed verdicts only, the guidance line, a marker line `Allowed verdicts: …` when the set is restricted, and the verdict-prefix format line. It is followed by the existence hint when `denyPaths` is non-empty (PP-7) and then by the user policy block: the root rule (the `rootRule` key, RR-2), the user's classification rules (the `rules` key) and the active permission grants (GR-4). Where a rule applies it takes precedence over the default criteria, and a classification rule takes precedence over the root rule. The marker line precedes the hint and the policy block so the jev adapter's user-rules slice excludes it.

Why: the default three-verdict prompt is kept byte-identical so unrestricted behavior does not drift; restricted sets must reach jev through the marker (JV-3).
Code: `classifierSystem`, `modeChoices`, `classifierPolicy`, `trustedPolicyBlock`, `classifyWithModel`
Pinned by: approval modes › classifier prompt › unattended lists only allow/deny with the marker line; supervised only allow/ask; auto carries no marker; concern question + reason (approve dialog) › the decisions body carries a typed concern question whose criteria match the vocabulary; user rules extend only the verdict

#### CL-6: Verdict prefix contract

A classifier response MUST begin (after optional whitespace) with `<verdict>allow</verdict>`, `<verdict>ask</verdict>` or `<verdict>deny</verdict>`, case-insensitively; the remaining text, trimmed and capped at 300 characters, is the reason. Anything else, including empty output, violates the contract and counts as a failed attempt (CL-7).

Why: prefix anchoring leaves no room for narration to precede or override the verdict, and a violation fails closed instead of being guessed at.
Code: `parseVerdict`
Pinned by: classifier › empty output → retry at 1024, verdict honored; verdict prefix contract (real adjudicate pipeline) › adapter output passes parseVerdict for all three choices

#### CL-7: Attempts, timeouts, fail-closed

A classification makes at most two attempts, with 512 then 1024 maximum tokens and a 25 s timeout each. A retry fires on an error or aborted stop reason, a thrown exception or a contract violation; it does not fire once the caller's signal is aborted. `temperature: 0` is sent unless the model's API is known not to accept it or the model rejected it before; a provider rejection over `temperature` triggers an immediate same-tier retry without it, cached per `api|model` for the process. When both attempts fail the call is a fail-closed deny with reason `classifier failure (fail-closed): …` carrying both diagnostics, and it triggers the cascade (CS-3).

Why: a 15 s budget would kill about 15% of calls at the measured p90 of 19.8 s (`research/cache-sim` data); the retry is a model-agnostic compatibility layer for thinking models that emit empty output or reject parameters (#47).
Code: `classifyWithModel`, `callClassifierOnce`, `CLASSIFIER_TIMEOUT_MS`, `TEMPERATURE_REJECTED_MODELS`
Pinned by: classifier › success on first try: single call, thinkingEnabled=false, maxTokens=512; classifier › both attempts fail → fail-closed deny with per-attempt diagnostics; completion fallback (omp runtime shape, #35) › temperature-rejecting classifier model: parameter stripped and retried, then cached (#47)

## JV: jev adapter

#### JV-1: Inert unless selected

The adapter registers provider `typesafe`, model `typesafe/jev-latest`. It takes part in adjudication only when the classifier or fallback model resolves to it, and makes no request otherwise. On a host without `registerProvider` it registers nothing.

Why: users who do not opt in merely load an inert extension (no requests, one provider registration and two event hooks).
Code: `jevAdapter` (default export), `createJevProvider`
Pinned by: extension wiring › registers the typesafe provider at load and re-registers on session_start; extension wiring › hosts without registerProvider (omp) stay inert

#### JV-2: Transports and credentials

Two transports share one adapter, selected by `PI_VERDICT_JEV_TRANSPORT` (`openrouter` default; any other value falls back to it). `openrouter` posts to `https://openrouter.ai/api/alpha/decisions` with model `~typesafe/jev-latest` and takes its key from the host's OpenRouter login, then `OPENROUTER_API_KEY`. `typesafe` posts to `https://api.typesafe.ai/v1/systemone` with model `jev-latest` and takes its key only from `TYPESAFE_API_KEY`. `PI_VERDICT_JEV_URL` overrides either endpoint. The transport is pinned when the provider is created. No credential is stored by the adapter.

Why: reuse the host's credential system rather than open a second channel outside its login/logout jurisdiction; the endpoint override insures against alpha-API drift; wire contracts are isomorphic except the slug ([research/typesafe-jev-classifiermodel.md](../research/typesafe-jev-classifiermodel.md)).
Code: `TRANSPORT_DEFAULTS`, `activeTransport`, `decisionsUrl`, `wireModel`
Pinned by: transport selection and endpoint override › the typesafe transport switches both endpoint and slug; auth resolve order › openrouter resolver wins over env; typesafe transport (direct v1 API) › auth resolves TYPESAFE_API_KEY only, ignoring openrouter sources

#### JV-3: Translation

The jev state is the last user message of the classifier request (the transcript, CL-4). The `verdict` question is a `choice` whose criteria mirror the LLM prompt, restricted to the verdicts named by the `Allowed verdicts:` marker line (unattended: allow/deny with a no-human instruction; supervised: allow/ask with ask absorbing the deny criterion). The slice of the system prompt starting at the user-rules header (the root rule and the classification rules, RR-2) is appended to the question's instructions; the rest of the system prompt, including the existence hint, is dropped. A second `choice` question, `concern`, names the risk category; its answer is cosmetic: a known non-`none` category is appended to the reason as ` — concern: <label>`, anything else is omitted and never fails the call. The answer is synthesized into `<verdict>X</verdict> jev: X p% (confidence c%; …)`, which satisfies CL-6.

Why: jev treats state as data, so splicing an LLM-voiced system prompt into it would disturb its calibration; the typed reason lets the ask dialog render probabilities and the concern.
Code: `extractState`, `buildDecisionsBody`, `parseVerdictChoices`, `verdictText`, `parseJevReason`, `USER_RULES_HEADER`, `VERDICT_CHOICES_PREFIX`
Pinned by: restricted verdict sets (approval modes) › streamDecisions posts the restricted criteria named by the system prompt marker; concern question + reason (approve dialog) › verdictText appends the concern label; none / unknown / missing add nothing and never throw

#### JV-4: Confidence is required

The adapter MUST throw on a `verdict` answer whose choice is not allow/ask/deny or whose confidence is not a finite number; an HTTP error, malformed JSON or missing key likewise ends the call as an error. Every such failure follows CL-7 and ends in fail-closed. Confidence is printed floored, so 49.6% never reads as 50%.

Why: the confidence floor (CS-1) depends on the segment always being present, so contract drift must fail closed.
Code: `verdictText`, `streamDecisions`
Pinned by: verdictText › missing or non-numeric confidence throws (#63 hard-require — contract drift fails closed); verdictText › confidence floors instead of rounding (a 49.6% must not render as 50% and slip past a 50 gate)

#### JV-5: omp support

jev works on both pi and omp; the host is detected by `"logger" in pi && "typebox" in pi`. On pi the adapter registers a full provider object. On omp it registers the model by name and config only (when a key resolves from `TYPESAFE_API_KEY`/`OPENROUTER_API_KEY` at load or from the host login at session start) so model lookup and availability checks succeed; the completion call bypasses omp dispatch: `completeForClassifier` calls `streamDecisions` directly and resolves credentials freshly per call.

Why: omp's compat completion bridge has no visibility into extension-registered providers, so the adapter's own stream is called directly (code comment, omp 18.3.0 local patch).
Code: `jevAdapter`, `completeForClassifier`, `streamDecisions`
Pinned by: extension wiring › omp shape (logger + typebox on the API object) registers by name + config, never a Provider object

#### JV-6: Misuse guard

When the host's `model_select` picks a `typesafe/*` model the adapter warns that it is a decisions model for `classifierModel` only and cannot drive a session.

Why: a decisions model generates no text.
Code: `jevAdapter`
Pinned by: extension wiring › model_select on the jev provider warns; other providers stay silent

## CS: Confidence floor, mode thresholds, fallback cascade

#### CS-1: Confidence floor

When `confidenceThreshold` is set, a first-layer jev verdict whose confidence is strictly below it is demoted, whatever its verdict (allow, ask or deny). A demotion means the first layer abstains and the call cascades (CS-3 to CS-8). The floor is inert for LLM first layers (their reasons carry no numeric confidence) and for fail-closed outcomes; it works standalone, with or without a fallback.

Why: jev already emits calibrated probabilities but the pipeline consumed only its choice; 23 of 403 jev allows in the measured corpus carried confidence below 50% and were allowed anyway ([research/classifier-fallback-model-feasibility.md](../research/classifier-fallback-model-feasibility.md)).
Code: `confidenceDemotion`, `parseJevConfidence`
Pinned by: confidence floor + cascade (#67) › min set, no fallback: below-floor demotes to ask with ground truth; at the floor stays autonomous; confidence floor + cascade (#67) › non-jev reasons never demote (LLM first layer: floor inert)

#### CS-2: Mode thresholds

Each mode has optional jev probability thresholds (percent) that re-map a non-demoted first-layer jev verdict; unset (`null`) means "jev's own choice equals that verdict". If every threshold of the active mode is unset, nothing is re-mapped. A re-mapped verdict replaces the first-layer verdict and annotates the reason `— <mode> thresholds: a → b`.

| mode | rule |
|---|---|
| `auto` | deny if P(deny) ≥ `autoDenyThreshold`; else allow if P(allow) ≥ `autoAllowThreshold`; else ask |
| `unattended` | deny if P(deny) ≥ `unattendedDenyThreshold`; else allow |
| `supervised` | allow if P(allow) ≥ `supervisedAllowThreshold`; else ask |

LLM verdicts and fallback verdicts are NEVER re-mapped.

Why: a threshold must never turn a fallback's judgment into something it did not say; the global floor (CS-1) runs first.
Code: `applyModeThresholds`
Pinned by: approval modes › jev probability thresholds › auto: autoDenyThreshold turns an allow with 35% deny probability into a deny, recorded in the audit; approval modes › jev probability thresholds › auto: unset thresholds leave jev's own choice alone; approval modes › jev probability thresholds › supervised: supervisedAllowThreshold turns a 60% allow into an ask

#### CS-3: Cascade triggers

A call enters the cascade on exactly three triggers: a demotion (CS-1); a fail-closed first layer, meaning the classifier failed both attempts (CL-7) or no classifier model resolved (CL-2); and an unattended-ask slip, meaning in `unattended` mode the first-layer verdict, after thresholds, is ask. A confident ask in any other mode goes straight to the human and does not cascade.

Why: a confident ask is the first layer's own request for a human, so a second model call would be wasted; unattended has no human to receive it.
Code: `adjudicate`, `runConfidenceCascade`
Pinned by: confidence floor + cascade (#67) › a high-confidence ask goes straight to the human — no fallback call; confidence floor + cascade (#67) › no-model fail-closed: enforce + fallback rescues; no fallback denies unchanged; approval modes › unattended › enforce fallback resolves the contract slip: fallback allow runs the call (two model calls)

#### CS-4: No fallback

Without a configured fallback (`classifierFallbackModel` unset) a demotion becomes an ask (reason annotated with the confidence and threshold), a fail-closed keeps its deny, and an unattended slip keeps its ask, which unattended turns into a `unattended-retry` block (MD-4).

Why: uncertainty must degrade to friction, never to permission.
Code: `runConfidenceCascade`
Pinned by: confidence floor + cascade (#67) › min set, no fallback: below-floor demotes to ask with ground truth; at the floor stays autonomous; confidence floor + cascade (#67) › fail-closed: no fallback denies; shadow records the opinion; enforce adjudicates de novo

#### CS-5: Fallback resolution and budget

The cascade is active only when `classifierFallbackModel` is set. The fallback model is the omp `verdict-fallback` role, else `classifierFallbackModel`; it NEVER falls back to the session model, and a model that does not resolve warns once per session and counts as a fallback failure (CS-8). The fallback runs the same two-attempt procedure as CL-7 with a 15 s timeout per attempt. It receives the same transcript and system prompt composition as the first layer (CL-5): the mode's verdict set, the existence hint and the classification rules.

Why: a second layer silently inheriting the session model would bill the same judgment twice instead of adding a second opinion.
Code: `resolveFallbackClassifier`, `runConfidenceCascade`, `FALLBACK_TIMEOUT_MS`
Pinned by: omp model roles › the verdict-fallback role beats classifierFallbackModel for the cascade call; omp model roles › an unavailable verdict-fallback role warns once and runs no fallback call (config key is not consulted)

#### CS-6: Shadow mode

In `classifierFallbackMode: "shadow"` (default) the fallback is consulted on triggered calls and its opinion is recorded (audit `fallback`, session counters), but it NEVER changes a verdict: a demotion still asks the human, a fail-closed deny stands, an unattended slip still blocks as `unattended-retry`.

Why: shadow-first rollout so fallback behavior can be measured against ground truth (AU-3) before it holds authority; observe-only state follows the shadow-cache discipline (AU-5); flipping to `enforce` is a human decision after about two weeks of shadow data with no ground-truth evidence of fallback false-allows ([research/classifier-fallback-model-feasibility.md](../research/classifier-fallback-model-feasibility.md)).
Code: `runConfidenceCascade`, `FallbackCascade`
Pinned by: confidence floor + cascade (#67) › shadow + demotion: the human is asked, the fallback opinion recorded, verdicts untouched; confidence floor + cascade (#67) › fail-closed: no fallback denies; shadow records the opinion; enforce adjudicates de novo

#### CS-7: Enforce mode

In `classifierFallbackMode: "enforce"` the fallback's verdict applies de novo to the triggered call, including allow, whether the origin was a demotion, a fail-closed or an unattended slip. The one carve-out: a demoted first-layer deny that the fallback would allow becomes an ask, NEVER an automatic allow; headless it degrades to deny and a subagent never auto-allows it (SG-5).

Why: the cascade exists to absorb uncertain first-layer calls, but a first layer that said deny keeps a human veto over a second model's allow.
Code: `runConfidenceCascade`
Pinned by: confidence floor + cascade (#67) › enforce + demotion: the fallback adjudicates — allow absorbs, deny blocks, ask confirms; confidence floor + cascade (#67) › carve-out: a demoted deny + fallback allow asks the human; headless degrades to deny; subagent gate (omp ctx.agent.kind = sub) › CS-7 carve-out holds for subagents: a demoted first-layer deny is never auto-allowed

#### CS-8: Fallback failure

If the fallback is unresolvable or both its attempts fail: in `shadow` the outcome is as CS-6 with the failure recorded as an error; in `enforce` the result is an ask with reason `fallback classifier unavailable (first layer abstained) — your call` and source `fail-closed` (headless: deny; unattended: `unattended-retry` block).

Why: once the user configures a second layer its silent failure must not quietly degrade the gate to a single layer; the tier that was to adjudicate is down, so the human decides.
Code: `runConfidenceCascade`
Pinned by: confidence floor + cascade (#67) › enforce fallback failure/unresolvable on a demotion falls to the human (headless → deny); confidence floor + cascade (#67) › aborted signal aborts the fallback attempt; both modes fall to the human

## MD: Approval modes

#### MD-1: Modes and verdict sets

There are four approval modes. The verdict set is the set of verdicts the classifier may answer, and `adjudicate` reshapes the effective outcome per mode (MD-3 to MD-5).

| mode | classifier verdicts | human asked |
|---|---|---|
| `auto` | allow, ask, deny | yes |
| `unattended` | allow, deny | never |
| `supervised` | allow, ask | yes |
| `off` | none (ungated) | no |

The modes were renamed from `default`, `yolo` and `noAutoDeny` to `auto`, `unattended` and `supervised`, and the keys `defaultDenyThreshold`, `defaultAllowThreshold`, `yoloDenyThreshold`, `noAutoDenyAllowThreshold`, `yoloDenyPaths` and `yoloOmpDir` to `autoDenyThreshold`, `autoAllowThreshold`, `unattendedDenyThreshold`, `supervisedAllowThreshold`, `unattendedDenyPaths` and `unattendedOmpDir`. A former mode value or key in a config file or a session override file is reported as renamed (`mode: "yolo" renamed to "unattended" — ignored`, `yoloDenyThreshold: renamed to unattendedDenyThreshold — key ignored`) and ignored, never mapped, so the mode falls back to `auto`.

Why: one mode switch replaces the earlier independent master switch, `autoDeny` and confidence knobs, and adds the unattended posture they lacked. An ignored former value falls back to `auto`, which is stricter than both `unattended` and `supervised`, so the rename never loosens the gate.
Code: `APPROVAL_MODES`, `modeChoices`, `adjudicate`
Pinned by: approval modes › classifier prompt › unattended lists only allow/deny with the marker line; supervised only allow/ask; auto carries no marker; approval mode rename (MD-1, MD-6) › a former mode value in a config file is reported and ignored: the mode falls back to auto (full three-verdict prompt); approval mode rename (MD-1, MD-6) › former threshold keys in a config file are reported and ignored; approval mode rename (MD-1, MD-6) › a former approval key in a session override file is reported and ignored

#### MD-2: off

`off` is session-scope only. In `off` the `tool_call` handler returns immediately: no rule, gate, classifier, audit record or notification is evaluated. A `mode: "off"` in a global or project config file is ignored with a warning, and the settings menu refuses `off` at file scopes.

Why: a config file, in particular a cloned repository's project config, must never be able to ungate tool calls.
Code: `tool_call` handler in `autoMode`, `loadUserRules`, `applySetting`
Pinned by: /automode command › off actually disables gating; approval modes › scopes › "off" in a config file is ignored with a warning (session-only); autoDeny reports its replacement; denyPaths (PP-1–PP-9) › master switch off → denyPaths inert (direct pass-through)

#### MD-3: auto

In `auto` a rule deny is a deny, a gate ask is an ask, and a classifier verdict stands as produced after CS-1 to CS-8: allow passes, deny blocks, ask goes to the human.

Why: the baseline posture; every other mode is a documented reshaping of it.
Code: `adjudicate`
Pinned by: approval modes › unattended › auto mode keeps the terminal ask for protected paths; classifier › ask + interactive confirm → allow; headless → deny

#### MD-4: unattended

`unattended` NEVER prompts. A rule deny stays a deny, and so does a built-in ask (RL-2 step 6): the block names the rule or tier and carries the grant hint, because there is no one to ask. A `.omp` gate hit follows `unattendedOmpDir` and a protected-path hit follows `unattendedDenyPaths` (each `deny` by default; `allow` passes silently), with source `protected-path` and no path plaintext — except that a gate hit with built-in rule hits underneath is never passed silently: with the gate's action `allow` it is still a deny with the built-in reason (and the grant hint), because `allow` on the gate cannot waive a built-in rule. Every other ask-shaped effective outcome — a classifier ask, a demotion without enforce authority, a failed enforce fallback, an unattended-ask slip — becomes a deny block tagged `unattended-retry` that tells the agent to explain why the action is needed or rewrite it narrower; this also applies headless. A classifier deny stays a deny.
A remembered approval (PR-9) is the exception: it passes the identical call before these outcomes, a built-in ask and a gate hit with built-in hits underneath included, because the human already answered that exact call.

Why: long unattended runs still want the deterministic floor and a classifier, without uncertain calls collapsing into a bare deny the agent cannot learn from.
Code: `adjudicate`, `UNATTENDED_RETRY_SUFFIX`, `presentVerdict`
Pinned by: approval modes › unattended › an ask from the classifier becomes an explain-or-rewrite block, never a prompt; approval modes › unattended › rule denies stay denies; the floor is untouched; approval modes › unattended › protected paths: denied by default with no path plaintext; unattendedDenyPaths allow passes silently; approval modes › unattended › .omp gate follows unattendedOmpDir, independent of unattendedDenyPaths

#### MD-5: supervised

With a UI, `supervised` turns every effective deny — built-in rule, user deny, classifier deny, fail-closed, no-model — into an ask whose reason ends ` (supervised: this would have been denied — your call)`; such an ask resolves to deny for a subagent (SG-5). Without a UI the deny stands. Gate asks and built-in asks stay asks.

Why: it keeps the earlier `autoDeny: false` behavior (every automatic deny is reviewable by the human) under the single mode switch.
Code: `adjudicate`, `SUPERVISED_SUFFIX`
Pinned by: approval modes › supervised › a rule deny becomes an ask carrying the suffix; declining blocks; approval modes › supervised › a classifier deny becomes an ask; headless still denies

#### MD-6: Setting a mode

The mode is set by the `--verdict-mode` flag (seeds the session scope at session start; an invalid value warns and is ignored), `/automode <mode>` (case-insensitive), the settings panel, and the cycle shortcut (default `ctrl+shift+y`; order `auto → unattended → supervised → off → auto`). All of them write session scope. `mode` can also be set in a global or project file (CF-4), except `off`. A former mode name (`default`, `yolo`, `noAutoDeny`) passed to `--verdict-mode` or `/automode` warns `renamed to <new>` and changes nothing.

Why: the session layer is persisted per session id so a mode choice survives a restart of that session (CF-5).
Code: `parseModeArg`, `setSessionSetting`, the `automode` command and shortcut in `autoMode`
Pinned by: approval modes › scopes › --verdict-mode seeds the session scope; an invalid value warns and is ignored; toggle shortcut › handler cycles auto → unattended → supervised → off → auto silently; approval mode rename (MD-1, MD-6) › --verdict-mode with a former mode name warns 'renamed to' and the mode stays auto; approval mode rename (MD-1, MD-6) › /automode with a former mode name warns 'renamed to' and leaves the mode unchanged

## PR: Outcome and presentation

#### PR-1: Ask degradation

An ask with no UI to answer it (`pi -p`, json, rpc) degrades to a deny with `degraded: true`. This applies to every ask origin: gate asks, classifier asks, demotion and cascade asks. A subagent session counts as having a UI (SG-2).

Why: uncertainty → friction, never uncertainty → permission ([docs/security-principles.md](security-principles.md)).
Code: `adjudicate`
Pinned by: adjudicate pipeline (interface level) › ask degradation is unified: protected-path ask degrades to deny without UI; adjudicate pipeline (interface level) › ask degradation is unified: classifier ask degrades to deny without UI; adjudicate pipeline (interface level) › with UI the same calls stay terminal asks (degradation is UI-conditional, not verdict-conditional)

#### PR-2: Block reason

A blocked call returns `[auto-mode <tag> block] BLOCKED — this action did NOT run. Reason: <detail>. Report the block to the user; never claim it succeeded or completed.`, with trailing dots of the detail stripped and an empty detail replaced by `(no further reason given)`. The tags:

| tag | meaning |
|---|---|
| `rule` | built-in rule (deny, or ask resolved to deny headless or by unattended) or user `deny` |
| `classifier` | classifier verdict, including a classifier failure (CL-7) |
| `fail-closed` | no classifier model, or an unavailable enforce fallback with nobody to ask |
| `protected-path` | gate ask denied headless or by unattended (MD-4) |
| `unattended-retry` | unattended's stand-in for an ask (MD-4) |
| `user-declined` | the human declined an ask (PR-4) |
| `subagent-auto` | a subagent ask resolved without a human and not approved (SG-4) |
| `subagent-cancelled` | the subagent run was cancelled while awaiting approval (SG-2) |

The tags `classifier`, `unattended-retry` and `user-declined` end the block reason with ` If this action is required, request a permission grant with verdict_grant (describe the exact operation and scope).` (GR-6). Rule, fail-closed, protected-path and subagent blocks do not carry it: a grant cannot lift them.

Why: structured error signaling does not reach every provider lane, and verbatim rule or classifier reasons can be empty or too terse for the acting model to recognize a block (#53).
Code: `blockedReason`, `presentVerdict`
Pinned by: agent-facing block reason form (#53) › classifier with empty reason → fallback detail, exact canonical form; agent-facing block reason form (#53) › rule block → rule tag; UI notify text unchanged; agent-facing block reason form (#53) › no classifier model available → fail-closed tag

#### PR-3: Notifications

Every deny block notifies (prefix `🛡️`, reason plus action line; protected-path denies omit the action line, PP-6). An ask surfaces as the ask dialog (PR-4). A classifier allow notifies only with `notifyAllows` or in debug (`--auto-mode-debug` / `PI_AUTO_MODE_DEBUG=1`), exactly once; mechanical allows (rule allow, protected-path confirm) notify only in debug; the shadow-cache annotation is debug-only. Subagent notifications carry the subagent label.

Why: notifications carry judgment while the audit log carries completeness (#60).
Code: `presentVerdict`
Pinned by: notifyAllows (#60) › notifyAllows: one classifier-allow notification with reason and action, no shadow suffix; notifyAllows (#60) › mechanical passes never notify under notifyAllows; notifyAllows (#60) › deny notifications are unaffected by the preference

#### PR-4: Ask dialog

An ask presents a dialog with Yes, No and (when allowed, PP-9) Explain…. While highlighted, No is an inline text field: non-empty text is sanitized to a single line and forwarded to the agent in the block reason as `, saying: "<text>"`; empty text or Escape declines plainly. A decline blocks with tag `user-declined`. Hosts without the rich dialog get a plain yes/no confirm. Dialogs are serialized process-wide. The dialog shows the code under review and, for a jev ask, its probability bar and concern.
With PR-9 the dialog's second row is "Yes, and don't ask again this session" (never in the permission-grant dialog).

Why: not recorded.
Code: `confirmAsk`, `buildApproveDialog`, `declineDetail`
Pinned by: EXPLAIN-GATE role and decline explanation › No with inline text: the user's text reaches the agent in the block reason; EXPLAIN-GATE role and decline explanation › declineDetail: single line, trimmed, absent when blank; approve dialog routing › ui.custom returning undefined (RPC mode) falls back to confirm

#### PR-5: EXPLAIN-GATE

Explain… asks the EXPLAIN-GATE role for an explanation of the held action, optionally answering a typed question. The model is the omp `explain-gate` role, else `explainGateModel`, else the session model (an unavailable configured model falls back to the session model with one warning). One attempt, 30 s timeout, 1024 maximum tokens, output capped at 4000 characters; the prompt is the transcript, the action, the gate's reason and the task (`explainGatePrompt` or the typed question). The explanation is display-only: it is shown in the re-opened dialog and NEVER reaches the agent or the verdict. A failure notifies a warning and re-opens the dialog without an explanation.

Why: not recorded.
Code: `explainGate`, `resolveExplainGate`, `EXPLAIN_GATE_ROLE`
Pinned by: EXPLAIN-GATE role and decline explanation › Explain with a question: one EXPLAIN-GATE call, answer shown in the re-opened dialog, never sent to the agent; EXPLAIN-GATE role and decline explanation › explainGateModel and explainGatePrompt configure the role; omp model roles › the explain-gate role beats explainGateModel

#### PR-6: Status widget

While a gray-zone model call runs in a root session with a UI that supports widgets, one status row reads `🛡️ verdict: classifying <tool> via <model id>…` (or the fallback variant); while an ask dialog is open it reads `🛡️ verdict: awaiting your approval · <tool>`. The row is cleared afterwards. It contains the phase, tool name and model id only, NEVER command or path text, and is never set for subagent calls.

Why: the row is visible while the call is in flight and must obey the plaintext confinement of PP-6.
Code: `AdjudicateEnv.onPhase`, the `tool_call` handler in `autoMode`
Pinned by: live classifier status widget › row never carries command text; live classifier status widget › subagent calls never set the row

#### PR-7: Verdict label

After an allowed call's result the gate records a label: how it passed (`rule`, `classifier`, `user`, `second-model`) plus jev probabilities and confidence when present. A label carries no reason text and no path. Rule labels are recorded but not rendered. On pi the label is a TUI-only transcript entry outside the model context; on omp it is an `aside` custom message and is therefore visible to the model.
A call passed by a remembered approval (PR-9) is labelled `remembered`; unlike `rule` labels it is rendered.

Why: a pass should be attributable at a glance; the omp transport has no TUI-only channel.
Code: `verdictLabelFor`, `VerdictLabel`, the `tool_result` handler in `autoMode`
Pinned by: approve dialog code expansion and verdict label › pi: classifier allow and user approval are told apart; denied calls leave no label; approve dialog code expansion and verdict label › omp: rule allow sends a hidden aside custom message, never a pi entry

#### PR-8: Verdict counters

The footer counts final pipeline verdicts (allow, ask, deny) of the root session; subagent calls are not counted, and an ask counts once whatever the user answers. Counters reset at session start and survive `/verdict` reloads.

Why: not recorded.
Code: `SessionState.verdictCounts`
Pinned by: footer status › counters count the final verdict: mechanical deny and ask-once

#### PR-9: Remembered approval

Every interactive ask dialog except the permission-grant dialog offers "Yes, and don't ask again this session" as its second row. Choosing it allows the call and remembers it for the session in memory: the key is the ask origin (rule-layer deny, built-in ask, gate ask, gray), the tool name, the exact input and the cwd. A later call with the same key is allowed right after the rule layer, without a classifier call or a dialog, in every approval mode; a rule-layer deny is overridden only in `supervised`. A remembered allow is not audited and notifies only in debug. The footer shows the count; `/automode forget` or the `/automode` panel clears all; a new session starts empty (`/verdict` and `/automode <mode>` reloads keep it). The plain confirm fallback cannot remember.

Why: repeated identical calls (a build, a test run) otherwise prompt every time; keying on the origin keeps a later deny rule, `denyPaths` entry or built-in ask from being bypassed by an earlier approval.
Code: `approvalKey`, `SessionState.rememberApproval`, `adjudicate`, `presentVerdict`
Pinned by: remembered approval (PR-9) › remember row on a gray ask: identical call skips classifier and dialog; remembered approval (PR-9) › plain Yes is not remembered; remembered approval (PR-9) › protected-path ask offers the row; remembered without leaking the path; remembered approval (PR-9) › grant dialog has no remember row; remembered approval (PR-9) › applies in unattended: the identical call passes without a classifier call; remembered approval (PR-9) › rule deny wins outside supervised; the key carries the ask origin; remembered approval (PR-9) › built-in ask: remembered in auto, still passes in unattended for the exact call only; remembered approval (PR-9) › /automode forget clears the count and the call asks again; remembered approval (PR-9) › session_start forgets

## SG: Subagent gate

#### SG-1: Identity and off

A call is a subagent call when the omp context carries `agent.kind === "sub"`; pi never has one. With `subagentGate: "off"` (default) the gate is inert in subagents: their calls pass ungated, while the root session stays gated. Approval mode `off` (MD-2) still applies first.

Why: default `off` keeps existing subagent workflows unchanged.
Code: `subagentIdentity`, the `tool_call` handler in `autoMode`
Pinned by: subagent gate (omp ctx.agent.kind = sub) › off: the gate is inert in subagents (the root stays gated); subagent gate (omp ctx.agent.kind = sub) › default is off: a fresh config leaves subagents ungated

#### SG-2: normal

In `normal` a subagent runs the pipeline as if a UI existed and an ask is shown on the root session's UI (labeled with the subagent), serialized with every other dialog. The `subagentAskTimeoutMs` deadline (default 60000) is counted from enqueue, so time queued behind another dialog counts. An answered dialog is the human decision. An expired deadline, or no root UI, resolves the ask without a human (SG-4). If the subagent run is cancelled the dialog closes and the call blocks with `subagent-cancelled` without consulting the second model.

Why: the human is at the root session; their dialogs must not overlap, and an unanswered subagent must not hang forever.
Code: the `tool_call` handler in `autoMode`, `serializeDialog`, `confirmAsk`
Pinned by: subagent gate (omp ctx.agent.kind = sub) › normal: a classifier ask prompts the root UI, not the subagent's; the answer decides; subagent gate (omp ctx.agent.kind = sub) › normal: a cancelled subagent run closes the root dialog, blocks, and never consults the second model; subagent gate (omp ctx.agent.kind = sub) › root dialogs are serialized: concurrent subagent asks never overlap

#### SG-3: auto

In `auto` a subagent ask never prompts anyone and is always resolved without a human (SG-4).

Why: unattended multi-agent runs have nobody to ask.
Code: the `tool_call` handler in `autoMode`
Pinned by: subagent gate (omp ctx.agent.kind = sub) › auto: never prompts; the second model decides; no second model configured → deny

#### SG-4: Resolution without a human

Every ask carries `autoResolve`. `allow` means the cascade's fallback already allowed it; `deny` is the default; `consult` asks the fallback model (CS-5) once. Only an explicit `allow` permits the call. A deny, an ask, a failure, a timeout, a missing or unresolvable fallback all deny with block tag `subagent-auto`.

Why: a second model may only widen access by explicitly approving; every doubt fails closed.
Code: `resolveAskWithoutHuman`
Pinned by: subagent gate (omp ctx.agent.kind = sub) › normal: unanswered past subagentAskTimeoutMs → second model decides; only an explicit allow permits; subagent gate (omp ctx.agent.kind = sub) › no root UI: normal degrades to the second-model path with no prompt

#### SG-5: Never auto-allowed

Asks that did not come from the classifier NEVER auto-allow (`autoResolve: "deny"`): protected-path and `.omp` gate asks, rule or fail-closed asks, and asks created by `supervised` from an effective deny. A demoted first-layer deny that the fallback would allow is never auto-allowed either (CS-7).

Why: a declaration's exception belongs to the declaring user; a first-layer deny keeps a human veto.
Code: `adjudicate`, `resolveAskWithoutHuman`
Pinned by: subagent gate (omp ctx.agent.kind = sub) › asks that did not come from the classifier never auto-allow (protected path, .omp, supervised); subagent gate (omp ctx.agent.kind = sub) › CS-7 carve-out holds for subagents: a demoted first-layer deny is never auto-allowed

#### SG-6: omp handler timeout

Set omp's `extensionHandlers.toolCallTimeoutMs` (`config.yml`, default 30000) to at least `subagentAskTimeoutMs + 60000`; omp pauses a handler's work budget only for the session's own dialogs, so a subagent waiting on the root UI would otherwise be aborted by the host. This is an operator requirement the extension cannot enforce.

Why: not recorded beyond the operational note in `docs/configuration.md`.
Code: none (host setting)
Pinned by: unpinned

## CF: Configuration, scopes, trust

#### CF-1: agentDir resolution

The agent directory is `PI_CODING_AGENT_DIR` when set; otherwise it is self-anchored from the extension's own install path (a copy under `<home>/<dot-dir>/(agent/)?(plugins/node_modules/<pkg>/)?extensions/…` anchors to `<home>/<dot-dir>/agent`, trying the lexical and realpath forms); otherwise `~/.pi/agent`. Resolution NEVER probes the host directory tree for existence.

Why: on a machine with both hosts installed, a present `~/.omp` must not misroute a gate running under pi.
Code: `resolveAgentDir`, `agentDirPath`
Pinned by: agentDir self-anchoring (#35) › dual install: a ~/.omp tree existing must not redirect a pi-anchored run; agentDir self-anchoring (#35) › PI_CODING_AGENT_DIR wins over anchoring

#### CF-2: User file

The user file is `<agentDir>/config/pi-verdict.json`. When missing it is written from the first-run template (a read-only filesystem is skipped silently) and empty rules load. When unreadable or not valid JSON, empty rules load with the built-in rules at their default actions, the project file is not loaded, and a warning is notified. In both cases session keys (CF-5) still apply. The gate is NEVER disabled by configuration errors.

Why: invalid configuration must never silently disable the gate (#25).
Code: `loadUserRules`, `sessionOnlyLoad`, `USER_CONFIG_TEMPLATE`
Pinned by: user rules (deny > allow > gray) › malformed config JSON warns at session_start; floor unaffected; user rules (deny > allow > gray) › first run generates config template

#### CF-3: Project discovery and trust

The project file is `<project>/.omp/pi-verdict.json` on omp and `<project>/.pi/pi-verdict.json` otherwise; the nearest file walking up from the cwd wins, and the walk stops before the home directory and before the agent tree's own root. It is applied only if the project root is trusted: the trust store `<agentDir>/config/pi-verdict-trust.json` lists trusted and untrusted roots, matched exactly (never subtrees). At session start, for an undecided project in an interactive root session, a prompt offers Trust (remembered), Not now (ignored this session, nothing persisted; a dismissed dialog is the same) and Never (ignored and remembered). Headless sessions and subagents never prompt; the file is ignored unless already trusted. A damaged trust store is never overwritten: Trust then applies to the session only, with a warning.

Why: a cloned repository's project config must never silently alter the gate.
Code: `findProjectConfig`, `readTrustStore`, `recordTrust`, the `session_start` handler in `autoMode`
Pinned by: project trust prompt › Trust: applies, persists the root, and is not asked again; project trust prompt › headless: no prompt, config ignored; project trust prompt › subagent: no prompt and ignored when undecided; applied when the main session trusted it; project trust prompt › malformed trust file: Trust applies for the session, file untouched, warns

#### CF-4: Merge semantics

A trusted project file is shallow-merged over the global file key by key, so a project list REPLACES the global list instead of extending it. The two rule maps `dangerRules` and `pathRules` merge per id instead: an id set in the project file replaces the global entry for that id only, other ids keep their global entry; an action string over a lower object entry keeps its `pattern`, `reason` and `flags` (`{...lower, action}`), an object entry on a built-in without `reason` keeps the built-in reason, `false` removes a danger rule and `null` entries are skipped with a warning. `toggleShortcut` and `_hint` are dropped from a project file (`toggleShortcut` with a warning), and a project `mode: "off"` is ignored with a warning (MD-2).

Why: replacing is predictable and lets a project narrow as well as widen; `toggleShortcut` binds at extension load and cannot differ per project.
Code: `loadUserRules`
Pinned by: /verdict config editor › local: first add copies the global list, notifies, and the badge flags the untrusted project; approval modes › scopes › a project config can set a mode; the session override still wins

#### CF-5: Session scope

Session overrides live in `<agentDir>/config/pi-verdict-sessions/<sessionId>.json` (a session id outside `[A-Za-z0-9._-]` is kept in memory only). A session file may set only `SESSION_KEYS` — `mode`, `confidenceThreshold`, the four jev thresholds, `unattendedDenyPaths`, `unattendedOmpDir`, `classifierFallbackMode`, `gateOmpDir`, `footer`, `modeStatus`, `grantStatus` — the rule maps `dangerRules` and `pathRules` (merged per id over local and global, CF-4), and `ruleAdditions`, whose `allow`, `deny`, `denyPaths`, `tools` and `rules` lists APPEND to the merged lists, and `grants`, the active permission grants (GR-6). Any other key is skipped with a warning. Precedence for every session key is session > local > global > default. The 50 newest session files are kept; new and forked sessions start without overrides.

Why: the right value differs per project and per session; the session file is kept apart from the audit directory and the trust store.
Code: `SESSION_KEYS`, `sanitizeSessionRaw`, `applyRuleAdditions`, `writeSessionOverrides`, `pruneSessionOverrides`, `settingSourcesOf`
Pinned by: approval modes › scopes › session beats user config, persists per session id, and survives a session_start; /verdict config editor › session scope: add lands in ruleAdditions; inherited global entries show tagged and the cursor skips them; session-scoped switches (menu redesign) › a session file with a non-boolean gateOmpDir keeps the gate on and reports a skip

#### CF-6: Invalid values

An invalid value is skipped with a warning (one notification per load listing every skipped value) and its default applies: an enum outside its set; a percent that is not a finite number in 0–100; a `subagentAskTimeoutMs` that is not a positive integer; a non-boolean switch; a non-string, empty or non-compiling list entry; a `dangerRules` entry whose id is not lowercase `[a-z0-9-]`, whose action string is not `deny`/`ask`/`allow`, whose action string or `false` names an unknown id, whose `pattern` is missing, non-string or non-compiling, whose `flags` are not a string of `i`/`m`/`s`/`u`, or whose `action`/`reason` have the wrong type; a `pathRules` id outside `PATH_TIER_IDS` or an action outside `deny`/`ask`/`allow`.

Why: configuration errors never disable the gate or crash the load (#25).
Code: `loadUserRules`, `parseApprovalKeys`
Pinned by: approval modes › scopes › invalid approval values skip with a warning and fall back to defaults; subagent gate (omp ctx.agent.kind = sub) › invalid subagentGate / subagentAskTimeoutMs warn and fall back to the defaults

#### CF-7: Removed keys

`autoDeny` (replaced by `mode: "supervised"`), `classifierMinConfidence` and `classifierFallbackConfidence` (both renamed `confidenceThreshold`) are ignored with a warning naming their replacement.

Why: clean cutover without aliases (breaking change of the approval-mode rework).
Code: `loadUserRules`
Pinned by: confidence floor + cascade (#67) › invalid confidenceThreshold warns; the old key reports the rename; approval modes › scopes › "off" in a config file is ignored with a warning (session-only); autoDeny reports its replacement

#### CF-8: When changes take effect

Hand edits of a config file apply at the next session start; `toggleShortcut` binds when the extension loads. Saves made through `/verdict`, `/rule`, `/automode` and the settings tool (ST-5) reload the rules immediately, re-anchor `denyPaths` (PP-1) and leave shadow-cache and fallback statistics untouched.

Why: hand edits stay deliberate and visible; menu edits must feel immediate.
Code: `SessionState.reloadRules`, `SessionState.reset`
Pinned by: /verdict config editor › add persists to the global file and takes effect immediately (no classifier call)

## AU: Audit log and shadow cache

#### AU-1: Audit scope

With `audit: true`, the gate appends one JSONL record per gray-zone adjudication and per protected-path or `.omp` gate outcome to `<agentDir>/verdicts/<sessionId>.jsonl`; rule allows and rule denies are NEVER recorded. The 20 most recent session files are kept (pruned at session start). Records are full fidelity, including the matched protected path (PP-6), and are local only. Subagent asks record who resolved them.

Why: gate asks grade the user's `denyPaths` rules via their answers; rule verdicts have no corpus value; the log is a local record in the same trust domain as `pi-verdict.json`.
Code: `AuditLog`, `AuditRecord`, `adjudicate`, `AUDIT_KEEP_SESSIONS`
Pinned by: audit verdict records (#54) › rule-layer verdicts stay unaudited; protected-path asks are recorded (#62); audit verdict records (#54) › session_start prunes to the 20 most recent session files; audit verdict records (#54) › off by default: no verdicts dir, no writes

#### AU-2: Top-level semantics

A record's top-level `verdict`, `reason` and `source` are the first layer's; the verdict actually applied under `enforce` lives in `fallback.effective`. A headless ask of any origin, and an unattended `unattended-retry` block, are recorded as their effective deny (the headless one with `degraded: true`). A fired floor sets `demoted: true`; threshold re-mapping sets `thresholdVerdict`; the record carries the approval `mode`.

Why: keeping first-layer semantics at the top level keeps shadow and enforce corpora comparable and old analysis scripts working; evaluators must read enforce rows through `fallback`.
Code: `adjudicate`, `FallbackAudit`, `AuditRecord`
Pinned by: audit verdict records (#54) › ask outcome recorded as ask (interactive) and as degraded deny (headless); audit verdict records (#54) › classifier failure and no-model paths both record fail-closed

#### AU-3: Interactive asks

An interactive ask is appended once, after the human answers, with `userAnswer` (`allowed`/`declined`) and `answeredAt`; if presentation throws, the record is still appended without the answer. Non-ask outcomes and headless asks append immediately and carry no answer.

Why: ground truth turns the log into an evaluation set for the first layer, the fallback and the `denyPaths` rules (#62).
Code: `Verdict.pendingAudit`, the `tool_call` handler in `autoMode`
Pinned by: audit user answers (#62) › classifier ask + user allows → one ask record with userAnswer allowed; answeredAt ≥ ts; audit user answers (#62) › confirm throw → record still lands without the answer, error propagates

#### AU-4: Observe-only and fail-soft

Audit recording NEVER changes a verdict. A write failure is swallowed; the first failure notifies one warning and later failures are silent.

Why: observability must not become an availability or integrity hazard for the gate (#54).
Code: `AuditLog.append`, `AuditLog.drainWarning`
Pinned by: audit verdict records (#54) › audit write failure never alters the verdict; warns exactly once

#### AU-5: Shadow cache

The shadow cache is an observe-only LRU of 128 gray-zone model verdicts keyed by two hashes: the command key (tool, input, cwd) and the context key (the last 5 user lines). Only model `allow` and `deny` verdicts are recorded (never ask or fail-closed); a would-be hit is counted and its agreement with the live verdict measured, but the cache NEVER supplies a verdict and the model is always called. It resets at session start.

Why: field data for the "should a serving cache ship" question without risking a stale verdict (#5 decision).
Code: `ShadowCache`, `shadowCommandKey`, `shadowContextKey`
Pinned by: shadow cache (observe-only) › repeat gray call: would-hit counted, model still called (never short-circuits); shadow cache (observe-only) › ask and fail-closed never enter the cache; shadow cache (observe-only) › LRU(128) evicts the oldest entry

## RG: Rule generator

#### RG-1: Transcript only

`/rule` sends the model the request and the recent transcript (the last 5 user lines and the last 20 tool calls), never the configuration. The model is the session model with reasoning off, a 30 s timeout and 1024 maximum tokens per call.

Why: protected-path plaintext must never reach a model (PP-6).
Code: `generateRule`, `critiqueRule`
Pinned by: unpinned

#### RG-2: Attempts and feedback

Generation makes at most 3 attempts; every failure (unparseable output, an invalid rule, a history-shadowed rule, a reviewer `revise`) is fed back into the next attempt. A model transport failure is not retried. When attempts run out the last candidate is returned unconfirmed with a note. A rule matching no recent call is not a failure.

Why: not recorded.
Code: `generateRuleReviewed`, `RULE_MAX_ATTEMPTS`
Pinned by: /rule command › malformed generator output → 3 attempts, then error notify, no dialog; /rule command › attempts exhausted: the last candidate is shown unconfirmed

#### RG-3: History replay and critic

A candidate `allow` or `tools` rule is replayed over the recent tool calls through the real rule layer; if it matches at least one call and still would auto-allow none of them (an earlier layer decides them), it is rejected and retried. A candidate that passes is reviewed by one critic model call; `revise` is fed back, an unavailable critic yields an unconfirmed result.

Why: an allow rule that an earlier layer always overrides (RL-2) is useless and misleads the user.
Code: `evaluateRuleOnHistory`, `critiqueRule`, `validateRule`
Pinned by: /rule command › shadowed allow is retried with feedback; the corrected rule is shown as reviewed; /rule command › critic revise feeds the next attempt

## RR: Root rule

#### RR-1: Storage and resolution

The root rule is one object under the config key `rootRule`: `{text, strictness, history, codebase, clarifications}`. `text` is the policy prose (`null` = none), `strictness` is `relaxed` | `balanced` | `strict`, `history` and `codebase` select the generator inputs, and `clarifications` are the user's instructions to the generator. It exists at global, local and session scope; the highest scope that sets a `rootRule` object wins wholesale, with no field merge, and the local scope counts only when its project is trusted (CF-3). An invalid field falls back to its default and is reported through the load warning channel (CF-6); a non-object `rootRule` is ignored as a whole. `clarifications` and the other generator inputs are NEVER sent to the classifier.

Why: one baseline policy per project is easier to reason about than a merged one, and the generator inputs belong to the policy they produced.
Code: `parseRootRule`, `ROOT_RULE_DEFAULTS`, `loadUserRules`, `sanitizeSessionRaw`
Pinned by: root rule (RR-1–RR-4) › highest scope wins wholesale; root rule (RR-1–RR-4) › invalid rootRule fields are skipped with a warning

#### RR-2: Composition

The root rule text is placed inside the user policy block of the classifier system prompt (CL-5), after the user-rules header so the jev slice carries it (JV-3): first `Root rule (the project's baseline policy):` with the text, then, when classification rules exist, `Classification rules (applied on top of the root rule; …)` with the bullets, then the apply sentence. Precedence is classification rules, then root rule, then the built-in criteria. Without a root rule the block is byte-identical to the classification-rules-only form. The fallback classifier receives the same policy as the first layer.

Why: the root rule is a baseline, so specific rules must be able to override it; keeping the no-root-rule prompt unchanged avoids drift for existing users.
Code: `userRulesHint`, `classifierPolicy`, `classifyWithModel`
Pinned by: root rule (RR-1–RR-4) › root rule sits inside the user rules block; rules win on conflict; root rule (RR-1–RR-4) › clarifications are persisted and sent to the generator only

#### RR-3: Generator inputs

`/automode-setup` sends the model (the session model, reasoning off): the strictness level and its definition, the clarifications, and, when enabled, the current session branch transcript (the last 20 user lines and the last 100 tool-call lines; tool results never) and a deterministic project snapshot. The snapshot is the top-level listing, a fixed file set (project docs, build and manifest files, up to 5 CI workflows; at most 6000 characters per file and 40000 in total) and the git remote names and URLs with userinfo removed. A file that is a credential path (S0, regardless of `builtinDenyFloor`) or matches `denyPaths` is skipped and only counted (PP-6); protected names are also omitted from the listing. The generator output and the file contents are untrusted data, and the clarifications are the only trusted instructions. The user's config is never sent.

Why: the root rule is drafted from evidence the user already exposed to the session; protected-path plaintext must never reach a model (PP-6).
Code: `collectProjectContext`, `generateRootRule`, `STRICTNESS_DOC`
Pinned by: root rule (RR-1–RR-4) › codebase context skips protected files and strips remote userinfo; root rule (RR-1–RR-4) › /automode-setup: generate → review → save to session; root rule (RR-1–RR-4) › nothing to analyze → warning, no model call

#### RR-4: Loop and review

Generation makes at most 3 attempts. A candidate over 4000 characters, unparseable output or a critic `revise` is fed back into the next attempt; a model transport failure is not retried; an unavailable critic yields an unconfirmed result; exhausted attempts return the last candidate unconfirmed with a note. A candidate over the length limit cannot be saved. The user always sees a preview (text, summary, review status, sources) and nothing is stored until they choose to save; they may edit the text, regenerate with feedback, or discard.

Why: the root rule steers every gray-zone verdict, so a human must accept it; the length limit bounds the prompt cost.
Code: `generateRootRuleReviewed`, `critiqueRootRule`, `ROOT_RULE_MAX_CHARS`, `openRootRuleMenu`
Pinned by: root rule (RR-1–RR-4) › critic revise feeds the next attempt; over-long draft is rejected; root rule (RR-1–RR-4) › /automode-setup: generate → review → save to session

## ST: Settings tool

#### ST-1: Actions and keys

The tool `verdict_settings` takes `action` = `get`, `set`, `unset`, `add` or `remove`; `key` from `SETTINGS_TOOL_KEYS` (every config key except `_hint`); `scope` = `global`, `local` or `session`; `value`; and `reason`. `set` replaces a key's whole value and validates it like the config loader (lists via `validateRule`, booleans, enums, percent keys 0–100 or `null`, model and prompt strings, `toggleShortcut`, `subagentAskTimeoutMs` integer ≥ 1, `rootRule` object with no skipped fields); the rule maps `dangerRules` and `pathRules` take an object and `set` merges it per id into that scope's stored map (an id with value `null` is dropped from the scope, restoring the lower scope's or default entry; an empty result is removed; entries are validated by `parseDangerRuleEntry` / the path-tier parser, unknown ids rejected); `unset` drops a key at one scope; `add`/`remove` take one entry of a list key (`allow`, `deny`, `denyPaths`, `tools`, `rules`). `get` returns the effective `dangerRules` as `{id: {action, reason, pattern, flags, builtin}}`. Scope rules, first violated one wins: `add`/`remove` apply only to list keys; `session` takes only `SESSION_KEYS`, `dangerRules`, `pathRules`, list keys (entries are appended to the effective list) and `rootRule`; `toggleShortcut` is not overridable at `local`; `mode` `off` is session-only. `reason` is required for changes (at most 500 characters). Invalid input is rejected before any dialog.

Why: one validation path means an approved change is always one the loader accepts; the per-scope limits mirror what the menus offer.
Code: `SETTINGS_TOOL_KEYS`, `validateSettingValue`, `settingScopeError`
Pinned by: settings tool (ST-1–ST-5) › invalid value is rejected before the dialog; settings tool (ST-1–ST-5) › mode off only at session scope; settings tool (ST-1–ST-5) › dangerRules set at session scope applies to the next call; a null id restores the default; settings tool (ST-1–ST-5) › an invalid rule entry is rejected before the dialog

#### ST-2: Confirmation

Every change (`set`, `unset`, `add`, `remove`) opens a confirmation dialog in every approval mode, showing scope and file, key, action, the stored value before and after, notes and the agent's reason. Nothing is written unless the user approves; a decline, an aborted signal or a dialog error writes nothing and the tool reports the decline as a normal result.

Why: agent-initiated policy changes weaken or tighten the gate the agent runs under, so the user decides every one (security principle 8); the dialog is the tool's own approval, not a gate ask, so unattended does not skip it.
Code: the `execute` handler registered as `SETTINGS_TOOL_NAME` in `autoMode`
Pinned by: settings tool (ST-1–ST-5) › approved set writes the global config; settings tool (ST-1–ST-5) › declined change writes nothing

#### ST-3: Fail closed

Calls from a subagent are refused. Changes are refused when there is no UI to ask the user; `get` still works without a UI.

Why: nobody can approve a change from a subagent or a headless session, and a refused change is the safe outcome.
Code: the `execute` handler registered as `SETTINGS_TOOL_NAME` in `autoMode`, `subagentIdentity`
Pinned by: settings tool (ST-1–ST-5) › no UI refuses changes without a dialog; settings tool (ST-1–ST-5) › subagent call is refused

#### ST-4: Plaintext

`get` returns, per key, the effective value, its source and the stored value at each scope; `denyPaths` is reduced to `{redacted: true, count}`. For `denyPaths` `add`/`remove` there is no membership check before the dialog, and a no-op is reported only after approval, so the agent learns nothing about the list. Results never echo a stored value; the dialog shows `denyPaths` plaintext to the user only (PP-6).

Why: the tool's output reaches the agent, and protected-path plaintext must not (PP-6).
Code: the `execute` handler registered as `SETTINGS_TOOL_NAME` in `autoMode`
Pinned by: settings tool (ST-1–ST-5) › get never returns denyPaths plaintext

#### ST-5: Writes

An approved change goes through the same writers as the menus (`writeScoped`, `setSessionRuleAdditions`) and takes effect immediately (CF-8). The first `local` list change on a key the project does not override starts from a copy of the global list, and the dialog says so. A change at `local` in a project that is not trusted is saved but not applied until the project is trusted (CF-3).

Why: one writer per scope keeps menu and tool edits identical; the copy-first rule matches the project-replaces-global list semantics (CF-4).
Code: `writeScoped`, `setSessionRuleAdditions`
Pinned by: settings tool (ST-1–ST-5) › local add starts from a copy of the global list; settings tool (ST-1–ST-5) › session add to deny takes effect immediately

## GR: Permission grants

#### GR-1: Request tool

The tool `verdict_grant` takes `action` = `request`, `release` or `list`. `request` carries `request` (natural language, at most 1000 characters, the exact operation and scope), optional `paths` (at most 10 entries of `{path, access}`, `access` = `read`, `write` or `full`, path at most 500 characters) and optional `rules` (at most 20 danger-rule ids, each of them in the effective danger-rule list — RL-5; an unknown id is rejected with the list of known ids before any dialog). At most 20 grants are active; an identical active request (same text, paths and rules) answers `Already granted` without asking. `release` drops one of the agent's own grants by id; `list` returns the active grants with their `rules`. In approval mode `off` every action answers `NA: …` and nothing else happens (MD-2); the tool is refused in subagents. A grant is a session-long, natural-language authorization; it is never written to a config file. A stored grant without a `rules` field loads with an empty list.

Why: the agent needs a sanctioned way to ask for an authorization a block told it about, and a human-approved scope the classifiers can read is narrower than a regex the user must write.
Code: `verdict_grant` (registered in `autoMode`), `GRANT_TOOL_NAME`, `parseGrants`
Pinned by: permission grants (GR-1–GR-6) › GR-1: mode off answers NA to every action, with no dialog and no model call; permission grants (GR-1–GR-6) › GR-2: invalid requests throw, an identical active request is not asked twice; permission grants (GR-1–GR-6) › GR-2: no UI rejects; subagents are refused; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › requesting an unknown rule id throws and lists the known ids; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › a persisted grant without a rules field still loads

#### GR-2: Human approval

In `auto` and `supervised` a request opens the grant dialog with I approve, I reject and Ask for clarification or revision (the last is an inline text field; empty text leaves the dialog open). Approval creates grant `G<n>` (ids are never reused within a session) with `grantedBy: "user"`. Reject answers `Rejected by the user` and tells the agent not to repeat the request; clarify returns the user's text to the agent and grants nothing. Without a UI the request is rejected, and a dialog failure or abort grants nothing. Hosts without the rich dialog use a plain select (plus an input for the clarification). The dialog never offers Explain… (PP-9).

Why: a grant widens what the classifiers may allow, so only a human, or in unattended a model consensus (GR-3), may create one.
Code: `confirmGrant`, `buildApproveDialog` (variant `grant`)
Pinned by: permission grants (GR-1–GR-6) › GR-2: reject, and clarify with text, grant nothing; permission grants (GR-1–GR-6) › GR-2: clarify with empty input returns to the choices; permission grants (GR-1–GR-6) › GR-2: rich dialog lists the three choices; an empty clarification row keeps it open until text is typed

#### GR-3: Unattended consensus

In `unattended` nothing prompts: the judge classifier reviews the request (the task paragraph `Grant review`, choices allow/deny; the request, its paths and its rule ids are the whole brief, and a grant that names built-in rules or paths needs the narrowest scope that serves the request), and a configured `classifierFallbackModel` must also allow, regardless of `classifierFallbackMode`. Both allow → the grant is created with `grantedBy: "classifier"`; any deny, error, a missing model or a missing allow → rejected with nothing granted. The existence hint of PP-7 is not sent: the request and the grants are the whole brief.

Why: unattended has no human, so a grant needs two independent agreements rather than the agent's say-so.
Code: `grantConsensus`, `GRANT_REVIEW_TASK`
Pinned by: permission grants (GR-1–GR-6) › GR-3: unattended grants only when the judge allows; a configured fallback must allow as well

#### GR-4: Authority in classifier prompts

Active grants are part of the user policy block of every classifier and fallback system prompt (CL-5), after the root rule and the classification rules, as `Permission grants (…)` with one `- G<n>: <request>` line per grant, followed by `(danger rules: <ids>)` when it names rules. Within its literal scope a grant is authoritative: the classifier may allow a call the grant clearly covers; nothing it does not literally cover is widened. A grant does not override a user `deny` rule, which is decided before the classifier (RL-2); it lifts a built-in rule only through the coverage check of GR-5. Protected-path entries are NOT sent in ordinary classifier prompts (PP-6): each grant with entries carries only `(plus N protected-path access entry/entries, enforced separately)`.

Why: the grant text is the user's own words, approved this session, so it is policy and not injected content; the protected-path plaintext rule (PP-6) stays intact outside the coverage check.
Code: `classifierPolicy`, `trustedPolicyBlock`
Pinned by: permission grants (GR-1–GR-6) › GR-2/GR-4/GR-6: approved grant is persisted and reaches the classifier prompt after the rules header; permission grants (GR-1–GR-6) › GR-4: the fallback classifier prompt carries the grants too; permission grants (GR-1–GR-6) › GR-4: protected-path text is withheld from ordinary classifier calls (count only)

#### GR-5: Coverage check

A grant may list protected-path access entries (`paths`) and danger-rule ids (`rules`). When a call would be a terminal ask because of `denyPaths` (PP-5) or the `.omp` gate (PP-8), or has built-in rule hits that make it a deny or an ask (RL-5, PG-3–PG-5), and at least one active grant could apply, the coverage check runs before the ask or deny (and before the unattended outcome of MD-4). A grant covers the call only if every protected path the call touches lies under one of its entries (segment boundary, base forms, PP-3/PP-4) and the access fits (a command tool accepts any access level, `write` and `edit` need `write` or `full`, every other file tool needs `read` or `full`), and every danger-rule hit's id is among its `rules`; a built-in path-tier hit is covered by a path entry that contains the path (the same entry rule). Several grants may cover different parts of one call (a command touching a `denyPaths` entry and a `.omp` directory needs both covered). If no grant covers every touch or hit the call asks or is denied as before (a built-in deny whose block text carries the grant hint) and no model is called. Otherwise the judge, and a configured fallback, are asked once each with the call, the covering grants and their paths and rule ids (task paragraph `Coverage check`, choices allow/ask); both must answer allow for the call to pass, any other outcome keeps the ask or deny. A passing call is allowed with reason `permission grant <ids> covers this gated access`, recorded in the audit log (AU-1) with source `protected-path` and silent outside debug (PR-3). A grant never lifts a user `deny` rule (RL-2 step 1).

Why: a protected path is a user-declared boundary and a built-in rule is the gate's own claim, so lifting either for one call needs the user's own approval of the path or rule (GR-2) plus two checks that this call is within it; an uncovered call must not leak the path to a model.
Code: `coveringGrants`, `denyPathHits`, `ompTouches`, `grantConsensus`, `GRANT_COVERAGE_TASK`, `adjudicate`
Pinned by: permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › without a covering grant a protected-path read asks the user, with no model call; permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › a covering read grant lets the scope check allow the read without asking; the reason and notices carry no path; permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › an access level that does not fit never reaches a model: write with a read grant asks; permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › a command touching a denyPath and a .omp path is not coverable when only the .omp path is granted; permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › the scope check answering ask falls back to today's ask; permission grants (GR-1–GR-6) › protected-path coverage (GR-5) › headless, an uncovered or refused protected-path call still denies; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › a grant naming the rule id lets the scope check lift the built-in deny; judge ask keeps the block with the hint; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › a grant without the id does not cover the rule: deny with no model call; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › a rule set to ask is liftable the same way (headless included); permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › a path grant covers its built-in tier at a fitting access level only; permission grants (GR-1–GR-6) › built-in rules and path tiers (GR-5) › unattended: a gate whose unattended action is allow still refuses a built-in ask underneath

#### GR-6: Lifetime, revocation and visibility

Grants live in the session scope (`grants` in the session file, CF-5), survive a restart of the same session and are absent in other sessions; malformed stored entries are dropped with one notice. The agent releases its own grants; the user lists and revokes them with `/grants` (`list`, `revoke <id>`, `revoke all`, or an interactive menu with a confirmation). A revocation sends the agent a `verdict-grant-revoked` message naming the ids. While grants exist the footer shows the count (`\uF084 n` full, `🔑 n` compact) and, on hosts with a status bar, an extra `🔑 n` entry; the `grantStatus` switch (default on, session-scopable) controls the latter. With no grants nothing is rendered, byte-identical to a build without the feature. A block of tag `classifier`, `unattended-retry` or `user-declined` tells the agent it may request a grant (PR-2).

Why: a grant is as sensitive as a rule, so it is visible, revocable and bounded by the session; the agent must also learn when a grant disappears under it.
Code: `setGrants`, `revokeGrants`, `renderFooter`, `refreshStatus`, `GRANT_STATUS_KEY`, the `grants` command
Pinned by: permission grants (GR-1–GR-6) › GR-6: release removes the grant from the next prompt; an unknown id throws; ids are not reused; permission grants (GR-1–GR-6) › GR-6: /grants revoke removes the grant and tells the agent; /grants lists; permission grants (GR-1–GR-6) › GR-6: /grants menu revokes a picked grant after confirmation, and revoke all clears the rest; permission grants (GR-1–GR-6) › GR-6: grants survive a restart of the same session id and not a different one; malformed entries are dropped with a notice; permission grants (GR-1–GR-6) › status surfaces (GR-6) › full footer shows the grant count only while grants exist and is byte-identical to the featureless render at 0; permission grants (GR-1–GR-6) › status surfaces (GR-6) › compact footer shows the grant count only while grants exist and is byte-identical to the featureless render at 0; permission grants (GR-1–GR-6) › status surfaces (GR-6) › prompt status bar (omp): 🔑 N while grants exist; grantStatus:false, mode off and zero grants clear it

#### GR-7: Gate briefing

On every agent turn (`before_agent_start`, chained on both hosts: pi `systemPrompt` is a string, omp a list of sections) the gate appends a `## Permission gate (pi-verdict)` section to the acting agent's system prompt. It says that every tool call is checked and that a blocked call starts with `[auto-mode <tag> block] BLOCKED` and did not run; names the approval mode (a gated subagent in `subagentGate: "auto"` is also told a model decides its approvals); lists the effective danger rules with action `deny` and with action `ask` as `id (reason)` (built-in and custom, never the pattern); lists every path tier whose action is not `allow`; gives the number of `denyPaths` entries without any path (PP-6); mentions the `.omp` gate when `gateOmpDir` is on; and tells the agent not to retry, rephrase, split or encode a blocked call but to request a `verdict_grant` (main agent) or to report the need in its final output (subagent, which cannot call the tool). The main agent is also pointed to `verdict_settings get` before it claims a rule blocks something. The section is omitted (prompt untouched) when the mode is `off`, or for a subagent while `subagentGate` is `off`, the same conditions under which the `tool_call` gate is inert, and when `systemPrompt` has an unknown shape. It holds nothing that changes within a session besides mode and rules (no grant ids), so the prompt stays cacheable; there is no switch to turn it off.

Why: the agent must learn the boundaries and the grant channel before it hits them, not after repeated blocks.
Code: `gateBriefing`, `GATE_BRIEFING_HEADER`, the `before_agent_start` handler
Pinned by: gate briefing (GR-7) › default rules: appends the briefing to a string system prompt, lists deny rules and tiers, names verdict_grant; gate briefing (GR-7) › omp array system prompt gets one appended section; gate briefing (GR-7) › dangerRules action ask moves the rule to the approval line; gate briefing (GR-7) › mode off and an ungated subagent get no briefing; gate briefing (GR-7) › a gated subagent is told to report instead of requesting a grant

## Decision tables

### Table A: effective outcome by approval mode

Each cell is interactive / headless. `off` evaluates nothing (MD-2).

| Row | `auto` | `unattended` | `supervised` |
|---|---|---|---|
| floor or user deny (RL-2, RL-5) | deny / deny | deny / deny | ask / deny |
| `.omp` gate hit (PP-8) | ask / deny | `unattendedOmpDir` (MD-4) | ask / deny |
| denyPaths hit (PP-5) | ask / deny | `unattendedDenyPaths` (MD-4) | ask / deny |
| `.omp` or denyPaths hit covered by a grant, judge and fallback both allow (GR-5) | allow | allow | allow |
| rule allow: user allow, path-grading allow, `tools`, empty command (RL-2) | allow | allow | allow |
| classifier allow | allow | allow | allow |
| classifier ask | ask / deny | `unattended-retry` block (after the unattended-ask cascade, CS-3) | ask / deny |
| classifier deny | deny | deny | ask / deny |
| fail-closed, no fallback (CS-4) | deny | deny | ask / deny |
| demotion, no fallback (CS-4) | ask / deny | `unattended-retry` block | ask / deny |

### Table B: cascade outcome by trigger and fallback mode

Outcome applied to the triggered call; an ask result degrades to deny headless (PR-1) and to a `unattended-retry` block in unattended (MD-4).

| Trigger | `shadow` (CS-6) | `enforce` (CS-7) | `enforce`, fallback failure (CS-8) |
|---|---|---|---|
| demotion (CS-1) | ask; opinion recorded | the fallback verdict; a fallback allow over a demoted first-layer deny becomes ask | ask (`fallback classifier unavailable …`) |
| fail-closed (CS-3) | deny stands; opinion recorded | the fallback verdict de novo, including allow | ask (`fallback classifier unavailable …`) |
| unattended-ask (CS-3) | ask stands → `unattended-retry` block | the fallback verdict (ask → `unattended-retry` block) | ask → `unattended-retry` block |

With no fallback configured every cell reads as CS-4. In `shadow`, a fallback failure leaves the outcome unchanged and is recorded as an error.

### Table C: subagent ask resolution

Rows are the origin of the ask (SG-4, SG-5); `consult` means the fallback model is asked once and only an explicit `allow` permits.

| Ask origin | `normal`, answered | `normal`, timeout or no root UI | `auto` |
|---|---|---|---|
| protected-path or `.omp` gate ask | human decides | deny | deny |
| rule or fail-closed ask; ask created by `supervised` from a deny | human decides | deny | deny |
| classifier ask, no fallback consulted yet | human decides | consult | consult |
| classifier-origin ask, cascade already consulted the fallback | human decides | the fallback's `allow` allows; anything else denies; a demoted first-layer deny never allows (CS-7) | same as timeout |
