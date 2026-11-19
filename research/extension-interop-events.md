# Extension interop channels in pi and omp

**Base paths.** Pi: `node_modules/@earendil-works/pi-coding-agent/` (cited as `dist/...`, `docs/...`, `examples/...`). Omp: `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/` (cited as `src/...`, local 18.10.4 copy). Line numbers are approximate where marked `~`. The upstream GitHub tree at HEAD `65e9a4674d3d50f805a41306574e711a9a79b5c2` was listed but its files were not fetched, so omp citations refer to the installed copy.

## Summary

- **Both hosts provide the same primitive: an `events` object on `ExtensionAPI`** with `emit(channel, data)` and `on(channel, handler) → unsubscribe`. Dispatch is synchronous. Handlers may be async, are not awaited, and their errors are logged, not propagated. Nothing is replayed to late subscribers.
- **Pi** creates one bus per `DefaultResourceLoader`, backed by Node `EventEmitter`. A new runtime (new session, resume, fork) gets a new bus. `/reload` keeps the bus, and subscriptions are dropped by runtime invalidation.
- **Omp** has the same shape, backed by a `Map<channel, Set<handler>>`. Subscriptions are not tracked per runtime. The bus is created per session (`sdk.ts:1786`). Its lifetime across `/reload` and session switches was not verified.
- **Load order.** Pi runs every factory sequentially in array order during `resourceLoader.reload()`. `session_start` fires only after that, so a `session_start` handler can rely on every extension being subscribed. Omp has the same pattern, with one exception: startup-deferred extensions can bind after the runner exists, and they receive a replay of `session_start` alone.
- **Other channels:** `getAllTools` / `getCommands` / `getActiveTools` / `setActiveTools` exist on both hosts. They expose tool and command metadata but no permission field. `globalThis` with `Symbol.for(...)` is a userland convention; pi-verdict already uses it. Module singletons are not shared across extensions [INFERENCE, not verified].
- **Trust implication.** `emit` takes no sender identity. Any loaded extension can publish to any channel or write to a global. A pre-approval or rule-floor channel is therefore not a trust boundary.

## Q1. Pi `ExtensionAPI.events` (EventBus)

**Type.** `dist/core/event-bus.d.ts:1-8`:
```ts
export interface EventBus { emit(channel: string, data: unknown): void; on(channel: string, handler: (data: unknown) => void): () => void; }
export interface EventBusController extends EventBus { clear(): void; }
export declare function createEventBus(): EventBusController;
```
Exported from the package root (`dist/index.d.ts:6`).

**Implementation.** `dist/core/event-bus.js:1-25`:
- `emit` calls `emitter.emit(channel, data)` synchronously. The `EventEmitter` invokes each `safeHandler` in registration order.
- `on` wraps the handler in `safeHandler = async (data) => { try { await handler(data) } catch (err) { console.error("Event handler error (<channel>):", err) } }`. The rejection is caught and logged, and the emitter never sees it.
- `on` returns `() => emitter.off(channel, safeHandler)`.
- `clear()` calls `emitter.removeAllListeners()`. The host never calls it (no `clear()` call in `dist`, verified by grep in the earlier pass).
- **No replay.** `EventEmitter` does not buffer. A subscriber that registers after an emit never sees it.

**Extension-facing wrapper.** `dist/core/extensions/types.d.ts` `ExtensionAPI.events: EventBus` (doc: "Shared event bus for extension communication.", ~line 1060, approximate). The wiring is in `dist/core/extensions/loader.js:366-377`:
- `events.emit` calls `assertActive()`, then `eventBus.emit`.
- `events.on` calls `assertActive()`, then `runtime.trackEventBusSubscription(eventBus.on(channel, handler))`. While the extension is loading, the unsubscribe is also pushed to `loadingUnsubscribers`, which is used if the factory throws.
- `loader.js:154-193` (`createExtensionRuntime`): `trackEventBusSubscription` keeps a Set of tracked unsubscribers. `invalidate()` calls each one and clears the Set. `invalidate` runs when the runtime goes stale (see Q2).

