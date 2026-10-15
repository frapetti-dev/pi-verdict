# Research: Pi extension model-call API, config reading, and implementation extraction from three permission extensions

> Related issue: #2 (Part of #1)
> Research date: 2026-08 (based on the locally installed versions: `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai@0.84.3`)
> All conclusions were verified against primary sources: the locally installed official Pi docs and dist types/implementation, the npm package sources of the three extensions (unpacked via `npm pack`), and GitHub repository clones (located at `/Volumes/RamDisk/pi-research/`).

## TL;DR

1. **Model calls**: an official helper already exists -- `ctx.modelRegistry.complete(model, context, options)` (resolves credentials internally); just pass `ctx.signal` as `options.signal`. "Introspection" (inheriting the session model + credentials) = pass `ctx.model` as the model; `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` fetches credentials explicitly. There is no need to fetch the provider API yourself.
2. **Config reading**: `settings.json` has **no** extension-facing API for custom keys (there is no settings accessor on `ExtensionContext`). Official approaches: an extension-owned config file (global under `getAgentDir()`; project-level under `.pi/`, with the path built from `CONFIG_DIR_NAME` and gated by `ctx.isProjectTrusted()`), the `pi.registerFlag()/pi.getFlag()` CLI flags, and environment variables (`process.env`). All three reference extensions take the "own JSON config file" route.
3. **Reference implementations**: the prompts, rule sets, cache/circuit breaker, and verdict contracts of the three extensions were extracted file by file (see Section 3); the end of this document gives a "rule-layer seed set" that can be adopted directly.

---

## 1. Model-call mechanism (sub-question 1)

### 1.1 Official helper: `ctx.modelRegistry.complete()` -- no need to fetch yourself

`ExtensionContext.modelRegistry` is an instance of the `ModelRegistry` class, with this type declaration (local `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:33`):

```typescript
complete<TApi extends Api>(model: Model<TApi>, context: Context, options?: ModelsApiStreamOptions<TApi>): Promise<AssistantMessage>;
```

The same file also declares the credential-resolution methods:

- `getApiKeyAndHeaders(model)` → `Promise<ResolvedRequestAuth>` (`{ ok: true; apiKey?; headers?; baseUrl?; env? } | { ok: false; error }`) (`model-registry.d.ts:11-16, 29`)
- `getProviderAuth(provider)` → `Promise<AuthResult | undefined>` ("resolves its current API key, headers, base URL, and provider-scoped environment without requiring a loaded model") (`model-registry.d.ts:35`; docs `docs/extensions.md:995-997`)
- `find(provider, modelId)`, `hasConfiguredAuth(model)`, `getProvider(provider)` (`model-registry.d.ts:27-34`)

**Credentials are resolved internally; the extension never needs to touch the API key.** Implementation chain: `ModelRegistry.complete()` → `ModelRuntime.complete()` → `stream()` → `prepareRequest()` (`dist/core/model-runtime.js:422-451`); the latter calls `this.getAuth(model, ...)` to resolve `apiKey/headers/baseUrl/env` and injects them into the provider request. The credential lookup order (auth.json → environment variables → models.json custom providers) is in `docs/sdk.md:445-448`.

`options` (via `ModelsApiStreamOptions` → `StreamOptions` → `ProviderRequestOptions`) supports:

- `signal?: AbortSignal` (`@earendil-works/pi-ai/dist/types.d.ts:53`) -- pass `ctx.signal` directly, and Esc cancels the nested model call (the docs at `docs/extensions.md:1001-1011` explicitly list "model calls that accept `signal`")
- `cacheRetention?: "none" | "short" | "long"`, `sessionId?: string` (`pi-ai/dist/types.d.ts:128-137`) -- prefix caching and session affinity
- `reasoningEffort`, `maxTokens`, `temperature`, `timeoutMs`, etc.

**Official example**: `examples/extensions/summarize.ts:163-187` fully demonstrates a standalone model call inside an extension:

```typescript
const model = ctx.modelRegistry.find("openai", "gpt-5.2");
if (!ctx.modelRegistry.hasConfiguredAuth(model)) { /* degrade */ }
const response = await ctx.modelRegistry.complete(
  model,
  { messages: summaryMessages },
  { reasoningEffort: "high", cacheRetention: "none", sessionId: uuidv7() },
);
// take the blocks with type === "text" from response.content
```

### 1.2 Implementing "introspection" (inheriting the current session provider/model + credentials)

`ctx.model` is the active model of the current session (`docs/extensions.md:995-997`; "`ctx.model` is the active model"). So the simplest form of an introspective call is:

