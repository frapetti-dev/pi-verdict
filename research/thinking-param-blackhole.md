# Classifier thinking-parameter black hole: root cause of systematic fail-closed in the gray zone with GLM-family thinking models (evidence for optional fix #7)

**Conclusion: the `reasoning: "minimal"` passed by the extension is collapsed to "send no thinking parameter at all" on the gateway stack of an internal provider plugin; the GLM-family thinking model then thinks at its own default level, burns through the 512 maxTokens -> empty/truncated output -> fail-closed; heavy thinking also stretches latency -> 15s timeout aborted.**

## Symptoms (5 live samples from this session)

| Time (local) | stopReason | Raw output | Corresponding Langfuse observation |
|---|---|---|---|
| 12:53:32 | length | `""` | (id omitted) |
| 12:53:53 | length | `""` | (id omitted) |
| 12:54:16 | length | `""` | (id omitted) |
| ~14:4x | length | `"<verdict>allow"` (truncated) | (sample from another session) |
| ~14:4x | aborted | `""` | (15s timeout) |

## Source level (internal provider plugin @0.9.0, name not public)

The plugin **does not touch the request body** (it only does OAuth/header injection/cost tracking/model listing), but it attaches uniform model metadata to all reasoning models (regex-matching `glm-` etc.):

```js
A = { thinkingLevelMap: { max: "max" }, compat: { forceAdaptiveThinking: true } }
```

- `forceAdaptiveThinking` -> the pi core sends adaptive thinking for anthropic-messages (the budget-style thinking field is abandoned)
- `thinkingLevelMap` has only the one key `max`: per the pi docs, **omitted keys fall back to the default mapping**; `minimal` has no effective mapping on the adaptive stack -> **the whole thinking field is omitted**

## Data level (Langfuse evidence, 2026-08-26)

`modelParameters` comparison for three kinds of calls on the same instance and the same model (GLM-family thinking model):

| Call type | max_tokens | thinking field |
|---|---|---|
| **auto-mode classifier** (3 entries, timestamps match the fail-closed events to the second, input contains the `<transcript>...<verdict>` contract, output is an empty string) | 512 | **missing (not sent)** |
| Session-level conversation (outside the extension) | 64000/131072 | `{"type":"adaptive"}` |
| Call with thinking explicitly disabled | 64/8192 | `{"type":"disabled"}` |

-> pi **is able** to send `thinking: disabled`, but it needs the right level; on this stack `minimal` maps neither to disabled nor to an effort - it simply evaporates.

