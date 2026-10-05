# Verdict label outside the tool block

## Context
Today every allowed gated call gets `[auto-mode] allowed: rule|classifier`, `approved by user` or `allowed: second model (no human)` appended as an extra `tool_result` content item (`extensions/pi-verdict.ts` `pi.on("tool_result")`, ~L3377). In omp it renders **inside** the tool box (e.g. `eval`). Goal: render it as a separate compact row **after** the box, using Nerd Font glyphs or emoji. When the verdict came from jev, the row also shows a one-line stacked allow/ask/deny probability bar plus the chosen verdict's %.

Host facts (checked in this session):
- `tool_result` can only change `content`/`details`/`isError` (both hosts). Content renders inside the box and goes to the model.
- omp (`@oh-my-pi/pi-coding-agent` types.ts L1558-1603) has no TUI-only transcript row API. `appendEntry` is persisted but never painted, and there is no `registerEntryRenderer`. A separate row needs `pi.sendMessage({customType, content, display:true, details}, {deliverAs:"aside"})` plus `pi.registerMessageRenderer(customType, (message, {expanded}, theme) => Component|undefined)`. The renderer's component replaces the default card completely (pi-tui `chrome/message-frame.ts` L139-167). If the renderer returns `undefined` or throws, omp draws the default card (`customType` header + content markdown). The message **is model-visible**. `aside` is drained at the next agent step boundary, so with parallel calls every row appears after the whole batch, and each row names its tool. That is accepted. Never use the default/steer delivery: steer aborts the in-flight tool batch.
- pi 0.84.3 (`dist/core/extensions/types.d.ts` L875/L952/L968): `appendEntry(customType, data)` + `registerEntryRenderer(customType, (entry: CustomEntry<T> /* .data */, options, theme) => Component|undefined)`. These are TUI-only, persisted, and not in LLM context.
- The classifier transcript (`collectTranscriptParts`, ~L981) skips every entry whose `type !== "message"`. omp `custom_message` entries and pi `custom` entries are therefore already excluded, so no change is needed there.

## Approach

### 1. Share the jev probability-bar painting (pure refactor, no behavior change)
In `extensions/pi-verdict.ts` near `renderJevBar` (~L2216):
- Hoist the constants to module level: `const JEV_NAMES = ["allow", "ask", "deny"] as const;` and `const JEV_COLORS = { allow: "success", ask: "warning", deny: "error" } as const;`. Use them in `renderJevBar` in place of its local `names`/`colors`.
- Extract `function jevCellCounts(p: JevReason["probabilities"], cells: number): number[] | null`. It must return exactly the current lines L2227-2241: largest-remainder rounding, then at least 1 cell for each non-zero verdict, in allow/ask/deny order. Return `null` when the sum is 0.
- Extract `function paintJevCells(counts: readonly number[], theme: Pick<Theme, "fg">, nerdFont: boolean): string`. It must match current L2242-2261 minus the label items: expand counts into per-cell colors via `JEV_COLORS`; use glyph `"█"`, with `NF_CAP_L`/`NF_CAP_R` on the first/last cell when `nerdFont`; emit one `theme.fg` call per same-color run.
- `renderJevBar` calls `jevCellCounts`. On `null` it keeps the `theme.fg("muted", "░".repeat(cells))` bar and an empty label row. Otherwise it builds `items` from `counts`, using the same cumulative offsets, text, colors, bold and priority as today, then sets `bar = paintJevCells(counts, theme, nerdFont)`.
- Existing `renderJevBar` tests must pass unchanged.

