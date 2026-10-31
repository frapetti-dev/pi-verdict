# Can omp extensions use the full window capabilities of the `tern` terminal?

*Researched 2026-10-29 on Windows 10.0.26300 (x64). Versions observed: omp 18.13.3 (`omp --version`), Tern 0.9.7 (`TERM_PROGRAM_VERSION`).*
*Moved from `omp/docs/research/omp-extensions-tern-window.md`; the showcase extension this note led to lives alongside it at [`tern-showcase/`](tern-showcase/).*

## Question

"I'm using the `tern` terminal with omp (the omp coding-agent harness). Can omp extensions be written that use the full window capabilities of tern?"

## Short answer

**Mostly yes, but through three different doors, and one of them is narrower than Tern's own docs suggest.**

1. **Native UI (the big one): yes, from inside an extension.** omp is built by the same company as Tern (Stencil Labs) and speaks Tern's *Surface Protocol* (TSP) itself. An extension's custom component can implement `describe()` / `describeScreen()` / `handleNativeEvent()` and Tern then draws cards, tables, markdown, diffs, images, overlays, pickers and full-page screens natively, with pointer events coming back. Overlays with `fullscreen: true` become a Tern `screen` surface. If Tern isn't answering the handshake, the same components silently fall back to ANSI rows.
2. **Window / pane / tab control: yes, by shelling out.** Tern ships a scripting CLI (`tern split|new|pip|dock|focus|move|run|send|capture|events|open|browser|ls …`) that works from inside a pane (verified live on this Windows box). An extension can call it with `pi.exec`. omp's built-in `ctx.ui.openTerminal` does **not** support Tern (only tmux, Zellij, Herdr, CMUX, Orca).
3. **Tern-side chrome (tab bar, status line, layouts, CSS, key binds, block types): not from an omp extension.** That needs a separate Tern **Luau plugin**; the two can only cooperate through files, processes, pane writes or the `tern` CLI [INFERENCE: no direct omp↔plugin API was found].

**Not reachable through omp's TSP layer as shipped (18.13.3):** TSP's HTML `el` kind, program stylesheets (`s` verb), program palette (`t` verb) and `flow` surfaces: omp's wire types contain none of them. Workaround: spawn a helper program using the Tern SDK in a new pane. Partial exception for styling: Tern ships its own CSS for omp's `omp.*` role names, and a node of any extension can carry one of those roles to borrow it (measured, see "Typography and roles" below).

## What tern is

Several unrelated projects share the name. Candidates and the pick:

| Candidate | Evidence | Picked? |
| --- | --- | --- |
| **Tern by Stencil Labs**, "a Rust native, Kitty compatible, multiplexer"/"neoterminal", Windows/macOS/Linux, closed beta | `https://stencil.so/tern` (title "Tern · Stencil", "CLOSED BETA", "Built for omp"); docs at `https://docs.stencil.so/tern/` | **Yes** |
| `cuong95nddev/tern` (macOS terminal for coding agents, Rust/GPU) | listed in a web search result, `https://github.com/cuong95nddev/tern`; not opened | No |
| `your-moon/tern` (SSH client, Rust/GPUI) | listed in a web search result, `https://github.com/your-moon/tern`; not opened | No |
| Tera Term (Windows terminal emulator, a near-homonym) | web-search result, `https://teratermproject.github.io/index-en.html` | No |

**Why Stencil Tern:** this very shell runs in it. Probed in this session: `TERM_PROGRAM=tern`, `TERM_PROGRAM_VERSION=0.9.7`, `TERN_PANE=4294967298`, `TERN_PANE_SOCKET=\\.\pipe\tern-f.rapetti`, `TERN_WINDOW_KEY=2`, `TERN_BLOB_DIR`, and `tern.exe`/`tern.com` at `C:\Users\f.rapetti\AppData\Local\Programs\Tern\` beside `conpty.dll` and `OpenConsole.exe` (`env`, `where tern`, `ls`). `tern ls` and `tern whoami --json` both work from this pane. omp's own source names it: "Tern (Stencil's terminal, `stencil-term`) sets TERM_PROGRAM=tern" (`[PI-TUI]/src/terminal-capabilities.ts:629-633`), and `[PI-TUI]/package.json:7-10` lists the author as "Stencil Labs, Inc." The Tern install also keeps its own copy of omp (`C:\Users\f.rapetti\AppData\Local\Tern\omp\bin\omp.exe`, first on `PATH`; `omp --version` → `omp/18.13.3`, same as `~/.bun/bin/omp.exe`).

Tern's own description (`https://stencil.so/tern`): sessions outlive the window (daemon), shells/omp/browser panes, git/SQLite/Jupyter/kanban blocks, `tern` scripting CLI, `tern remote serve`/`tern web serve`, and "programs describe their UI over the Tern Surface Protocol, and Tern draws it natively." Availability: closed beta (waitlist) on the same page.

## What omp extensions can do (UI surface)

