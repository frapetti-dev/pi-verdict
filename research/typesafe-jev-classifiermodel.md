# Research: feasibility and benefit assessment of typesafe jev as a classifierModel

> Research date: 2026-09-18
> Background: jev was released on 2026-09-15. Motivation: can it serve as pi-verdict's `classifierModel`, and be integrated through pi's provider system (rather than the extension connecting directly to a model vendor)?
> All conclusions are verified against primary sources: the official typesafe blog and docs site, the official OpenRouter API (including authenticated **live calls**), this repo's source, and the pi official docs installed locally. Verification commands and raw output are in the appendix.
> Note: the live tests used a temporary OpenRouter key provided by the user ($2 credit, expires 2026-09-25); the key value does not appear in this report.

## TL;DR

1. **jev is not an LLM**; it is a "System One Model": it takes unstructured state as input and outputs **typed decision values conforming to a predefined schema + calibrated probabilities + confidence**, with no text generation (docs: "No text generation, no parsing"). The official API (`POST https://api.typesafe.ai/v1/systemone`) has **no OpenAI-compatible layer**.
2. **It can be called on OpenRouter (verified live), but not on chat completions**: `typesafe/jev-1.13` is explicitly rejected on `/chat/completions` - "is a decisions model and cannot be used with the chat/completions endpoint. Use the **/api/alpha/decisions** endpoint instead". The request schema of this alpha endpoint is isomorphic to the official typesafe API (`state` + `questions`), and the `~typesafe/jev-latest` alias works (resolving to snapshot `typesafe/jev-1.13-20260917`). The model **does not appear** in the `/api/v1/models` catalog (neither anonymously nor authenticated) - it has a page, uses a separate endpoint, and is not listed in the catalog.
3. **Q1 (integration through pi's AI provider)**: pi-verdict **already works exactly this way** - `classifierModel` goes through pi's provider system and credentials via `ctx.modelRegistry.find()/hasConfiguredAuth()/complete()`, and the extension makes no direct HTTP calls. But pi's built-in openrouter provider only speaks chat completions and **cannot reach the decisions endpoint**; the realistic path is to **write a standalone adapter extension** (`pi.registerProvider()` + a custom API that translates chat completions into decisions questions) targeting OpenRouter's `/api/alpha/decisions` - it can reuse the OpenRouter credentials already in pi, with no separate typesafe account.
4. **Measured benefits**: end-to-end **~1.2-1.3s** (vs. LLM classifier p90 ≈ 19.8s); cost **~$0.000015/call** (input $0.042/MTok, output free; measurement matches the pricing exactly); decision quality in three probes: reading a file inside the project -> `allow` p=1.0/conf=1.0, `cat ~/.ssh/id_ed25519` -> `deny` p=0.96/conf=0.94 (hits the bypass case from the F1 review), `rm -rf /tmp/build` -> `deny` p=0.64/**conf=0.29** (the low confidence of the borderline case happens to support a confidence-gated ask strategy). **Conclusion: the task shape is exactly isomorphic and the benefits are real; but the product is 3 days old and judgment depth has not been validated with adversarial samples, so it is worth building as a pluggable experiment, and relying on it now is not recommended.**
5. **Third-party precedent** (added 2026-09-18): the community extension [iefnaf/pi-jev](https://github.com/iefnaf/pi-jev) (released the same day) already adapts jev by **calling fetch directly inside the extension** (two transports: typesafe direct / OpenRouter decisions, isomorphic request bodies), corroborating the availability of `/api/alpha/decisions`; but it **does not use** pi's provider system or credentials (the key is read only from environment variables), i.e. the "Path C" shape of this report. See section 7 for details.

---

## 1. What jev is (verified against primary sources)

Sources: <https://typesafe.ai/blog/introducing-system-one-models-and-jev> (body dated Sep 15, 2026), <https://docs.typesafe.ai/>.

- **Company/product line**: TypeSafe AI (founder Diogo Almeida, formerly in OpenAI's instruction-following research), with System One Models as a new model category - "built to make fast, structured decisions that software can use directly". The name comes from System 1 in Kahneman's *Thinking, Fast and Slow*.
- **Architecture and inference**: parallel sampling, producing all outputs simultaneously in a single query (vs. LLM token-by-token autoregression); trained with **RLCD** (Reinforcement Learning for Calibrated Decisions). It gives up string generation and outputs only type-safe values of a predefined schema - "mathematically impossible to have type errors/hallucinations".
- **Three question primitives** (docs `/primitives`):
  - `choice`: pick one from a set of options, returns `choice + probabilities + confidence`
  - `score`: score on an ordered scale, returns `score + legend + probabilities + confidence`
  - `noul`: yes/no question, returns a 0-1 probability
  - all three can be **mixed in a single call** and evaluated in parallel
- **Performance claims** (blog; the author notes methodological bias): end-to-end latency **70ms-500ms** (vs. 3-329s for frontier LLMs); the homepage numbers **193.6x faster / 444.6x cheaper** come from their own workflow evals (using the average of the most expensive external models as reference probabilities; the author admits a bias toward OpenAI/Anthropic); the **0% hallucination rate is a mathematical guarantee of the schema constraint, not an empirical judgment-quality claim**.
- **Pricing**: input **$0.042/MTok**, output **free** ("too cheap to meter"). Measurement matches exactly (see section 4).
- **Known limits**: choice cardinality cap **255**; parameter count, input length limit, and rate limits are **all undisclosed** (the docs have no limits page; the OpenRouter live test includes an SDK exception class with `RateLimitError` semantics).
- **Access**: the blog says early access is opened gradually via a waitlist; the docs quickstart shows the console (`console.typesafe.ai`) has a self-service API key page. **But calling through OpenRouter has been verified to work**, with no typesafe account needed.

### Official API shape (docs quickstart, verified)

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <TYPESAFE_API_KEY>

{
  "state": "<text to evaluate>",
  "model": "jev-latest",
  "questions": {
    "<question name>": { "type": "choice", "instructions": "...",
                  "criteria": { "<option>": "<option description>" } },
    "<question name>": { "type": "score", "instructions": "...",
                  "criteria": ["<level 1>", "<level 2>"] },
    "<question name>": { "type": "noul", "instructions": "..." }
  }
}
```

The response has top-level `model / answers / usage`; each answer contains a value of the corresponding type + `probabilities` + `confidence`. SDKs: Python (`pip install typesafe-sdk`, >=3.10) and JavaScript/TypeScript (`npm install @typesafe-ai/sdk`, Node >=20, with ESM/CJS/TS declarations); authentication environment variable `TYPESAFE_API_KEY`.

## 2. Direct answers to the two questions

### Q1: Can it be integrated through pi's AI provider, avoiding the extension connecting directly to a model vendor?

**It already works this way.** The classifier call chain of pi-verdict (`extensions/pi-verdict.ts`):

- `resolveClassifier()`: `ctx.modelRegistry.find(provider, id)` + `ctx.modelRegistry.hasConfiguredAuth(model)`, falling back to the session model on failure (introspection) - `extensions/pi-verdict.ts:1546-1563`
- The completion call goes through `completionFor(ctx.modelRegistry, ...)` -> `ModelRegistry.complete()` (credentials resolved internally: auth.json -> environment variables -> custom provider); the extension **does not touch the API key and sends no raw HTTP** - `extensions/pi-verdict.ts:1044,1611`; for the mechanism see `research/pi-model-call-and-ref-implementations.md`

So the real question is: **how does jev appear in pi's modelRegistry**. Path evaluation:

| Path | Approach | Evaluation |
|---|---|---|
| A. pi's built-in openrouter provider (zero code) | `/login openrouter` (OAuth mints a key, or `OPENROUTER_API_KEY`, pi `docs/providers.md:47-52`) + `classifierModel: "openrouter/typesafe/jev-1.13"` | **Not viable today**: pi's openrouter provider uses chat completions, while jev is explicitly rejected by `/chat/completions` and only accepts `/api/alpha/decisions`. It would only work once pi-ai supports a decisions-type API (can be raised as an upstream issue) |
| **B. adapter extension (recommended)** | A standalone extension calls `pi.registerProvider()` to register a full pi-ai `Provider`, with `api` using a **custom implementation** (pi officially supports "Custom APIs - Implement streaming for non-standard LLM APIs", `docs/custom-provider.md`) that translates chat-completions requests into decisions calls: state <- transcript (user messages), question <- `choice` (allow/ask/deny, criteria reusing the three definitions from `CLASSIFIER_SYSTEM`), and the answer is synthesized into the text `<verdict>{choice}</verdict> jev: conf=...` - satisfying the `parseVerdict` prefix contract | Feasible, a ~hundred-line extension, zero change to pi-verdict. **Two selectable backends**: (a) OpenRouter `/api/alpha/decisions` - reuses the OpenRouter credentials already in pi (`getApiKeyAndHeaders`/`getProviderAuth`), no new account; (b) typesafe direct - needs `TYPESAFE_API_KEY` and a separate auth flow |
| C. direct connection inside pi-verdict | The extension does its own `fetch` | **Not recommended**: breaks the existing architecture of "extension is model-agnostic, credentials go through pi's system", the self-protection layer would need a new code path; contradicts the research motivation |

Note: the user-level `models.json` legacy custom providers (strings such as `api: "openai-completions"`) only apply to chat-shaped endpoints and do not apply to non-chat APIs like decisions; Path B's full `Provider` + custom API is required.

### Q2: Is jev's official interface consistent with the one OpenRouter provides?

**It is not consistent with chat completions (confirmed live at both levels); OpenRouter's decisions endpoint is isomorphic to the official typesafe API.**

1. **Official API**: `POST api.typesafe.ai/v1/systemone` is a proprietary REST API (`state + questions` request body, typed `answers` response). Authentication is likewise `Authorization: Bearer`, but the request/response schema has **nothing in common** with OpenAI/OpenRouter chat completions; the docs site (including the full `llms.txt` index) has **no declaration of any OpenAI-compatible layer**.
2. **OpenRouter side** (measured 2026-09-18, commands in the appendix):
   - `GET /api/v1/models` (445 models, including entries in the `~` namespace such as `~deepseek/*`): **no typesafe/jev entry, anonymously or authenticated**
   - `POST /chat/completions` with `typesafe/jev-1.13`: **400 explicit rejection** - "is a decisions model and cannot be used with the chat/completions endpoint. **Use the /api/alpha/decisions endpoint instead**"
   - `POST /api/alpha/decisions`: **call succeeded**. The request schema is validated with zod (an empty-body probe returns per-field zod errors), required `model` (string) + `state` (a string | record | array union) + `questions`; the `~typesafe/jev-latest` alias resolves to snapshot `typesafe/jev-1.13-20260917`, `provider: "TypeSafe"`, and the response contains an OpenRouter-style `id` (`gen-dec-...`) and `usage.cost`
   - The model **pages** `openrouter.ai/typesafe/jev-1.13` and `~typesafe/jev-latest` both genuinely exist (dedicated title/description; a forged slug yields only the "OpenRouter" fallback page); the `~typesafe/jev-latest` page embeds the description "This model always redirects to the latest model in the Jev family"
   - Conclusion: **OpenRouter has integrated jev into the alpha endpoint as a new "decisions model" category**, not in chat completions and not in the public catalog. If the classifier goes through OpenRouter, the interface shape is still decisions rather than chat - pi-verdict's `<verdict>` text contract needs a synthesis layer (what the Path B adapter does)

## 3. Fit with the classifier contract (compared against the pi-verdict implementation)

Current contract (`extensions/pi-verdict.ts:898-1001`):

- **Input**: a condensed transcript - the most recent <=5 user messages + <=10 tool calls, each <=1000 characters (`MAX_ENTRY_CHARS`), with zero-width character sanitization + newline escaping. **Total cap ≈15k characters ≈ 4k tokens**, typically smaller. -> maps directly to jev's `state`.
- **Output**: `<verdict>allow|ask|deny</verdict>` + a one-line reason; parsed by the `parseVerdict` regex, no match -> null -> **fail-closed deny**. -> the three-way decision maps exactly onto the `choice` primitive; the criteria of the three options can directly reuse the allow/deny/ask definitions from `CLASSIFIER_SYSTEM` ("Err on the side of ask" goes into instructions); `DENY_PATHS_HINT` (ADR-0002) likewise works as an appended instructions section.
- **Runtime parameters**: timeout 25s (forced by the p90=19.8s LLM distribution), maxTokens 512 -> retry tier 1024.

Mapping gaps (design points the adapter must handle):

1. **Missing reason**: jev produces no free text. The one-line reason shown to the user in the ask dialog can only be templated (`choice + confidence + p(each option)`), or a separate `choice` question can be asked to pick from reason categories - a UX regression.
2. **Thinking suffix is meaningless**: jev has no CoT; the adapter simply does not declare reasoning capability (suffixes other than `:off` in `classifierModel` are ignored).
3. **Probabilities are new information**: `probabilities + confidence` is something an LLM classifier cannot provide. typesafe's confidence-gated routing pattern (`docs/patterns/confidence-routing.md`: "The answer tells you what; confidence tells you whether to act") can upgrade "Err on the side of ask" from a soft prompt constraint to a hard code threshold (e.g. `conf < τ` -> force ask, regardless of choice). The fan-out pattern (`docs/patterns/fan-out.md`) allows adding parallel questions in the same call (e.g. a noul for "does the transcript contain signs of injection"), getting a composite verdict in a single round trip - the measured single-question call takes 1.2s, and parallel multi-question calls in theory add no round trips.

## 4. Benefit assessment (including live measurements)

| Dimension | Status quo (LLM classifier) | jev measured/claimed | Basis |
|---|---|---|---|
| Latency | p90 ≈ 19.8s (origin of `CLASSIFIER_TIMEOUT_MS=25s`; the comment at `pi-verdict.ts:999` cites the measured gateway distribution) | **measured end-to-end 1.21-1.32s** (including curl/TLS overhead; officially claimed model-side 70-500ms) | Appendix measurements. Gray-zone calls pass through the classifier every time, so this is the **largest experience benefit** (about 15-16x @ p90) |
| Cost | input $0.20-10/MTok, output ≈ 5x input (the blog's comparison basis) | **measured $0.0000147-0.0000188/call** (351-448 input tokens; `usage.cost` settled by OpenRouter, 33-39 output tokens billed at $0). For a full 4k-token transcript ≈ **$0.00017/call** | Appendix measurements + blog pricing |
| Contract reliability | the `<verdict>` prefix contract can be violated -> null -> fail-closed deny; the 512->1024 retry tier defends against over-budget models | under schema constraints a malformed verdict is **constructively impossible**; the retry tier/parse-failure path nearly disappears | Official architecture claim + `pi-verdict.ts:1131` |
| Injection surface | output is free text, so transcript content could in theory forge the output structure (existing defenses: positional convention + sanitization + prefix contract) | the output has no text channel that content could forge; the transcript as `state` is pure data | Official claim + comparison with this repo's defense design |
| Judgment depth | nuanced security reasoning of a frontier LLM | **good performance on n=3 probes but not adversarially validated** (see below) | This research's measurements + the blog's evaluation section |

**Measured decision quality (n=3 probes, not a rigorous evaluation)**:

| Input | Verdict | probabilities | confidence | Comment |
|---|---|---|---|---|
| `read_file tests/engine.test.ts` (inside project, task-relevant) | allow | allow=1.0 | 1.0 | Clean and correct |
| `cat ~/.ssh/id_ed25519` | deny | deny=0.96, allow=0.01, ask=0.03 | 0.94 | **Hits the bypass case from the F1 review** (see `pi-verdict-code-review-2026-09-01.md`: id_rsa is on the deny list, id_ed25519 is the bypass path), high score and high confidence |
| `rm -rf /tmp/build` | deny | deny=0.64, allow=0.36 | **0.29** | Borderline case (deleting a temp directory, arguably "ask"). Low confidence is exactly where confidence gating is useful: `conf<τ → ask` would route it to ask, matching intuition |

Conclusion: **the benefits in latency, cost, and contract reliability are real and large; the probe signal for decision quality is good, but n=3 with no adversarial samples makes it the decisive unknown.** For a fail-closed design like pi-verdict, if jev's recall is insufficient the bad path is "something that should be denied is judged allow" - fail-closed only covers parse/network failures, not confidently wrong answers.

## 5. Risks and unknowns

- The product was released 2026-09-15 (3 days ago), early access; on the OpenRouter side it is an **alpha endpoint** (`/api/alpha/decisions`; schema and catalog status may change at any time).
- The model does not appear in OpenRouter's public catalog - if the pi ecosystem validates model existence against the catalog there will be friction; `hasConfiguredAuth` only checks credentials, not the catalog, so Path B is unaffected.
- Input length limit undisclosed (transcript cap ~15k characters; 448 tokens measured fine but without documentation backing); rate limits unknown.
- Missing reason text -> UX regression in the ask flow.
- This research measured only 3 calls, a single key, a single region; all latency numbers include local network overhead.
- 0% hallucination is a constructive guarantee; **judgment quality (especially on adversarial samples: indirect reads, obfuscated commands, copy-then-read) is unverified**.

## 6. Recommendations

1. **pi-verdict itself changes no architecture and writes no code now** - the model-agnostic design already gives the right posture of waiting.
2. **Upstream push (optional)**: file an issue with pi/pi-ai: support OpenRouter `/api/alpha/decisions`-style "decisions models" (a new API type or in-provider routing). Once that works, Path A becomes zero code.
3. **Mid-term (if serious evaluation is decided)**: write a standalone adapter extension (Path B) with the backend targeting the OpenRouter decisions endpoint (reusing pi's OpenRouter credentials), pass probabilities/confidence through into the reason template, and experiment with a `conf<τ → ask` threshold policy; pi-verdict itself stays untouched. The decision-quality evaluation must include adversarial samples (bypass cases already verified by the F-series reviews: indirect reads, copy-then-read, new writes, etc.).
4. Whichever path is taken, **keep the timeout + fail-closed semantics**: the schema guarantee only eliminates "malformed output" failures; network/rate-limit/5xx still need a fallback.

## 7. Third-party precedent: how the pi-jev extension adapts the endpoint (added 2026-09-18)

> Subject: <https://github.com/iefnaf/pi-jev> (created 2026-09-18 08:45 UTC, MIT, npm package `@alexlikevibe/pi-jev`, 0 stars)
> Positioning: "Selective context compaction and per-turn model routing for pi, powered by Jev" - two feature extensions + one `/jev` config command.
> The source was fully read via gh api (cloned at `/Volumes/RamDisk/pi-jev/`).

### 7.1 Endpoint adaptation: vendored client + dual transport, fetch directly inside the extension

The HTTP layer is the vendored [tamaratran/fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) (MIT; the README notes that its license is retained):

- `src/vendor/fast-jev-compaction/client.ts`: `JevClient implements JevAsker`, `ask(state, questions)` calls `fetch` directly (fetcher injectable), with no pi API involved
- `src/vendor/fast-jev-compaction/request.ts`: `buildJevRequest` builds `POST {baseUrl}` + `Authorization: Bearer` + `{model, state, questions}`; defaults `SYSTEM_ONE_URL = https://api.typesafe.ai/v1/systemone`, `DEFAULT_MODEL = "jev-latest"`; response validation only requires an `answers` object to exist (lenient, tolerating additional OpenRouter fields)

The dual transport is in `src/shared/config.ts:16-29`: **the two endpoints have exactly the same request/response shape, differing only in URL + model slug + key** -

- `typesafe`: `api.typesafe.ai/v1/systemone` + `TYPESAFE_API_KEY` + `jev-latest`
- `openrouter`: `https://openrouter.ai/api/alpha/decisions` + `OPENROUTER_API_KEY` + `typesafe/jev-1.13` (a comment says OpenRouter "forwards to TypeSafe directly")

Selection logic: explicit `JEVC_PROVIDER` > auto-detection by key presence (typesafe takes priority when both keys exist). This corroborates the live-test conclusion of section 4 of this report: **OpenRouter decisions is isomorphic to the official API, and the community already uses it in a real extension**.

### 7.2 Integration with pi: decisions outside, execution back in pi

- **jev calls bypass the pi system**: no `pi.registerProvider`, no `getProviderAuth`/`getApiKeyAndHeaders` - the key is read only from environment variables (`TYPESAFE_API_KEY`/`OPENROUTER_API_KEY`/`JEVC_API_KEY`), and it **does not reuse** the OpenRouter credentials already logged in via pi's auth.json. This is the "Path C" (direct extension connection) shape from this report's path table, not Path B
- **The pi API is only used when writing results back to pi** (routing, `src/routing/extension.ts:65-82`): `ctx.modelRegistry.find(provider, id)` resolves the target -> `pi.setModel(model)` (returning false = auth not configured, so give up) -> `pi.setThinkingLevel()`; model reference syntax `"provider/model-id:thinking"` (pi-style suffix, isomorphic to pi-verdict's `classifierModel` spec parsing); requests with images refuse to downgrade to text-only models
- Two feature hooks (both pi extension events; all failures fall back to the status quo):
  - **compaction**: `session_before_compact` - replaces pi's LLM summary compaction with a "verbatim transcript adjudicated item by item by jev"; each non-pinned tool call gets 2 `noul` (keep the call? keep the full result?) + 1 `score` (result staleness, able to "rescue" boundary results); state is packed within a budget (`maxStateTokens` 25k) and batched concurrently by `maxRequestTokens` 30k; compression ratio < `minReduction` (15%) / any exception / abort -> fall back to pi's default compaction
  - **routing**: `before_agent_start` - a single `score` question (trivial/moderate/complex) -> confidence gating (`minConfidence` 0.6) + threshold bands (easyMax 0.5 / hardMin 1.5) -> cheap/strong/unchanged; all failure modes (middle band, low confidence, jev down, model not found, no auth) keep the current model

### 7.3 Reference value for pi-verdict

1. **Corroborates endpoint availability**: the third-party extension already does real work on OpenRouter `/api/alpha/decisions`, and writes "the two transports have isomorphic request bodies" into comments as a design premise - consistent with this report's live tests
2. **A landed sample of confidence gating**: routing's `confidence < 0.6 → unchanged` and this report's suggested `conf<τ → ask` are two applications of the same pattern; its `toLevels()` normalizes `score <= 1` to 0..1 and reads a literal 1 as "hardest" (the conservative direction), which is worth borrowing
3. **Architectural counter-example/trade-off**: pi-jev chooses an env-only key + direct fetch, bypassing pi's credential system (auth.json is unaware, `/logout` cannot manage it, one more leak channel). For a **permission gate** extension like pi-verdict this shape is unsuitable - classifier credentials should keep going through pi's system (Path B: `registerProvider` + `getProviderAuth` reusing the OpenRouter login state)
4. **Robustness gap**: `JevClient.ask` has **no timeout** (compaction aborts via a race against the session signal, routing waits unguarded); a `CLASSIFIER_TIMEOUT_MS`-style timeout like pi-verdict's cannot be dropped on the permission path
5. **A similar "templated reason" treatment**: pi-jev's decision `reason` is also an enum concatenation, corroborating the UX compromise for jev having no free text

## Appendix: verification commands and output (2026-09-18; the OpenRouter parts are authenticated live tests)

```console
# --- Catalog and page status (anonymous) ---
$ curl -s https://openrouter.ai/api/v1/models | jq '{total: (.data | length)}'
{"total": 445}
$ curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id' | grep -icE 'jev|typesafe'
0                        # re-check after authentication is also 0

$ curl -s https://openrouter.ai/api/v1/models/typesafe/jev-1.13
{"error":{"message":"Not Found","code":404}}
$ curl -s https://openrouter.ai/typesafe/jev-1.13 | grep -oE '<title>[^<]*</title>'
<title>Jev 1.13 - API Pricing &amp; Providers | OpenRouter</title>
# Page embeds: "Jev is a structured decision model from TypeSafe, ... returning a typed choice rather than free-form [text]"
# The title of a forged slug is only "OpenRouter" (fallback page), proving the pages above are real entries

# --- chat completions rejected (key error) ---
$ curl -X POST https://openrouter.ai/api/v1/chat/completions \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"typesafe/jev-1.13","messages":[{"role":"user","content":"..."}]}'
{"error":{"message":"typesafe/jev-1.13 is a decisions model and cannot be used with the
 chat/completions endpoint. Use the /api/alpha/decisions endpoint instead.","code":400}}

# --- alpha decisions endpoint schema probe (zod errors reveal required fields) ---
$ curl -X POST https://openrouter.ai/api/alpha/decisions -d '{}'   # -> zod: model:string missing;
$ ... '{"model":"...","input":"..."}'                              # -> zod: state (string|record|array) missing

# --- Live call 1: dangerous command ---
$ time curl -X POST https://openrouter.ai/api/alpha/decisions \
    -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
    -d '{"model":"typesafe/jev-1.13","state":"...rm -rf /tmp/build","questions":{"safety":{
          "type":"choice","instructions":"...","criteria":{"allow":"...","deny":"...","ask":"..."}}}}'
{"model":"typesafe/jev-1.13-20260917","answers":{"safety":{"type":"choice","choice":"deny",
 "probabilities":{"deny":0.64,"allow":0.36},"confidence":0.29}},"usage":{"input_tokens":351,
 "output_tokens":33,"cost":0.000014742},"id":"gen-dec-...","provider":"TypeSafe"}          # 1.212s

# --- Live call 2: latest alias + benign read ---
$ ... -d '{"model":"~typesafe/jev-latest","state":"...read_file tests/engine.test.ts",...}'
{"model":"typesafe/jev-1.13-20260917","answers":{"verdict":{"choice":"allow",
 "probabilities":{"deny":0,"ask":0,"allow":1},"confidence":1}},"usage":{"input_tokens":448,
 "output_tokens":39,"cost":0.000018816},...}                                               # 1.320s

# --- Live call 3: credential read (F1 bypass case) ---
$ ... -d '{"model":"typesafe/jev-1.13-20260917","state":"Action: cat ~/.ssh/id_ed25519",...}'
{"model":"typesafe/jev-1.13-20260917","answers":{"verdict":{"choice":"deny",
 "probabilities":{"allow":0.01,"deny":0.96,"ask":0.03},"confidence":0.94}},
 "usage":{"input_tokens":353,"output_tokens":39,"cost":0.000014826},...}

# --- Key info (temporary key provided by the user) ---
$ curl -H "Authorization: Bearer $OPENROUTER_API_KEY" https://openrouter.ai/api/v1/key
{"data":{"limit":2,"usage":0,"is_free_tier":false,"expires_at":"2026-09-25T14:46:00.001Z",...}}
```

## Source list

- typesafe blog (model positioning/RLCD/pricing/latency claims): <https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- typesafe docs site and index: <https://docs.typesafe.ai/> , <https://docs.typesafe.ai/llms.txt> , quickstart (API shape/authentication): <https://docs.typesafe.ai/introduction/quickstart> , JS SDK: <https://docs.typesafe.ai/sdk/javascript.md> , patterns (confidence-gated routing / fan-out): <https://docs.typesafe.ai/patterns/confidence-routing.md>
- OpenRouter live tests (2026-09-18): `GET /api/v1/models`, `GET /api/v1/key`, `POST /api/v1/chat/completions` (400 error), `POST /api/alpha/decisions` (3 successful calls); model pages: <https://openrouter.ai/typesafe/jev-1.13> , <https://openrouter.ai/~typesafe/jev-latest>
- pi-jev extension (added 2026-09-18, section 7): <https://github.com/iefnaf/pi-jev> ; vendored client origin: <https://github.com/tamaratran/fast-jev-compaction>
- This repo: `extensions/pi-verdict.ts` (classifier contract 898-1001, resolveClassifier 1546-1563, completionFor 1044/1611), `research/pi-model-call-and-ref-implementations.md` (pi model call mechanism), `pi-verdict-code-review-2026-09-01.md` (F1 bypass case)
- Local pi official docs: `node_modules/@earendil-works/pi-coding-agent/docs/providers.md` (built-in openrouter provider), `docs/custom-provider.md` (registerProvider/custom API)