**Where the bus lives.**
- `dist/core/resource-loader.js:159`: `this.eventBus = options.eventBus ?? createEventBus();`. One bus per `DefaultResourceLoader`.
- `dist/core/agent-session-services.js:63-69`: `createAgentSessionServices` constructs a new `DefaultResourceLoader` (no `eventBus` passed) and awaits `reload()`. So each call gets a new bus.
- `dist/main.js:564-589` (`createRuntime`) calls `createAgentSessionServices` on every call.
- `dist/core/agent-session-runtime.js:99-173`: `switchSession` / `newSession` call `teardownCurrent` (emits `session_shutdown`, then `session.dispose()`), then `createRuntime`. So **a new session, resume, or fork gets a new bus**. Subscribers from the old runtime are gone, and state held in the old bus is lost.
- `/reload` (`dist/core/agent-session.js:~2140-2165`): emits `session_shutdown` (reason `reload`), calls `oldRunner.invalidate()` (unsubscribes tracked listeners), then `this._resourceLoader.reload()` on the same loader. The bus survives, and factories re-subscribe on reload.

**Documented use.** `docs/extensions.md:1711-1715`: "Shared event bus for communication between extensions: `pi.events.on("my:event", …)`, `pi.events.emit("my:event", {…})`". `docs/sdk.md:658-671` shows an external embedder passing `createEventBus()` into `DefaultResourceLoader({ eventBus })` and calling `eventBus.on("my-extension:status", …)`.

## Q2. Pi load order and `session_start` timing

**Path order.** `dist/core/package-manager.js:1974-2018` (`addResources`):
1. Project auto-discovered `.pi/extensions` (only if the project is trusted).
2. User auto-discovered `~/.pi/agent/extensions`.
3. `settings.json` entries and packages are merged into the same accumulator. `resourcePrecedenceRank` in `package-manager.js:61-68` gives 0 project+local settings, 1 project+auto, 2 user+local settings, 3 user+auto, 4 package. A stable sort by rank, then a dedupe by canonical path, is at `package-manager.js:~2077`.
- Order inside one directory comes from `readdirSync` in `collectAutoExtensionEntries` (`package-manager.js:~404-436`). No explicit sort was seen, so this is OS-dependent [INFERENCE].

**Factory binding.**
- `dist/core/resource-loader.js:402-412` (`loadCurrentExtensionSet`) calls `loadExtensionsCached(extensionPaths, cwd, this.eventBus)`. Inline factories are appended last.
- `resource-loader.js:~425-460` (`loadFinalExtensionSet`) keeps the `extensionPaths` order, appends inline factories last, and handles project-trust pre-loading.
- `dist/core/extensions/loader.js:~430-445` (`loadExtensionsInternal`) binds sequentially, `for … await loadExtension`. A factory that throws is recorded in `errors` and skipped.

**`session_start` timing.**
- `dist/core/agent-session-services.js:69`: `await resourceLoader.reload()` completes before `createAgentSessionServices` returns, so every factory has run.
- `dist/core/agent-session.js:1827-1853` (`bindExtensions`): `this._applyExtensionBindings(...)`, then `await this._extensionRunner.emit(this._sessionStartEvent)`, then `extendResourcesFromExtensions`. So `session_start` is emitted after all factories.
- `dist/modes/interactive/interactive-mode.js:1440-1452` (`bindCurrentSessionExtensions`) calls `session.bindExtensions`. The interactive path is the only one checked.

**Handler dispatch.** `dist/core/extensions/runner.js:579-600` (`ExtensionRunner.emit`): for each extension in load order, for each handler, `await handler(event, ctx)`. Handlers therefore run one at a time, in load order. `session_start` handlers of an earlier extension complete before a later extension's handler runs. A handler error is caught and emitted as an extension error.

**Consequence for a bus contributor (pi).**
- A publisher that emits from its factory reaches only listeners already subscribed by earlier-loaded extensions. Pi-verdict would miss it if it loads later.
- A publisher that emits from its own `session_start` handler reaches every listener, because all factories have finished by then. This is the order-independent pattern.

## Q3. Omp equivalents

