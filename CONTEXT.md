# pi-verdict

The glossary of pi-verdict, a permission gate for coding-agent tool calls built from a deterministic rule layer and a model classifier. It defines terms only; behavior is specified in [docs/adjudication-rules.md](docs/adjudication-rules.md), whose rule IDs each entry links to.

## Language

### Gate

**Permission gate**:
The extension that adjudicates every tool call of a coding agent before it runs and answers allow, ask or deny.
_Avoid_: guard, firewall, sandbox
Rules: [RL-2](docs/adjudication-rules.md#rl-2-evaluation-order), [CL-1](docs/adjudication-rules.md#cl-1-gray-zone)

**Auto Mode**:
The allow-unless-intercepted posture: a tool call passes unless the rule layer or the classifier intercepts it, the reverse of Claude Code's prompt-unless-approved default.
_Avoid_: YOLO; "auto mode" for the `auto` approval mode (say "the `auto` mode")
Rules: [MD-1](docs/adjudication-rules.md#md-1-modes-and-verdict-sets)

**Tool call**:
One request by the agent to run a host tool (a command, a file operation, an MCP or custom tool); the unit the gate adjudicates.
Rules: [RL-1](docs/adjudication-rules.md#rl-1-tool-families)

**Action line**:
The one-line rendering of the tool call under review, pinned as the last line of the transcript.
Rules: [CL-4](docs/adjudication-rules.md#cl-4-input-transcript)

**Verdict**:
The result of adjudicating one tool call: allow, ask or deny, with a reason and a verdict source.
_Avoid_: decision, ruling, judgment
Rules: [PR-2](docs/adjudication-rules.md#pr-2-block-reason)

**Three-state verdict**:
The value set of a verdict: allow (the call runs), deny (the call is blocked), ask (a human decides).
Rules: [MD-1](docs/adjudication-rules.md#md-1-modes-and-verdict-sets), [PR-1](docs/adjudication-rules.md#pr-1-ask-degradation)

**Verdict source**:
The stage that produced a verdict: `rule` (the rule layer), `protected-path` (a gate ask), `classifier` (the classifier, including its failure) or `fail-closed` (no classifier model, or an unavailable enforce fallback).
Rules: [PR-2](docs/adjudication-rules.md#pr-2-block-reason), [CS-8](docs/adjudication-rules.md#cs-8-fallback-failure)

**Adjudication pipeline**:
The full sequence that turns a tool call into a verdict: rule layer, classifier, confidence floor and mode thresholds, fallback cascade, approval-mode shaping and presentation.
_Avoid_: verdict pipeline, judgment pipeline
Rules: [RL-2](docs/adjudication-rules.md#rl-2-evaluation-order), [CL-1](docs/adjudication-rules.md#cl-1-gray-zone), [CS-3](docs/adjudication-rules.md#cs-3-cascade-triggers), [MD-1](docs/adjudication-rules.md#md-1-modes-and-verdict-sets)

**Approval mode**:
The overall posture of the gate for a session: `auto`, `unattended`, `supervised` or `off`.
_Avoid_: master switch, autoDeny, default, yolo, noAutoDeny (former mode names)
Rules: [MD-1](docs/adjudication-rules.md#md-1-modes-and-verdict-sets), [MD-2](docs/adjudication-rules.md#md-2-off), [MD-3](docs/adjudication-rules.md#md-3-auto), [MD-4](docs/adjudication-rules.md#md-4-unattended), [MD-5](docs/adjudication-rules.md#md-5-supervised), [MD-6](docs/adjudication-rules.md#md-6-setting-a-mode)

### Rule layer

**Rule layer**:
The deterministic first stage of the pipeline; it decides allow, deny or ask from rules without calling a model, or leaves the call gray.
Rules: [RL-2](docs/adjudication-rules.md#rl-2-evaluation-order)

**Built-in rules**:
The built-in part of the rule layer, made of danger rules and path tiers, each with a configurable rule action (`deny` by default for most); it never declares a command allowed — `allow` hands the call on to the classifier.
_Avoid_: built-in deny floor, built-in allowlist
Rules: [RL-5](docs/adjudication-rules.md#rl-5-danger-rules), [RL-6](docs/adjudication-rules.md#rl-6-builtindenyfloor), [PG-3](docs/adjudication-rules.md#pg-3-s0-secrets)

**Danger rule**:
A regular expression, identified by an id and carrying a rule action, whose match on a command string denies, asks or passes the call; the built-in ones can be reconfigured or removed and users can add custom ones (`dangerRules`).
Rules: [RL-5](docs/adjudication-rules.md#rl-5-danger-rules)

**Path tier**:
One of the built-in grades of the path-grading part of the built-in rules (`s0-secret`, `s1-system-read`, `s1-system-write`, `s2-user-rc-write`, `s3-git-meta-write`), each with a configurable rule action (`pathRules`).
Rules: [PG-3](docs/adjudication-rules.md#pg-3-s0-secrets), [PG-4](docs/adjudication-rules.md#pg-4-reads), [PG-5](docs/adjudication-rules.md#pg-5-writes)

**Rule action**:
What a matching built-in rule does: `deny` blocks, `ask` asks the user (a deny headless or in `unattended`), `allow` passes no judgment so the call goes to the classifier.
_Avoid_: verdict (that is the final allow/ask/deny of the pipeline)
Rules: [RL-5](docs/adjudication-rules.md#rl-5-danger-rules), [RL-6](docs/adjudication-rules.md#rl-6-builtindenyfloor)

**Path grading**:
The built-in classification of a file path into a sensitivity grade that yields allow, gray or deny for a file tool.
Rules: [PG-1](docs/adjudication-rules.md#pg-1-applicability), [PG-4](docs/adjudication-rules.md#pg-4-reads), [PG-5](docs/adjudication-rules.md#pg-5-writes)

**Sensitivity grade**:
One of S0 (secrets and credentials), S1 (system directories), S2 (user persistence entry points) or S3 (git metadata), each a set of path patterns.
Rules: [PG-3](docs/adjudication-rules.md#pg-3-s0-secrets), [PG-4](docs/adjudication-rules.md#pg-4-reads), [PG-5](docs/adjudication-rules.md#pg-5-writes)

**User rules**:
The allow and deny regular expressions the user configures; deny beats allow.
Rules: [RL-2](docs/adjudication-rules.md#rl-2-evaluation-order), [RL-3](docs/adjudication-rules.md#rl-3-rule-target), [RL-4](docs/adjudication-rules.md#rl-4-user-regexes)

**Rule target**:
The string a user regular expression is tested against: the command string, or the resolved path of a file tool.
Rules: [RL-3](docs/adjudication-rules.md#rl-3-rule-target)

**Tools allowlist**:
The exact names of tools outside the command and file families that the user allows without the classifier.
Rules: [RL-7](docs/adjudication-rules.md#rl-7-tools-allowlist)

**Settings tool**:
The agent-callable tool `verdict_settings` that reads the gate's settings and proposes changes to them; the rule layer allows it and the user confirms every change.
Rules: [RL-8](docs/adjudication-rules.md#rl-8-settings-tool), [ST-1](docs/adjudication-rules.md#st-1-actions-and-keys), [ST-2](docs/adjudication-rules.md#st-2-confirmation)

**Scope tool**:
A file tool whose optional path defaults to the working directory and whose search covers a subtree: `grep`, `find`, `ls`.
Rules: [RL-1](docs/adjudication-rules.md#rl-1-tool-families), [PP-3](docs/adjudication-rules.md#pp-3-matching)

**Dual-form matching**:
Testing every canonical form of a path, lexical and realpath, and treating a match on any form as a match.
_Avoid_: single-form matching
Rules: [PG-2](docs/adjudication-rules.md#pg-2-forms), [PP-4](docs/adjudication-rules.md#pp-4-base-tier-only)

**Base tier**:
The dual-form variant that takes the lexical absolute form plus the realpath of the whole path when it exists.
Rules: [PP-4](docs/adjudication-rules.md#pp-4-base-tier-only)

**Rebuilt tier**:
The dual-form variant that adds, for a target that does not exist yet, a form rebuilt from the realpath of its nearest existing ancestor.
_Avoid_: ancestor rebuild for protected paths
Rules: [PG-2](docs/adjudication-rules.md#pg-2-forms), [PP-4](docs/adjudication-rules.md#pp-4-base-tier-only)

**Protected path**:
A path the user declares sensitive in the `denyPaths` config key; any call touching it asks the user.
_Avoid_: denyPath, sensitive path
Rules: [PP-1](docs/adjudication-rules.md#pp-1-declaration-normalization-and-anchoring), [PP-2](docs/adjudication-rules.md#pp-2-candidate-extraction), [PP-3](docs/adjudication-rules.md#pp-3-matching), [PP-5](docs/adjudication-rules.md#pp-5-hit-is-a-terminal-ask)

**Forced .omp gate**:
The built-in gate, on by default, that turns any call touching a `.omp` directory into a terminal ask.
Rules: [PP-8](docs/adjudication-rules.md#pp-8-forced-omp-gate)

**Terminal ask**:
An ask raised by a gate that no later rule-layer step and no classifier can override.
Rules: [PP-5](docs/adjudication-rules.md#pp-5-hit-is-a-terminal-ask), [PP-8](docs/adjudication-rules.md#pp-8-forced-omp-gate)

**Existence hint**:
A fixed sentence added to the classifier's system prompt stating that protected paths are configured, without naming any of them.
Rules: [PP-7](docs/adjudication-rules.md#pp-7-existence-hint)

**Gray zone**:
The set of tool calls the rule layer leaves undecided and hands to the classifier.
Rules: [CL-1](docs/adjudication-rules.md#cl-1-gray-zone)

### Classifier

**Classifier**:
The first-layer model call that judges a gray tool call and answers in the verdict prefix contract.
Rules: [CL-1](docs/adjudication-rules.md#cl-1-gray-zone), [CL-2](docs/adjudication-rules.md#cl-2-classifier-model-resolution), [CL-7](docs/adjudication-rules.md#cl-7-attempts-timeouts-fail-closed)

**Self-reflection**:
The classifier's default model source: the model of the running session.
Rules: [CL-2](docs/adjudication-rules.md#cl-2-classifier-model-resolution)

**Transcript**:
The condensed, sanitized text the classifier reads: recent user messages, recent tool calls and the action line last, never tool results.
Rules: [CL-4](docs/adjudication-rules.md#cl-4-input-transcript)

**Verdict prefix contract**:
The response form every classifier backend is normalized to: a leading `<verdict>allow|ask|deny</verdict>` followed by a short reason.
Rules: [CL-6](docs/adjudication-rules.md#cl-6-verdict-prefix-contract)

**Classification rules**:
The user's free-text rules, the `rules` config key, appended to the classifier's system prompt.
_Avoid_: user rules (those are the allow and deny regular expressions)
Rules: [CL-5](docs/adjudication-rules.md#cl-5-system-prompt-composition)

**Root rule**:
The single free-text baseline policy for the classifier, drafted by the session model and accepted by the user; classification rules apply on top of it.
_Avoid_: root role, base rule, project policy
Rules: [RR-1](docs/adjudication-rules.md#rr-1-storage-and-resolution), [RR-2](docs/adjudication-rules.md#rr-2-composition)

**Typed decision**:
The output form of a non-generative model: a choice among predefined options with a probability distribution and a confidence.
Rules: [JV-3](docs/adjudication-rules.md#jv-3-translation)

**jev adapter**:
The companion extension that presents TypeSafe's jev decisions model as a registered model and translates the classifier call into a decisions request.
Rules: [JV-1](docs/adjudication-rules.md#jv-1-inert-unless-selected), [JV-3](docs/adjudication-rules.md#jv-3-translation), [JV-5](docs/adjudication-rules.md#jv-5-omp-support)

**Transport**:
The route a jev request takes: `openrouter` or `typesafe`.
Rules: [JV-2](docs/adjudication-rules.md#jv-2-transports-and-credentials)

**Concern**:
The risk category jev names in a second typed question, shown as a cosmetic label in the reason.
Rules: [JV-3](docs/adjudication-rules.md#jv-3-translation)

**Confidence floor**:
The `confidenceThreshold` below which a first-layer jev verdict is demoted.
_Avoid_: classifierMinConfidence, confidence threshold
Rules: [CS-1](docs/adjudication-rules.md#cs-1-confidence-floor)

**Demotion**:
The abstention of the first layer when its confidence is strictly below the confidence floor; the call cascades.
Rules: [CS-1](docs/adjudication-rules.md#cs-1-confidence-floor), [CS-4](docs/adjudication-rules.md#cs-4-no-fallback)

**Mode threshold**:
A per-mode jev probability threshold that re-maps a non-demoted first-layer jev verdict.
Rules: [CS-2](docs/adjudication-rules.md#cs-2-mode-thresholds)

**Fallback classifier**:
The second-layer model, never the session model, that the cascade consults.
_Avoid_: second opinion
Rules: [CS-5](docs/adjudication-rules.md#cs-5-fallback-resolution-and-budget)

**Cascade**:
The escalation of a triggered call from the first layer to the fallback classifier, or to the human when none is configured.
Rules: [CS-3](docs/adjudication-rules.md#cs-3-cascade-triggers), [CS-4](docs/adjudication-rules.md#cs-4-no-fallback)

**Cascade trigger**:
One of the three events that start the cascade: a demotion, a fail-closed first layer, an unattended-ask slip.
Rules: [CS-3](docs/adjudication-rules.md#cs-3-cascade-triggers)

**Shadow fallback mode**:
The fallback mode in which the fallback classifier's opinion is recorded and never changes a verdict.
Rules: [CS-6](docs/adjudication-rules.md#cs-6-shadow-mode)

**Enforce fallback mode**:
The fallback mode in which the fallback classifier's verdict applies to the triggered call, with one carve-out for a demoted deny.
Rules: [CS-7](docs/adjudication-rules.md#cs-7-enforce-mode), [CS-8](docs/adjudication-rules.md#cs-8-fallback-failure)

**unattended-ask slip**:
A first-layer ask in `unattended` mode, where no human exists to receive it.
Rules: [CS-3](docs/adjudication-rules.md#cs-3-cascade-triggers), [MD-4](docs/adjudication-rules.md#md-4-unattended)

### Outcomes

**Ask degradation**:
The turning of an ask into a deny when no UI is available to answer it.
Rules: [PR-1](docs/adjudication-rules.md#pr-1-ask-degradation)

**Fail-closed**:
The default outcome when the gate cannot establish an answer: the call is blocked.
Rules: [CL-7](docs/adjudication-rules.md#cl-7-attempts-timeouts-fail-closed), [JV-4](docs/adjudication-rules.md#jv-4-confidence-is-required), [CS-4](docs/adjudication-rules.md#cs-4-no-fallback), [CS-8](docs/adjudication-rules.md#cs-8-fallback-failure)

**Explain-or-rewrite block**:
The block `unattended` returns in place of an ask, asking the agent to justify the action or rewrite it more narrowly.
Rules: [MD-4](docs/adjudication-rules.md#md-4-unattended)

**Block reason**:
The agent-facing text of a blocked call: a tag, a fixed statement that the action did not run, and the detail.
Rules: [PR-2](docs/adjudication-rules.md#pr-2-block-reason)

**Block tag**:
The label in a block reason that names the kind of block, such as `rule` or `unattended-retry`.
Rules: [PR-2](docs/adjudication-rules.md#pr-2-block-reason)

**Ask dialog**:
The confirmation dialog with Yes, Yes and don't ask again this session, No and Explain… through which a human answers an ask.
Rules: [PR-4](docs/adjudication-rules.md#pr-4-ask-dialog), [PR-9](docs/adjudication-rules.md#pr-9-remembered-approval), [PP-9](docs/adjudication-rules.md#pp-9-no-explain-for-gate-asks)

**Remembered approval**:
A human Yes to an ask that the gate reuses for the identical tool call for the rest of the session.
_Avoid_: session approval, always-allow
Rules: [PR-9](docs/adjudication-rules.md#pr-9-remembered-approval)

**Decline reason**:
The text a user types into the No row, forwarded to the agent in the block reason.
Rules: [PR-4](docs/adjudication-rules.md#pr-4-ask-dialog)

**EXPLAIN-GATE role**:
The model role behind Explain…, producing an explanation for the human only.
Rules: [PR-5](docs/adjudication-rules.md#pr-5-explain-gate)

**Verdict notification**:
A user-facing message about a verdict; deny blocks always produce one, allows only when enabled.
Rules: [PR-3](docs/adjudication-rules.md#pr-3-notifications)

**Verdict label**:
The status row recorded after an allowed call, naming how it passed.
Rules: [PR-7](docs/adjudication-rules.md#pr-7-verdict-label)

**Status widget**:
The one-row live indicator shown while a model call or an approval is pending.
Rules: [PR-6](docs/adjudication-rules.md#pr-6-status-widget)

**Footer**:
The status display of the gate's mode, models and verdict counters.
Rules: [PR-8](docs/adjudication-rules.md#pr-8-verdict-counters)

**Mode chip**:
The compact approval-mode badge in the prompt status bar.
Rules: [MD-6](docs/adjudication-rules.md#md-6-setting-a-mode)

### Observability

**Verdict audit log**:
The opt-in per-session JSONL record of gray-zone and gate adjudications.
Rules: [AU-1](docs/adjudication-rules.md#au-1-audit-scope), [AU-2](docs/adjudication-rules.md#au-2-top-level-semantics), [AU-4](docs/adjudication-rules.md#au-4-observe-only-and-fail-soft)

**Ground truth**:
The user's answer to an interactive ask, stored on its audit record.
Rules: [AU-3](docs/adjudication-rules.md#au-3-interactive-asks)

**Shadow cache**:
The observe-only cache that measures how often a gray call would repeat an earlier verdict and never supplies one.
Rules: [AU-5](docs/adjudication-rules.md#au-5-shadow-cache)

### Configuration

**agentDir**:
The host's agent directory under which the gate keeps its config, trust store, session overrides and audit logs.
Rules: [CF-1](docs/adjudication-rules.md#cf-1-agentdir-resolution)

**Self-anchoring**:
Deriving agentDir from the extension's own install path instead of probing the host tree.
Rules: [CF-1](docs/adjudication-rules.md#cf-1-agentdir-resolution)

**Scope**:
A layer a setting can be stored in: `session`, `local`, `global`, or the built-in default.
Rules: [CF-5](docs/adjudication-rules.md#cf-5-session-scope)

**Global scope**:
The user config file under agentDir.
_Avoid_: user scope
Rules: [CF-2](docs/adjudication-rules.md#cf-2-user-file)

**Local scope**:
The trusted project's config file.
_Avoid_: project scope
Rules: [CF-3](docs/adjudication-rules.md#cf-3-project-discovery-and-trust), [CF-4](docs/adjudication-rules.md#cf-4-merge-semantics)

**Session scope**:
The overrides of one session, stored per session id.
Rules: [CF-5](docs/adjudication-rules.md#cf-5-session-scope)

**Session override**:
A setting stored in session scope.
Rules: [CF-5](docs/adjudication-rules.md#cf-5-session-scope)

**Rule additions**:
The entries a session appends to the merged allow, deny, denyPaths, tools and rules lists.
Rules: [CF-5](docs/adjudication-rules.md#cf-5-session-scope)

**Project trust**:
The user's recorded decision whether a project's config may be applied.
Rules: [CF-3](docs/adjudication-rules.md#cf-3-project-discovery-and-trust)

**Model role**:
A named omp model assignment the gate reads: `judge`, `verdict-fallback` or `explain-gate`.
Rules: [CL-2](docs/adjudication-rules.md#cl-2-classifier-model-resolution), [CS-5](docs/adjudication-rules.md#cs-5-fallback-resolution-and-budget), [PR-5](docs/adjudication-rules.md#pr-5-explain-gate)

**Rule generator**:
The `/rule` command that drafts a rule from a description and checks it against recent history.
Rules: [RG-1](docs/adjudication-rules.md#rg-1-transcript-only), [RG-2](docs/adjudication-rules.md#rg-2-attempts-and-feedback), [RG-3](docs/adjudication-rules.md#rg-3-history-replay-and-critic)

### Permission grants

**Permission grant**:
A session-long, natural-language authorization the agent requests through `verdict_grant`, optionally naming protected-path access entries and danger-rule ids, and the user approves (in `unattended`, the judge and fallback classifiers both allow); classifiers treat it as authoritative within its literal scope, it is the only thing that lifts a built-in deny, and it is revocable at any time.
_Avoid_: approval (that is a human answer to an ask), permission, allowlist entry
Rules: [GR-1](docs/adjudication-rules.md#gr-1-request-tool), [GR-2](docs/adjudication-rules.md#gr-2-human-approval), [GR-4](docs/adjudication-rules.md#gr-4-authority-in-classifier-prompts), [GR-6](docs/adjudication-rules.md#gr-6-lifetime-revocation-and-visibility)

**Protected-path access entry**:
A path plus an access level (`read`, `write` or `full`) listed in a permission grant, used only by the grant coverage check; it covers protected paths and, for the built-in path tiers, the tier hits at that path.
Rules: [GR-5](docs/adjudication-rules.md#gr-5-coverage-check)

**Grant coverage check**:
The step before a gated ask or a built-in rule deny/ask that allows the call without a human when every touched protected path lies under an access entry of an active grant, every danger-rule hit is named in a grant's `rules`, and both the judge and fallback classifiers confirm the call is within it.
Rules: [GR-5](docs/adjudication-rules.md#gr-5-coverage-check), [PP-6](docs/adjudication-rules.md#pp-6-plaintext-confinement)

**Grant review**:
The unattended-mode consensus in which the judge and a configured fallback classifier both must allow a grant request before it is created.
Rules: [GR-3](docs/adjudication-rules.md#gr-3-unattended-consensus)

### Subagents

**Subagent gate**:
The omp-only setting that decides whether and how the gate applies to subagent sessions.
Rules: [SG-1](docs/adjudication-rules.md#sg-1-identity-and-off), [SG-2](docs/adjudication-rules.md#sg-2-normal), [SG-3](docs/adjudication-rules.md#sg-3-auto)

**Resolution without a human**:
The settling of an ask when nobody answers it, in which only an explicit fallback allow permits the call.
_Avoid_: auto-resolve (as a noun)
Rules: [SG-4](docs/adjudication-rules.md#sg-4-resolution-without-a-human), [SG-5](docs/adjudication-rules.md#sg-5-never-auto-allowed)