### 2. Label model and renderers (new pure code, exported for tests)
Add these in `extensions/pi-verdict.ts`, in the same area after `renderJevBar`:
```ts
export const VERDICT_LABEL_TYPE = "pi-verdict-label";
/** Status row after an allowed call's block. Carries no reason text and no path (ADR-0002): tool name, how it passed, jev numbers only. */
export interface VerdictLabel {
	tool: string;
	how: "rule" | "classifier" | "user" | "second-model";
	jev: { choice: "allow" | "ask" | "deny"; probabilities: Record<"allow" | "ask" | "deny", number>; confidence: number } | null;
}
```
- `function verdictLabelFor(tool: string, how: VerdictLabel["how"], reason: string): VerdictLabel`. It sets `jev` from `parseJevReason(reason)` (already imported) as `{ choice, probabilities, confidence }` and leaves `rest` and `concern` out. On `null` it sets `jev: null`.
- `export function verdictLabelText(l: VerdictLabel): string` returns the model-visible plain text used as the omp message `content`. Format: `` `[auto-mode] ${l.tool} ${OUTCOME[l.how]}` `` where `OUTCOME = { rule: "allowed: rule", classifier: "allowed: classifier", user: "approved by user", "second-model": "allowed: second model (no human)" }`. When `l.jev` is set, append `` ` · jev ${choice} ${probabilities[choice]}%` ``.
- `function asVerdictLabel(x: unknown): VerdictLabel | null` validates persisted data: an object, `tool` is a string, `how` is one of the 4 values, and `jev` is `null` or an object with a valid `choice` and finite numeric `probabilities.allow/ask/deny` and `confidence`. Anything else returns `null`.
- `export function renderVerdictLabel(l: VerdictLabel, theme: Pick<Theme, "fg" | "bold">, nerdFont: boolean, width: number): string[]`:
  - Glyphs. With `nerdFont`: shield `NF_SHIELD` (`\uF132`). Per-`how` icons: rule `"\uF0E3"` (add `const NF_GAVEL = "\uF0E3";` next to the other NF constants), classifier and second-model `NF_CHIP`, user `"\uF007"` (add `const NF_USER = "\uF007";`). Each glyph counts as 1 cell. Without `nerdFont`: shield `"🛡️"`, rule `"📜"`, classifier and second-model `"🤖"`, user `"👤"`. Each emoji counts as 2 cells.
  - Short texts: `{ rule: "rule", classifier: "classifier", user: "approved", "second-model": "2nd model" }`.
  - Base row: `" " + theme.fg("success", shield) + " " + theme.fg("toolTitle", tool) + " " + theme.fg("muted", `${icon} ${short}`)` where `tool = displaySafe(l.tool)`.
  - jev part (only when `l.jev`): `" " + bar + " " + theme.bold(theme.fg(JEV_COLORS[choice], `${choice} ${p}%`))`. The bar has a fixed 10 cells: `paintJevCells(jevCellCounts(probabilities, 10), theme, nerdFont)`, or `theme.fg("muted", "░".repeat(10))` when the counts are `null`.
  - Width. Compute the plain width from the known part widths: the leading space, shield width, spaces, `tool.length`, icon width, `short.length`, and for the jev part `1 + 10 + 1 + pctText.length`. If `fullWidth + 1 <= width`, return `[base + jev]`. Otherwise, if `baseWidth + 1 <= width`, return `[base]`. Otherwise return `[]`. The `+1` is slack for terminals that draw emoji at a different width.

### 3. Replace the trailer with the label (wiring)
In `SessionState` (~L1588-1627, L1652), do a clean rename:
- `trailers: Map<string, string>` → `labels: Map<string, VerdictLabel>`, with doc comment "Verdict label per allowed tool call, consumed once by `tool_result`."
- `noteTrailer(id, text)` → `noteLabel(id: string, label: VerdictLabel)`, still through `remember`.
- `takeTrailer` → `takeLabel(id: string): VerdictLabel | undefined`.
- `reset()` clears `labels`.
- `grep -n "Trailer\|trailer" extensions/pi-verdict.ts` must return no matches afterwards.