```typescript
pi.on("tool_call", async (event, ctx) => {
  if (!ctx.model) return { block: true, reason: "no active model" };
  const response = await ctx.modelRegistry.complete(
    ctx.model,                                   // inherit the session's current provider/model
    { messages: [/* verdict prompt */] },
    { signal: ctx.signal, cacheRetention: "short",
      sessionId: ctx.sessionManager.getSessionId(),
      temperature: 0, maxTokens: 80 },
  );
  // credentials are resolved inside ModelRuntime.prepareRequest; no need to read the API key
});
```

If you need the credentials explicitly (for example to bypass the registry and call the provider directly), use `await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` -- it is a discriminated union, so you must narrow with `if (!auth.ok)` first and then take `apiKey/headers/env` (pi-llm-shared `src/call.ts:95-99` uses exactly this).

### 1.3 Alternative paths (actually used by the three reference extensions)

| Path | Used by | Notes |
|---|---|---|
| `ctx.modelRegistry.complete()` | official example summarize.ts | **Recommended**. Credentials resolved internally; stable API (class method, not deprecated) |
| `ctx.modelRegistry.getProvider(id).streamSimple(model, ctx, opts).result()` | pi-permission-ai-guard `src/model-review.ts:78-88` (`createCompleteSimple`) | Not deprecated; the caller must run `getApiKeyAndHeaders` itself and inject `apiKey/headers` |
| `completeSimple` from `@earendil-works/pi-ai/compat` | @zhushanwen/pi-llm-shared `src/call.ts:17` | compat is a "temporary compatibility entry point" (header comment in `pi-ai/dist/compat.d.ts:1-10`: "This module is deleted with the coding-agent ModelManager migration"); `completeSimple`/`streamSimple` are declared at `compat.d.ts:65-66` |
| `completeSimple` from `@earendil-works/pi-ai` (package root) | wangzexi/pi-auto-approve `auto-approve.ts:18` | **Compatibility risk**: the pi-ai@0.84.3 package root no longer exports `completeSimple` (measured: `typeof === "undefined"` after `import()`); the extension was written against an older pi-ai. Do not use in new code |

On billing/accounting for nested calls: if a nested LLM call is made from inside a **custom tool**, `usage` can be reported in the tool result (`docs/extensions.md:1995`); the `tool_call` hook scenario has no such channel; noted for reference only.

On parallel tool calls: when `tool_call` fires, `ctx.sessionManager` is already synced to the current assistant message, but it is not guaranteed to include sibling tool results from the same batch (`docs/extensions.md:764-766`). A throwing `tool_call` handler fail-safes by blocking that tool (`docs/extensions.md:2904`).

---

## 2. Config reading (sub-question 2)

### 2.1 settings.json has no extension custom-key API

Complete field list of `ExtensionContext` (`dist/core/extensions/types.d.ts:209-249`): `ui / mode / hasUI / cwd / sessionManager / modelRegistry / model / scopedModels / thinkingLevel / isIdle() / isProjectTrusted() / signal / abort() / hasPendingMessages() / shutdown() / getContextUsage() / compact() / getSystemPrompt()` -- **no settings accessor at all**. The "All Settings" table in `docs/settings.md` also has no mechanism for extension custom keys. Conclusion: settings.json only takes effect for Pi's built-in keys; extensions should not stuff custom config into it.

### 2.2 Four officially accepted approaches

1. **Extension-owned JSON config file (project-level)** -- the only approach the docs explicitly demonstrate (`docs/extensions.md:958-973`):

   ```typescript
   import { CONFIG_DIR_NAME, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
   const projectConfigPath = join(ctx.cwd, CONFIG_DIR_NAME, "my-extension.json");
   ```

   Before reading project-level config, gate with `ctx.isProjectTrusted()` (`docs/extensions.md:976-980`: "Use this before reading project-local extension configuration that should only be honored for trusted projects").

2. **Extension-owned config file (global-level)** -- `getAgentDir()` is an official export (re-exported at `dist/index.d.ts:2`; `dist/config.d.ts:77`) that returns the Pi agent directory (default `~/.pi/agent`, honoring the `PI_CODING_AGENT_DIR` environment variable). The extension creates its own subpath under this directory to store config.

