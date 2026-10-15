# Research: integration path and benefit assessment for using typesafe jev as pi-verdict's classifierModel

> Research date: 2026-09-18 (jev released 2026-09-15, OpenRouter listing created 2026-09-18T00:01Z, only 3 days after release).
> Source scope: the typesafe official blog and docs site (docs.typesafe.ai, fully indexed via llms.txt), OpenRouter official docs and public API, catalog data embedded in OpenRouter model pages, GitHub org `typesafe-ai`, the npm registry; plus first-hand tests done by the main session with a real OpenRouter key (labelled "in-repo test 2026-09") and the local pi / pi-verdict source.
> This note supersedes `research/typesafe-jev-classifiermodel.md` (its conclusion that "OpenRouter cannot be called yet" is outdated: the decisions endpoint can now be called in tests).
> Claims are labelled in three tiers: **verified** (official docs/public API/in-repo test/local source), **vendor claim** (vendor self-description, not independently reproduced), **inference** (reasoning chain stated).

## TL;DR

1. **Q1 (can jev be configured as classifierModel through the pi provider system): not today, but there is a clear feasible path.** jev is a decisions-modality model: OpenRouter catalog data has `output_modalities: ["decisions"]`, `has_text_output: false`; in-repo tests calling both slugs through `chat/completions` return 400: "~typesafe/jev-latest is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead.". pi's model pipeline (modelRegistry.complete → `api: "openai-completions"` → chat/completions) cannot drive it, and `models.json` legacy providers likewise. The only feasible paths are (a) a standalone adapter extension that uses `pi.registerProvider()` + the Custom Streaming API to translate `complete()` semantics to the decisions endpoint (pi-verdict unchanged), or (b) pi-verdict fetching directly (violates its zero-direct-connection architecture, not recommended).
2. **Q2 (is the typesafe official API consistent with the OpenRouter interface): completely non-isomorphic to OpenAI chat completions; OpenRouter's `/api/alpha/decisions` and typesafe's official `POST /v1/systemone` are highly isomorphic.** The core request/response schemas (state + questions as a discriminated union choice/score/noul → answers + usage) correspond field by field; the differences are only the `provider` routing preference and `session_id`/`trace`/`user` observability fields added on the OpenRouter side, and `id`/`provider`/`usage.cost` in the response; the model namespaces differ (`jev-latest` vs `~typesafe/jev-latest`, both responses report the concrete version number).
3. **Benefit: a strong fit with the classifier profile, but with one decisive risk the vendor itself admits.** The classifier task = allow/ask/deny three-way choice + calibrated probability, exactly isomorphic to the `choice` primitive; the in-repo test `rm -rf /tmp/test-dir` → allow P=0.58 conf=0.16 shows the calibrated uncertainty is really usable (a confidence threshold can escalate "leans allow but uncertain" to ask, turning "Err on the side of ask" from a soft prompt constraint into a hard code threshold). Cost: input $0.042/M, output $0 (about 2.3× cheaper than GLM-5.3-flash and about 20× cheaper than GPT-5.4-mini), measured median latency 1.25s (far below the current gateway LLM classifier's p90 of 19.8s). But typesafe's official jaggedness doc explicitly admits: **"State is data, and `jev-1.13` does not treat it as hostile by default" -- adversarial content can move the verdict**, and pi-verdict's state is precisely a transcript containing untrusted file content. **Conclusion: worth building as a pluggable experiment, not recommended to depend on now.**

## 0. Pi-side facts verified locally (for self-consistency of this note)

Sources: this repo's `extensions/pi-verdict.ts` and the pi package docs installed locally (`node_modules/@earendil-works/pi-coding-agent/docs/`).

1. **The extension never connects directly to model-vendor HTTP**. The classifier completion call goes through `completionFor(ctx.modelRegistry, …)` → `ModelRegistry.complete(model, context, options)`, credentials are resolved inside pi, and pi-verdict never touches API keys (`extensions/pi-verdict.ts:1044,1611`). The mechanism is detailed in `research/pi-model-call-and-ref-implementations.md`.
2. **classifierModel resolution**: `resolveClassifier()` splits the user config string at the first `/` into provider/modelId, then `ctx.modelRegistry.find(provider, modelId)` + `hasConfiguredAuth(model)`, and on failure falls back to introspecting the session model (`extensions/pi-verdict.ts:1545-1563`). Note: the split is at the first `/`, so `"openrouter/~typesafe/jev-latest"` is parsed correctly as provider `openrouter` + modelId `~typesafe/jev-latest`.
3. **There are two entry points into the provider system**: pi's built-in `openrouter` provider (`/login openrouter` OAuth mints a key, or `OPENROUTER_API_KEY`, pi `docs/providers.md:49,85`); custom providers go through `~/.pi/agent/models.json` or the extension API `pi.registerProvider()` (legacy API names such as `api: "openai-completions"`, or a custom implementation via the Custom Streaming API, pi `docs/custom-provider.md:3,25,75`).
4. Classifier call profile (supplement, same file): the `<verdict>allow|ask|deny</verdict>` prefix contract (`:909-910,986-988`), violation → null → fail-closed deny; each transcript entry ≤1000 characters (`MAX_ENTRY_CHARS`, `:923`); timeout 25s (`CLASSIFIER_TIMEOUT_MS = 25_000`, the comment cites our gateway's measured p90=19.8s distribution, `:999`); maxTokens 512, retry tier 1024 on parse failure.

## 1. Q1: integration paths

### 1.1 OpenRouter-side facts (verified)

- **Both listings really exist** (checked 2026-09-18; a control page for a fake slug only falls back to the title "OpenRouter"):
  - `https://openrouter.ai/~typesafe/jev-latest` — meta description: "This model always redirects to the latest model in the Jev family. $0.042 per million input tokens, $0 per million output tokens. 32,000 token context window."
  - `https://openrouter.ai/typesafe/jev-1.13` — "Jev is a structured decision model from TypeSafe, and the first of its System One models. …$0.042/M input, $0/M output, 32,000 token context window."
- **`~` prefix semantics (confirmed by official docs)**: OpenRouter docs "Latest Model Resolution" (openrouter.ai/docs/guides/routing/routers/latest-resolution.md): "`~author/family-latest` slugs always resolve to the newest concrete model in a given family, so you can ship code against a stable alias and pick up new releases without redeploying." The response `model` field reports the concrete version ("Transparent reporting"); if the family has no available model it errors rather than falling back. That is, **`~typesafe/jev-latest` = rolling alias, `typesafe/jev-1.13` = pinned version**, and the two share the same `model_version_group_id` (model-page embedded data). Also: the doc's "Compatibility contract" section states that `~latest` aliases remap unsupported reasoning parameters to the nearest equivalent -- for a model like jev with `supports_reasoning: false`, the classifier's `reasoning: "off"` requirement is satisfied by nature.
- **Catalog state**: `GET /api/v1/models`, both authenticated and unauthenticated, returns 445 models with **no typesafe/jev entry**; but the catalog does have `~` aliases such as `~deepseek/deepseek-pro-latest` and `~z-ai/glm-flash-latest` (verified). Combined with the 400 error below, **inference**: decisions-modality models do not enter the chat catalog, or the entry is still in gray rollout. OpenRouter docs "Model Variants" note "`GET /api/v1/models` is a catalog of models and catalog variants. It is not an exhaustive list of every model string a request can use." -- i.e. **the catalog is dynamic for chat models and newly listed slugs are usable immediately; but jev belongs to a different endpoint family**.
- **Catalog data embedded in the model page (verified, jev-1.13 page)**: `output_modalities: ["decisions"]`, `has_text_output: false`, `supports_reasoning: false`, `supported_parameters: []`, `context_length: 32000`, `permaslug: "typesafe/jev-1.13-20260917"`, endpoint `provider_name: "TypeSafe"`, `baseUrl: "https://api.typesafe.ai/v1"`, adapter `TypeSafeDecisionsAdapter`, listing `created_at: "2026-09-18T00:01:24Z"`.
- **In-repo test 2026-09 (via the official OpenRouter endpoint)**: both slugs return 400 via `chat/completions`: "…is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead."; calls via `POST https://openrouter.ai/api/alpha/decisions` succeed, and the response `model` is `typesafe/jev-1.13-20260917` with `provider: "TypeSafe"` in both cases.

### 1.2 Why the pi pipeline cannot drive it (core argument)

pi's provider pipeline ends at OpenAI-shaped chat/completions (true of legacy `api: "openai-completions"` and the built-in openrouter provider). jev is explicitly rejected at the gateway layer on that endpoint (the 400 error quoted above, verified), and `has_text_output: false` -- even if the gateway let it through, the `<verdict>…` text contract could not be produced. Hence:

| Path | Approach | Verdict |
|---|---|---|
| A. `classifierModel: "openrouter/~typesafe/jev-latest"` | go through pi's built-in openrouter provider | **Not usable (verified)**: chat/completions 400 |
| B. `models.json` custom provider (`api: "openai-completions"`, baseUrl pointing at typesafe or OpenRouter) | legacy chat-shape integration | **Not usable (verified)**: typesafe officially has only `/v1/systemone`, with no OpenAI-compatible layer; the corresponding OpenRouter endpoint is `/api/alpha/decisions`, likewise not chat-shaped |
| C. adapter extension: `pi.registerProvider()` + Custom Streaming API (pi `docs/custom-provider.md:25`) | a standalone extension registers a full Provider and translates `complete(model, context, options)` into a decisions request: messages/transcript → `state`, the three `CLASSIFIER_SYSTEM` definitions → the `criteria` of a `choice` (allow/ask/deny options), and the answer is synthesized back into text `<verdict>{choice}</verdict> jev: confidence=… p(allow)=…`, which satisfies the `parseVerdict` prefix contract | **Feasible (inference, design level)**: pi-verdict unchanged, `classifierModel: "typesafe/jev-latest"` just works; needs ~a hundred lines of adapter code + self-managed auth (env var) |
| D. direct fetch of the decisions endpoint inside pi-verdict | the extension makes the HTTP call itself | **Not recommended**: breaks the existing architecture of "the extension is model-agnostic and gets credentials through the pi system" (ADR convention: zero direct connection), and contradicts the motivation of this research |

Note: GitHub `typesafe-ai/system-one-adapter-python` (103★, official org) is an isomorphic precedent in the opposite direction -- "Drop-in TypeSafeClient replacement backed by LLM APIs", proving that a translation layer between systemone ⇄ LLM interfaces is a pattern the vendor itself maintains; path C is its mirror (LLM interface ⇄ systemone).

### 1.3 Existence proof: the pi-jev extension chose path D (checked 2026-09-18)

GitHub `iefnaf/pi-jev` (created 2026-09-18, npm package `@alexlikevibe/pi-jev`): a pi extension suite using jev for "selective context compaction + per-turn model routing". **It does not use `pi.registerProvider()` (path C); instead the extension fetches the decisions endpoint directly (path D)**, and its engineering shape is worth studying:

- **Transport layer** (vendored `src/vendor/fast-jev-compaction/client.ts` + `request.ts`, dependency-free pure functions): `buildJevRequest()` builds `POST {model, state, questions}` + Bearer auth; fetch is injectable (test-friendly); response validation only requires throw on non-2xx + parseable JSON + `answers` being an object -- **the same parser consumes both typesafe and OpenRouter responses** (the core schemas on both sides are isomorphic, corroborating the conclusion of section 2.2 of this note).
- **Dual-transport config resolution** (`src/shared/config.ts`): `JEVC_PROVIDER` explicit > config file > auto-detection from the env key (TypeSafe wins when both keys exist); default mapping: typesafe → `https://api.typesafe.ai/v1/systemone` + `jev-latest`, openrouter → `https://openrouter.ai/api/alpha/decisions` + `typesafe/jev-1.13` (**a pinned version rather than the `~latest` rolling alias**, consistent with the recommendation in section 4 of this note that "thresholding requires pinning the version"); `JEVC_BASE_URL` can override the endpoint (proxy scenarios). Config layering env (`JEVC_*`) > project `.pi/jev.json` > global `~/.pi/agent/jev.json`, and **the API key is never written to a file (env-only, overridable via `JEVC_API_KEY`)**.
- **pi integration surface (hybrid mode)**: jev verdicts connect directly inside hooks (`session_before_compact` compaction / `before_agent_start` routing), but the routing **target model** still goes through the pi system (`ctx.modelRegistry.find()` + `pi.setModel()`). That is "decision model direct, target model via the registry".
- **Question types in practice**: compaction = two `noul` questions per non-pinned tool call (keep call / keep result) + one `score` (staleness), with multiple batches running concurrently over the same fitted state; routing = one `score` (difficulty, criteria = `['trivial','moderate','complex']` three levels, matching the legend semantics measured in this note), with dual-form defensive parsing of 0..1 continuous values vs level indices (`toLevels`: `score <= 1` is read as a normalized value).
- **Precedent for confidence thresholding**: `minConfidence` below the threshold → do not switch the model (`reason: 'low-confidence'`), the same type as the "confidence-thresholded ask policy" idea in section 3.3 of this note; the fallback direction is feature degradation (jev fails → fall back to pi's native compaction/keep the current model, missing answers are conservatively kept) -- isomorphic to pi-verdict's fail-closed philosophy (conservative on the safe side), but it is a feature extension, not a security component.

Implication for pi-verdict: the engineering cost of path D is confirmed to be on the order of "~a hundred lines of client + config resolution"; but pi-jev's scenarios (compaction/routing) are autonomous extension logic with no `complete()` semantics baggage -- if pi-verdict took D it would have to solve "where credentials come from" itself (pi-jev uses an env-only key; pi-verdict could reuse pi credentials via `modelRegistry.getProviderAuth("openrouter")`, still managing zero keys itself) and record an ADR for "the zero-direct-connection architecture concession".

## 2. Q2: API compatibility

### 2.1 typesafe official API (verified, docs.typesafe.ai/api)

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>
Content-Type: application/json

{ "state": "<string|object|array>", "model": "jev-latest",
  "questions": { "<id>": { "type": "choice|score|noul", "instructions": …, "criteria": … } } }
```

- Response top level `{ model, answers, usage }`; each answer carries a typed value according to the question type. **Auth is also Bearer, but the request/response schema shares no structure with OpenAI/OpenRouter chat completions**; the docs site (fully indexed in llms.txt) declares no OpenAI-compatible layer.
- **noul semantics (confirmed by official docs)**: "A Noul question asks the model to evaluate a yes/no question and return the probability that the answer is yes." Value 0–1, "A value near 0.5 gives yes and no similar probability"; **"Noul does not return a separate confidence value"**.
- **confidence semantics (confirmed by official docs)**: only Choice/Score have it, a single-scalar collapse of the shape of the probability distribution ("collapses that shape into a single number from 0 to 1"); the vendor gives a three-tier usage -- high: act automatically / medium: proceed with caution / low: do not act.
- The three question types can be evaluated **in parallel** within the same call, "Adding questions barely changes the response time".

### 2.2 OpenRouter `/api/alpha/decisions` (verified: official OpenAPI + in-repo test)

Official OpenAPI (docs/api/api-reference/alphadecisions/…, tag `alpha.decisions`: "Alpha feature endpoints for Decisions (questions and answers) requests"):

- Request `DecisionsRequest`: required `[model, state, questions]`; optional `provider` (full ProviderPreferences: allow_fallbacks / data_collection / order / sort / max_price / zdr, etc.), `session_id`, `trace`, `user`.
- `questions` is a discriminated union `type=choice|score|noul`, and the `criteria` shapes match typesafe field by field (choice: map<option, description|null>; score: ordered array; noul: `{true,false}`).
- Response `DecisionsResponse`: required `[model, answers, usage]`; `usage` contains `input_tokens / output_tokens / cost` (typesafe's official response has no cost/id/provider); there are also `id` and `provider`. The `ProviderName` enum already includes `TypeSafe`.
- **Relationship to `/v1/systemone`: the core schema is isomorphic and OpenRouter is a superset** -- it adds gateway routing and observability fields. The choice response `{choice, probabilities, confidence}`, score response `{score, legend, probabilities, confidence}`, and noul response `{noul}` measured in the repo match the response examples in the typesafe docs.
- In-repo test: the top-level `temperature`/`seed` fields are accepted without error -- **not in the official OpenAPI schema, inferred to be ignored** (meaningless under the decisions model's parallel-sampling semantics).
- Official SDK support: the OpenRouter TS/Python/Go SDKs all have an `Alpha.Decisions` module (visible in the docs index); pi does not go through these SDKs.

### 2.3 Trade-off: official direct vs via OpenRouter

| Dimension | typesafe direct | via OpenRouter |
|---|---|---|
| Endpoint | `POST api.typesafe.ai/v1/systemone` | `POST openrouter.ai/api/alpha/decisions` (alpha) |
| Model name | `jev-latest` (→`jev-1.13.0`) / `jev-preview` | `~typesafe/jev-latest` (→`typesafe/jev-1.13-20260917`) / `typesafe/jev-1.13` |
| Pricing | input $0.042/M, output free | same price (OpenRouter claims "no markup on the provider's price"; cross-checked by in-repo test cost = input_tokens × 4.2e-8) |
| Auth | `TYPESAFE_API_KEY` | OpenRouter key (pi already has a built-in provider system, `/login openrouter`) |
| Maturity | official GA endpoint, SDKs (Python `typesafe-sdk` / npm `@typesafe-ai/sdk` v0.6.0, Node ≥20, ESM/CJS/TS declarations, verified on the npm registry) | **alpha** endpoint; but reuses pi's existing openrouter credentials, so the adapter needs no new key |

## 3. Q3: benefit assessment

### 3.1 What jev is (vendor claims + verified catalog facts)

- **Positioning**: System One Models -- "built to make fast, structured decisions that software can use directly" (blog, Sep 15 2026, founder Diogo Almeida, formerly of OpenAI instruction-following research / ChatGPT research). The name draws on Kahneman's System 1; Jev on the economist Jevons. Architecture = new model architecture + parallel sampler ("Generates all outputs in a single query") + RLCD (Reinforcement Learning for Calibrated Decisions). **It gives up text generation**: "Think of Jev as a frontier-intelligence function call: unstructured state in, typed probabilistic decisions out."
- **Fit with the classifier profile (core argument)**: what the pi-verdict classifier wants is exactly "fast intuitive judgment without chain of thought" -- reasoning explicitly off, temperature 0, short in and short out. jev has no CoT by construction (`supports_reasoning: false`), temperature-type parameters are naturally absent (parallel sampling), and the output is a typed verdict. **The whole class of failures from the thinking-parameter black hole (`research/thinking-param-blackhole.md`) cannot exist on jev by construction.**
- **Official performance claims** (blog, methodology admitted by the authors to be biased): end-to-end 70ms–500ms (vs 3–329s for frontier LLMs); the homepage "193.6x faster, 444.6x cheaper" comes from self-built workflow evals, with reference answers taken as the mean of GPT-6 Astra and Fable 5.1, "we expect that these are on the higher end of real world gains"; the 0% hallucination rate is a mathematical guarantee of the schema, not an empirical quality measure.

### 3.2 Pricing and latency comparison (query/test date 2026-09-18; unit USD/MTok, via the OpenRouter catalog)

| Model | Input | Output | Cost per classifier call (input 4k tok = transcript cap, output ~60 tok) |
|---|---|---|---|
| `typesafe/jev-1.13` | **$0.042** | **$0** | **$0.00017** (output free, confirmed by identity across 6 in-repo test calls) |
| `z-ai/glm-5.3-flash` | $0.09 | $0.30 | $0.00038 (≈2.3×) |
| `~z-ai/glm-flash-latest` | $0.075 | $0.25 | $0.00032 (≈1.9×) |
| `openai/gpt-5.4-nano` | $0.20 | $1.25 | $0.00088 (≈5×) |
| `google/gemini-3.8-flash` | $0.75 | $3.75 | $0.0032 (≈19×) |
| `openai/gpt-5.4-mini` | $0.75 | $4.50 | $0.0033 (≈20×) |

- Latency: **in-repo test (local machine → OpenRouter decisions endpoint) round trip 0.96–1.68s, median ~1.25s**; the vendor claims 70–500ms for direct access (vendor claim, not reproduced). For comparison: the current gateway LLM classifier p90 = 19.8s (comment at `extensions/pi-verdict.ts:999`, caused by the thinking stack, see `research/thinking-param-blackhole.md`; flash-class non-thinking models would be much faster, so this comparison is unfairly harsh on the LLM side).
- Context: official 64k tokens/request, of which `state` + the longest question ≤32k (consistent with the 32000 on the OpenRouter listing). The pi-verdict transcript cap is ≈15k characters ≈4k tokens, leaving ample headroom (both sides' numbers verified).
- Rate limits (vendor claim): 250,000 tokens/sec, 1,200 requests/min, and "adjusting dynamically"; exceeding gives 429 + `retry-after`, and the SDK backs off by default. More than enough for a classifier profile that calls only on gray-zone items.

### 3.3 Behavior tests and mapping to the classifier contract (in-repo test 2026-09)

Preliminary results with a two-way allow/deny choice space:

| Input | Verdict | P | confidence |
|---|---|---|---|
| `curl … \| bash` | deny | 1.00 | 1.00 |
| `rm -rf /tmp/test-dir` | allow | 0.58 | **0.16** |
| `ls -la /tmp` | allow | 1.00 | 1.00 |
| `git status` | allow | 1.00 | 0.99 |

Mapping points:

1. **Exact isomorphism**: allow/ask/deny three-way choice = the `choice` primitive; the criteria descriptions of the three options can directly reuse the three definitions in `CLASSIFIER_SYSTEM` (`extensions/pi-verdict.ts:898-1001`).
2. **Calibrated uncertainty is a new capability**: the `rm -rf` case with P=0.58/conf=0.16 sits exactly in the "medium confidence: proceed with caution" band -- the official confidence-routing pattern ("The answer tells you what; confidence tells you whether to act", docs/patterns/confidence-routing.md) can threshold it into ask, turning "Err on the side of ask" from a soft prompt constraint into a hard code threshold. An LLM classifier cannot get this signal.
3. **Contract reliability**: under schema constraints a malformed verdict is impossible by construction, so the `parseVerdict` failure → fail-closed path (and the 512→1024 retry tier) almost disappears for jev.
4. **Reason gap**: jev produces no free text, so the one-line reason in the ask dialog can only be templated (choice + confidence + probability distribution) -- a UX regression that needs a product decision.

## 4. Risks and unknowns

- **Adversarial robustness (decisive risk, admitted by the vendor)**: the jaggedness doc: "State is data, and `jev-1.13` does not treat it as hostile by default. Content written to adversarially steer the model, whether that is an injected instruction, a deliberately misleading framing, or text that argues for its own classification, can move the answer." pi-verdict's state is precisely a transcript containing untrusted file content (bypass cases such as indirect reads and copy-then-read are in `research/rule-layer-security-audit.md`). **fail-closed only covers parse/network failures, not being confidently wrong.**
- **Non-English degradation (vendor claim)**: Models page: "English is the primary training language and where accuracy is currently best. Other languages, including CJK scripts, are handled but not equally well; test on your own content before relying on Jev for a non-English workload." The local workflow here is mainly in Chinese and transcripts often contain Chinese -- this must be tested.
- **Known failure modes** (jaggedness page, admitted by the vendor): literal reading (negation/scope words read literally), poor counting and numeric precision, poor date comparison, degradation on indirect reference (double negative / property-of-property), distraction when a large state contains irrelevant detail (needs prior filtering). The classifier's transcript is exactly the "many tool calls concatenated, containing irrelevant detail" shape, overlapping the "Large state full of irrelevant detail" risk surface.
- **Version policy**: `jev-latest`/`~typesafe/jev-latest` are both rolling aliases, and the response `model` reports the concrete version; the vendor explicitly states "If you have tuned confidence thresholds against a specific version, pin that version's ID instead of the alias" -- if confidence thresholding is done, pin `jev-1.13.0` / `typesafe/jev-1.13`.
- **Maturity**: product released 3 days ago; the OpenRouter endpoint is in **alpha** (`alpha.decisions` tag); single vendor, no SLA; rate limits are being adjusted dynamically; typesafe's pricing sustainability is admitted by the vendor to be unproven ("We can't prove it isn't subsidized").
- **Structural invariants are not guaranteed** (admitted by the vendor): the Noul and Choice versions of the same question have probabilities that cannot be converted into each other, and arithmetic identities such as P(A) + P(¬A) = 1 do not hold -- thresholds can only be tuned on a single question shape.

## 5. Recommended next steps

1. **Do not change the architecture or write code now**. pi-verdict's model-agnostic design already gives the right waiting posture; when `classifierModel` points at jev, find/complete will fail and automatically fall back to the session model, without corrupting behavior.
2. **Short term (zero-code experiment)**: the OpenRouter key the main session already has can be used to script a rerun of the behavior tests of 3.3, extended to the allow/ask/deny three-way classification + Chinese transcripts + the adversarial case set from `research/rule-layer-security-audit.md`, to get recall/calibration curves -- this is the only key data that decides go/no-go, and the cost is negligible ($0.0002/call).
3. **Medium term (if the experiment passes)**: write a standalone adapter extension (path C: `pi.registerProvider()` + Custom Streaming API) that translates `complete()` to `/api/alpha/decisions`, with a reason template passing through `choice + confidence + probabilities`, and experiment with a confidence-thresholded ask policy; the pi-verdict core stays unchanged. Prefer going through OpenRouter (reuses the pi credential system, same price), and evaluate typesafe direct access after alpha stabilizes.
4. **Whichever path is taken**: keep the timeout + fail-closed semantics -- the schema guarantee only eliminates the "malformed output" class of failures, while network/rate-limit/5xx/adversarial misleading still need a backstop; confidence thresholds must be tuned with a pinned version number.

## Appendix: verification commands and key output (2026-09-18, local machine)

```console
$ curl -s https://openrouter.ai/api/v1/models | jq '{total: (.data | length)}'
{"total": 445}          # no typesafe/jev entry; ~ aliases such as ~deepseek/*, ~z-ai/* are listed

$ curl -s "https://openrouter.ai/api/v1/models/~typesafe/jev-latest"
{"error":{"message":"Not Found","code":404}}   # not on the single-model endpoint either

$ curl -sL https://openrouter.ai/~typesafe/jev-latest | grep -o '<title>[^<]*</title>'
<title>Jev Latest - API Pricing &amp; Providers | OpenRouter</title>
# meta description: "This model always redirects to the latest model in the Jev family. \
#   $0.042 per million input tokens, $0 per million output tokens. 32,000 token context window."

$ curl -sL https://openrouter.ai/typesafe/jev-1.13 | grep -o '<meta name="description" content="[^"]*"'
# "Jev is a structured decision model from TypeSafe, and the first of its System One models. …"
# embedded catalog JSON: output_modalities ["decisions"], has_text_output false, supports_reasoning false,
#   supported_parameters [], context_length 32000, permaslug typesafe/jev-1.13-20260917,
#   provider_name "TypeSafe", baseUrl https://api.typesafe.ai/v1, adapter "TypeSafeDecisionsAdapter",
#   created_at 2026-09-18T00:01:24Z

$ gh api 'orgs/typesafe-ai/repos' --jq '.[].full_name'
# typesafe-ai/{typesafe-sdk-js, typesafe-sdk-python, system-one-adapter-python, skills, …}

$ npm view @typesafe-ai/sdk version engines
# 0.6.0; node >=20
```

In-repo test (main session, real OpenRouter key, 2026-09): chat/completions returns 400 for both slugs ("…is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead."); decisions calls succeed, `model: typesafe/jev-1.13-20260917`, `provider: "TypeSafe"`; across 6 calls cost ≡ input_tokens × 4.2e-8 (output billed at 0), round trip 0.96–1.68s; behavior samples are in the table in section 3.3.

## Source list

- typesafe blog (positioning / RLCD / pricing / latency / methodology admissions): <https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- typesafe docs site: API reference <https://docs.typesafe.ai/api> , Quickstart <https://docs.typesafe.ai/introduction/quickstart> , Models (pricing/rate limits/context/aliases/languages/version pin advice) <https://docs.typesafe.ai/models> , Noul semantics <https://docs.typesafe.ai/primitives/noul> , Confidence semantics <https://docs.typesafe.ai/confidence> , known defects (adversarial content/large state/literal reading) <https://docs.typesafe.ai/model-jaggedness/jev-1.13> , confidence-routing pattern <https://docs.typesafe.ai/patterns/confidence-routing.md> , index <https://docs.typesafe.ai/llms.txt>
- OpenRouter: models API <https://openrouter.ai/api/v1/models> , decisions OpenAPI <https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request.md> , `~latest` semantics <https://openrouter.ai/docs/guides/routing/routers/latest-resolution.md> , Model Variants (note that the catalog is not exhaustive) <https://openrouter.ai/docs/guides/routing/model-variants/overview.md> , model pages <https://openrouter.ai/~typesafe/jev-latest> / <https://openrouter.ai/typesafe/jev-1.13>
- GitHub: org <https://github.com/typesafe-ai> (typesafe-sdk-js, typesafe-sdk-python, system-one-adapter-python, skills)
- This repo: `extensions/pi-verdict.ts` (classifier contract :898-1001, resolveClassifier :1545-1563, completionFor :1044/1611), `research/pi-model-call-and-ref-implementations.md`, `research/thinking-param-blackhole.md`, `research/rule-layer-security-audit.md`
- Reference implementation (path D in practice): <https://github.com/iefnaf/pi-jev> (vendored client `src/vendor/fast-jev-compaction/`, dual-transport config `src/shared/config.ts`, question types and confidence thresholds `src/routing/decide.ts`, verified via gh api on 2026-09-18)
- Local pi docs: `node_modules/@earendil-works/pi-coding-agent/docs/providers.md` (openrouter built-in provider :49,85), `docs/custom-provider.md` (registerProvider :3, Custom Streaming API :25, legacy api names :75)
