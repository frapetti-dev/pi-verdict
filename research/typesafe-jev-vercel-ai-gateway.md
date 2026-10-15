# Research: second transport for the jev backend - feasibility of Vercel AI Gateway

> Research date: 2026-09-19
> Background: pi-verdict's jev classifier backend currently goes only through OpenRouter (`extensions/jev-adapter.ts` -> `POST https://openrouter.ai/api/alpha/decisions`, with credentials reused from pi's OpenRouter login state). The user asked: besides OpenRouter, can Vercel AI Gateway be supported at **low cost**, on the grounds that "pi-ai already has built-in support for Vercel AI Gateway".
> Source statement: all conclusions are verified against primary sources - the locally installed pi-ai source (0.84.3 and the latest npm 0.85.1 tarball), Vercel's official docs and changelog, the `@ai-sdk/gateway@4.0.87` SDK source, unauthenticated probes of the AI Gateway live `/v1/models` catalog and endpoints, the typesafe official docs quickstart, and this repo's source. This machine has no relevant API key (`AI_GATEWAY_API_KEY`/`TYPESAFE_API_KEY` are both unset), so no authenticated real calls were made; verification commands and output excerpts are in the appendix.

## Core Conclusions

1. **The user's premise is true, but it helps only a little**: pi-ai does ship a built-in `vercel-ai-gateway` provider (identical in 0.84.3 and the latest 0.85.1), but it is just another **chat-type provider** - the API is fixed to `anthropicMessagesApi()`, the model catalog has 237 entries and **no jev/evaluation entry**. Its only direct value for the jev backend is the **credential pipeline** (`/login vercel-ai-gateway` or `AI_GATEWAY_API_KEY`, exactly isomorphic to the existing OpenRouter reuse pattern); the transport itself is still carried by the adapter's own custom API, and "pi-ai built-in support" provides no decisions/evaluation call capability (an upstream grep finds no evaluation/decisions API implementation).
2. **The decisive fact is reversed**: Vercel AI Gateway **listed jev on 2026-09-16** - the live catalog (queryable without authentication) contains `typesafe-ai/jev`, type `evaluation`, input **$0.042/MTok** (the same price as measured on OpenRouter; the gateway claims zero markup on provider prices), output $0, with `zdr: "all"` / `no_training: "all"`. The pi-ai 0.85.1 catalog snapshot does not yet contain this model (the snapshot lags; it is not that the gateway has not listed it).
3. **But the gateway does not serve it through OpenAI/Anthropic-compatible endpoints**: the official docs state "Evaluation is available through the **AI SDK only**. It is not supported through the OpenAI-compatible, Anthropic-compatible, or Cohere-compatible endpoints". The wire contract was extracted from the open-source `@ai-sdk/gateway` source and verified live by unauthenticated probes: `POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model`, with the model in the **`ai-model-id` request header** (not in the body), body `{state, questions}`, response `{answers, usage{inputTokens,outputTokens}, warnings, providerMetadata}` (confidence in `providerMetadata.typesafe.confidence`).
4. **Conclusion: feasible, and low cost at single-file scale** - add one transport branch to `extensions/jev-adapter.ts`, an estimated **40-60 lines**, plus 4 documentation updates (README.md / README.zh-CN.md / docs/configuration.md / ADR-0003). pi-verdict itself (gate/classifier/contract) needs zero changes. The key mappings are almost ready-made: `verdictText()` already parses `{answers.verdict:{choice, probabilities, confidence}}`, isomorphic to the gateway response, **zero changes**; `mapUsage()` gets one camelCase branch; the request body drops the `model` field and adds 3 gateway headers.
5. **Risk is on par with, or an even weaker public commitment than, the OpenRouter alpha**: the gateway wire endpoint is not a documented public REST API (AI SDK only), the protocol version header is currently `0.0.1`, the spec is `v4`, and the AI SDK side marks it experimental; the catalog entry has `context_window`/`max_tokens` of 0 (usage is not validated against a model window, but there is no upstream window contract to rely on either). The implementation should centralize the endpoint/headers as constants and keep the `PI_VERDICT_JEV_URL` escape-hatch semantics (taking a default per transport).
6. **If the goal is only to "get away from OpenRouter"**, the third route, typesafe direct (`POST api.typesafe.ai/v1/systemone`, `TYPESAFE_API_KEY`, self-service keys at console.typesafe.ai), is the path with the smallest schema difference and the best official stability commitment - the request body is fully isomorphic to OpenRouter decisions (only the `model` value changes from `~typesafe/jev-latest` to `jev-latest`). The incremental value of the gateway path lies in the Vercel ecosystem (credits/budgets/request logs/team management, ZDR/No-Training declarations).

