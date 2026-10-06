# 0005 - Approval modes: one mode switch, per-mode verdict sets, layered scopes

---
status: accepted
date: 2026-10-06
---

## Context

The gate had three independent knobs for "how much does a human stay in the loop": the master switch (`--auto-mode`, `/automode on|off`, the toggle shortcut), `autoDeny` (denies become asks), and `classifierMinConfidence` (uncertain jev verdicts become asks). Missing was the opposite posture — a session with nobody to ask (long unattended runs, `yolo`-style workflows) that still wants the deterministic floor and a classifier, without every uncertain call silently degrading to a bare deny the agent cannot learn from. Config also had a single layer for the cross-cutting settings, although the right value differs per project and per session.

## Decision

1. **One `mode`** replaces the master switch and `autoDeny`: `default` (deny / ask / allow), `yolo` (deny / allow, never prompts), `noAutoDeny` (ask / allow), and `off` (ungated). `off` exists only at session scope: a config file — in particular a cloned repository's project config — must never be able to ungate the tool calls.
2. **Per-mode verdict sets reach the classifier.** The set a mode can use (`modeChoices`) restricts the LLM prompt and, through an `Allowed verdicts:` marker line in the system prompt, the jev `choice` question. The default set renders byte-identically to the previous prompt. The marker line precedes the denyPaths hint and the user-rules block, so the jev adapter's user-rules slice (which starts at `USER_RULES_HEADER`) never includes it.
3. **yolo never prompts.** Every ask-shaped outcome — classifier `ask`, confidence demotion, a failed enforce-mode fallback, the `yolo-ask` contract slip — becomes a block that tells the agent to explain why the action is needed or rewrite it narrower (`yolo-retry`). A slip first consults `classifierFallbackModel`: enforce applies its verdict, shadow only records. Rule denies (floor, `deny` regexes) keep denying. `denyPaths` / `.omp` gate hits follow `yoloDenyPaths` / `yoloOmpDir` (default deny); the block never carries path plaintext (ADR-0002).
4. **noAutoDeny keeps today's `autoDeny: false` semantics**: any effective deny with a UI becomes an ask with an explanatory suffix, `autoResolve: "deny"` (subagent gate never auto-allows it); headless still denies.
5. **Per-mode jev probability thresholds** (`applyModeThresholds`) re-map a non-demoted first-layer jev verdict; LLM verdicts and the fallback's verdict are never re-mapped, so a threshold can never turn a fallback's judgment into something it did not say. `confidenceThreshold` (renamed from `classifierMinConfidence`) stays global and runs first.
6. **Layered scopes**: session > trusted project > user > default for every approval key. The session layer is persisted per session id under `<agentDir>/config/pi-verdict-sessions/` (not the audit directory, not the trust store), keeps the 50 newest files and never stores non-approval keys. `--verdict-mode`, `/automode <mode>`, the cycling shortcut and the panel all write it.

## Consequences

- **Breaking** clean cutover: `autoDeny`, `classifierMinConfidence`, `--auto-mode` and `/automode on|off` are removed; the old keys warn and are ignored.
- The jev decisions API must accept a `choice` question with fewer than three criteria keys. If it ever rejects or ignores the restriction, the pipeline mapping still holds (yolo `ask` → `yolo-ask` cascade; noAutoDeny `deny` → ask); only the adapter's request shape would need to fall back to three keys.
- Forks and new sessions start without session overrides (they are keyed by session id).
- Audit records gain `mode` and, when thresholds re-mapped the verdict, `thresholdVerdict`; the `fallback` object gains `triggeredBy: "yolo-ask"`.