In `autoMode` (after `const isOmpHost` ~L2901 is defined, before the `tool_result` handler), add a single label sink:
- pi path, when `typeof pi.registerEntryRenderer === "function" && typeof pi.appendEntry === "function"`: register `pi.registerEntryRenderer(VERDICT_LABEL_TYPE, (entry, _o, theme) => labelComponent(entry.data, theme))`. The sink is `(l) => pi.appendEntry(VERDICT_LABEL_TYPE, l)`.
- otherwise, the omp path, when `isOmpHost && typeof pi.sendMessage === "function" && typeof pi.registerMessageRenderer === "function"`: register `pi.registerMessageRenderer(VERDICT_LABEL_TYPE, (message, _o, theme) => labelComponent(message.details, theme))`. The sink calls `(pi as unknown as { sendMessage: OmpSendMessage }).sendMessage({ customType: VERDICT_LABEL_TYPE, content: verdictLabelText(l), display: true, details: l }, { deliverAs: "aside" })`, with a local `type OmpSendMessage = (message: { customType: string; content: string; display: boolean; details: VerdictLabel }, options: { deliverAs: "aside" }) => void;`. The cast is needed because pi's types lack `"aside"`. Call it on `pi` so `this` stays bound.
- otherwise the sink is `null` and no label is produced. Both real hosts take one of the two paths. A pi older than `registerEntryRenderer` is not on omp, so it gets no label and never gets a steer message.
- `labelComponent(data: unknown, theme: Theme)`: `const l = asVerdictLabel(data); return l ? { render: (w: number) => renderVerdictLabel(l, theme, state.userRules.footer === "full", w), invalidate() {} } : undefined;`. This reuses the existing Nerd Font convention (`footer === "full"`, as at ~L2833/L2856) and reads it at render time. Use the same component object shape as ~L2415.

Replace the `tool_result` handler (~L3375-3382). Comment: "Verdict label after the block: a separate transcript row (pi: TUI-only custom entry; omp: aside custom message, model-visible). No reason text, no path (ADR-0002)." Body: take the label via `state.takeLabel(event.toolCallId)` when `toolCallId` is a string, pass it to the sink if both exist, and always `return undefined` so the result content stays unchanged.

In the `tool_call` handler, delete `allowedTrailer`, rename `noteAllowed`'s parameter to `label: VerdictLabel`, and call `state.noteLabel`. Change the four call sites:
- root (~L3479) and subagent non-ask (~L3485): `noteAllowed(verdictLabelFor(event.toolName, verdict.verdict === "ask" ? "user" : verdict.source === "classifier" ? "classifier" : "rule", verdict.reason))`
- second model (~L3496): `noteAllowed(verdictLabelFor(event.toolName, "second-model", res.reason))`
- subagent human approval (~L3510): `noteAllowed(verdictLabelFor(event.toolName, "user", verdict.reason))`

### 4. Tests (`tests/pi-verdict.test.ts`)
- Harness `makeHarness`/`install` (L46-111). Add `sent: Array<{ message: any; options: any }>`, `entries: Array<[string, unknown]>`, `messageRenderers: Record<string, any>` and `entryRenderers: Record<string, any>` to `Harness` and `h`. The fake pi always gets `registerMessageRenderer`, `sendMessage` (push `{ message, options }`) and `appendEntry` (push `[type, data]`). It gets `registerEntryRenderer` only when `!opts?.ompHost`, which mirrors the real hosts. Spread it as `...(opts?.ompHost ? { logger: {}, typebox: {} } : { registerEntryRenderer: … })`.
- `session()` (L178): add `ompHost?: boolean` to `opts` and pass it to `h.install`.
- In `describe("approve dialog block reference and verdict trailer")`, rename the title to `…and verdict label`. Replace the tests "rule allow appends a trailer item once" and "classifier allow and user approval are told apart; denied calls leave no trailer" with:
  1. pi: `session({ allow: ["^ls\\b"] })`, `toolCall(h,"bash",{command:"ls"},"c1")`, then `result(h,"c1")` is `undefined` (content untouched). `h.entries` equals `[["pi-verdict-label", { tool: "bash", how: "rule", jev: null }]]`. A second `result(h,"c1")` adds nothing. `h.sent` is `[]`.
  2. pi: same flow as the old second test. Classifier allow, then user approval via `driveDialogs(h, [["\r"]], [])`. The `how` sequence in `h.entries` is `["classifier","user"]`. The denied `rm -rf` call (built by concatenation) and the Escape-declined call add no entries.
  3. omp: `session({ allow: ["^ls\\b"] }, { ompHost: true })`, rule allow. `result` is `undefined`. `h.sent` equals `[{ message: { customType: "pi-verdict-label", content: "[auto-mode] bash allowed: rule", display: true, details: { tool: "bash", how: "rule", jev: null } }, options: { deliverAs: "aside" } }]`. `h.entries` is `[]`.
  4. omp jev: `h.responses = [{ text: "<verdict>allow</verdict> jev: allow 92% (confidence 85%; ask 5%, deny 3%)" }]` on `cargo check`. `sent[0].message.content === "[auto-mode] bash allowed: classifier · jev allow 92%"`, and `details.jev` equals `{ choice: "allow", probabilities: { allow: 92, ask: 5, deny: 3 }, confidence: 85 }`. Render through `h.messageRenderers["pi-verdict-label"](sent[0].message, { expanded: false }, { fg: (_c, t) => t, bold: (t) => t }).render(80)[0]`. With the default config (`footer` defaults to `"full"`) it contains `"\uF132"`, `"bash"`, `"classifier"`, `"allow 92%"`, `"\uE0B6"` and `"\uE0B4"`. `.render(30)` keeps `"classifier"` but has no `"92%"`.
  5. Emoji: `session({ footer: "compact" }, { ompHost: true })` with the same jev response. The row contains `"🛡️"` and `"🤖"`, does not contain `"\uF132"`, and has exactly 10 `"█"` (allow/ask/deny = 8/1/1 cells).
  6. Persisted junk: `h.entryRenderers["pi-verdict-label"]({ data: { tool: 1 } }, { expanded: false }, theme)` returns `undefined`.