Extensions are in-process TS/JS modules (`omp://extension-loading.md`, "Runtime isolation model": "Extensions are **not sandboxed**"). Loaded from `<cwd>/.omp/extensions`, `~/.omp/agent/extensions`, `package.json#omp.extensions`, or `extensions:` in settings (`omp://extension-loading.md`, "Inputs to extension loading"). This repo itself is such a package (`package.json`: `"omp": { "extensions": ["./src/index.ts"] }`).

### The generic TUI surface (works in any terminal)

`ctx.ui` = `ExtensionUIContext` (`[PI-CA]/src/extensibility/extensions/types.ts:311-444`):

| API | Line | Notes |
| --- | --- | --- |
| `custom(factory, {overlay, overlayOptions, onHandle, signal})` | 373, 255-264 | Mounts a `Component` in the editor area or as an overlay with focus (`omp://tui.md:131-132`; `omp://tui.md` "Extension UI (`ExtensionUIContext`)") |
| `select`/`confirm`/`input`/`editor`/`askDialog`/`approve` | 317-346, 398 | dialogs |
| `onTerminalInput(handler)` | 352 | raw input listener; interactive mode only (`omp://extensions.md:1082`: unsupported in RPC) |
| `setWidget`, `setStatus`, `setWorkingMessage`, `setTitle`, `notify` | 361, 355, 358, 370, 349 | widgets above/below editor (`omp://extensions.md:919-922`) |
| `setEditorComponent` (must return a `CustomEditor` subclass), `addAutocompleteProvider` | 420, 411 | |
| `setFooter`, `setHeader` | 364, 367 | **no-ops in the interactive controller** (`omp://extensions.md:908-911`) |
| `openTerminal(request)` | 326 | multiplexer panes only: tmux, Zellij, Herdr, CMUX, Orca; "not an OS window" (`omp://extensions.md:927-930`); the provider files under `[PI-CA]/src/subprocess/terminal-launch/` are `cmux, herdr, orca, tmux, zellij` (directory listing), no Tern provider; Herdr is rejected on Windows (`omp://extensions.md`, "Herdr launches are rejected on Windows") |
| `registerComposerShape`, `registerMessageRenderer`, `registerAssistantThinkingRenderer`, tool `renderCall`/`renderResult` | `omp://extensions.md:1190-1296` | custom renderers |
| `pi.exec(command, args, options)` | `types.ts:1955` | run any process (available even during load, `omp://extensions.md:1300`) |

Component contract (`omp://tui.md`, "Core component contract"): `render(width): string[]` + optional `handleInput`, `wantsKeyRelease` (key-release events filtered unless set, `omp://tui.md:120-124`; `[PI-TUI]/src/tui.ts:323`), focus/cursor marker.

**Full-screen / alternate screen (ANSI path):** `OverlayOptions.fullscreen: true` "Borrow[s] the terminal's alternate screen buffer for this overlay's lifetime"; `mouseTracking` (default on) enables mouse reporting while fullscreen (`[PI-TUI]/src/tui.ts:456-505`; SGR decoding in `[PI-TUI]/src/mouse.ts:1-30`). Opt-in mouse capture in the main view is the `tui.mouse` setting, default `false`; native text selection becomes Shift+drag (`omp://settings.md:892`).

**Raw escape output:** a custom factory receives `tui: TUI` whose `terminal: Terminal` has `write(data: string)` (`[PI-TUI]/src/terminal.ts` `interface Terminal`, line 565 ff., `write` at 602; `TUI.terminal` at `tui.ts:821`). `writeTerminalSequence` and `writeThroughActiveTerminal` are exported from `terminal.ts` (re-export line 40). It is possible but unsupported by any documented extension contract, and in native mode see "Stray output" below.

**Capability detection:** `tui.nativeRendering` (`tui.ts:1686`), `TERM_PROGRAM` (`terminal.ts:59-61`), omp's own terminal table (`terminal-capabilities.ts:629-633`: Tern ⇒ Kitty image protocol, truecolor, hyperlinks, OSC 99 notifications), `DescribeContext.supports(kind)` / `.feature(name)` (`[PI-TUI]/src/native/node.ts:73-93`), env overrides `PI_TUI_NATIVE`, `PI_TUI_TSP_RECORD`, `PI_FORCE_IMAGE_PROTOCOL` (`omp://environment-variables.md:647-652`).

### The Tern-native surface (Tern Surface Protocol)

omp probes for TSP at startup: APC `tsp` hello behind a DA1 sentinel; direct Tern sessions optimistically open a surface immediately and fall back to rows if Tern doesn't confirm; `PI_TUI_NATIVE=0` forces ANSI; multiplexers skip the probe (`omp://tui-core-renderer.md:166-186`, `omp://environment-variables.md:648`). Once live, "None of [the row/history/viewport/resize] machinery runs"; components are *described*, reconciled to document ops and sent as frames paced by Tern's acks (`omp://tui-core-renderer.md:174-181`; `[PI-TUI]/src/native/backend.ts:1-31`).

What this means for an extension author:

