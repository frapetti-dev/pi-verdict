# 0001 - Self-protection layer: gate integrity over configuration exemption

---
status: superseded (2026-09-25: self-protection layer fully removed — see final revision below)
date: 2025-08-27
---

## Background

pi-verdict's security boundary (rule layer + classifier) is implemented by an extension running inside the agent process, and both its config file `config/pi-verdict.json` and the extension's own installed copy sit within the agent write permissions that boundary is meant to guard. With both writes classified as gray-zone → classifier judgment, a prompt injection needs only to convince the classifier to allow one write to clear `deny`, flip `builtinDenyFloor`, or rewrite the gate's own source — the next session's gate is then empty or owned by the attacker. A gate that can be turned off or rewritten by what it is guarding cannot credibly claim "risk accepted by the user."

## Decision

1. Introduce a **self-protection layer**: a built-in deny rule set not exemptable by any configuration; `builtinDenyFloor: false` narrows to only turning off the danger regexes and path sensitivity grading, and **cannot** turn off the self-protection layer.
2. Protected scope: `pi-verdict.json` + the extension's installed copy. The copy is located via runtime self-anchoring (`import.meta.url`), covering both single-file and npm-directory install forms, and follows `PI_CODING_AGENT_DIR` redirection automatically.
3. Disposition semantics: **hard deny**, with the reason pointing the user to manual edits; reads pass. Rationale: any write inside the gate is by definition agent-initiated, so deny is equivalent to "user-editable only" (the user's own editor edits never go through the gate).
4. Depth (tamper detection): phase one does in-session detection — a full snapshot at startup, re-checked before every verdict; disposition is per-file diff:
   - **Extension copy** changed: always auto-restored from the snapshot + this session fail-closes;
   - **`pi-verdict.json`** changed: in interactive mode, a `ctx.ui.select` two-choice prompt (the option text is the action, removing Yes/No mapping ambiguity) lets the user adjudicate — "Accept" = rebuild the baseline and continue the session as usual (the new config still applies from the next session), "Decline" = roll back + fail-close, closing the dialog counts as Decline (the safe side); headless (no UI) has no one to ask, so it takes the safe side, same disposition as the extension copy.
   Cross-session baselining (persistent hash, startup comparison and confirm UX) is phase two.

## Alternatives considered

- **Gate it behind the `builtinDenyFloor` switch (disableable)**: self-defeating — an injection turns the floor off in one config change and does whatever it wants next; "user sovereignty" becomes "attacker sovereignty." User-sovereignty exemptions should apply to "risk to my own system," not to the gate's own integrity.
- **ask instead of deny**: interactive confirmation under an injection scenario depends on the user catching every prompt with perfect vigilance — rubber-stamping risk is real; the config already applies to new sessions and the `_hint` guides manual edits, so letting the agent edit it on the user's behalf buys little. sudoers requiring visudo is the isomorphic precedent.
- **OS-level hardening (chflags / a separate uid)**: the same uid can clear an immutable flag; a separate uid is too heavyweight; and neither cleanly expresses "user can change it, agent cannot" — that distinction only exists at the gate layer.
- **Rule layer only, no detection**: command-string regexes are obfuscatable, MCP/custom tools never go through the rule layer, and a pure deny only "raises the bar" rather than "guaranteeing" it — so a detection backstop is a necessary component.
- **Unconditional auto-restore on config tampering (initial implementation)**: a running pi would also roll back and brick the session on the user's own legitimate manual edits — under a long-lived session this amounts to "the user can never modify the config," contradicting the "user-editable only" design intent.
- **Warn-only on config tampering, no restore**: a warning can be scrolled past or ignored; a tampered config (e.g. `allow:[".*"]` + `builtinDenyFloor:false`) silently takes over the next session with no forced-attention mechanism — hence the confirm-style approach: one rare, semantically serious dialog doubles as forced attention and user adjudication.
- **Bring the whole `~/.pi/agent/` tree (mcp.json, settings.json, skills/, git/, etc.) into scope**: explicitly rejected. That surface is the pi host's and the user's own agent-configuration surface; the agent installing skills or editing MCP config on the user's behalf is legitimate day-to-day work, and the gate extension overreaching into it would substitute the extension's judgment for the user's own sovereignty. A user who wants that surface protected should express it through their own user-rules deny regex — it is not this extension's integrity boundary.

## Consequences

- `builtinDenyFloor` semantics narrow — the README, the config template `_hint`, and the code header comment must stay in sync.
- The agent can never manage this config on the user's behalf (including requests like "update classifierModel for me"); the user must edit it manually.
- A manual mid-session edit to `pi-verdict.json` triggers one confirmation: keep it and the baseline is rebuilt (session continues as usual), decline and it is rolled back; headless always rolls back on a change — avoid editing this file while a headless session is running; mid-session changes to the extension copy (regardless of source) always roll back + fail-close.
- Legitimate changes such as extension upgrades rely on the "applies from the next session" flow; the phase-two cross-session baseline will close the cross-session tampering blind spot and add an upgrade-confirmation UX.
- Detection is not a real-time guarantee (an asynchronous modification outside the re-check window is caught no later than the next re-check, or in phase two's baseline) — documentation must state this honestly.

## Revision (local patch, 2026-09-24): removed runtime tamper detection

Item 4's in-session tamper detection (`IntegrityWatch`: full snapshot at startup + re-check before every verdict + auto-restore of the extension copy / two-choice config prompt) has been removed and no longer runs with the extension. Reason: the detection baseline is in-process memory state; when the same installed copy is shared across concurrent sessions, any write to the config/copy by one session after its snapshot (including the user's own legitimate manual edit through an editor) would be judged "tampering" by another session, triggering an auto-restore or fail-close — turning the "user-editable only" design intent, under multi-session use, into "the user's edit gets reverted by another session that never touched the file."

Items 1–3 (the self-protection layer itself: hard deny, `builtinDenyFloor: false` cannot turn it off, reads pass) are unaffected and remain in effect. The write-protected set (`prot.exact`) is now re-derived by `SessionState` on every `reset()` from the current session's `trustedProjects` candidate files and any resolved project override file (truncated back to the construction-time global baseline length, then appended), no longer relying on in-memory snapshot diffing.

This revision records a **behavior change that has already happened** and does not add a phase-two cross-session baseline plan — the original item 20's "cross-session baseline, phase two" motivation (catching detection-persistence bypasses) is shelved along with the detection mechanism it was meant to back up.

## Revision (2026-09-25): self-protection layer fully removed

Items 1–3 (the self-protection layer itself: hard deny on the gate's own files, `builtinDenyFloor: false` unable to turn off this layer, reads passing) are now removed as well — this ADR's decision no longer runs with the extension. There is no longer any rule-layer disposition specifically protecting `pi-verdict.json` or the installed extension copy; agent writes to these files are now graded like any other file, through the ordinary rule layer + classifier, with no special exemption and no special block. Item 6 (the `#54` verdicts audit directory's read/write blocking) is removed along with it — it shared the same module.

Reason for removal: the self-protection layer's value was already weakened once item 4's runtime tamper detection was removed (2026-09-24) — without a detection backstop, "hard deny on writes inside the gate" only stops paths that go through a pi/omp tool call; a direct rewrite of the installed file that bypasses tool calls entirely was already unaffected, and the bash-side substring-regex matching was already obfuscatable (see the original text above). Once the boundary had narrowed to "only blocking direct writes made through a tool call," the layer's actual security increment no longer justified the complexity it added to the development workflow (see AGENTS.md's now-historical "Gate self-reference" entry) and to multi-session/multi-project use (`trustedProjects`).

Consequences: the gate's own files no longer carry runtime protection — a user who wants these paths protected can still declare them via `denyPaths` (ADR-0002's ask-terminal semantics, not this ADR's former hard deny). README, README.zh-CN.md, docs/configuration.md, docs/security-principles.md, and AGENTS.md have been updated to remove self-protection references accordingly. This ADR is kept as a historical record and is not deleted.