**Bus class.** `src/utils/event-bus.ts:3-26`:
```ts
export class EventBus {
  readonly #listeners = new Map<string, Set<(data: unknown) => void>>();
  emit(channel, data) { for (const handler of handlers) handler(data); }   // synchronous
  on(channel, handler) { /* safeHandler = async wrapper with try/await/catch → logger.error("Event handler error", {channel, error}) */ return () => this.#listeners.get(channel)?.delete(safeHandler); }
  clear() { this.#listeners.clear(); }
}
```
Plus `emitSubagentFrame(eventBus, subagentEventBus, channel, payload)` (`event-bus.ts:~28-38`). That helper publishes subagent frames on the session bus and an observability bus. It is an internal use of the same class.

**Shape vs pi.**
- Same public surface: `emit`, `on` returning unsubscribe, plus `clear()`.
- Same sync dispatch, async handlers not awaited, errors logged rather than propagated.
- Dispatch iterates a live `Set`, not a snapshot like pi's `EventEmitter`. A handler added during emit is visited in that same loop [INFERENCE, from Set iteration semantics; not tested].
- Errors go to `logger.error` (from `@oh-my-pi/pi-utils`), not `console.error`.
- No per-runtime tracking. `ConcreteExtensionAPI` receives the raw bus: `src/extensibility/extensions/loader.ts:196`, `public readonly events: EventBus`. There is no `assertActive` wrapper and no unsubscribe tracking for `events.on`. Compare pi's `trackEventBusSubscription`.

**Public API.** `src/extensibility/extensions/types.ts:~2044` (inside `ExtensionAPI`, after `unregisterProvider`): `events: EventBus;` with doc "Shared event bus for extension communication."

**Bus creation.**
- `src/sdk.ts:1786-1787`: `const eventBus = options.eventBus ?? new EventBus();` and `subagentEventBus` likewise. So an embedder can pass one in.
- `src/sdk.ts:2865`: `loadExtensionFromFactory(factory, cwd, eventBus, …)` uses the same bus.
- `src/main.ts:2449-2450`: `new EventBus()` and `new EventBus()` (subagent) on a CLI path. `src/main.ts:571` creates one in `createAcpSessionFactory`.
- The lifetime across `/reload`, session switches, and ACP sessions was not traced. [INFERENCE: it is per session-factory call, like pi.]

**Loading and order.** `src/extensibility/extensions/loader.ts`:
- `loadExtensions(paths, cwd, eventBus?, runtime?)` at ~486-493: `Promise.all(paths.map(importExtensionModule))`. Imports are concurrent.
- `bindPreparedExtensions` at ~501-523: `resolvedEventBus = eventBus ?? new EventBus()` at ~509, then a sequential `for … await bindExtension(...)` in original path order. The comment says this is "so registration semantics (last-wins collisions…) stay deterministic".
- `bindExtension` at ~443-465 constructs `new ConcreteExtensionAPI(PiCodingAgent, extension, runtime, cwd, eventBus)` and runs the factory with `withHostGuard`.
- `loadExtensionFromFactory` at ~465-478 does the same for inline factories.

**Path discovery.** `discoverExtensionPaths` (`loader.ts:~600-680`) builds the list in this order:
1. Native capability discovery (`providers: ["native"]`, from `.omp`/`.pi`).
2. Hook factories (`hookCapability`), filtered to `.ts`/`.js`.
3. Installed plugin entry points (`getAllPluginExtensionPaths`).
4. Explicitly configured paths.
- `addPath` dedupes by `fs.realpath`.
- Whether the ordering inside each step is sorted was not verified.

**Session_start timing.**
- `src/modes/controllers/extension-ui-controller.ts:~352-368` (`initHooksAndCustomTools`): `extensionRunner.initialize(actions, contextActions, commandActions, enrichedUiContext, "tui")`, then `await extensionRunner.emit({ type: "session_start" })`. So in TUI mode, `session_start` fires after the factories are bound.
- Other modes (RPC, print, ACP) were not checked.

**Replay for deferred extensions.** `src/extensibility/extensions/runner.ts:1099-1133` (`addExtensions`): "startup-deferred extensions binding into the live session runtime… a `session_start` that already went out is replayed to them alone." Implemented by `#sessionStartEvent` (`runner.ts:551`), recorded at `runner.ts:1708-1710` in `emit()`. So omp is not strictly "every factory before `session_start`": a deferred extension can bind after `session_start` and then gets a replay of that event only. Pi has no equivalent that I saw [not verified].