| Hook | Where | Effect |
| --- | --- | --- |
| `describe(cx): NativeNode \| null` on any `Component` | `[PI-TUI]/src/tui.ts:273`; extension components are `Component & {dispose?}` (`[PI-TUI]/src/chat/extension-types.ts:5`) | Return a semantic node tree instead of rows; `null`/absent ⇒ `rows` fallback node from `render()` (`omp://tui.md:206`) |
| Builders `card, col, row, text, md, code, diff, ansi, kv, list, item, kbd, elapsed, node(...)` | `[PI-TUI]/src/native/describe.ts`; exported from `@oh-my-pi/pi-tui` index (`index.ts:62-66`) | |
| `handleNativeEvent(event)` | `tui.ts:306`; `NativeUiEvent` = `toggle`, `select`, `activate`, `action` (act/value/mods), `change`, `edit`, `undo`, `send` (`[PI-TUI]/src/native/node.ts:118-139`) | Pointer actions come back (click, double-click, context-menu entries) |
| `describeScreen(cx): NativeScreen` + overlay `fullscreen: true` | `tui.ts:303`; `native/backend.ts:452-480` | A fullscreen overlay becomes a Tern `mode:"screen"` surface with your own `main`/`dock` regions and `role`; the inline omp surface pauses and resumes untouched |
| `nativeOverlay`, `nativeSheet(cx)` | `tui.ts:282, 295` | Choose the glass-sheet role/head/size, or make a `picker`/`prefs` node the frame itself |
| `describeCall` / `describeResult` on `registerTool` definitions → `NativeToolView` | `[PI-CA]/src/extensibility/extensions/types.ts:970-973`; `NativeToolView` `[PI-TUI]/src/tools/renderer.ts:124` | Native tool cards (`tool` node, else `card`) |
| `Image` component describes itself as an `image` node; bytes become content-addressed blobs (`b` verb, or Tern's on-disk blob cache under `TERN_BLOB_DIR`) | `[PI-TUI]/src/components/image.ts:794`, `native/blobs.ts:1-9`, `native/backend.ts:15-25` | Inline images without Kitty escape sequences |
| `reveal`/`scroll` on nodes, `DescribeContext{cols,reduceMotion,dark,hour12,supports,feature}` | `native/node.ts:26-93` | |

Tern side of the same contract (what the terminal promises): programs own state and keys; Tern owns layout, animation (spinners/shimmer/elapsed clocked by Tern, honours Reduce Motion), hover/scroll, native text selection in editors (`edit`/`undo`/`send` features), and keeps every node addressable in scrollback (`https://docs.stencil.so/tern/protocol/index.md` "Who owns what"; `…/protocol/input.md` "Native editing", "Pointer actions"; `…/protocol/operations.md` "Flow control", "Retention"). Element vocabulary: `col row card section rule spacer text md code diff ansi rows math image kv table tree badge kbd icon spinner shimmer elapsed progress rate list item tabs picker editor input status seg overlay toast tool checklist agent chart meter effort prefs block el` (`https://docs.stencil.so/tern/elements/index.md`, "Every kind").

## What tern offers

### Standard terminal side
- Env: `TERM_PROGRAM=tern`, `TERM_PROGRAM_VERSION`; on this box `TERM=dumb` inside the agent's non-PTY shell and `TERMINFO` points at a Tern-shipped terminfo (`env`; `tern ssh` copies Tern's terminfo to hosts that lack it, `tern --help`).
- Keys reach programs "as they always have: on the pty, as input: the kitty keyboard protocol, bracketed paste" (`https://docs.stencil.so/tern/protocol/input.md`, "Keys").
- Per omp's capability table (omp source, **not Tern docs**): Kitty graphics, OSC 8 hyperlinks, OSC 99 notifications (`[PI-TUI]/src/terminal-capabilities.ts:629-633`). omp's event controller treats OSC 9;4 progress as Tern's per-pane "busy" state and always sends it under Tern (`[PI-CA]/src/modes/controllers/event-controller.ts:1029-1038`).
- I found no Tern-authored page enumerating its xterm/Kitty/sixel/iTerm2 escape-sequence support. [INFERENCE] Sixel/iTerm2 images are not claimed by Tern; omp's table gives Tern only the Kitty protocol.

### Tern Surface Protocol (TSP v1)
- In-band APC `ESC _ tsp;<verb>;…ESC \`. Verbs: `q o f b t s x` (program→terminal) and `r e` (terminal→program) (`…/protocol/transport.md`). Works over ssh and through the session daemon.
- Modes: `inline` (session), `screen` (full pane), `flow` (output that stays in scrollback) (`…/protocol/surfaces.md`, "Modes").
- Regions `main` / `dock` / `layer`; overlays; aside `prefs` sheet; program palette (`t`) and **program CSS** (`s`, scoped to the surface, no `url()`/`position:fixed`) (`…/protocol/surfaces.md`, `…/protocol/operations.md` "Security and limits").
- Flow control: 2 credits, `ack`; limits 200 000 nodes, 16 MiB blobs, 262 144-byte APC (`…/protocol/operations.md`).
- Debugging: `PI_TUI_TSP_RECORD`/`TERN_TSP_RECORD` JSONL, Tern's `surface-play` replays it (`…/protocol/operations.md` "Debugging"; `omp://environment-variables.md:649`).
- SDKs for Rust/Python/Go/TypeScript (`@stencil-hq/tern`): `print`, `ask`, `chat` helpers; repo `https://github.com/stencil-hq/tern-sdk` (MIT; `…/protocol/sdks.md`).

