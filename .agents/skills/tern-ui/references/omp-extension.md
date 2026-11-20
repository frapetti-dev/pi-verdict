# Native Tern UI from an omp extension

omp (Oh My Pi) speaks Tern's Surface Protocol (TSP) itself. An extension's component can return a semantic node tree from `describe()`; Tern draws it natively and sends pointer events back. Everything below was verified against `@oh-my-pi/pi-tui`, `pi-coding-agent` and `pi-wire` v18.13.x (`C:/Users/<user>/.bun/install/global/node_modules/@oh-my-pi/*`) and live in Tern 0.9.7 on Windows.

Template to copy: `assets/omp-extension-template/`. Run `scripts/describe-harness.ts` to check output (see `verification.md`).

## Contents
- Component hooks
- DescribeContext and events
- ctx.ui API
- Surface recipes: overlay, sheet, screen, widget
- Native tool cards
- Event routing, keys, memo/identity
- Capability gating
- Reserved keys
- What omp cannot reach
- Windows notes

## Component hooks

Any `Component` mounted by `ctx.ui.custom` / `setWidget` may implement these (source: `pi-tui/src/tui.ts:268-306`).

| Hook | Contract |
|---|---|
| `render(width): string[]` | ANSI fallback rows. REQUIRED even when `describe` exists (TSP is not live in Windows Terminal, tmux/zellij/screen, or under `PI_TUI_NATIVE=0`). |
| `describe(cx): NativeNode \| null` | Semantic node tree. MUST return the same object while nothing changed (the reconciler skips unchanged components by reference). `null` falls back to `render()`. |
| `nativeOverlay?: {role?, head?, size?, anchor?}` | Glass-sheet frame for an overlay. `size`: `"sm"\|"md"\|"lg"\|"full"`; `anchor`: `"center"\|"top"\|"bottom"`. `role` should be `omp.overlay.<name>`. |
| `nativeSheet?(cx): boolean` | `true` = the component's own node IS the frame (only for `picker` and `prefs` nodes). |
| `describeScreen?(cx): NativeScreen` | For fullscreen overlays: returns `{role, main, dock}` (arrays of child components or nodes). Put the component itself in `dock` so it keeps focus and events. |
| `handleNativeEvent?(event)` | Pointer/native events from Tern (see below). |
| `handleInput?(data)` | Keyboard (kitty protocol or legacy). Needed on both paths. |
| `dispose?()` | Clear timers, listeners. |
| `invalidate()` | Required by the `Component` interface; usually a no-op. |

Building blocks: node builder `{ k, p, c, key }` (`k` kind, `p` props, `c` children, `key` stable identity). `@oh-my-pi/pi-tui` also exports its own builders (`card, col, row, text, md, code, diff, ansi, kv, list, item, kbd, elapsed, node`; `pi-tui/src/native/describe.ts`); the template's `nodes.ts` builds plain nodes instead so it only needs type imports from `pi-wire`.

Imports rule: type-only imports from `@oh-my-pi/pi-tui`, `@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-wire`. The only runtime value import the template uses is `matchesKey` from `@oh-my-pi/pi-tui`. omp provides these at runtime; do not add them as dependencies.

## DescribeContext and events

`DescribeContext` (`pi-tui/src/native/node.ts`): `{cols, reduceMotion, dark, hour12?, supports(kind), feature(name)}`. It has NO clock; motion is clocked by Tern (use `spinner`, `elapsed`, `progress`, `shimmer`, `rate`).

`NativeUiEvent` is one of:

| `type` | Fields | Fired by |
|---|---|---|
| `toggle` | `key, collapsed` | collapsible card/section |
| `select` | `key, item` | list, table, tabs, picker row (single click) |
| `activate` | `key, item` | double-click / Enter on a list item |
| `action` | `key, act, value?, mods` | `actions: { click: "name" }` on any node; non-built-in action names arrive here |
| `change` | `key, item, value` | switch, select, slider, ... |
| `edit` / `undo` / `send` | editor events | `editor` nodes |

