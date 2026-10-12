# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. Each entry links to the rules that use the term.
- **`docs/adjudication-rules.md`**: the normative rule set; read the sections touching the area you're about to work in (rule IDs such as `PP-6` are cited from code comments and test titles).

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a single-context repo with no ADR directory:

```
/
├── CONTEXT.md                  ← glossary (terms only)
└── docs/
    ├── adjudication-rules.md   ← normative rules: statement, Why, Code, Pinned by
    ├── configuration.md        ← key reference
    └── security-principles.md  ← principles, each with Enforced by: rule links
```

Decisions are recorded as edits to the affected rule (its `Why:` line) plus a `CHANGELOG.md` entry.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag rule conflicts

If your output contradicts an existing rule in `docs/adjudication-rules.md`, surface it explicitly rather than silently overriding:

> _Contradicts PP-4 (base tier only), but worth reopening because…_