3. **CLI flags** -- `pi.registerFlag(name, { description, type, default })` + `pi.getFlag(name)` (`docs/extensions.md:1633-1648`), suited to switch-style config (such as plan-mode's `--plan`).

4. **Environment variables** -- an extension is in-process Node code and can use `process.env` directly (official example: `examples/extensions/interactive-shell.ts:102,105` uses `INTERACTIVE_COMMANDS` / `INTERACTIVE_EXCLUDE`).

### 2.3 What the reference extensions actually do (all verified)

| Extension | Config location | Mechanism |
|---|---|---|
| @zhushanwen/pi-permission | `<agentDir>/config/permission-ext-config.json` | Derived via `getAgentDir()`; default config auto-created on first run; fields: `mode(yolo/auto/approve/strict)`, `enabled`, `classifier.{enabled,model,timeout,autoApproveLowRisk,autoDenyHighRisk,thinkingLevel}`, `userRules[]` (`src/config.ts:6-14, 44-46`; README) |
| pi-permission-ai-guard | global `<agentDir>/extensions/pi-permission-ai-guard/config.json` + project `<cwd>/.pi/extensions/pi-permission-ai-guard/config.json` | Two-layer read, deep merge (project overrides global), zod validation; the project layer is skipped when `trustedProject: false` (`src/config-loader.ts:50-58, 111-145`); invalid config → verdict chain is not registered (fail-safe degradation to no automatic review, never a wrong verdict) |
| wangzexi/pi-auto-approve | no config file | Only the `/autoapprove` command toggling an in-memory switch + the `PI_AUTO_APPROVE_DEBUG_REVIEW` environment variable (`auto-approve.ts:69-71, 224-230`) |

---

## 3. Reference implementation extraction (sub-question 3)

Research copies: `/Volumes/RamDisk/pi-research/{pi-permission, pi-llm-shared, pi-permission-ai-guard, pi-auto-approve, pi-packages}`.

### 3.1 `@zhushanwen/pi-permission@1.3.3` -- three-layer pipeline (AST + rules + AI classifier)

**Architecture**: `checkPermission()` is the pure-function main entry (`src/pipeline.ts:411`), with four modes:

- `yolo`: allow everything; `strict`: manual approval for everything;
- `approve`: Layer 1 AST → Layer 2 rules (allow passes / deny rejects / ask → human, no AI);
- `auto`: Layer 1 AST → Layer 2 rules → on ask, Layer 3 "AI classifier **races** user approval" (`runLayer3WithRacing`, `pipeline.ts:229`).

**Overall fail-closed principle**: any exception path → ask (auto) or manual, never a silent allow; in headless (json/print) mode, an AI ask result → fail-closed deny (`pipeline.ts:267-281`).

**Layer 1 -- AST structural analysis** (`src/ast/analyzer.ts`): a faithful port of Codex `bash.rs` `try_parse_word_only_commands_sequence` using web-tree-sitter. Allowlist of 11 named nodes (program/list/pipeline/command/command_name/word/string/string_content/raw_string/number/concatenation) + 6 punctuation tokens (`&&` `||` `;` `|` `"` `'`); any other structure (command_substitution/file_redirect/subshell/backticks/redirects, etc.) → `clean: false`, sent straight downstream. Input over 65536 characters or a parse failure → fail-closed (`analyzer.ts:31-57`). Produces `commands: string[][]` (splits a compound command into individual argv).

**Layer 2 -- rule matching** (`src/rules/`):

- **Allowlist = function predicate, not regex**: `isKnownSafeCommand(argv)` (`builtins.ts:535`) = 50 unconditionally safe commands (`BUILTIN_UNCONDITIONAL_SAFE`, `builtins.ts:37-89`: cat/ls/grep/find (note: find is actually in the conditional group)/head/tail/wc/jq, etc.) + 9 conditional commands with argv-level flag sub-checks (`builtins.ts:91-101`: base64 forbids `-o/--output` and merged short-flag clusters containing `o`; find forbids `-exec/-delete/-fprint*`; rg forbids `--pre/--hostname-bin/-z`; git allows only the read-only subcommands `status/log/diff/show/branch` and forbids global options such as `-C/-c/--exec-path`; sed only `sed -n {N|M,N}p`; sort/iconv/shuf forbid `-o`; date forbids `-s`). Ported from codex-rs `is_safe_command.rs`.
- **Danger rules = 12 regexes** (`BUILTIN_DANGER_RULES`, `builtins.ts:552-666`): bd-001 `rm` with a recursive flag; bd-002 `sudo`; bd-003 `chmod 777/a+rwx/ugo+rwx`; bd-004 raw device writes (`> /dev/sd*` / `dd of=/dev/*`); bd-005 `git push --force`; bd-006 `git reset --hard`; bd-007 `git clean -f`; bd-008 `git checkout .`; bd-009 `git restore`; bd-010 `curl|wget ... | sh/bash`; bd-011 `gh repo create/delete/rename/archive`; bd-012 `gh release create/delete/edit`. All `action: "deny"`, compiled with `new RegExp(pattern, "i")`.
- **Aggregation semantics** (`runLayer2`, `pipeline.ts:130-166`): match per argv; any deny → overall deny; all allow → allow; otherwise ask. **C1 addition**: run the deny check once more on the full command string, to cover `curl x | sh` (bd-010), which a single argv cannot see after the AST splits on the pipe. For non-bash tools: the `tool` field is wildcard-matched against toolName and the `pattern` field against path (`matchNonBashTool`, `pipeline.ts:85-107`).
- User-defined rules: OpenCode wildcard syntax, last-match-wins.

**Layer 3 -- AI classifier** (`src/classifier/`):

- **Classification prompt** (`prompt.ts:23-38`, full text):

  ```
  You are a security risk classifier for tool invocations in an AI coding agent.
  Evaluate the given tool invocation for destructive or unsafe operations.

  Reply with ONLY a JSON object (no markdown, no prose before/after):
  {"outcome": "allow" | "deny" | "ask", "risk_level": "low" | "medium" | "high", "reasoning": "one short sentence", "confidence": 0.0-1.0}

  Rules:
  - allow: safe operations (read-only commands, writing to project directory, git status/diff/log, ls, cat, echo, grep, find)
  - deny: clearly destructive AND irreversible (rm -rf /, mkfs, force push to main, drop database, format disk)
  - ask: potentially dangerous or system-wide changes (rm with recursion, sudo, writing to system dirs like /etc, network operations, deleting multiple files)
  - For file writes: allow if writing to user's project/cwd directory; ask if writing to system dirs or sensitive paths (~/.ssh, /etc)
  - confidence = your certainty in the outcome (0.0 = guessing, 1.0 = certain)
  ```

  The comments note it is deliberately kept at ~80 tokens to reduce first-call latency. The user prompt is four or five lines of key-value pairs `tool/command/path/cwd(/agent)` (`prompt.ts:41-52`).
- **Risk-level contract**: `ClassifierResult { outcome: allow|deny|ask, risk_level: low|medium|high, reasoning: string, confidence: 0-1 }`. **Bias patch** (`applyAutoApproveOverrides`, `pipeline.ts:181-201`): `high + allow + autoDenyHighRisk=true` → forced deny; `low + allow + autoApproveLowRisk=false` → forced ask. That is, the AI's allow cannot be trusted at high risk.
- **Model resolution**: `classifier.model: "auto"` = take the first available model with credentials from the session's scopedModels, otherwise specify exactly as `provider/model-id`; goes through `ctx.modelRegistry` (`find` + `hasConfiguredAuth`) and does not read models.json itself (`src/classifier/model-resolver.ts:12-26, 60-97`; README).
- **LLM call**: via @zhushanwen/pi-llm-shared `callLLM` (`pi-llm-shared/src/call.ts:88-132`): `completeSimple` (compat subpath) + `getApiKeyAndHeaders` to inject credentials; `stopReason: error/aborted` normalized to `{ok:false, stopReason}`; the outer layer adds a timeout + signal race as a backstop against hanging forever (`classifier.ts:92-130`). All failures → fail-closed `{outcome:"ask", risk_level:"medium", confidence:0}`.
- **Parse tolerance**: three stages -- greedy regex extraction of JSON → `JSON.parse` → field enum validation (confidence clamped to [0,1]); any failure → fallback ask (`src/classifier/json-parser.ts:1-26`).
- **Race semantics** (`pipeline.ts:229-403`): the AI and user approval start simultaneously; user answers first → abort the AI; AI answers allow/deny first → close the dialog and follow the AI result; AI answers ask → hand off to a human (5-minute timeout backstop, fail-closed deny).

### 3.2 `pi-permission-ai-guard@0.7.0` (kuoruan) -- context trimming against injection, verdict cache, circuit breaker

**Positioning**: a non-terminal link in the Authorizer chain of `@gotgenes/pi-permission-system` (`src/review-pipeline.ts`; link contract `AuthorizerVerdict = allow | deny(reason?) | defer`, see pi-packages `pi-permission-system/src/authority/authorizer.ts:20-41`). It only works when the deterministic rule engine's verdict is "ask"; if the engine already allowed/denied → defer immediately (`review-pipeline.ts:92-103`). All failures → defer (hand off to the next link/human), not deny.

**Context trimming (the core of injection defense)** (`src/transcript-stripper.ts:171-249`, `stripTranscript`): session entries are handled by trust level --

- **Keep (trusted)**: `user` messages; `ask_user_question` tool results (the user's structured answers);
- **Remove (untrusted)**: assistant text (only tool call names + arguments are extracted), ordinary toolResults (injection entry point and heaviest in tokens), compaction/branch_summary (derived context, not a user authorization signal), custom messages;
- **Limits**: the most recent 5 user messages, 10 tool calls, 1000 characters each (truncated head 60% + tail 40%) (defaults, `src/config-schema.ts:15-19`);
- **Sanitization** (`src/utils.ts`): `normalizeText` strips zero-width characters (U+200B-200D/2060/FEFF) + collapses all whitespace to a single space (prevents newlines from forging prompt section headings, `utils.ts:116-118`); `redactSecrets` masks ~20 classes of secret patterns (AWS/Anthropic/OpenAI/GitHub/GitLab/Slack/Google/Stripe/PEM private key blocks/Bearer, etc., `utils.ts:20-69`) + `password|token|api_key|...` key-value pairs (`utils.ts:76-77`); action text uses `encodeActionTextForPrompt` = JSON.stringify escaping then inlined (`utils.ts:150-152`), which preserves shell whitespace without letting it create new prompt sections.

**Verdict prompt** (`src/prompt.ts`):

- system = `SAFETY_RULES` (prompt.ts:34-176) + fixed `VERDICT_SECTION` (prompt.ts:179-193; custom instructions can only replace the rules part, the output contract cannot be overridden).
- SAFETY_RULES has three tiers by **intent dependence**: `DENY — Always` (regardless of intent: secret/credential reads, irreversible destruction, sensitive data exfiltration, system tampering and security weakening, persistent system changes, external code execution `curl|bash`/remote package installs, externally exposed listeners, destructive VCS, resource abuse), `DENY — Unless` (allowed only with a clearly matching intent: writes outside CWD, environment changes, deletion, network/browser interaction, external publishing, MCP/skill side effects), and `ALLOW` (matches the current task: read-only inside CWD, limited in-project writes, project toolchain, non-destructive local VCS). Compound commands are evaluated segment by segment, taking the strictest tier; an encoded/obfuscated payload whose effect cannot be decoded → defer.
- **Verdict JSON contract** (VERDICT_SECTION):

  ```json
  {"verdict":"allow"}
  {"verdict":"deny","reason":"<risk; safer alternative if useful>","riskLevel":"low|medium|high|critical"}
  {"verdict":"defer","reason":"<what needs clarification>"}
  ```

  Parse failure/invalid fields → defer (`src/verdict.ts:100-126`).

**Verdict cache** (`src/session-state.ts:114-164`, `VerdictCache`): LRU (default 128 entries), key = `commandHash` (request snapshot: action context + cwd + policy path boundary), value carries `contextHash` (hash of the concatenated trusted intent). **A hit requires both hashes to match** -- when the same command is seen after the conversation has advanced, the contextHash changes, it misses and is re-reviewed, ensuring verdicts are never misapplied across contexts; miss reasons (disabled/no-entry/context-changed) are recorded in telemetry. defer is not cached (`review-pipeline.ts:137-152, 168-174`).

**Circuit breaker** (`src/session-state.ts:49-99`, `CircuitBreaker`): counts only **real model verdicts** (cache hits and breaker short-circuits are not counted): deny → consecutive count +1 and total count +1; allow → consecutive count reset to zero; defer → unchanged. Two tiers: 3 consecutive denies trigger (recoverable tier, reset to zero after triggering to give the model another chance) + 20 cumulative denies per session trigger (hard cap, never reset); once triggered it returns `deny` by default (configurable to defer). Defaults in `src/config-schema.ts:42-46`.

**Model call** (`src/model-review.ts`): `provider.streamSimple(...).result()`; `AbortSignal.timeout(timeoutMs)` is the only abort source (the Authorizer callback cannot get `ctx.signal`, `model-review.ts:205`); `maxTokens: 512` (`model-review.ts:64`); default `timeoutMs: 15000`, model `anthropic/claude-haiku-4-5`, `reasoning: "off"` (`config/config.example.json`). Note a pitfall observed in practice: the Anthropic provider resolves with an empty message (stopReason="aborted") after catching an abort rather than rejecting, so an empty reply must be distinguished as `timeout` vs `empty-reply` (`model-review.ts:146-172`).

### 3.3 `wangzexi/pi-auto-approve@1.1.0` -- introspective call path, verdict JSON contract

**Three tiers** (`auto-approve.ts`):

1. **Tier 1 auto-allow** (15 regexes, `auto-approve.ts:23-40`): `ls/dir/tree`, `cd`, `cat/head/tail/less/more`, `file/stat/wc/du/df`, `grep/rg/ag/ack`, `find/locate/which/whereis/type`, read-only git subcommands (status/log/diff/show/branch/tag/stash list/remote/ls-remote/rev-parse/rev-list/describe/whatchanged/shortlog/blame/grep/config --get), read-only docker, read-only npm/yarn/pnpm (list/info/view/outdated/audit/why), read-only pip, `echo/printenv/env/whoami/hostname/uname/uptime/id/groups/pwd/date`, `<cmd> --version/--help`.
2. **Tier 2 auto-block** (7 regexes, `auto-approve.ts:42-50`): `rm -rf /`, `rm -rf /etc|/usr|/var`, fork bomb `:(){ }`, `dd of=/dev/*` (non-null), `mkfs.*`.
3. **Tier 3 introspective review**: same model + full conversation context.

**Introspective call path** (`auto-approve.ts:255-291`):

```typescript
const reviewModel = resolveReviewModel(ctx.modelRegistry, ctx.model);      // ctx.model re-resolved via registry.find (lines 214-218)
const { systemPrompt, messages } = buildReviewContext(
  ctx.sessionManager, ctx.getSystemPrompt(), command);                      // reuses main-session system prompt + branch messages (line 260)
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(reviewModel);      // credentials (line 261)
completeSimple(reviewModel, { systemPrompt, messages }, {
  apiKey: auth?.apiKey, env: auth?.env, headers: auth?.headers,
  cacheRetention: "short",                    // prefix caching
  sessionId: ctx.sessionManager.getSessionId(),// session affinity, reuses the main session's cache prefix
  signal: ctx.signal,
  temperature: 0, maxTokens: 80,
});
```

`buildReviewContext` (lines 122-144): clones the messages from `sessionManager.getBranch()`, **removes toolResults and the toolCall parts of assistant messages** (keeping only text/thinking), to avoid feeding unclosed tool-call formats back to the model and making it keep emitting DSML/tool-call output; appends a user-role review request at the end (fixed rules first, dynamic command last, which favors prefix caching). The comment states the goal explicitly: "same model/prefix segments, favoring cache hit rates" (file header comment, lines 5-14). The UI toast also shows the cache hit rate `CH = cacheRead/(cacheRead+input)` (lines 55-67).

**Review prompt** (`buildReviewPrompt`, lines 96-120): wrapped in `<safety_review>` XML -- instruction (completed for this request only, play an internal security reviewer, must not continue the task) / rules (`<allow>` read-only low-risk or explicitly user-requested, user-requested public network diagnostics; `<block>` destructive, secret-related, credential/private file exfiltration, state changes without explicit authorization, ambiguity) / output_contract / examples; the command goes in `<command><![CDATA[...]]></command>` (CDATA guards against injection, `toCdata` escapes `]]>`, lines 84-86).

**Verdict JSON contract** (lines 106-109, 146-176): **exactly two keys** `{"verdict":"allow"|"block","reason":"..."}` (key set strictly validated with `keys.length===2`); `extractFirstJsonObject` extracts the first JSON object with a bracket-balancing scan (tolerating ```json fences); empty reason or non-enum verdict → invalid.

**Failure policy = fail-OPEN (opposite to the other two extensions)**: 30-second timeout → allow + toast warning (lines 293-296); `stopReason==="error"` → allow (lines 300-303); parse failure → allow (lines 308-315); catch-all → allow (lines 317-320). Block only in non-interactive mode (`!ctx.hasUI`) and when there is no model/no credentials (lines 250-252, 261-265).

**Compatibility note**: `import { completeSimple } from "@earendil-works/pi-ai"` (line 18) no longer exists at the pi-ai@0.84.3 package root (measured undefined); the extension depends on the old pi-ai package-root export; when using it as a reference, switch to `ctx.modelRegistry.complete()` or the compat subpath.

### 3.4 Appendix: Authorizer chain seam (gotgenes/pi-permission-system)

If you go with the "permission system + chain link" ecosystem rather than a standalone `tool_call` hook: `@gotgenes/pi-permission-system` defines `Authorizer.authorize(details, query, log) → Promise<allow|deny|defer>` (`pi-packages/packages/pi-permission-system/src/authority/authorizer.ts:20-41`), where defer = hand off to the next link; terminal links (LocalUserAuthorizer, etc.) cannot defer. Third-party extensions register links via `getPermissionsService().registerAuthorizer(name, fn)` (ai-guard `src/extension.ts:136`), and `query.checkPermission(...)` provides the deterministic engine's current verdict (gate parity). This is the integration approach ai-guard chose; it is an either/or with the "standalone tool_call hook" approach of pi-permission / pi-auto-approve.

---

## 4. Rule-layer seed set (for direct adoption by the prototype)

The lists below are extracted and merged from the implementations of the three extensions, and can be used directly as the initial values of the pi-verdict prototype's rule layer.

### 4.1 Bash unconditional allowlist (read-only/side-effect-free, allowed directly)

From pi-permission `BUILTIN_UNCONDITIONAL_SAFE` (50 entries) + pi-auto-approve Tier 1 additions:

```
arch basename cat cd cksum cmp column comm cut diff dirname du df echo expand
expr false file fold grep groups head id jq ls md5sum nl paste printenv ps pwd
readlink realpath rev seq sha256sum shasum stat tail tr true tsort uniq uname
uptime wc whereis who whoami which
```

Additions (command-prefix regexes): `tree`, `less/more`, `rg/ag/ack`, `locate/type`, `hostname/env`, `date` (forbid `-s/--set`), `<any command> --help|-h`, `<python|node|uv|tsx|npx> --version|-v`.

### 4.2 Bash conditional allowlist (argv-level flag checks)

| Command | Allow condition | Forbidden flags |
|---|---|---|
| `git` | only `status/log/diff/show/branch` with read-only arguments | global: `-C -c -p --config-env --exec-path --git-dir --namespace --paginate --super-prefix --work-tree`; subcommand: `--output --ext-diff --textconv --exec`; `branch` only `--list/-l/--show-current/-a/-r/-v*/--format=` |
| `find` | default | `-exec -execdir -ok -okdir -delete -fls -fprint -fprint0 -fprintf` |
| `rg` | default | `--pre --hostname-bin --search-zip -z` |
| `base64` `sort` `iconv` `shuf` | default | `-o/--output` (including the `o` in merged short-flag clusters such as `-fo`) |
| `sed` | only `sed -n {N|M,N}p [file]` (argv<=4) | every other form |
| `date` | default | `-s/--set` (including short-flag clusters containing `s`) |
| `npm/yarn/pnpm` | only `list/info/view/outdated/audit/why/config list` | other subcommands |
| `pip/pip3` | only `list/show/freeze/search` | other subcommands |
| `docker/podman` | only `ps/images/inspect/logs/stats/info/version/history/top/diff` | other subcommands |

### 4.3 Bash dangerous patterns (direct deny, regex, `i` flag)

Taken from pi-permission `BUILTIN_DANGER_RULES` (12 entries) + pi-auto-approve Tier 2 (7 entries), merged by theme:

1. **Recursive deletion**: `\brm\b.*(\s-(?:[a-zA-Z]*r)|--recursive)`; root/system-directory specialization: `\brm\s+(-rf?|--recursive)\s+(/|/etc|/usr|/var)(?:\s|$)` (the latter is "catastrophic" and should never be downgradable by configuration)
2. **Privilege escalation**: `\bsudo\b`
3. **Permission weakening**: `\bchmod\b.*(777|a\+rwx|ugo\+rwx|ugo=rwx)`; can add `chmod` setuid (`\bchmod\b.*\b[ug]\+s\b`)
4. **Raw device writes**: `(>\s*/dev/(sd|hd|nvme|mmcblk|vd|xvd)[a-z0-9]+|of=/dev/(sd|hd|nvme|mmcblk|vd|xvd)[a-z0-9]+)`; `\bmkfs\.`
5. **Destructive VCS**: `\bgit\s+push\s+.*(-f\b|--force\b)`; `\bgit\s+reset\s+--hard\b`; `\bgit\s+clean\b.*(\s-(?:[a-zA-Z]*f)|--force)`; `\bgit\s+checkout\s+(--\s+)?\.\s*($|[;&|])`; `\bgit\s+restore\b`
6. **Remote code execution**: `\b(curl|wget)\b.*\|\s*(ba)?sh\b`
7. **GitHub remote mutation**: `\bgh\s+repo\s+(create|delete|rename|archive)\b`; `\bgh\s+release\s+(create|delete|edit)\b`
8. **Fork bomb**: `:\(\)\s*\{`

Two engineering details to note (from pi-permission comments): a short-flag cluster must be anchored on whitespace (`\s-`), otherwise `.*` backtracking will mistake letters inside long options such as `--verbose` for short flags; pipe-type patterns (`curl|sh`) must be checked against the **full command string**, since a single argv after AST splitting cannot see the `|`.

### 4.4 File path sensitivity tiers (path matching for read/write/edit tools)

Synthesized from the pi-permission prompt rules and ai-guard SAFETY_RULES:

| Tier | Paths | Default action |
|---|---|---|
| S0 Secrets/credentials (reading is already high-risk) | `~/.ssh/**`, `~/.aws/**`, `~/.gnupg/**`, `**/.env*`, `**/*credentials*`, `**/id_rsa*`, `**/*.pem`, `**/*_history`, `~/.config/gh/**`, `~/.pi/agent/auth.json` | deny (read) / deny (write) |
| S1 System config | `/etc/**`, `/usr/**`, `/var/**`, `/System/**`, `/etc/sudoers*`, `**/authorized_keys` | deny (write); read goes to ask/AI |
| S2 User config (persistence entry points) | `~/.bashrc` `~/.zshrc` `~/.profile`, shell RC, `~/.gitconfig`, `crontab`, `~/Library/LaunchAgents/**`, `~/.config/systemd/**` | write ask/deny; read allowed (non-secret parts) |
| S3 Repository metadata | `.git/hooks/**`, `.git/config`, `.gitmodules` | write deny (executable code entry point) |
| S4 Inside project (CWD) | `join(ctx.cwd, "**")` | write allowed (bounded, matches task intent); `..`/symlink escapes are treated as outside CWD |
| S5 Ordinary files outside CWD | others | write ask; non-secret reads → ask or defer to AI |

### 4.5 Directly reusable pieces of the AI verdict layer

- **Verdict contract**: three states `{outcome|verdict: allow, deny|block, ask|defer}` + `risk_level` + short `reason`, strict JSON; three-stage parse tolerance (extract JSON → parse → enum validation); on parse failure, fail-closed (pi-permission) or fail-open (pi-auto-approve) -- **the prototype should fail closed to ask**.
- **Cache**: (commandHash, contextHash) dual-key LRU; defer is not cached.
- **Circuit breaker**: N consecutive denies trigger a recoverable tier + M cumulative per-session denies as a hard cap; once triggered, return deny.
- **Bias patch**: at high risk the AI's allow is not trusted (high+allow → deny); at low risk where automatic allow is not permitted (low+allow → ask).
- **Prompt injection defense**: partition trusted/untrusted content; untrusted text gets zero-width characters stripped, whitespace collapsed, secrets masked, and JSON-escaped inline; the command goes in CDATA; keep the system prompt lean (cost/latency) but the output contract must not be overridable by custom instructions.

---

## 5. Evidence list (primary sources)

Local install (`~/.bun/install/global/node_modules/`):

- `@earendil-works/pi-coding-agent/docs/extensions.md` -- tool_call (70-73, 760-776), ctx.modelRegistry (995-999), ctx.signal (1001-1011), ctx.cwd project config (958-973), ctx.isProjectTrusted (976-980), registerFlag/getFlag (1633-1648), error handling (2904)
- `@earendil-works/pi-coding-agent/docs/settings.md` -- all built-in settings keys (no extension custom keys)
- `@earendil-works/pi-coding-agent/docs/sdk.md:445-448` -- credential lookup order
- `dist/core/model-registry.d.ts:11-35` -- `complete` / `getApiKeyAndHeaders` / `getProviderAuth` types
- `dist/core/model-runtime.js:422-451` -- `prepareRequest` credential injection implementation
- `dist/core/extensions/types.d.ts:209-249` -- full ExtensionContext fields (no settings accessor)
- `dist/config.d.ts:77` + `dist/index.d.ts:2` -- `getAgentDir()` official export
- `@earendil-works/pi-ai/dist/types.d.ts:53, 128-137` -- StreamOptions signal/cacheRetention/sessionId
- `@earendil-works/pi-ai/dist/compat.d.ts:1-10, 65-66` -- compat temporary entry point and completeSimple declaration
- `examples/extensions/summarize.ts:163-187` -- official `modelRegistry.complete` example
- `examples/extensions/interactive-shell.ts:102-105` -- environment variable config example

Reference extensions (research copies in `/Volumes/RamDisk/pi-research/`):

- `@zhushanwen/pi-permission@1.3.3` (npm pack): `src/pipeline.ts`, `src/rules/builtins.ts`, `src/ast/analyzer.ts`, `src/classifier/{prompt,classifier,json-parser,model-resolver}.ts`, `src/config.ts`, README
- `@zhushanwen/pi-llm-shared@0.4.1` (npm pack): `src/call.ts`, `src/resolve.ts`
- `pi-permission-ai-guard@0.7.0` (npm pack): `src/{review-pipeline,transcript-stripper,prompt,session-state,model-review,verdict,config-loader,config-schema,utils,extension}.ts`, `config/config.example.json`
- `wangzexi/pi-auto-approve@1.1.0` (github clone): `auto-approve.ts`, README.md
- `gotgenes/pi-packages` (github clone): `packages/pi-permission-system/src/authority/authorizer.ts`
