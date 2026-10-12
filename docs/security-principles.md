# Security Design Principles

This document states the security design principles behind pi-verdict and how they map to what is actually shipped. It complements the [pipeline](../README.md#pipeline) section in the README; the rules each principle rests on are in [adjudication-rules.md](adjudication-rules.md), listed under `Enforced by:`. Where a principle describes a direction rather than shipped behavior, it says so explicitly — this document deliberately makes no claims the implementation does not back.

pi-verdict is a **fail-closed, layered permission gate** for coding agents. It is not a sandbox and does not attempt to formally prove that arbitrary agent-generated programs are safe.

## Principles

### 1. Fail closed by default

When the system cannot establish that an action is safe, it must not silently allow it. Classifier exceptions, malformed verdicts, timeouts, unavailable models, and non-interactive `ask` verdicts all degrade to `deny` — never to automatic approval.

```text
uncertainty → friction     (never: uncertainty → permission)
```

Enforced by: [PR-1](adjudication-rules.md#pr-1-ask-degradation), [CL-7](adjudication-rules.md#cl-7-attempts-timeouts-fail-closed), [JV-4](adjudication-rules.md#jv-4-confidence-is-required), [CS-4](adjudication-rules.md#cs-4-no-fallback), [CS-8](adjudication-rules.md#cs-8-fallback-failure)

### 2. Deterministic floors come before AI

Some security properties must never depend on an LLM. The built-in deny floor (command danger rules plus path sensitivity grades S0–S3) adjudicates before the classifier is ever consulted. The classifier may interpret ambiguity; it must not override a hard deny — and neither can user allow rules.

Precisely: no built-in rule allows a non-empty `bash` or `powershell` command — commands are denied by a danger rule, allowed only by a user `allow` regex, or left to the classifier. Path grading, by contrast, does mechanically allow what it can vouch for: reads outside the S0 and S1 grades, and writes whose every canonical form lies inside the working directory and outside S0–S3.

Enforced by: [RL-2](adjudication-rules.md#rl-2-evaluation-order), [RL-5](adjudication-rules.md#rl-5-danger-rules), [PG-3](adjudication-rules.md#pg-3-s0-secrets), [PG-4](adjudication-rules.md#pg-4-reads), [PG-5](adjudication-rules.md#pg-5-writes), [PG-6](adjudication-rules.md#pg-6-commands-are-not-path-graded)

### 3. The classifier judges semantics, not syntax

Coding agents routinely generate long pipelines, heredocs, embedded interpreters, and command substitutions. Regex floors and allowlists cannot realistically classify such payloads, so: **deterministic rules establish the floor; the classifier handles the remaining semantic ambiguity.** A long read-only pipeline may be complex but low-impact; a short heredoc may be syntactically simple but arbitrarily destructive. Decisions focus on what an action *does*, not how it is spelled.

Known limitation, stated honestly: bash-side path extraction is token-level — command substitution and base64-embedded paths produce no protected-path hit and fall to the classifier's vigilance ([PP-2](adjudication-rules.md#pp-2-candidate-extraction)).

Enforced by: [CL-1](adjudication-rules.md#cl-1-gray-zone), [PP-2](adjudication-rules.md#pp-2-candidate-extraction), [PP-7](adjudication-rules.md#pp-7-existence-hint)

### 4. Adjudicate by impact, not by complexity

A long command is not automatically dangerous, and a short one is not automatically safe — so the deciding axis is *impact*, never length or syntactic complexity: long read-only actions can auto-allow; short destructive ones deny or ask. This is what keeps protection meaningful without producing approval fatigue.

Enforced by: [CL-1](adjudication-rules.md#cl-1-gray-zone), [CL-5](adjudication-rules.md#cl-5-system-prompt-composition)

### 5. Verdicts are informed judgments, not proofs

A classifier `allow` means "consistent with policy and user intent as far as the model can tell" — it does **not** mean "proven incapable of causing harm." That distinction is fundamental to the security model and to why the deterministic floor exists at all.

Enforced by: [CL-6](adjudication-rules.md#cl-6-verdict-prefix-contract), [CS-1](adjudication-rules.md#cs-1-confidence-floor), [CS-3](adjudication-rules.md#cs-3-cascade-triggers)

### 6. Minimize the classifier's trusted input

The classifier receives only what it needs to judge: a condensed transcript (user messages + tool calls, **no tool results**), with the action under review pinned as the last line — hardened against forged-line injection (#22). When protected paths are configured, the classifier gets an *existence hint* only — it never sees the path plaintext, and the jev adapter does not receive even the hint. This limits indirect prompt-injection surface without starving semantic adjudication.

Enforced by: [CL-4](adjudication-rules.md#cl-4-input-transcript), [PP-6](adjudication-rules.md#pp-6-plaintext-confinement), [PP-7](adjudication-rules.md#pp-7-existence-hint), [JV-3](adjudication-rules.md#jv-3-translation)

### 7. Protected resources are matched by canonical identity

Path decisions use canonical filesystem identity, not lexical strings: lexical + realpath dual-form matching (#20), case folding on case-insensitive filesystems, macOS firmlink prefixes (#21), and `~`/`$HOME`/relative spellings. The two tiers differ on purpose: **path grading** uses the rebuilt tier, which also reconstructs not-yet-existing targets from the realpath of their nearest existing ancestor, because a false allow there costs the most; **protected paths** use the base tier (lexical plus whole-path realpath) and never reconstruct ancestors, so a nonexistent target behind a symlinked alias falls to the classifier and its existence hint instead of hitting. A path that merely *looks* workspace-local is not trusted as workspace-local.

Enforced by: [PP-1](adjudication-rules.md#pp-1-declaration-normalization-and-anchoring), [PP-2](adjudication-rules.md#pp-2-candidate-extraction), [PP-3](adjudication-rules.md#pp-3-matching), [PP-4](adjudication-rules.md#pp-4-base-tier-only), [PG-2](adjudication-rules.md#pg-2-forms)

### 8. User policy may restrict, and may only weaken by explicit opt-in

User rules are the user's own security declarations (deny beats allow; protected paths are the stronger declaration channel). The built-in deny floor *can* be turned off — but only by an explicit, documented `builtinDenyFloor: false` in a config the user controls, i.e. a deliberate downgrade the user owns, never a silent or accidental weakening. A project config cannot do so unless the user has trusted that project, and `off` mode exists only per session so no file can ungate the tool calls.

Enforced by: [RL-2](adjudication-rules.md#rl-2-evaluation-order), [RL-6](adjudication-rules.md#rl-6-builtindenyfloor), [MD-2](adjudication-rules.md#md-2-off), [CF-3](adjudication-rules.md#cf-3-project-discovery-and-trust), [CF-4](adjudication-rules.md#cf-4-merge-semantics)

### 9. Platform differences are documented, not silently weaker

Security semantics must not silently degrade just because an action is expressed differently. Where full parity is not shipped, the gap is documented instead: on Windows the built-in floor covers bash-shaped patterns only — PowerShell-native dangerous commands rely on the classifier, which fails closed (see [Status & limitations](../README.md#status--limitations)).

Enforced by: [RL-5](adjudication-rules.md#rl-5-danger-rules), [PG-2](adjudication-rules.md#pg-2-forms), [CL-7](adjudication-rules.md#cl-7-attempts-timeouts-fail-closed)

### 10. Optimize for safe automation, not maximum automation

The objective is to maximize useful automation while minimizing unsafe automatic execution. Both extremes lose: "everything → ask" breeds approval fatigue and blind approvals; "everything ambiguous → allow" breeds silent unsafe execution. The three-state verdict exists for exactly this reason — auto-approve clearly low-impact actions, escalate the ambiguous ones, deny what violates hard policy.

Enforced by: [MD-1](adjudication-rules.md#md-1-modes-and-verdict-sets), [PR-1](adjudication-rules.md#pr-1-ask-degradation), [CS-3](adjudication-rules.md#cs-3-cascade-triggers)

### 11. A permission gate, not a sandbox

pi-verdict makes tool authorization safer and more explainable; it provides no OS-level isolation. For strong guarantees, stack it with what it deliberately is not: OS sandboxing, container isolation, filesystem/network restrictions, least-privilege execution. The strongest model is a *policy gate + semantic adjudication + technical isolation* — never any single mechanism.

Enforced by: none — a stated non-goal; the documented limits of path analysis are in [PG-6](adjudication-rules.md#pg-6-commands-are-not-path-graded) and [PP-2](adjudication-rules.md#pp-2-candidate-extraction).

## Directions (not yet shipped)

**Capability-aware authorization.** Decisions today key off tool names, paths, and command strings, with the classifier covering uncovered tools (MCP and custom tools land in the gray zone by construction — no user rule silently covers a tool it does not name). Expressing policy in terms of capabilities (`filesystem.write`, `network`, `credential-access`, `destructive`, …) instead of command spellings is a direction we find right, and it is not implemented today. When it ships, this section moves into the principles above.

## Summary

```text
                          Tool Call
                              │
                              ▼
        ┌─────────────────────────────────────────────┐
        │            Deterministic rule layer          │  (no LLM)
        │  built-in floor: danger rules, S0–S3 grades  │
        │  user deny                                   │
        │  .omp gate ─────────────► ask                │
        │  protected path ────────► ask                │
        │  user allow                                  │
        │  path grading allow (non-sensitive read,     │
        │    in-cwd write) / tools allowlist           │
        └───────────┬───────────────────┬─────────────┘
              deny ◄┤                   ├► clearly safe → allow
                    │                   │
                  gray (everything else)
                    ▼
        ┌─────────────────────────────────────────────┐
        │  LLM / jev classifier                        │
        │  confidence floor · thresholds · fallback    │
        │  (semantic judgment, fail-closed)            │
        └──────────────────────┬──────────────────────┘
                               ▼
              allow / ask / deny     (ask → human; non-interactive → deny)
```

Optionally stacked *outside* the gate: OS sandboxing / container / filesystem & network restrictions — pi-verdict complements isolation, it does not replace it.

> **Core principle: deterministic controls for what must never be allowed, LLMs for what syntax alone cannot decide, technical isolation to limit the consequences of inevitable mistakes.**