---

## 1. Verifying the premise: what the built-in vercel-ai-gateway provider in pi-ai actually is

This repo's devDeps use `@earendil-works/pi-coding-agent@0.84.3` (`package.json:59`), which depends on `@earendil-works/pi-ai`. The full provider definition (verbatim identical in 0.84.3 and the 0.85.1 tarball):

```js
// node_modules/@earendil-works/pi-ai/dist/providers/vercel-ai-gateway.js
export function vercelAIGatewayProvider() {
    return createProvider({
        id: "vercel-ai-gateway",
        name: "Vercel AI Gateway",
        baseUrl: "https://ai-gateway.vercel.sh",
        auth: { apiKey: envApiKeyAuth("Vercel AI Gateway API key", ["AI_GATEWAY_API_KEY"]) },
        models: Object.values(VERCEL_AI_GATEWAY_MODELS),
        api: anthropicMessagesApi(),
    });
}
```

- Provider id `vercel-ai-gateway`, baseURL `https://ai-gateway.vercel.sh`, authentication environment variable **`AI_GATEWAY_API_KEY`** (`dist/env-api-keys.js:88`).
- **The API type is fixed to `anthropicMessagesApi()`** (i.e. the Anthropic Messages chat protocol; pi-ai's KnownProvider list is at `dist/types.d.ts:19`). pi-ai has no second gateway API - there is no implementation for modalities other than chat completions / messages / embeddings (such as evaluation); a full grep of the 0.85.1 tarball for `evaluate|evaluation` has no relevant hits.
- The model catalog comes from `dist/providers/data/vercel-ai-gateway.json` (script-generated, mounted at `models.generated.js:34,74`): the only top-level group key is **`anthropic-messages`**, with **237 models** in total, and **grep for `jev|typesafe|decision` gives 0 hits**. The snapshot of the latest published `@earendil-works/pi-ai@0.85.1` (npm view, 2026-09-19) is the same - even if the user upgrades to the latest pi, the built-in provider still **cannot see jev**.
- Credentials/login: pi's official docs `docs/providers.md:86` list this provider - `/login` (stored in auth.json, key name `vercel-ai-gateway`) or the environment variable `AI_GATEWAY_API_KEY`. This means that if the jev adapter goes through the gateway, it can **copy the existing OpenRouter credential reuse pattern**: `ctx.modelRegistry.getProviderAuth("vercel-ai-gateway")` + an environment variable fallback.
- The upstream repo is now **earendil-works/pi** (confirmed via `gh api repos/earendil-works/pi`; the old badlogic/pi-mono links in the repo redirect to it). The only recent gateway-related commit is "fix(ai): preserve Vercel AI Gateway unsigned thinking", with no trace of evaluation/decisions plans.

**Verdict**: "pi-ai already has built-in Vercel AI Gateway support" holds for an **ordinary LLM classifier** and is usable today - pointing `classifierModel` at any gateway chat model in the registry is enough (via `modelRegistry`, zero change to pi-verdict, not tested live); but for the **jev backend**, the built-in provider cannot help with the transport - decisions/evaluation-type calls must be implemented by the adapter's own custom API, and the only reusable part is the credential resolution pipeline.

## 2. The decisive question: does Vercel AI Gateway carry jev - yes, as a first-class modality

- **Live catalog confirmation** (`GET https://ai-gateway.vercel.sh/v1/models`, the official docs note this endpoint needs no authentication): 372 models in total, including:

```json
{
  "id": "typesafe-ai/jev",
  "owned_by": "typesafe-ai",
  "name": "Jev",
  "type": "evaluation",
  "supported_specifications": ["v4"],
  "context_window": 0,
  "max_tokens": 0,
  "zdr": "all",
  "no_training": "all",
  "pricing": { "input": "0.000000042", "output": "0" }
}
```

  - `0.000000042 $/token × 1e6 = **$0.042/MTok**`, consistent with the OpenRouter measurement (`research/typesafe-jev-classifiermodel.md` section 5, `extensions/jev-adapter.ts:184-185`); the gateway claims "adds zero markup to provider token prices" (docs/ai-gateway). Output is billed at $0.
- **Official changelog**: "TypeSafe AI's Jev now available on AI Gateway" (2026-09-16) - model id `typesafe-ai/jev`, called through the experimental `evaluate` API of AI SDK 7 (supported since `ai@7.0.105`), confidence in `result.providerMetadata.typesafe.confidence`, requests enter the gateway's logs/reporting/budgets; the only stated caveat is that the API is experimental.
- **Docs surface**: the gateway files it under the new **Evaluation modality** (docs/ai-gateway/modalities -> evaluation page): "Evaluate shared state against typed questions and get structured answers back" - question types `choice` (criteria is an option -> description record, the answer contains `choice` + per-option `probabilities`), `score`, `boolean` (returns a 0-1 `probability`); one request can ask multiple questions in parallel; `state` accepts string/object/array. This is semantically consistent with the `choice` question structure that jev-adapter currently sends to OpenRouter (`VERDICT_QUESTIONS`, `extensions/jev-adapter.ts:51-63`).
- **Key limitation** (verbatim from the evaluation docs page): "Evaluation is available through the AI SDK only. It is not supported through the OpenAI-compatible, Anthropic-compatible, or Cohere-compatible endpoints." - i.e. neither `/v1/chat/completions` nor `/v1/messages` carries jev (live probes show both routes exist but return 400 for an empty body; `/api/alpha/decisions` and `/v1/decisions` return 404 on the gateway domain - OpenRouter's proprietary path does not exist here).

## 3. Wire contract: extracted from @ai-sdk/gateway source + verified live without authentication

Officially, evaluation is not documented as a public REST API, but `@ai-sdk/gateway@4.0.87` (MIT, open source) provides the complete contract. `GatewayEvaluationModel` (dist/index.js):

- **URL**: `${baseURL}/evaluation-model`, with `baseURL` defaulting to `https://ai-gateway.vercel.sh/v4/ai` => **`POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model`** (`/v4` corresponds to the catalog field `supported_specifications: ["v4"]`).
- **Request headers**: `Authorization: Bearer <key>`; the global `ai-gateway-protocol-version: 0.0.1` (constant `AI_GATEWAY_PROTOCOL_VERSION`); the model-specific `ai-evaluation-model-specification-version: 4` and **`ai-model-id: typesafe-ai/jev`** (the model is in the header; the body has no model field).
- **Request body**: `{ state, questions, providerOptions? }`.
- **Response schema** (zod): `{ answers: Record<string, {type:'choice', choice, probabilities?} | {type:'score', score, probabilities?} | {type:'boolean', probability}>, rounding?, usage?: {inputTokens?, outputTokens?}, warnings?, providerMetadata? }` - note that usage is camelCase and has **no cost field** (billing goes through Vercel credits; per-call cost is not returned in the response); the changelog says confidence is in `providerMetadata.typesafe.confidence`.

**Live verification** (no key on this machine, so the contract is confirmed indirectly via error responses, 2026-09-19):

| Probe | Result |
|---|---|
| `POST /v4/ai/evaluation-model`, without the protocol header | `400 {"error":{"message":"Unsupported gateway protocol version"}}` |
| Same as above, with `ai-gateway-protocol-version: 0.0.1` + spec header + `ai-model-id`, empty body | `400` zod error requiring `state: string` and `questions: record` field by field - **matches the SDK source schema verbatim** |
| `GET /v4/ai/evaluation-model` | `405` (route exists) |
| `GET /v1/models` without authentication | `200`, 372 models including typesafe-ai/jev |

No authenticated 200 real call was made (no credentials); the probes above confirm the three elements of route, protocol header, and body schema, and the only remaining unknown is whether the success response has additional fields beyond the SDK schema.

## 4. Low-cost support path: change list

All changes are concentrated in the single file `extensions/jev-adapter.ts` (currently 255 lines), with zero changes to the core:

1. **Transport selection**: add an environment variable (e.g. `PI_VERDICT_JEV_TRANSPORT=openrouter|vercel|typesafe`, defaulting to `openrouter` to keep the status quo). The community precedent iefnaf/pi-jev's `JEVC_PROVIDER` selector design can serve as a reference (README: "auto-detected; when both keys are present TypeSafe takes priority").
2. **Endpoint and request headers**: the gateway branch defaults to URL `https://ai-gateway.vercel.sh/v4/ai/evaluation-model` (keeping the `PI_VERDICT_JEV_URL` escape-hatch semantics, taking a different default per transport; the current `DECISIONS_URL` logic is at `extensions/jev-adapter.ts:43`). Add the request headers `ai-gateway-protocol-version` / `ai-evaluation-model-specification-version` / `ai-model-id` (model id `typesafe-ai/jev`). `buildDecisionsBody()` (:87-89) **drops the `model` field** in the gateway branch.
3. **Credential resolution**: copy the OpenRouter pattern (:210-222) - `getProviderAuth("vercel-ai-gateway")` + an `AI_GATEWAY_API_KEY` fallback; the availability check logic re-registered on `session_start` (:239-245) is unchanged. pi already supports `/login vercel-ai-gateway` (`docs/providers.md:86`), so users do not need to manage a key outside pi.
4. **Response mapping**:
   - `verdictText()` (:102-116) **needs zero changes** - the gateway's `{answers:{verdict:{type:'choice',choice,probabilities}}}` is isomorphic to the existing parsing; the `confidence` field is not in the gateway answer body and must be read additionally from `providerMetadata?.typesafe?.confidence` (about 3 lines; when missing, the existing logic already degrades gracefully by omitting confText).
   - `mapUsage()` (:118-131) gets a camelCase branch (`inputTokens`/`outputTokens` -> the existing snake_case fields; `cost` is always 0 because the gateway does not return per-call cost - the cost display in `notifyAllows`/audit must accept this difference, or the docs must note it).
5. **Docs**: README.md and README.zh-CN.md, the "Provider: OpenRouter only, for now" subsection (README.md:129), the host/provider notes in docs/configuration.md, and an appended gateway transport appendix in ADR-0003. The npm package has no new files (the `package.json:8-14` files list is unchanged).

The estimated code size is **40-60 lines** (including types and error messages), doable in one PR; tests follow the existing `bun test` pure-function style for `buildDecisionsBody`/`verdictText`, adding 2-3 cases for gateway response samples.

## 5. Comparison of the three transports

| Dimension | OpenRouter (status quo) | Vercel AI Gateway | typesafe direct |
|---|---|---|---|
| Endpoint | `POST openrouter.ai/api/alpha/decisions` | `POST ai-gateway.vercel.sh/v4/ai/evaluation-model` | `POST api.typesafe.ai/v1/systemone` |
| Stability commitment | alpha endpoint, schema may change at any time (stated in both changelog and live tests) | **AI SDK only** (no public REST commitment); protocol `0.0.1` / spec `v4` / experimental | official v1 stable API |
| Request body | `{model: "~typesafe/jev-latest", state, questions}` | `{state, questions}` + `ai-model-id` header | `{model: "jev-latest", state, questions}` (isomorphic to OpenRouter) |
| Response differences | `answers.verdict` + `usage{input_tokens, output_tokens, cost}` | `answers.verdict` (no confidence in the body) + `usage{inputTokens, outputTokens}` (no cost) + `providerMetadata.typesafe.confidence` | `answers` (with confidence) + `usage` |
| Account/credentials | reuses pi's OpenRouter login state, zero additions | Vercel account + credits (or team BYOK); pi `/login vercel-ai-gateway` already supported | typesafe account + self-service key at `console.typesafe.ai/keys` |
| Pricing | $0.042/MTok input, output $0 (usage.cost settled in live tests) | same price, gateway zero markup; no per-call cost returned, goes through credits/budgets | same pricing basis (blog/earlier research) |
| Data governance | OpenRouter-side policy | catalog declares `zdr: "all"`, `no_training: "all"` | official ZDR policy (docs) |
| Incremental value | - | Vercel ecosystem budgets/logs/team management/failover | shortest dependency chain, official support channel |

## 6. Risks and Recommendations

1. **Wire stability**: the public commitment of the gateway evaluation contract is weaker than the OpenRouter alpha (which at least has API docs and a catalog page). When implementing, it is recommended to: (a) centralize the endpoint, protocol header, and spec version as constants at the top of the adapter, with a comment pointing to the source (@ai-sdk/gateway version); (b) keep fail-closed on the failure path (already guaranteed today - an exception in `streamDecisions` becomes an error event and the classifier falls back). 2. **Catalog lags behind live**: the pi-ai generated catalog does not contain jev, which would cause friction if pi later validates model existence; the adapter's self-registered model skips catalog validation (today `hasConfiguredAuth` only checks credentials), so it is harmless. 3. **Ordering suggestion**: if the adapter is to be touched soon, the typesafe direct branch (official v1, isomorphic body, smaller change) and the gateway branch can be made into the same transport selector in the same PR; if only one is picked, the case for the gateway is reusing pi's login state with no new account + Vercel budget management, and the case for typesafe is stability. This is a product trade-off, not a technical constraint. 4. **Upstream push (optional)**: file an issue with earendil-works/pi requesting an evaluation API type in pi-ai (aligned with the AI SDK v4 spec); once that works, the adapter's custom API can be retired (to be filed together with the decisions-type issue suggested in the earlier research).

## Appendix: verification commands and output excerpts

```bash
# 1. live catalog (no authentication; official statement that the endpoint is auth-free)
$ curl -sS https://ai-gateway.vercel.sh/v1/models | python3 -c "…"
total models: 372
jev/typesafe/systemone: ['typesafe-ai/jev']   decision*: []
# providers: ['alibaba', …, 'typesafe-ai', …]

# 2. endpoint route probes (2026-09-19, no authentication)
$ POST https://ai-gateway.vercel.sh/v4/ai/evaluation-model   # without protocol header
-> 400 {"error":{"message":"Unsupported gateway protocol version"}}
$ POST same as above + 'ai-gateway-protocol-version: 0.0.1' + spec/model headers + '{}'
-> 400 zod: state expected string / questions expected record
$ GET  /v4/ai/evaluation-model -> 405
$ POST /api/alpha/decisions, /v1/decisions (gateway domain) -> 404
$ POST /v1/chat/completions, /v1/messages -> 400 (route exists)

# 3. pi-ai version and snapshot
$ npm view @earendil-works/pi-ai version -> 0.85.1
$ python3 … /pi-ai-0.85.1/.../data/vercel-ai-gateway.json
top keys: ['anthropic-messages']  -> 237 models
jev hits: 0  typesafe hits: 0  decision hits: 0

# 4. @ai-sdk/gateway@4.0.87 key source (dist/index.js after npm pack)
getUrl() { return `${this.config.baseURL}/evaluation-model`; }
baseURL ?? "https://ai-gateway.vercel.sh/v4/ai"
AI_GATEWAY_PROTOCOL_VERSION = "0.0.1"
getModelConfigHeaders() { return { "ai-evaluation-model-specification-version": "4", "ai-model-id": this.modelId }; }
body: { state, questions, ...providerOptions ? { providerOptions } : {} }
gatewayEvaluationAnswerSchema = z.discriminatedUnion("type", [ choice{choice, probabilities?}, score{score, probabilities?}, boolean{probability} ])
usage: z.object({ inputTokens: optional, outputTokens: optional }).optional()

# 5. credential environment variable check (names only)
AI_GATEWAY_API_KEY: unset  VERCEL_AI_GATEWAY_API_KEY: unset  TYPESAFE_API_KEY: unset
```

Local source references:
- `node_modules/@earendil-works/pi-ai/dist/providers/vercel-ai-gateway.js` (full provider, 0.84.3; same in the 0.85.1 tarball)
- `node_modules/@earendil-works/pi-ai/dist/env-api-keys.js:88`, `dist/models.generated.js:34,74`, `dist/types.d.ts:19`, `dist/providers/data/vercel-ai-gateway.json`
- `node_modules/@earendil-works/pi-coding-agent/docs/providers.md:86` (gateway login/env/auth.json line)
- `extensions/jev-adapter.ts:37-43, 51-63, 87-89, 102-116, 118-131, 148-157, 200-230, 239-245`
- Earlier research: `research/typesafe-jev-classifiermodel.md` (OpenRouter alpha live tests, pricing, ADR basis)

External primary sources:
- <https://vercel.com/docs/ai-gateway> (endpoint/zero markup/BYOK/budgets)
- <https://vercel.com/docs/ai-gateway/modalities> and <https://vercel.com/docs/ai-gateway/modalities/evaluation> ("AI SDK only" statement, question types, usage)
- <https://vercel.com/docs/ai-gateway/models-and-providers> (`/v1/models` needs no authentication, model id format)
- <https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway> (2026-09-16, `ai@7.0.105+`, providerMetadata.typesafe.confidence, experimental)
- `@ai-sdk/gateway@4.0.87` (npm, dist/index.js - wire contract)
- <https://docs.typesafe.ai/introduction/quickstart> (`POST api.typesafe.ai/v1/systemone`, Bearer, console.typesafe.ai/keys, `jev-latest`, `{state, model, questions}`)
- <https://github.com/iefnaf/pi-jev> (dual-transport precedent, `TYPESAFE_API_KEY`/`JEVC_PROVIDER`)
- `gh api repos/earendil-works/pi` (current upstream repo name; related commit "fix(ai): preserve Vercel AI Gateway unsigned thinking")