### Windowing / scripting (Tern CLI, from `tern --help`, `tern help dev`, `tern <cmd> --help`)
`tern [DIR]`, `tern open [--split right|down|--tab|--preview] [--wait] PATH[:LINE[:COL]]`, `tern ls|inspect|new|split|run|move|pip|dock|rename|focus|close|kill|wait|keep-open|send|capture|process|events|browser`, `tern restart`, `tern whoami`, `tern ctl …`, `tern ssh`, `tern plugin …`, `tern daemon`, `tern remote serve|install|login|trust|hosts|discover`, `tern web serve`. Notable:
- `tern split BLOCK right|down [--cwd D] [--keep-open] [-- COMMAND…]`, `tern new session|tab`, `tern pip BLOCK [--over BLOCK] [--corner tl|tr|bl|br]`, `tern dock`, `tern move`, `tern focus`.
- `tern send BLOCK keys|text|paste|mouse press|release|move COL ROW`, `tern capture BLOCK [--html|--ansi] [--scrollback] [--surfaces]`, `tern wait BLOCK [--until exit|prompt|idle=MS]`, `tern events [--filter KIND,…]` (JSON lines).
- `tern browser JSON` (open/goto/snapshot/act/eval/capture a browser PiP over a block).
- "Every command works on one window's sessions: `--window KEY`'s, else the window of the pane it runs in (its key is `$TERN_WINDOW_KEY` there)" (`tern ls --help`).
- Live probe: `tern ls` and `tern whoami --json` succeeded from this pane on Windows, listing sessions/tabs/blocks with ids such as `4294967298`.
- Control sockets: `TERN_PANE_SOCKET` (Windows named pipe `\\.\pipe\tern-f.rapetti`), `TERN_DAEMON_SOCKET` (`tern --help`, env section; `env`). omp itself talks to that socket with a length-prefixed JSON protocol for its browser PiP and for `/fork` into a new pane (`[PI-CA]/src/tools/browser/tern/wire.ts:1-17, 375`, `kind.ts:1-49`). That protocol is documented only in those source comments (they cite Tern's `crates/tern/src/daemon/json.rs`, not public); treat it as unstable.

### Tern plugins (Luau), a *different* extension system
Packages with `plugin.toml` + `host.luau` (daemon side) + `window.luau` (each window's UI thread). Can add block types (native panes drawn from Lua), command lenses, pane hooks, palette commands, key binds, built-in overrides, route file opens/links, format tab bar/title/status line, CSS (`tern.css`), script layout (`cx.layout`) (`https://docs.stencil.so/tern/index.md`, "Two halves"). Manage with `tern plugin list|reload|dir|install|remove|link|unlink|types`. Plugins run as you, no permission system (`…/concepts/security.md`), and can `tern.process.run`, `tern.fs`, `tern.pane.write`, `cx:run`. Support matrix: host half, window half, `tern.process.run` and the `tern plugin` CLI are all "Yes" on Windows (`…/concepts/support-matrix.md`). Blocks "open a screen surface with role `plugin.<plugin>.<block>` and speak the Tern Surface Protocol the same way a program would" (`…/concepts/architecture.md`).

## Gap analysis

"omp extension can reach" is judged against omp 18.13.3 sources/docs; "how" is the concrete route. Items marked [INFERENCE] are not verified end to end.

| Capability | Tern supports | omp extension can reach | How / notes |
| --- | --- | --- | --- |
| Native semantic UI (cards, tables, md, diff, code, kv, tree, charts, progress) | Yes: TSP element kinds | **Yes** | `describe()` on a component; `describeCall`/`describeResult` on tools; builders from `@oh-my-pi/pi-tui` (`tui.ts:273`, `native/describe.ts`). Falls back to `rows` when Tern doesn't confirm TSP (`omp://tui-core-renderer.md:174-186`). Guard with `tui.nativeRendering` / `cx.supports(kind)` |
| Overlays, sheets, pickers, toasts | Yes: `overlay`, `picker`, `prefs`, `toast` | **Yes**, with a narrowed mapping | `ctx.ui.custom(..., {overlay:true})`, `nativeOverlay`, `nativeSheet`. omp maps overlay options only to anchor `top/center/bottom` and size `sm/md/lg/full` (`native/backend.ts:256-275`), so `row/col/offsetX/offsetY/margin` placement is not carried to Tern |
| Full-screen takeover | Yes: `screen` surface | **Yes** | overlay `fullscreen:true` (+ `describeScreen` for regions/role) ⇒ Tern `screen` surface (`backend.ts:452-480`); on ANSI path ⇒ real alternate screen (`tui.ts:500`) |
| Pointer: click / double-click / context menu / fold | Yes: `actions`, `toggle/select/activate/action` events | **Yes** | `handleNativeEvent` (`node.ts:118-139`). Hover, scrolling, selection are Tern's (`…/protocol/input.md`) |
| Raw SGR mouse reporting | Not documented by Tern [INFERENCE: not needed on TSP path] | ANSI path only | `tui.mouse` setting, fullscreen `mouseTracking` (`omp://settings.md:892`, `tui.ts:505`). On the native path use pointer events instead |
| Keyboard | Yes: kitty keyboard protocol, bracketed paste | **Yes** | `handleInput`, `wantsKeyRelease`, `ctx.ui.onTerminalInput`; reserved keys (`ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab`, `escape`, `enter`, …) can't be bound (`omp://extensions.md`, "Constraints and pitfalls") |
| Native text editing (selection, undo, atomic send) | Yes: `edit`/`undo`/`send` features | Yes, via the composer / `CustomEditor` | omp advertises `features:["edit","undo","send"]` (`omp://tui-core-renderer.md:204-207`); `setEditorComponent` factory must return a `CustomEditor` subclass (`types.ts:420`) |
| Images | `image` node (blobs); Kitty graphics per omp's table | **Yes** | `Image` component describes itself (`components/image.ts:794`); blob upload/cache automatic (`native/blobs.ts`) |
| Program CSS stylesheets (`s` verb), program palette (`t`) | Yes | **No through omp's layer** (partly via bundled roles) | `TspVerb = "q"\|"o"\|"f"\|"b"\|"x"\|"r"\|"e"` only (`[PI-WIRE]/src/tsp.ts:31`). Workaround [INFERENCE, untested]: `tui.terminal.write()` a raw APC `s`/`t` message for omp's surface id; undocumented and could desync omp's reconciler. Safer: helper process in its own pane (below). Measured partial route: put one of Tern's bundled `omp.*` roles on a node (e.g. `omp.advisor.note` on `text`) to get its font, size and weight, see "Typography and roles" |
| `el` HTML elements/forms, `block` kind | `el` and `block` listed in Tern's vocabulary | **No (typed out)** | omp's `TSP_KINDS` (`[PI-WIRE]/src/tsp.ts:38-82`) has no `el`/`block` and does have `media`, which Tern's docs table doesn't list; versions may differ [INFERENCE]. Check Tern's live `hello.kinds` with `PI_TUI_TSP_RECORD` |
| `flow` surfaces (output kept in scrollback) | Yes (feature `flow`) | **No via omp's TUI** (`mode: "inline"\|"screen"`, `backend.ts:231`) | Run a Tern-SDK CLI via `pi.exec`/new pane, or `tern open` / `tern capture` |
| Stray raw ANSI/escape output | Hidden while an inline surface owns the pane | **Effectively no in native mode** | "Bytes that aren't TSP while a surface is live … stay hidden with the rest of the grid until it closes or suspends" (`…/protocol/surfaces.md`, "Stray output"). Title/progress/notification OSCs are fine (omp already sends progress) |
| Split / tab / session / float (PiP) / dock / move / focus / close | Yes: CLI + daemon JSON protocol | **Yes, by shell-out** | `pi.exec("tern", ["split","@focused","right","--","cmd"…])`, `tern new tab`, `tern pip`, `tern dock`, `tern move`, `tern focus`. Not via `ctx.ui.openTerminal` (no Tern provider) |
| Type into / read other panes | Yes: `tern run/send/capture/wait/process` | **Yes, by shell-out** | `tern send BLOCK text …`, `tern capture BLOCK --surfaces`, `tern wait … --until idle=MS` |
| Observe window events | Yes: `tern events` (JSON lines) | **Yes, by spawning** | long-lived `Bun.spawn`/`pi.exec` of `tern events --filter pane_spawned,layout_changed` (the filter names come from the site's demo, `https://stencil.so/tern`); manage lifetime with `ctx.setInterval`-style helpers (`omp://extensions.md:409-430`) |
| Open files/media beside omp, `EDITOR` integration | Yes: `tern open [--preview/--split/--tab/--wait]` | **Yes, by shell-out** | `pi.exec("tern", ["open","--preview", path])` |
| Browser PiP over omp's pane | Yes: `tern browser` | **Yes** (built-in) | omp's `browser` tool Tern backend (`omp://tools/browser.md:147,150`; `app.tern`). Doc says "native WKWebView" (macOS wording); Windows web engine not stated in any source I found [INFERENCE: platform webview] |
| Tab bar, status line, window title formatting, layouts, CSS for Tern chrome, key binds, block types, lenses | Yes: Luau plugins | **No from an omp extension** | Write a Tern plugin (`plugin.toml` + `host.luau`/`window.luau`); install with `tern plugin link DIR`. Coordinate with omp via `tern.process.run`, `tern.pane.write`, files [INFERENCE: no direct IPC found] |
| Several Tern windows, OS window frame, global shortcuts, notifications dialogs | Tern-internal (`tern ctl system`/`dialog`, `help dev`) | **No** (developer tooling, not an extension API) | `tern ctl` is documented as dev tooling (`tern help dev`) |
| Capability detection | `hello` reply: `kinds`, `features`, `cell`, `dark`, `reduceMotion`, `hour12`, `cols` (`…/protocol/handshake.md`) | **Yes** | `tui.nativeRendering`, `DescribeContext.supports/feature`, `TERM_PROGRAM` |
| Headless / RPC / print / ACP modes | n/a | **No UI** | `ctx.hasUI` false or `custom()` unsupported (`omp://tui.md:12-22`, `omp://extensions.md:1072-1100`) |
| tmux/screen inside Tern | Swallow APC | **ANSI fallback** | omp skips the probe in multiplexers unless forced (`omp://tui-core-renderer.md:168-172`; Tern: "tmux, screen and zellij swallow APC strings", `…/protocol/handshake.md`) |

### Recommended architecture for an extension that wants "full Tern"
1. **In-session UI**: components with `describe()`/`describeScreen()`/`handleNativeEvent()`, with a rows fallback (so it works in Windows Terminal too).
2. **Window orchestration**: a thin helper calling `pi.exec("tern", …)`; check `process.env.TERM_PROGRAM === "tern"` and `TERN_PANE` first (the same gate omp uses: `[PI-CA]/src/tools/browser/tern/kind.ts:22-49`).
3. **Anything needing CSS, `el` forms, flow output or custom Tern chrome**: ship a separate program using `@stencil-hq/tern` (opened with `tern split … -- cmd`) and/or a Tern Luau plugin.

## Typography and roles (measured live)

*Measured 2026-10-30 on omp 18.14.0 inside Tern, while redesigning pi-verdict's dialogs. Method: a throwaway extension (or the pi-verdict `/verdict-debug` screens) in a side pane started with `tern split "$TERN_PANE" right --keep-open --cwd DIR --json -- pwsh -NoProfile -Command "$env:PI_CODING_AGENT_DIR='TMP'; omp --no-extensions -e EXT.ts"` (temp agent dir with copies of `agent.db`, `config.yml`, `models.db` for model auth), driven with `tern send ID text …` / `tern send ID keys enter`, and `tern ctl shot NAME` which writes `NAME.png` plus `NAME.layout.json` (every element with its computed `fontFamily`, `fontSize`, `fontWeight`) under `%LOCALAPPDATA%\Programs\Tern\target\shots\tern\live\`. Fonts below are read from those dumps, not judged from the screenshots. Pane ids come from `tern inspect` (indented first column); `$(…)` capture of `tern split --json` stdout fails on this box, redirect to a file.*

### Which node kinds are sans or monospace

Tern draws Geist (sans) or JetBrains Mono (monospace). Without a role:

| Where | Font |
| --- | --- |
| `text`, `md`, `code`, `card` content, `kv`, `section` heads, `list`/`item` content, table body cells, in overlays, docks and widgets | monospace |
| Overlay title (`nativeOverlay.head`), `omp.btn` buttons, `badge` chips, `tabs`, table header cells, the `picker` sheet (rows, details, subtitle) | sans |
| `md` in the chat transcript (`main` region) | sans, but not reachable from a dialog |

Consequence: a dialog built from plain `text`/`md` nodes is monospace, whatever its container. The only sans body text without a role is the `picker` sheet.

### `picker` hides its preview in narrow panes

A `picker` with `preview` children shows them only while the sheet is wide. In a narrow pane the 580 px sheet gets the class `pv-hide` and the preview is dropped, even with `size: "lg"`. So a picker cannot be relied on to display the command, a classifier opinion or a free-text field. pi-verdict therefore uses a picker only for the trust prompt (no heavy content) and keeps approvals as a card dialog.

### Roles restyle nodes, and an extension can reuse Tern's roles

`role` on a node is a hook into Tern's bundled stylesheet. omp's own `describe()` implementations use `omp.*` names such as `omp.plan.body`, `omp.plan.options`, `omp.btn`, `omp.sheet.head`. Nothing stops an extension from setting the same names on its own nodes. Test: 578 distinct `"omp.*"` strings found by grepping `@oh-my-pi/pi-tui/src`, each put on (a) an `md` node, (b) a `text` node and (c) a `col` wrapping an `md`, 578 nodes per run, computed font read per node. Roles that gave a sans face: 55 on `md`, 57 on `text`, 61 on `col>md` (the rest stayed monospace). The effect is per kind: `omp.plan.body` makes `md` and `col>md` sans but leaves `text` monospace, and `omp.ask.question` makes only `md` sans.

Roles that give plain prose, as measured (family size/weight):

| Role | on `md` | on `text` | on `col>md` | What it looks like |
| --- | --- | --- | --- | --- |
| `omp.advisor.note` | sans 13.5/400 | sans 13.5/400 | sans 13.5/400 | compact, no box, no padding (used by pi-verdict) |
| `omp.plan.body` | sans 13.5/400 | monospace | sans 13.5/400 | plan prose; used for pi-verdict's explanation `md` |
| `omp.plan.feedback` | sans 16/400 | sans 16/400 | sans 16/400 | roomy: adds vertical padding per row |
| `omp.plan.prompt` | sans 13/550 | sans 13/550 | sans 13/550 | bold prompt line |
| `omp.plan.note` | sans 12.5/400 | sans 12.5/400 | sans 12.5/400 | boxed note with an accent bar on the left |
| `omp.ask.question` | sans 15/550 | monospace | monospace | question line, `md` only |
| `omp.sheet.head` | sans 14/600 | sans 14/600 | sans 14/600 | section heading |
| `omp.hub.title` | sans 17/600 | sans 17/600 | sans 17/600 | large title |
| `omp.app.git.body`, `omp.usage.label`, `omp.welcome.tip`, `omp.app.git.message` | sans 12.5-13/400 | same | same | plain sans; not inspected for padding or boxes |

Caveats. Only fonts were read from the dumps; backgrounds, borders and padding were judged from screenshots for the `omp.plan.*` roles and `omp.advisor.note`, and not at all for the other roles. The names are Tern's, not a documented extension API, so a Tern release can rename or restyle them [INFERENCE: nothing in the docs promises stability]. A role replaces the node's own role, so an extension's custom role on the same node would be lost. Probe pitfall: Escape did not dismiss a custom overlay in a throwaway probe extension (the overlay stayed open), so each probe mode needs its own pane.

### How omp's plan review window is built (a model to copy)

`@oh-my-pi/pi-tui/src/overlays/plan-review-overlay.ts`, class `PlanReviewOverlay` (`describe()` ~l.1533). It is plain TSP nodes with Tern-owned roles, not a `picker`:

- `nativeOverlay` is `{role: "omp.overlay.planReview", size: "lg", anchor: "center", head: <the plan's first heading>}`; the root is a borderless `col` (gap `md`), the overlay is the frame.
- Head tools: right-aligned `row` (`omp.plan.tools`) of buttons (Copy, Edit in `$EDITOR`, Cancel).
- Body: `col` `omp.plan.body` (grow) of one `md` per section, annotations as `col`s with `omp.plan.note`; with enough headings, a `row` puts a Contents `list` (`omp.plan.toc`, depth roles `omp.plan.toc.depthN`) in a 32ch sidebar next to the body.
- Strategy slider: a `tabs` node (`omp.plan.strategy`); decision bar: a `list` of items (`omp.plan.options`) that Tern lays out as buttons with the first as the hero; submitting state is a `spinner`.
- Focus is shown with `tone: "accent"` on the focused region; events come back through `handleNativeEvent` (`action`, `select`, `activate`).

So the plan window mixes sans UI and rendered markdown because its roles carry the styling, not because of a different node kind. The same mechanism is what the pi-verdict ask, review and confirm dialogs reuse.

### Other measured layout facts

- Gap tokens accepted by `col`/`row`: `none|xs|sm|md|lg`.
- A declared overlay size `md`/`lg` becomes `full` in panes under about 100 columns; an undeclared `md` obtained with `overlayOptions.width: "60%"` floats at every pane width.

## Windows caveats

- TSP on Windows goes through ConPTY. Tern's own docs: ConPTY's input parser discards APC, so **terminal→program** TSP messages are written as OSC 877 (`ESC ] 877 ; tsp ; … ESC \`); **program→terminal** stays APC, and "the inbox conhost of Windows re-renders the program's output and drops APC, so TSP needs the ConPTY that Tern bundles (`conpty.dll` and `OpenConsole.exe`, installed next to `tern.exe`)" (`https://docs.stencil.so/tern/protocol/transport.md`, "Windows"). Both files are present here (directory listing). omp handles the OSC 877 framing (`[PI-TUI]/src/terminal.ts:49-54, 93-100, 1710`).
- omp's `describe()` extensions therefore work on Windows only inside Tern's bundled ConPTY, which is what the Tern docs require for TSP; [INFERENCE] a plain conhost/Windows Terminal session never answers the `hello`, so omp stays on ANSI rows there. Don't write code that assumes TSP just because `TERM_PROGRAM=tern`; use `tui.nativeRendering`.
- Tern's keyboard path: the omp TUI contains a Windows win32-input-mode decoder for hosts without the kitty keyboard protocol (`[PI-TUI]/src/windows-input-mode.ts:1-23`); whether Tern needs it [INFERENCE: not for Tern, which documents the kitty keyboard protocol].
- Extension loading on Windows uses `file://` specifiers; Bun ignores their query strings, so edit-and-reload of extension modules in a live session is **not** guaranteed (`omp://extension-loading.md`, "Module import and factory contract"). Restart omp after editing an extension.
- `ctx.ui.openTerminal` has no Tern provider on any OS, and Herdr launches are rejected on Windows (`omp://extensions.md`, "Herdr launches are rejected on Windows"); use `tern split` instead.
- Shell-outs: `tern.exe`/`tern.com` are on `PATH` (probed). When calling `pi.exec`, pass an argv array (no shell). Tern's own docs warn that text typed into panes via `cx:run` / `tern.pane.write` runs in the user's shell with that shell's quoting rules (`https://docs.stencil.so/tern/concepts/security.md`, "Developing"), so prefer `tern split … -- COMMAND ARGS` over `tern run`/`tern send` for anything built from untrusted text.
- Plugin side: all plugin capabilities relevant here are "Yes" on Windows; in-place daemon upgrade is Unix-only; the daemon socket is a named pipe (`…/concepts/support-matrix.md`).
- `tern browser`: "Native calls install the platform browser driver … other unsupported platforms return unsupported" (`tern browser --help`); omp falls back to Chromium when Tern reports `unsupported`/`no_window`/`connect` (`[PI-CA]/src/tools/browser/tern/wire.ts:50-60`).
- Tern 0.9.7 is closed beta; the public docs at `docs.stencil.so` may describe newer behaviour than this build (e.g. their handshake example shows `ver 0.4.3`) [INFERENCE].

## Sources

**Local, read in this session**
- Tern installed binary help: `tern --help`, `tern help dev`, `tern plugin --help`, `tern <split|new|run|send|capture|pip|dock|open|browser|events|wait|ls …> --help`; `tern ls`, `tern whoami --json`.
- Environment/FS probes: `env` (TERM_PROGRAM, TERN_*), `where tern`, `ls` of `%LOCALAPPDATA%\Programs\Tern`, `%LOCALAPPDATA%\Tern`, `omp --version`.
- omp internal docs (`omp://…`): `tui.md`, `tui-core-renderer.md`, `tui-runtime-internals.md`, `extensions.md`, `extension-loading.md`, `environment-variables.md`, `settings.md`, `theme.md`, `tools/browser.md`, `keybindings.md`.
- omp source (installed packages, v18.13.3), abbreviations:
  - `[PI-TUI]` = `C:/Users/f.rapetti/.bun/install/global/node_modules/@oh-my-pi/pi-tui` (`src/tui.ts`, `src/terminal.ts`, `src/terminal-capabilities.ts`, `src/native/{node,describe,backend,overlay,blobs,encode}.ts`, `src/components/image.ts`, `src/mouse.ts`, `src/windows-input-mode.ts`, `src/chat/extension-types.ts`, `src/tools/renderer.ts`)
  - `[PI-CA]` = `…/@oh-my-pi/pi-coding-agent` (`src/extensibility/extensions/types.ts`, `src/tools/browser/tern/{wire,kind}.ts`, `src/modes/controllers/event-controller.ts`, `src/subprocess/terminal-launch/`)
  - `[PI-WIRE]` = `…/@oh-my-pi/pi-wire` (`src/tsp.ts`)
- Repo: `C:/Users/f.rapetti/git/omp/package.json` (omp extension manifest).

**Tern official (web)**
- Product page: https://stencil.so/tern
- Plugin SDK / overview: https://docs.stencil.so/tern/ (`index.md`)
- Surface Protocol: https://docs.stencil.so/tern/protocol/index.md, `transport.md`, `handshake.md`, `surfaces.md`, `documents.md`, `input.md`, `operations.md`, `sdks.md`
- Elements: https://docs.stencil.so/tern/elements/index.md
- Concepts: https://docs.stencil.so/tern/concepts/architecture.md, `support-matrix.md`, `security.md`
- Guides/scripts: https://docs.stencil.so/tern/guides/getting-started.md, https://docs.stencil.so/tern/scripts/terminal.md
- SDK repo: https://github.com/stencil-hq/tern-sdk

## Open questions

1. **Live handshake contents.** What does *this* Tern 0.9.7's `hello.kinds` list (does it include `el`, `block`, `media`)? Capture with `PI_TUI_TSP_RECORD=<file> omp` in a Tern pane and read the `r` line. Determines whether the `el`/`block` gap is only omp's types or also Tern's build.
2. **Is a raw `tsp;s`/`t` write from an extension safe?** Not tested; depends on omp's reconciler owning the surface id (`sf`) and frame sequence numbers.
3. **Mouse reporting under TSP.** Do SGR mouse reports reach a program with a live inline surface? Tern's docs only describe pointer *actions* as events; nothing says SGR mouse is delivered or suppressed.
4. **Windows web engine for `tern browser`** (omp docs say WKWebView, which is macOS).
5. **Stability of Tern's daemon JSON protocol** (`TERN_PANE_SOCKET`) beyond omp's own use; no public spec found. Prefer the `tern` CLI unless a spec is published.
6. **Direct omp-extension ↔ Tern-plugin channel** (shared event bus or message API): none found; needs confirmation from Stencil or the plugin API reference (`https://docs.stencil.so/tern/reference/api.md`, not read).
7. **Event names for `tern events --filter`**: only `pane_spawned` and `layout_changed` appear (in the product page demo); the full list wasn't found.
8. **Stability and full style of the bundled `omp.*` roles.** Only fonts were measured; whether Tern keeps these names across releases, and what padding/background each role adds, is unverified (the stylesheet isn't public). Re-run the 578-role probe after a Tern or omp upgrade.
