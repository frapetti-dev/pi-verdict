# Upstream report drafts for pi (P1/P3)

> Target repo: `earendil-works/pi` (monorepo, package `packages/coding-agent` @ 0.84.3)
> Purpose: to be edited and revised by hand later, then submitted using the official template. **Read the "Submission notes" below before submitting.**
> Source of facts: the pi-verdict repo's `research/thinking-param-blackhole.md` (evidence gathered 2026-08-26)

## Submission notes (from CONTRIBUTING.md, hard constraints)

- [ ] Must use the official issue template (bug.yml): What happened / Steps to reproduce / Expected behavior / version
- [ ] Fit within one screen; **rewrite in your own voice** (LLM-generated text passed off as human-written is explicitly forbidden; if AI assistance is kept, follow up with a comment clearly labeled as AI)
- [ ] Issues from new contributors are **auto-closed**; maintainers review the auto-closed queue daily and reopen those that meet the bar; `lgtmi`/`lgtm` unlocks follow-ups
- [ ] Review is not guaranteed Friday through Sunday (2026-08-26 is a Wednesday, a weekday queue)
- [ ] Duplicate search conclusion: #8156 (the mirror-image issue on the openai-codex lane, auto-closed/no-action) is the nearest precedent in the same family, already cited in draft 1
- [ ] Do not open a PR before getting a maintainer `lgtm`

---

## Draft 1 (primary report, P1: per-call "off" semantics)

**Title:**

```
anthropic-messages lane: per-call reasoning: "off" is truthy → adaptive effort "high" instead of disabled; thinkingLevelMap.off never consulted for the string form
```

**What happened?**

`SimpleStreamOptions.reasoning` is typed `ThinkingLevel`, which includes `"off"`. On the anthropic-messages lane, passing the string `"off"` to `streamSimple`/`completeSimple` does not disable thinking — it takes the adaptive branch at effort **high** (code-derived from 0.84.3 dist, see repro):

- `streamSimple` gates on `if (!options?.reasoning)` — the string `"off"` is truthy, so any `forceAdaptiveThinking` model takes the adaptive branch
- `mapThinkingLevelToEffort`'s switch has no `"off"` case → `default: return "high"`
- Omitting `reasoning` (undefined) correctly yields `thinkingEnabled: false` → `thinking: {"type":"disabled"}` (when `thinkingLevelMap?.off !== null`) — this half we confirmed on the wire via proxy logs

So `"off"` and `undefined` — nominally the same level — diverge, and `thinkingLevelMap.off` (the per-model "cannot disable" gate) is never consulted for the string form.

This is not custom-provider-only: built-in adaptive Claude models (opus-4-6→5, sonnet-4-6/5 ship `compat.forceAdaptiveThinking` with maps like `{xhigh,max}` — no `off:null`) hit the same path, and for them disabling is supported. For models that genuinely cannot disable (e.g. `claude-fable-5` with `off:null`), `"off"`→high is defensible clamping — the gate just never gets a say.

**Steps to reproduce**

On 0.84.3, call the simple API on any anthropic-messages model with `compat.forceAdaptiveThinking` (built-in adaptive Claude, or a custom anthropic-compatible provider) with `reasoning: "off"` and inspect the request body: `thinking: {"type":"adaptive"}` + `output_config: {"effort":"high"}`. Same call with `reasoning` omitted: `thinking: {"type":"disabled"}`. (Code path: `dist/api/anthropic-messages.js` — `streamSimple` + `mapThinkingLevelToEffort`. We verified the omission→disabled half on the wire; the off→high half is from reading the shipped dist.)

Context from our debugging (separate issue, extension-side): a permission-classifier making small `max_tokens: 512` calls on a thinking model got empty answers (`stopReason: length`) whenever the request carried no thinking parameter — the provider defaulted to max effort.

**Expected behavior**

Either `"off"` normalizes to the omission path (consistent with the agent session, which passes `reasoning: undefined` for `thinkingLevel === "off"`, and with the azure openai-responses adapter), or `"off"` is excluded from `SimpleStreamOptions.reasoning`'s type and documented as session-level only. If deliberate (like `resolveGoogleThinkingLevel`'s `off → "high"`), the divergence across lanes deserves a doc note — related: #8156 reports the mirror-image gap on the openai-codex lane.

Ecosystem signal: `@zhushanwen/pi-llm-shared`'s `callLLM` wrapper (used by the published `pi-permission` extension) already normalizes `off` → omit before calling `completeSimple`, apparently for this exact reason — the quirk is being worked around independently in the wild.

Happy to PR whichever direction maintainers prefer.

**Version:** 0.84.3

---

## Draft 2 (secondary report, P3: extension-layer API gap; recommended to file only after getting lgtmi)

**Title:**

```
Extension ModelRegistry.complete() silently drops SimpleStreamOptions fields (reasoning) — consider exposing completeSimple
```

**What happened?**

`ctx.modelRegistry.complete()` is typed `ModelsApiStreamOptions<TApi>` (per-API options; `AnthropicOptions` has no `reasoning` — that field belongs to `SimpleStreamOptions`, mapped by `streamSimple`). Extensions holding a generic `Model<Api>` get the fallback type `StreamOptions & Record<string, unknown>`, whose index signature swallows unknown-property checks — so `reasoning: "minimal"` typechecks and is silently dropped at runtime. The extension-facing `ModelRegistry` doesn't expose `completeSimple`, so there is no supported way for an extension to request a per-call thinking level.

**Expected behavior**

Expose `completeSimple` on the extension-facing registry, or document the API-layer/simple-layer distinction. This cost us a day of debugging (writeup available on request); happy to share details.

**Version:** 0.84.3

---

## Appendix: cross-adapter "off" behavior comparison (kept for own reference, do not paste into the issue)

| Lane | Fate of the string "off" | map.off gate |
|---|---|---|
| anthropic-messages (simple layer, any forceAdaptiveThinking model) | adaptive @ **high** (switch default, code-derived) | **bypassed** |
| ├ built-in opus-4-6→5/sonnet-4-6/5 (map has no off:null, can be disabled) | same as above - a real bug: should send disabled | omission path works, string path bypasses |
| ├ built-in fable-5 (off:null, cannot be disabled) | off→high is a reasonable clamp; the UI does not offer off either | neither path sends disabled (correct) |
| └ custom provider (GLM behind an internal gateway, map has no off key) | same as above; on the GLM side disabled→effort low (BigModel table) | omission→disabled confirmed delivered on the wire |
| anthropic-messages (reasoning omitted) | `thinking:{type:"disabled"}` | works (sent only if off !== null; GLM confirmed on the wire) |
| google-generative-ai | `"high"` (**deliberate**, resolveGoogleThinkingLevel) | not applicable |
| azure openai-responses / openai-codex | normalized to undefined / the reasoning field is not sent after collapsing | unreachable on the codex lane (#8156) |
| ecosystem workaround: @zhushanwen/pi-llm-shared callLLM | internally normalizes off→omit before calling completeSimple (already written into the issue draft as ecosystem evidence) | avoided |
| agent session (main loop) | off → passed in as undefined | takes effect indirectly |