**Dispatch.** `runner.ts:1716-1763` (`#emitTo`):
- For `session_shutdown`, all handlers start concurrently with `Promise.all` and a timeout.
- For everything else, handlers run sequentially in extension order. Each one goes through `#runHandlerWithTimeout` (`runner.ts:~1685-1718`), which catches errors and calls `emitError`.
- Same semantics as pi for normal events.

**Compat layer.** `src/extensibility/legacy-pi-coding-agent-shim.ts`:
- `:985`, `:1051`, `:1364`: `eventBus` appears in the shim's option and state types.
- `:1093`: `eventBus: options.eventBus ?? new EventBus()`.
- `:1219-1239`: `loadExtensions(paths, cwd, eventBus)` and passes `eventBus` through.
- The shim therefore forwards the bus to pi-style extensions. Those extensions get the same `events` object (`ConcreteExtensionAPI.events`).
- `src/extensibility/plugins/legacy-pi-compat.ts` mentions the same resolver state but was not read in full.

**Shape differences to note for a shared contract.** None for the `on`/`emit` signatures. Omp has `clear()` on the class; pi exposes it only on `EventBusController`, which `ExtensionAPI.events` does not type as `EventBusController`. A contributor should type against `EventBus` (`emit`/`on`) only.

## Q4. Other channels

**Tool and command metadata (both hosts).**
- Pi: `ExtensionAPI.getAllTools(): ToolInfo[]` and `getCommands(): SlashCommandInfo[]`, `getActiveTools`, `setActiveTools`. `dist/core/extensions/types.d.ts` ~980-984. Pre-bind these are `notInitialized` (`dist/core/extensions/loader.js:~163-170`), so they throw until `bindCore`. `ToolInfo` is `Pick<ToolDefinition, "name"|"description"|"parameters"|"promptGuidelines"> & { source metadata }` (`types.d.ts:~1175`). `SlashCommandInfo` is at `dist/core/slash-commands.d.ts:3-9`.
- Omp: `src/extensibility/extensions/types.ts:1958-1967` declares `getActiveTools`, `getAllTools(): ToolInfo[]`, `setActiveTools`, `getCommands(): SlashCommandInfo[]`. `ToolInfo` is at `types.ts:1001` ("identity, schema, and source provenance"). Runtime wiring: `src/modes/runtime-init.ts:125-129` (`getAllTools: () => session.getAllToolInfos()`, `getCommands: () => getSessionSlashCommands(session)`). `get-commands-handler.ts:13` excludes built-in commands.
- **Limit.** `ToolDefinition` has no permission or policy field (checked in the pi `types.d.ts` section read this pass: `name, label, description, promptSnippet, promptGuidelines, parameters, executionMode, execute, render*`). A tool cannot declare "pre-approved" through its definition. These APIs are read-only discovery, so they can validate an exact-name allowlist but cannot carry one.

**Session entries.** `ExtensionAPI.appendEntry(customType, data)` (pi `types.d.ts` ~959) persists custom entries to the session file. Whether another extension can read them through a documented API was not verified.

**Global object (userland).** Pi-verdict already uses this convention:
- `extensions/pi-verdict.ts:6340`: `export const ACTIVE_MODELS_PROBE = Symbol.for("pi-verdict:active-models");`
- `extensions/pi-verdict.ts:6734`: `(globalThis as Record<symbol, unknown>)[ACTIVE_MODELS_PROBE] = ownProbe = activeModels;` set in `session_start` when the session is the root (not a subagent).
- `extensions/pi-verdict.ts:6757-6763`: `session_shutdown` deletes the probe only if it still holds its own reference.
- `Symbol.for` makes it shared across any module instance in the same process. Works in both hosts [INFERENCE: both run the extensions in one JS realm].

**Module singletons.** Not a channel. Pi loads extension modules through jiti (`createJiti(..., { moduleCache: false, … })` [INFERENCE from the earlier pass; not re-read this pass]). Two extensions importing the same npm package may get separate instances. Only `globalThis` / `Symbol.for` is a shared registry that was verified.