## Critical files & anchors
- `extensions/pi-verdict.ts` `SessionState` L1586-1653: trailer map, rename to labels.
- `extensions/pi-verdict.ts` `renderJevBar` L2215-2287 and NF constants L2676-2687: bar refactor and new glyph constants.
- `extensions/pi-verdict.ts` `autoMode` L2901 (`isOmpHost`), L3375-3520: sink, `tool_result` handler, four `noteAllowed` sites.
- `tests/pi-verdict.test.ts` L46-183 (harness/session) and L3423-3482: harness host API and replaced tests.

## Verification
1. Prerequisite: `node_modules` is missing. Run `bun install --frozen-lockfile` in `C:/Git/personal/pi-verdict`.
2. Run `bun run typecheck` and `bun test`. Everything must pass, including the 6 new tests and the unchanged `renderJevBar` tests.
3. Headless omp smoke test (live omp path; the stubs cannot prove aside delivery):
   - Create a temp dir `T`. Copy `agent.db`, `config.yml` and `models.db` from `~/.omp/agent` into `T`. Write `T/config/pi-verdict.json` = `{"allow":["^echo\\b"],"deny":[],"tools":[]}`.
   - From a throwaway project dir, with `PI_CODING_AGENT_DIR=T`, run: `omp -p --session-dir T/sessions --no-title --no-extensions -e C:/Git/personal/pi-verdict/extensions/pi-verdict.ts --tools bash --no-lsp "Run exactly this bash command: echo hi. Then reply done."`
   - Expected in the session JSONL under `T/sessions`: the bash `toolResult` content has no `[auto-mode]`, and a later line has `"type":"custom_message"`, `"customType":"pi-verdict-label"`, `"display":true` and details `{"tool":"bash","how":"rule","jev":null}`. The run finishes normally (the aside did not abort the batch).
   - Run `omp render <that jsonl> --plain -w 100` (same env). The label row appears **after** the bash block. A default card showing `pi-verdict-label` / `[auto-mode] bash allowed: rule` is acceptable here, because `render` loads no extensions.
   - Delete `T`.
4. Manual (the user, interactive): copy `extensions/pi-verdict.ts` and `extensions/jev-adapter.ts` to the installed extensions dir and restart omp. Run a rule-allowed `eval` and a jev-classified call. Expected: a one-line row below each box, like ` <shield> eval <gavel> rule` and ` <shield> bash <chip> classifier <10-cell green/yellow/red bar> allow 92%`, and no `[auto-mode]` text inside the boxes.

## Assumptions & contingencies
- If the aside custom message is missing from the JSONL in step 3 although the run succeeded, check interactive omp (step 4) before concluding anything. If it is missing there too, stop and report. Do **not** switch to steer (it aborts the tool batch) or `followUp` (the row would land after the final answer).
- If `bun run typecheck` rejects the `{ render, invalidate }` literal as a renderer return, annotate it with `import type { Component } from "@earendil-works/pi-tui"`. Do not add a value import.
- Subagent calls keep producing labels into their own session (the extension is re-bound per session). That matches today's trailer, which was also in the subagent's context.