Note: LiteLLM reporting drops the system parameter (the classifier system prompt is not in the Langfuse input, consistent with investigation #4), so identifying these calls relies on user-message features (`<transcript>` + `<verdict>` contract + max_tokens 512 + temperature 0).

## Causal chain

```
extension reasoning:"minimal"
  -> pi core: adaptive stack + map{max} has no minimal mapping -> thinking field omitted
  -> LiteLLM gateway forwards as-is (GLM-family thinking model has thinking on by default)
  -> reasons at the default high level -> 512 maxTokens fully burned (empty output/truncated) or exceeds 15s (timeout)
  -> fail-closed deny -> gray zone systematically blocked
```

The "plugin overrides the thinking level" hypothesis: **true in effect, false in mechanism** - it is not a runtime override; rather, the plugin's model metadata collapses minimal into an omitted parameter, which conspires with GLM's default-on thinking from both ends.

## Compatibility: is `reasoning: "off"` universal? (BigModel official mapping table + evidence)

The effort handling table from the BigModel official docs (GLM Coding Plan model switching guide):

| Value passed by the tool | Actual GLM level | Handling |
|---|---|---|
| thinking.type unset/true/enabled/adaptive | **max** | Use the default level (root cause of this incident: omitted parameter = max) |
| thinking.type false/disabled/none/off | **low** | Request continues; still thinks lightly |
| reasoning_effort minimal/light/low | low | Converted automatically |
| reasoning_effort medium/high | high | Converted automatically |
| reasoning_effort xhigh/max/ultra | max | Converted automatically |
| Priority | Explicit Effort > thinking switch > default max | |

Conclusion: `off` is a **universal request**, not a **universal guarantee**:

| Model/stack | Actual effect of `off` | Evidence |
|---|---|---|
| Real Anthropic | Thinking fully off | pi standard anthropic behavior |
| GLM/BigModel (verified via the internal gateway) | Drops to effort low, cannot reach zero | Official table + measurement |
| Model without thinking capability (reasoning:false) | No parameter to send, no-op | pi model metadata |
| Model that cannot turn thinking off and rejects disabled | May error -> fail-closed | Theoretical risk, needs a fallback |

Key evidence: on the same gateway with a GLM-family thinking model, the CC classifier runs with `thinking:{disabled}` + **max_tokens 64** and outputs `<block>no` successfully (dozens of entries that day, occasional empty output ~3.5%) - "effort low light thinking + small budget" holds in real traffic, and 512 leaves even more headroom.

Another key corollary: lower levels other than `off` (`minimal`/`low`) face the same "map lacks the key -> parameter omitted -> GLM max" black hole on this provider stack; `off` is the only level with a dedicated wire form (`thinking:{type:disabled}`) that has been verified to arrive through this gateway.

## Fix Recommendations (compatibility-corrected version)

1. **Primary fix on the extension side**: `reasoning: "off"` instead of `"minimal"` - the only level with a dedicated wire form; on GLM it drops to effort low light thinking (64 tokens proven sufficient, 512 leaves ample headroom).
2. **Defensive fallback (must keep, not optional)**: on contract failure/empty output, retry once with a higher maxTokens (e.g. 1024) - covers the two long-tail classes "models that ignore disabled" and "models that cannot turn thinking off and reject the parameter"; this is the real model-agnostic compatibility layer.
3. **Keep maxTokens at 512**: CC has verified the low level works at 64, 512 leaves headroom for light thinking on other models; raise to 1024 on retry.
4. **Upstream (internal provider plugin)**: `thinkingLevelMap` should be completed with the low-level mappings (minimal/low -> a low level or disabled), eliminating the "omitted parameter = GLM max" trap; at the very least note it in the README.
5. **Upstream pi core**: per-call reasoning collapsing into an omitted parameter on the adaptive stack is unsafe for models whose "default level = max"; worth raising for discussion.

## Final Root-Cause Correction (third layer, decisive): `reasoning` never left the extension

The first two rounds of analysis (thinkingLevelMap collapse, off mapping) reasoned at the **wrong level** - they correctly describe the behavior of the simple layer (`streamSimple`), but the extension's call never reaches it:

1. The extension calls `ctx.modelRegistry.complete()` - an **API-layer** method, with option type `ModelsApiStreamOptions<TApi> = AnthropicOptions & ...`;
2. The thinking fields of `AnthropicOptions` are `thinkingEnabled/thinkingBudgetTokens/effort/thinkingDisplay`, **with no `reasoning`** (the latter belongs to `SimpleStreamOptions`, mapped by `streamSimple`; the extension-side `ModelRegistry` does not expose `completeSimple`);
3. Why TS lets it through: the extension holds the wide type `Model<Api>`, the conditional type `ApiStreamOptions<Api>` falls into the fallback branch `StreamOptions & Record<string, unknown>`, and **the index signature swallows the unknown-property check**;
4. Runtime serialization: `if (options?.reasoning)` is always false and `thinkingEnabled === false` is not set either -> **no thinking parameter is sent at all** -> GLM defaults to the max level (matches the first row of the BigModel table).

**Lesson from the mid-course experiment**: after deploying the `reasoning: "off"` fix, Langfuse still showed no thinking field - this very experiment exposed the real root cause. (Also note: if the simple layer really received the string "off", `!options?.reasoning` would be false -> forceAdaptive branch -> `mapThinkingLevelToEffort` switch default -> **effort "high"**; the string "off" does not mean thinking off at that layer either; what is equivalent to turning thinking off is omitting reasoning.)

**Final fix**: `thinkingEnabled: false` (a native anthropic-messages field; its serialization condition `thinkingLevelMap?.off !== null` holds for the internal plugin's `{max:"max"}` map) -> measured to arrive as `thinking:{"type":"disabled"}`; for other APIs it is a harmless extra property, backed by the defensive retry (512->1024).

## Reproduction/Verification Method

- Query: `GET /api/public/v2/observations?type=GENERATION&fromStartTime=…&fields=core,model,io`, identify classifier calls by `modelParameters.max_tokens==512 && temperature==0` + input containing the `<verdict>` contract
- Criteria: the classifier call's modelParameters lack the thinking field; output content is an empty string; compare against 64000/131072 (adaptive) and 64/8192 (disabled)