**Conflict handling.** Pi `dist/core/resource-loader.js:~443-455` (`addExtensionConflictDiagnostics`): "Keep all extensions loaded. Conflicts are reported as diagnostics, and precedence is handled by load order." Tool, command, and flag name collisions are reported as diagnostics only. Omp uses last-wins collision handling (comment in `bindPreparedExtensions`).

## Q5. Ecosystem conventions

- **Channel naming is `<namespace>:<event>`.** Pi's own example `examples/extensions/event-bus.ts` uses `pi.events.on("my:notification", …)` and `pi.events.emit("my:notification", {…})`. `docs/extensions.md:1714-1715` uses `my:event`. `docs/sdk.md:668` uses `my-extension:status`. Pi-verdict's global key `pi-verdict:active-models` follows the same shape.
- **No `<ext>:register` convention** appears in pi's docs, examples, or the bundled extensions. The earlier brief named that pattern. I did not find it in pi docs, pi-verdict docs, or `research/`. [INFERENCE: it is not an established host convention.]
- Omp's subagent frames use named bus channels ("task subagent lifecycle/progress channels", `src/collab/protocol.ts:87`). Exact channel strings were not read.
- `web_search` for `pi.events.on` in other extensions returned the upstream example and the docs only, not third-party code.

## Implications for pi-verdict (contribution design)

Facts that constrain the design, with no recommendation beyond them:
1. **Subscribe in the factory, emit from `session_start`.** Pi and omp both run `session_start` after the initial factories. Emitting from a factory is order-dependent. Pi-verdict's listener must also be subscribed before the emit, which means subscribing in its own factory.
2. **Re-emit after `/reload` and session replacement.** A new session or resume creates a new bus (pi). `/reload` keeps the bus but drops old subscriptions, and `session_start` fires again. Anything published once, outside `session_start`, is lost.
3. **Pull vs push.**
   - Push (`events.emit`): needs ordering as in (1), and only works if pi-verdict is subscribed at emit time.
   - Pull (`globalThis[Symbol.for("pi-verdict:contrib")]`, read at pi-verdict's `session_start`): order-independent for registration, but nothing notifies pi-verdict of later changes. Pi-verdict already uses this pattern, so it adds no new mechanism.
4. **No sender identity.** Neither host attaches the emitter to a message. Any loaded extension can publish a pre-approval or a rule-floor entry. Pre-approved tools and denyPaths should be treated as trust-sensitive, and the built-in floor should stay outside this channel.
5. **Tool name validation.** `getAllTools()` is available only after bind (both hosts). Validate exact-name allowlist entries at `session_start`, when the list is final.
6. **Host differences that matter.** Omp defers some extensions and replays `session_start` only to them (`runner.ts:1099-1133`). Pi does not, as far as observed. Omp's bus subscriptions are not tracked per runtime, so pi-verdict should unsubscribe its own listeners on `session_shutdown` if it needs to.

## Not verified / skipped

- Pi jiti `moduleCache` and whether two extensions get separate instances of an npm package (no re-read this pass).
- Omp bus lifetime across `/reload`, `switchSession`, and ACP sessions; omp session_start timing in RPC, print, and ACP modes.
- Pi `appendEntry` readback path for other extensions.
- Upstream line numbers at HEAD `65e9a4674d…`; the GitHub tree was listed but no files were fetched there.
- Any third-party extension that uses `globalThis` or `pi.events` beyond the examples.

**Risk:** `emit` has no sender identity, so any loaded extension can inject pre-approvals or classifier rules over the bus or the global. Treat contributed entries as untrusted input unless the source is verified.

### Critical Files for Implementation

- `node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js` — pi bus semantics: sync emit, async handlers swallowed, no replay, `clear()` exists.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js` — `events` wiring (~366-377), tracked unsubscribes and invalidation (~154-193); decides what survives reload.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js` — `bindExtensions` (1827-1853) emits `session_start` after factories; `reload` path (~2140-2165).
- `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/extensibility/extensions/loader.ts` — omp sequential binding (~501-523), `events` on `ConcreteExtensionAPI` (196), path discovery (~600-690).
- `extensions/pi-verdict.ts` — existing `Symbol.for` global probe (6340, 6734, 6757-6763); the place a contribution reader would attach to `session_start`.