Built-in action names handled by Tern itself and NOT delivered as `action`: `toggle`, `copy`, `open`, `zoom`, `select`, `activate`.

## ctx.ui API

| API | Use |
|---|---|
| `custom(factory, {overlay, overlayOptions, ...})` | Mount a component; factory is `(tui, theme, kb, done) => Component`; resolves with the value passed to `done`. |
| `setWidget(key, factory \| undefined, {placement})` | Widget above/below the editor; `undefined` clears. |
| `select`, `confirm`, `input`, `editor`, `askDialog` | Host dialogs (`askDialog` renders natively; fall back to `select`). |
| `notify(msg, level)`, `setStatus(key, text)` | Toasts / status line. |
| `onTerminalInput(handler)` | Raw input listener (interactive mode only). |
| `setFooter`, `setHeader` | No-ops in the interactive controller. |
| `openTerminal` | Multiplexer panes only (tmux, Zellij, Herdr, CMUX, Orca). NO Tern provider: use `tern split` (`tern-cli.md`). |
| `pi.exec(cmd, argv, opts)` | Run a process. Always an argv array. |

`ctx.hasUI` is false in headless/RPC/print modes: bail out with a notify (`needsUi` in the template's `index.ts`).

## Surface recipes

### Overlay (floating dialog) -> `overlay.ts`
- `ctx.ui.custom(factory, { overlay: true, overlayOptions: { width: "80%" } })`.
- Component declares `nativeOverlay: { role: "omp.overlay.<name>", head: "Title" }` and NO `size`.
- `width: "80%"` (default choice; `"60%"` only for a really small dialog, `"90%"` for commands or diffs) becomes an undeclared `md` overlay that floats at every pane width. A declared `md`/`lg` size fills the pane in panes narrower than about 100 columns.
- The root node must not draw a second frame: no head-less `card` ring. Use `framed([...], "md")` (spacer padding) with `heading` / `prose` / `kv` / `bar`.
- Close via an idempotent `finish()`; both click and key can call it.

### Sheet (picker) -> `picker.ts`
- Component returns a `picker` node and sets `nativeSheet: cx => cx.supports("picker")`; the picker draws its own frame, sidebar scopes, rows/cards layout, hit highlights (`hits`), actions.
- The query is program-owned: handle typing in `handleInput` (`query += data`) and re-order via `order: ids[]`.
- A `picker` hides `preview` children in narrow panes (CSS class `pv-hide`, even with `size: "lg"`). Never put essential information only in a preview.
- `nativeSheet` is ONLY for `picker` / `prefs`.

### Screen (full pane) -> `screen.ts`
- `ctx.ui.custom(factory, { overlay: true, overlayOptions: { fullscreen: true } })`.
- Component implements `describeScreen` returning `{ role, main: [bodyComponent], dock: [rootComponent] }`. No `nativeOverlay`/`nativeSheet` on the root: their absence is what makes the backend treat it as a screen.
- `dock` holds the component itself (so it keeps focus, `handleInput`, `handleNativeEvent`); `main` holds content components, each with its own `describe` and `handleNativeEvent`.
- On the ANSI path `fullscreen: true` borrows the alternate screen; `render()` must produce the rows.

### Widget -> `widget.ts`
- `ctx.ui.setWidget("my-ext", factory, { placement: "aboveEditor" })`; clear with `setWidget(key, undefined)`.
- The factory receives `tui` (`tui.requestRender()` after state changes). Clear timers in `dispose`.

## Native tool cards -> `tool.ts`

`pi.registerTool({... describeCall(args), describeResult(result, opts, args)})` return a `NativeToolView`: `{ tool?: { title, target?, targetKind?, badges?, meta? }, open?: boolean, body?: NativeNode[] }`. `describeCall` draws the pending header; `describeResult` draws the final card (`open: true` expands it; `body` is a list of TSP nodes). Read data back from `result.details` and keep `details` JSON-serializable. Source: `pi-coding-agent/.../extensions/types.ts:970-973`, `NativeToolView` in `pi-tui/src/tools/renderer.ts:124`.

## Event routing, keys, memo/identity

- `event.key` is the node's key PATH (`"frame/content/actions/close"`). Take the last segment with `leafKey(e.key)` when routing by node.
- Give keys to dynamic children (`items.map(i => n("item", ..., undefined, i.id))`) so ids, selection and view state survive reorders; the reconciler diffs by `key`.
- Buttons: `button(label, act, keys)` is a `row` with role `omp.btn` and `actions: { click: act }`; its `key` is `act`. A click arrives as `{type:"action", act}`. The optional `keys` string (`"escape"`, `"ctrl+s"`) is only a keycap display: `"+"` is the separator, so a literal `+` key cannot be shown.
- Memo: `new Memo().get([version, cx.dark, ...], build)`. Bump `version` on every state change, then `tui.requestRender()`. Include every input that changes the output (`cx.cols`, `cx.dark`) in the deps.
- State mutation in `handleNativeEvent` / `handleInput` must end in `bump()` unless the component closed.

## Capability gating

| Check | Meaning |
|---|---|
| `tui.nativeRendering` | true only while a TSP surface is live (not just because `TERM_PROGRAM=tern`) |
| `cx.supports(kind)` | the terminal's handshake advertised the kind; wrap rare kinds in `guard(cx, kind, build)` |
| `cx.feature(name)` | terminal feature: `aside edit undo send flow ...` |
| `PI_TUI_NATIVE=0` | forces ANSI |
| `process.env.TERM_PROGRAM === "tern"` + `TERN_PANE` | inside a Tern pane (gate for the `tern` CLI, NOT for TSP) |

To know from outside a component whether native UI is live (e.g. to choose a different string-array widget), probe once at `session_start` with a throwaway `setWidget` factory and remember `tui.nativeRendering`.

## Reserved keys

Cannot be bound by extensions: `ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab`, `escape` and `enter` at the prompt level (overlay components still receive `escape`/`enter` in `handleInput`). Prefer plain letters or digits for shortcuts inside an overlay.

## What omp cannot reach

| Want | Why not | Alternative |
|---|---|---|
| Program CSS (`s` verb) | omp never emits `s` (`pi-tui/src/native/backend.ts`) | borrow Tern's bundled `omp.*` roles (`roles-and-layout.md`) or run a standalone SDK program (`standalone-sdk.md`) |
| `flow` surfaces | omp modes are `inline` / `screen` only | SDK program in a split |
| `el`, `block`, `stats`, `button`, `select`, `switch`, `calendar` kinds | absent from `TSP_KINDS` (`pi-wire/src/tsp.ts:38-82`) | SDK program |
| Tab bar, status line, palette commands, key binds, CSS for chrome, block types | Tern-side plugin territory | `luau-plugins.md` |
| Open Tern panes via `ctx.ui.openTerminal` | no Tern provider | `tern split` (`tern-cli.md`) |
| Raw ANSI output while a surface is live | non-TSP bytes are hidden | use nodes; do not write escapes |
| Overlay placement (`row/col/offset/margin`) | only anchor `top/center/bottom` and size `sm/md/lg/full` carry over | `anchor`, `size`, `width` |

## Windows notes

- TSP needs Tern's bundled ConPTY (`conpty.dll`, `OpenConsole.exe` next to `tern.exe`); client-to-program messages arrive as OSC 877 because ConPTY drops APC. Plain Windows Terminal/conhost never answers the handshake: omp stays on ANSI. Hence `render()` is not optional.
- Extensions load via `file://` specifiers and Bun ignores their query strings: restart omp after every edit.
- `tern.exe` is on `PATH`; `pi.exec("tern", [...])` works without a shell.
