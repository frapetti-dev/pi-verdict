# Tern Luau plugins

Plugins extend Tern itself: palette commands, key binds, status line, tab titles, custom pane "blocks", command-output "lenses", global CSS. They are separate from omp extensions (see `omp-extension.md`) and from SDK programs (`standalone-sdk.md`).

Sources: `https://docs.stencil.so/tern/…` (`.md` pages) unless noted. Docs do not pin a version; the local Tern observed was 0.9.7. `[UNVERIFIED]` = not confirmed against the installed binary or a docs page.

## Contents
1. Gotchas
2. Package layout and manifest
3. Host vs window halves, budgets
4. Lifecycle and reload
5. API summary
6. Minimal complete example (verbatim)
7. Block example (verbatim)
8. Chrome: status line, tab title, segment shape
9. Commands, binds, overrides
10. Lenses
11. UI builders
12. Dev loop (CLI, luau-lsp, logs, driving)
13. Windows paths
14. Security and sandbox
15. Support matrix
16. Cooperation with omp
17. Unverified / not covered

## 1. Gotchas
- `tern` is a global. Never `require("tern")` (`guides/getting-started.md`, `guides/debugging.md`).
- Budgets are hard: host 2 s per call; window 50 ms per call; 4 ms for chrome formatters and `available`. A trip raises `tern: <hook> exceeded <n> ms`, pauses the hook 5 s (doubling to 5 min), toasts once (`concepts/runtime.md`). Do slow work with `tern.process.run`/`tern.fetch` callbacks and `tern.timer`, not loops.
- `tern.process.run(argv, opts, cb)` takes an argv array. No shell, no quoting, no globbing. Raises on iOS (`reference/api-shared.md`).
- Registration APIs (`tern.command`, `bind`, `override`, `route.*`, `chrome.*`, `files.button`, `css`, `on`) take effect when the call returns, not at the call. Reload drops all of them with the VM and reruns the entry (`reference/api-window.md`, "Registration").
- Reload restarts running blocks from their last `save` state; lens state is rebuilt from the saved raw output, so `open`/`line`/`finish` must be side-effect-free (`concepts/lifecycle.md`, `guides/lenses.md`).
- Pane output, command lines and file names are untrusted input. Prefer `tern.process.run` over typing text into panes (`concepts/security.md`).
- A `[[lenses]]`/`[[blocks]]` entry in `plugin.toml` without a matching `tern.lens.define`/`tern.block.define` in `host.luau` fails the plugin.
- Chrome formatters have no `cx` and are cached by input table; call `tern.chrome.refresh()` (from a timer/callback/handler, never from a formatter) when outside data changes.
- `cx` is valid only during the call that received it. Timer, process and fetch callbacks get a fresh `cx` as the last argument (window half); host-side callbacks get none.

## 2. Package layout and manifest
- A package is a directory with `plugin.toml` at its root. Entries: `host.luau` and/or `window.luau`. Optional `styles = [...]` CSS files, `lib/*.luau` modules loaded with `require("./lib/pods")` (`concepts/packages.md`, `reference/manifest.md`).
- Manifest keys (`reference/manifest.md`). Unknown keys are errors at top level and inside `[[blocks]]`/`[[lenses]]`. Size cap 64 KiB.

| Key | Rule |
|---|---|
| `schema` | required, integer `1` |
| `id` | required, `^[a-z][a-z0-9-]{0,31}$`, unique |
| `name` | required, 1-64 chars |
| `version` | required, free-form |
| `description`, `icon` | optional; unknown icon becomes `puzzle` |
| `host` / `window` | at least one; relative `.luau`/`.lua` path |
| `styles` | array of CSS files; 256 KiB total |
| `[[blocks]]` | `id`, `title` required; `icon`, `files` (globs on file name, case-insensitive), `palette` (default `true`); requires `host` |
| `[[lenses]]` | `id`, `match` (≥1 glob) required; requires `host` |

- Errors include `missing entry host.luau`, `duplicate id k8s`, `blocks need a host entry`.
- Naming: block kind `<plugin>.<block>`; block region role `plugin.<plugin>.<block>`; lens id `plugin.<id>.<lens>`; lens block role `lens.plugin.<id>.<lens>`; command action `plugin.<plugin>.<command>`; data dir `<state>/plugin-data/<id>` (`concepts/packages.md`, "Ids and names").
- Template: `assets/luau-plugin-template/`.

## 3. Host vs window halves, budgets

| | `host` | `window` |
|---|---|---|
| Runs | One worker thread per plugin in the session daemon (or in a window when no daemon serves its panes) | One VM per plugin per window, on that window's UI thread |
| Budget | 2 s per call | 50 ms per call; 4 ms for chrome formatters and `available` |
| Owns | Blocks, lenses, host events, `spawn` filter, `tern.pane.write`/`list` | Palette commands, binds, overrides, route open/link, chrome formatters, `tern.css`, `cx`, window events, layout, `tern.secrets` |
| Cannot | Touch a window | Own pane content |

`tern.context` is `"host"` or `"window"` (use in shared modules). The web tab runs no Lua; iOS runs window halves only, interpreted (`architecture.md`, `reference/api.md`, `reference/api-shared.md`, `guides/distribution.md`).

## 4. Lifecycle and reload
- Host halves load at daemon start, before saved panes restore. Window halves load per window in id order after manifest styles install. `window_start` fires once per window per plugin (`concepts/lifecycle.md`).
- Reload triggers: folder watch (~300 ms batch), `tern plugin reload [ID]`, `install|remove|link|unlink`, palette "Reload plugins", Preferences › Plugins.
- Reload restarts running blocks from last `save` state. A block whose type vanished ends with `no block type KIND on this host` (`guides/distribution.md`).
- Failed loads: host entry error gives status `failed` in `tern plugin list`. A window entry error is not in the list; it shows as Failed in Preferences and as the toast "Plugin *name* failed to load" (`guides/debugging.md`).

## 5. API summary

**Host** (`reference/api-host.md`)
- `tern.block.define(id, BlockDef)`; `tern.lens.define(id, LensDef)`; `tern.on(host event, fn)`; `tern.pane.write(pane, text)`; `tern.pane.list()`.
- Host events: `command_started{pane,line,cwd}`, `command_finished{pane,line,status,took_ms}`, `cwd{pane,path}`, `title{pane,title}`, `pane_exited{pane,status}`, `spawn(spec)->spec?`. Handlers get an EffectCx.
- `tern.pane.write(pane: number, text: string) -> ()` writes to the pane's pty "as if typed"; end with `"\r"` to run a command. Queued, applied after the handler returns; unknown pane ignored, nothing raises.
- `tern.pane.list() -> { PaneInfo }`, `PaneInfo = {pane: number, cwd: string?, program: string, title: string, busy: boolean}`; panes whose program has not exited; a block's own pane is listed before `init` runs.
- EffectCx (lens `open`/`event`, host events): `toast(level,text,sub?)`, `open(target)`, `copy(text)`. None raise; may be kept and reused. Toast levels: `success`; `error`/`warn`/`warning` show as error; else info.

**Window** (`reference/api-window.md`)
- `tern.command(def)`, `tern.bind(chord, action|fn)`, `tern.override(command_id, fn)`, `tern.route.open(fn)`, `tern.route.link(fn)`, `tern.chrome.*`, `tern.files.button(def)`, `tern.css(name, source)`, `tern.on(name, fn)`, `tern.secrets`.
- Window `cx` (valid only for that call):
  - `session` (`:focused()`, `:panes()`, `:tabs()`, `:settle(pane, ms?)` -> Awaitable<string> of last output lines, default 30000 ms, cap 120000), `layout`.
  - `run(pane: number, text: string)` types text, end with `"\r"`; raises `no program runs in that pane`.
  - `open(target: string, how: How?, reveal: Reveal?)`.
  - `new_block(kind, args?, how?, opts?) -> number?`.
  - `command(id)` runs a built-in only; `action(name)`.
  - `pick(opts) -> Awaitable<PickItem?>`; `prompt(opts?) -> Awaitable<string?>`.
  - `toast(level, text, sub?)` with level `"success"|"info"|"error"`; `copy(text)`; `window_key()`.
  - More members on `cx`: `canvas`, `docs`, `board`, `browser`, `db`, `settings`, `git`, `notebook`, `actions`, `agents`, `procs`, `screen`.
  - `how` is `default|beside|below|split|tab|replace|over|preview`; other values raise `unknown how`.
- `tern.secrets.get(name) -> Awaitable<string?>`, `tern.secrets.set(name, value: string?) -> Awaitable<nil>`. Window halves only. System keychain (Credential Manager on Windows). Names `[a-z0-9][a-z0-9._-]{0,63}`; value ≤ 64 KiB; `nil` deletes. Consume with `:next(function(value, err, cx) … end)`.
- `tern.on(name, fn)` window events (handler gets payload + fresh `cx`, except `window_start(cx)`):

| Event | Payload |
|---|---|
| `window_start` | (cx) |
| `focus` | `{pane, tab}` |
| `pane_created`, `pane_closed` | `{pane}` |
| `tab_created`, `tab_closed` | `{tab}` |
| `command_started` | `{pane, line}` |
| `command_finished` | `{pane, line, status, took_ms}` |
| `cwd` | `{pane, path}` |
| `title` | `{pane, title}` |
| `agent_state` | `{pane, old, new}` (`working`, `waiting_input`, `idle`, `exited`; `old` nil if new) |
| `agent_finished` | `{pane, result}` (`done`/`failed`/`exited`/`closed`) |
| `float_moved` | `{pane, tab, over, corner?, stashed?, docked?}` |
| `session_ended` | `{session, name, shown}` |
| `budget` | `{hook, state, ms?, paused_ms?}` (`paused`/`resumed`) |
| `canvas_action` | `(ev, cx) -> boolean?` |

  Unknown name raises ``tern.on: unknown window event `<name>` ``. See `reference/events.md`.
- `tern.files.button({id, title, icon?, run(files, cx)})`; `FilesInfo = {root: string?, host: string, selection: {string}, tab: "files"|"changes"|"refs"}`; hook budget 50 ms.
- `tern.css(name, source)` installs sheet `plugin:local:<id>:<name>`; `name` `[A-Za-z0-9_-]`, not `styles`; replace by re-calling. Manifest `styles` install as `plugin:local:<id>:styles`.

**Shared** (`reference/api-shared.md`)
- `tern.plugin{id,name,dir,data}`, `tern.runtime{os,jit}`, `tern.log.debug|info|warn|error` (`print` = info), `tern.json.encode|decode|array|null`, `tern.base64.encode|decode`, `tern.now`, `tern.getenv`.
- `tern.timer(ms, fn)` not repeating, returns handle with `:cancel()`; `tern.sleep(ms)`; awaitables `a:next(fn(result, err, cx))`.
- `tern.kv.get|set` (`kv.json` in data dir; `set(nil)` deletes).
- `tern.fs.read(path, max?)|write|list|exists|mkdir|remove`; relative paths resolve against `tern.plugin.dir`; blocking.
- `tern.process.run(argv, opts?, cb)`: opts `cwd`, `env`, `stdin`, `timeout_ms`; result `{status, stdout, stderr, timed_out}`; output capped 16 MiB each; sets `TERN_PLUGIN_DATA`.
- `tern.fetch(url, opts?, cb)`: `method`, `headers`, `body`, `timeout_ms` (default 30 s); result `{status, headers, body, error, timed_out}`; non-2xx is not an error; works on iOS.
- `tern.parse.location(text)` -> path, line (used in lens example).

## 6. Minimal complete example (verbatim, `guides/getting-started.md`)
`plugin.toml`:
```toml
schema = 1
id = "first"
name = "First"
version = "0.1.0"
description = "A seq lens and a hello command."
host = "host.luau"
window = "window.luau"

[[lenses]]
id = "seq"
match = ["seq *"]
```

`host.luau`:
```lua
--!strict
-- The host half: a lens that reads `seq` output as numbers.

type State = { values: { number } }

local ui = tern.ui

local seq: LensDef<State> = {
	open = function(_run, _cx)
		return { values = {} }
	end,
	line = function(state, l)
		local n = tonumber(l.text)
		if n then
			table.insert(state.values, n)
		end
	end,
	finish = function(_state, _status) end,
	view = function(state)
		if #state.values == 0 then
			return nil -- not numbers: keep the raw output
		end
		local sum = 0
		local series: { { any } } = {}
		for i, n in state.values do
			sum += n
			series[i] = { tostring(i), n }
		end
		return ui.col({
			ui.text({
				ui.span(tostring(#state.values), "strong num"),
				ui.span(" numbers, sum "),
				ui.span(tostring(sum), "num"),
			}),
			ui.spark(series),
		})
	end,
}

tern.lens.define("seq", seq)
```

`window.luau`:
```lua
--!strict
-- The window half: a palette command.

tern.command({
	id = "hello",
	title = "Say hello",
	icon = "sparkle",
	run = function(cx)
		local how = if tern.runtime.jit then "native code" else "the interpreter"
		cx:toast("info", "Hello from " .. tern.plugin.name, "running on " .. how)
	end,
})
```

## 7. Blocks (`guides/blocks.md`)
A block is a pane whose program is your Lua. It lives in the daemon's pane table, so every window shows it and it survives closed windows, reloads and daemon restarts. Windows hold no Lua for a block; they draw the frames the worker sends.

Declare in `plugin.toml`:
```toml
[[blocks]]
id = "list"
title = "Checklist"
```
Kind is `<plugin>.<id>`. `title` labels the palette row "New Checklist block". Implement with `tern.block.define(id, def)` in `host.luau`.

| `BlockDef` field | Required | Called |
|---|---|---|
| `init(cx, args, saved) -> state` | yes | start, and restart after reload/daemon restart |
| `view(state, cx) -> {main?, dock?, layer?}` | yes | after every handler and every `cx:render()` |
| `title(state) -> string?` | no | after every `view` |
| `key(state, key, cx) -> boolean?` | no | each key/paste with focus; return exactly `false` when nothing changed (skips render+save) |
| `event(state, ev, cx)` | no | when someone acts on view nodes |
| `resize(state, cols, rows, cx)` | no | pane cell size changes |
| `save(state) -> any` | no | after every handler (except a `key` that returned `false`) and on `cx:save()` |
| `font` | no | `"mono"` (default) or `"sans"`; anything else fails `tern.block.define` |
| `features` | no | `{"edit","undo"}` for native editing |

Rules from the page:
- Region roots (`main`, `dock`, `layer`) must be containers (`ui.col({...})`); a bare `main = ui.text(...)` draws nothing. Omitted region shows nothing. `layer` takes clicks only where drawn.
- Node ids: region root named after the region; children `<parent id>.<key>` using `p.key` else 0-based index. Give reorderable/deletable children stable `key`s so scroll/focus/collapse state follows the item; duplicate sibling keys reject the view (`main.items: duplicate child key "i3"`).
- Block `cx`: `pane`, `cwd`, `cols`, `rows`, `render()`, `save()`, `exit(code?)`, `frame(ops)`, `blob(bytes, mime)`, `toast`, `open`, `copy`. Requests queue and apply after the handler returns in order; render loops cap at 8 rounds.
- Key table: `{name, text, ctrl, alt, shift, meta}`; paste arrives as `name = "paste"`. The window's own binds take their chords first. Return `true`/nothing from every branch that changed state; `false` only for unused keys.
- `actions = { click = "check=7" }` on a node gives `event` `{ev="action", id="main.items.i7", act="check", value="7"}`.
- There is no close callback: background work must check `tern.pane.list()` for the block's pane before acting; set a local stopped flag when calling `cx:exit()` yourself. After the block ends `render|save|exit|frame|blob` are ignored but `toast|open|copy` still reach windows.
- Handler errors toast `Plugin <name>: list.key failed`; a bad `view` keeps the last good view.

Complete example (verbatim): a block that runs its launch arguments every two seconds.
```lua
--!strict
local ui = tern.ui

type WatchState = { argv: { string }, out: string, status: number?, at: number }

local EVERY_MS = 2000

-- Whether pane `pane` still runs (a block that ended is gone from the list).
local function running(pane: number): boolean
	for _, p in tern.pane.list() do
		if p.pane == pane then
			return true
		end
	end
	return false
end

local watch: BlockDef<WatchState> = {
	init = function(cx, args, _saved)
		local state: WatchState = { argv = args, out = "", status = nil, at = 0 }
		local function tick()
			if not running(cx.pane) then
				return
			end
			tern.process.run(state.argv, { cwd = cx.cwd, timeout_ms = 10000 }, function(r)
				if not running(cx.pane) then
					return
				end
				state.out, state.status, state.at = r.stdout .. r.stderr, r.status, tern.now()
				cx:render()
				tern.timer(EVERY_MS, function()
					if running(cx.pane) then
						tick()
					end
				end)
			end)
		end
		if #args > 0 then
			tick()
		end
		return state
	end,
	title = function(state)
		return if #state.argv > 0 then "watch " .. table.concat(state.argv, " ") else nil
	end,
	view = function(state, _cx)
		if #state.argv == 0 then
			return { main = ui.col({ ui.text({ ui.span("Pass the command to run as arguments", "muted") }) }) }
		end
		return {
			main = ui.col({ ui.ansi(state.out) }),
			dock = ui.row({ ui.text({
				ui.span(if state.status == 0 then "ok" else "exit " .. tostring(state.status), if state.status == 0 then "success" else "error"),
				ui.span(" · every " .. EVERY_MS // 1000 .. "s", "muted"),
			}) }),
		}
	end,
}

tern.block.define("watch", watch)
```
(Manifest for it: `[[blocks]] id = "watch"`, `title = …`, plus `host = "host.luau"`.) Liveness is checked before launching, in the completion callback and in the timer. A reload stops the old worker incl. timers; the new `init` restarts the loop.

## 8. Chrome: status line, tab title, segment shape (`guides/chrome.md`, `reference/api-window.md`)

Signatures:
```lua
tern.chrome.tab_title: (fn: (tab: TabInfo) -> string?) -> ()
tern.chrome.window_title: (fn: (win: WindowInfo) -> string?) -> ()
tern.chrome.status: (fn: (pane: StatusPaneInfo) -> { StatusSegment }?) -> ()
tern.chrome.program_icon: (program: string, icon: string?) -> ()
tern.chrome.refresh: () -> ()

type TabInfo = { id: number, name: string?, cwd: string?, program: string, title: string, panes: number, busy: boolean }
type WindowInfo = { [string]: any }  -- fields: space, tab?, pane?, cwd?, tabs
type StatusPaneInfo = { pane: number, cwd: string?, program: string, title: string, busy: boolean }
type StatusSegment = { text: string, icon: string?, tone: string?, command: string? }
```
- `StatusSegment`: `text` required; `icon` Tern icon name (unknown shows none); `tone` `accent|muted|ok|warn|error` (`bad`) styled, any other value is only a `data-tone` attribute for CSS; `command` an action name run on click (`"new_tab"`, `"plugin.<plugin>.<id>"`; unparsable toasts "A status segment's command is unknown"). Clickable segments get class `on`, `role="button"`. DOM: `<span class="sl-plugin" data-plugin="ID" data-tone="TONE">`.
- Formatters: one per slot per plugin (re-register replaces); empty string = `nil`; `tab_title` first plugin in id order wins and replaces even user-renamed tabs (check `tab.name`); `status` segments from all plugins show, in id order; at end of status line after pane size; only while the status bar is on. Pure: no `cx`; 4 ms; cache keyed by input table (256 entries, cleared on reload/any registration/`refresh`). Wrong return type fails with `a status formatter returns a list of segments or nil` / `a title formatter returns a string or nil`.
- `tern.chrome.refresh()` raises `not from a formatter` if called inside one; call from timers, callbacks, event handlers, commands.
- `status` input fields come from the focused pane; `cwd` is `""` when unknown (typed optional, always set). For remote panes `cwd` is on the remote host while `tern.fs` reads the local machine.
- Program icons: `tern.chrome.program_icon("nvim", "sparkle")`; unknown icon raises. `tern.files.button` adds a Files pane header button.

Status-line formatter example (verbatim): segment fed by a process, refreshing after each poll; click runs the plugin command.
```lua
local pending: number? = nil

local function segments(_pane: PaneInfo): { StatusSegment }?
	if pending == nil or pending == 0 then
		return nil
	end
	return {
		{ text = tostring(pending) .. " to review", icon = "branch", tone = "accent", command = "plugin.reviews.open" },
	}
end

local function poll()
	tern.process.run({ "gh", "search", "prs", "--review-requested=@me", "--state=open", "--json", "number" }, { timeout_ms = 15000 }, function(result, _cx)
		if result.status == 0 then
			local ok, list = pcall(tern.json.decode, result.stdout)
			if ok then
				pending = #list
				tern.chrome.refresh() -- drops the cached segments and redraws
			end
		end
		tern.timer(60000, poll)
	end)
end

tern.chrome.status(segments)
tern.command({
	id = "open",
	title = "Open review queue",
	run = function(cx)
		cx:open("https://github.com/pulls/review-requested")
	end,
})
poll()
```
Note: the docs example annotates the parameter `PaneInfo`; the declared type for the status formatter input is `StatusPaneInfo` (same shape except `PaneInfo` is the host-side type) `[UNVERIFIED which name tern.d.luau accepts]`. Leave the parameter unannotated to be safe, as the template does.

Directory-keyed segment (verbatim; pure, depends only on input):
```lua
local function first_word(path: string): string?
	if not tern.fs.exists(path) then
		return nil
	end
	local ok, text = pcall(tern.fs.read, path)
	if not ok then
		return nil
	end
	return string.match(text, "^%s*(%S+)")
end

tern.chrome.status(function(pane)
	local cwd = pane.cwd
	if cwd == nil or cwd == "" then
		return nil
	end
	local version = first_word(cwd .. "/.nvmrc")
	if version == nil then
		return nil
	end
	return { { text = "node " .. version, tone = "muted" } }
end)
```

Tab title example (verbatim):
```lua
tern.chrome.tab_title(function(tab)
	if tab.name then
		return nil -- keep names the user gave
	end
	return string.match(tab.cwd or "", "([^/]+)/*$")
end)
```

Global CSS: manifest `styles` (at load, before window entry) and `tern.css`. Plugin sheets sit after Tern's, before the user's CSS theme. Use `[data-role='myplugin.row']` for your own nodes; Tern variables `--accent`, `--accent-fill`, `--t1`…`--t4`, `--ok`, `--warn`, `--bad` keep light/dark correct. Selectors: `#statusline .sl-plugin[data-plugin='<id>']` (+ `[data-tone]`, `.on`); `.sf-main[data-surface='plugin.<plugin>.<block>']` (also `.sf-dock`, `.sf-layer`); `.sf-<kind>` nodes; `.sf-block[data-role='lens.plugin.<plugin>.<lens>']`. `url()` in sheets: relative to the plugin dir only; absolute paths, `https:`, `..` refused. CSS parse errors are logged, not raised.

## 9. Commands, binds, overrides (`guides/commands.md`)
```lua
tern.command({
	id = "scratch",
	title = "Open scratch file",
	icon = "file",
	keys = { "ctrl+alt+shift+s" },
	run = function(cx)
		cx:open(tern.plugin.data .. "/scratch.md", "beside")
	end,
})
```
- `CommandDef = {id, title, icon?, group?, keys?, available?(cx)->boolean, run(cx)}`. `id` `[A-Za-z0-9_-]`, not `bind`; bad id raises `tern.command: bad id`. `group` default = manifest `name`. `available` runs on every palette open under 4 ms; an error or overrun hides the row. `run` has 50 ms; failures toast `Plugin <name>: command <id> failed`. Re-registering an id replaces the row but earlier `keys` stay bound.
- Action names (usable in `command`, binds, `keybinds`): built-in command ids (`new_tab`, `split_right`, `close_pane`, `layout:rail`, `move_pane:left`), `palette`, `goto_tab:N`, `focus_pane:DIR`, `text:BYTES`, `plugin.<plugin>.<id>`, `plugin.<plugin>.bind.<n>`. Full list: `reference/actions.md`. A missing plugin action toasts `No plugin has this action` only when pressed.
- Binds: `tern.bind("ctrl+alt+shift+n", "new_tab")` or a function. Chords `+`-joined (`ctrl`, `alt|opt`, `shift`, `cmd|super`), `>` for sequences. Plugins only add keys: a bind that collides with defaults/preset is dropped with `plugin bind left out` in the log; the user's `keybinds` always win. Function binds are numbered, so register a `tern.command` when users should rebind.
- Override: `tern.override("new_tab", function(cx) …; return true end)`; truthy skips the built-in; `cx:command(id)` inside runs the built-in without recursing. Inside a handler `cx:command` takes built-in ids only (plugin actions raise `unknown command`) and `cx:open` skips routes.
- Routes: `tern.route.open(fn(req,cx))`, `tern.route.link(fn(link,cx))`; decisions `{block,args}`, `{url}`, `{path,how}`, `{handled=true}` (`guides/routing.md` `[UNVERIFIED]` page not read).

## 10. Lenses (`guides/lenses.md`, `reference/api-host.md`)
A lens turns a claimed command's output into a native view; raw output stays one click away. Claim is declarative (manifest globs) and decided before any Lua runs, so `open` cannot decline; return `nil` from `view` to show raw output.
```toml
[[lenses]]
id = "du"
match = ["du", "du *"]
```
- Matching: text is program + args joined by single spaces; `*` any run, `?` one char, case-sensitive; list `["du", "du *"]` to claim both. Wrappers skipped (`sudo`, `env`, `time`, `npx`, …). Pipelines, lists (`;`, `&&`), stdout redirects, subshells, heredocs are never lensed. Plugins in id order, first matching pattern wins; order manifest narrow to broad. Needs shell integration and Settings › Terminal › Native command output on.
- `LensDef<S> = {open(run, cx) -> S, line(state, l), finish(state, status), view(state) -> Node?, event?(state, ev, cx)}`; `LensRun = {line, typed, cwd?, program, args}`; `LensLine = {text, links = {{from, to, href}}}` (1-based inclusive bytes).
- `view` runs at most once per 250 ms while output arrives, once at finish and after each `event`; diffed by place not key. Cap displayed rows (built-ins stop at 5000 and end with `ui.overflow(hidden)`).
- State: last 256 captures per plugin; lost on reload; rehydrated lazily on a click by re-running `open`/`line`/`finish`, so state must derive only from `run` and the lines, and each event should carry the whole choice (`sort=name`, not `toggle_sort`). A capture that goes interactive or exceeds 16 MiB is aborted (no `finish`).
- Example (verbatim, `reference/api-host.md`):
```lua
tern.lens.define("grep", {
	open = function(run, _cx)
		return { cwd = run.cwd, rows = {} }
	end,
	line = function(state, l)
		local path, line = tern.parse.location(l.text)
		if path and line then
			table.insert(state.rows, {
				{ tern.ui.path(path, state.cwd), tern.ui.span(":" .. line) },
				{ tern.ui.span(l.text) },
			})
		end
	end,
	finish = function(_state, _status) end,
	view = function(state)
		if #state.rows == 0 then
			return nil
		end
		return tern.ui.table({
			{ id = "at", head = "Where" },
			{ id = "text", head = "Line", grow = 1 },
		}, state.rows)
	end,
})
```
```toml
[[lenses]]
id = "grep"
match = ["rg TODO*", "grep * TODO *"]
```

## 11. UI builders (`reference/ui.md`)
Both `tern.ui` and `tern.parse` exist in both contexts. Nodes are plain tables `{k, p?, c?}`; edit `p` before returning:
```lua
local node = tern.ui.badge("Retry", "accent")
local p: { [string]: any } = node.p or {}
p.actions = { click = "retry" }
p.key = "retry"
node.p = p
```
- Common props: `key`, `tone` (`accent|success|warning|error|info|muted`), `role` (becomes `data-role`), `collapsible`, `collapsed` (both needed to start folded), `actions` (`{click = "name"}`; `name=value` splits into `act`/`value`).
- Spans: `span(t, s?)` tokens `muted`, `strong`, `error`, `num`, `code`, `path`; `link(t, href, s?)`; `path(p, cwd?)` links to `file://` (relative needs `cwd`). Span `fx`: `shimmer|pulse|none`.
- Layout: `text(spans)`, `col(children)` (gap `sm`), `row`, `lines` (gap none), `card(head, children, props?)` (props: `icon`, `meta`, `end`, common), `section(head, children)`, `rule(label?)`; `gap` prop `none|xs|sm|md|lg`.
- Values: `badge(t, tone)`, `button(text?, {icon, keys, variant = default|primary|quiet|danger, size = sm|md, on, disabled, busy, actions, …})`, `kv({{key, value}, …})`, `stats({{label, value, sub?, tone?, title?}})`, `meter(value 0-1, label)`, `progress(value?, label)` (nil = indeterminate), `bars(series)`, `spark(series)` with `{label, value}` pairs, `test_summary(passed, failed, skipped, took?)`, `overflow(hidden)`.
- `table(cols, rows, opts?)`: `Col = {id, head, align = start|center|end, priority, grow, truncate = end|start|middle, mono}`. Remaining table opts, `ansi`, `image`, `list` builders: `reference/ui.md` past line 300 `[UNVERIFIED]` (the block example above uses `ui.ansi(text)`).
- Builder errors read `tern.ui.<builder>: <arg path>: <problem>`; a single node where a list goes raises `expected a list of nodes, got one node (wrap it in {})`.
- Element kinds and props are the same as the TSP kinds in `elements.md`.

## 12. Dev loop

Usage (real output of `tern plugin --help`, this machine):
```
tern plugin list                          plugins, how they loaded, problems
tern plugin reload [ID]                   load every plugin again, or only ID
tern plugin dir                           where plugins are installed
tern plugin install SRC [--force]         from a git URL or a directory
tern plugin remove ID
tern plugin link DIR | unlink ID          use a plugin where it is
tern plugin types DIR                     writes DIR/tern.d.luau for luau-lsp
      every verb also takes [--json] [--window KEY]
```
- `install SRC`: `https://`, `http://`, `git@`, `ssh://` URL or `github.com/OWNER/REPO[/PATH]` (cloned with git; package is directory PATH of the clone), else a local directory (leading `~` ok). `--force` replaces an installed copy, never a linked one.
- `link DIR` uses the package in place (writes `<plugins>/<id>.path`), so edits reload without copying; `unlink ID` removes it. Every change reloads the daemon's plugins. `reload` exits 1 when a plugin fails or the directory has problems. `--window KEY` picks the window whose daemon list/reload ask; `--json` prints machine output.
- Exit codes (`reference/cli.md`, docs only): 0 ok; 1 failure; 2 usage; 124 daemon timeout (60 s). Without a daemon: `no daemon running; changes apply at next start`.
- `tern plugin list --json` observed with no plugins installed:
```json
{ "plugins": [], "problems": [], "jit": false, "canvas": true }
```
  (Shape of a non-empty `plugins` entry: `[UNVERIFIED]`, not observed.) Note `jit: false` on this build, so `tern.runtime.jit` is false here.
- Fast loop: `tern plugin link .` once; save a file; watcher reloads in ~300 ms. Check `tern plugin list` for `failed` host plugins; window-entry failures only toast/appear in Preferences › Plugins.
- luau-lsp (`guides/getting-started.md`, `guides/debugging.md`): run `tern plugin types DIR`, then in editor settings:
```json
{
  "luau-lsp.platform.type": "standard",
  "luau-lsp.sourcemap.enabled": false,
  "luau-lsp.types.definitionFiles": { "@tern": "tern.d.luau" }
}
```
  Use the global `tern`; `require("tern")` fails. Keep `--!strict`.
- Logs: by default only warn/error from plugins are written; `STENCIL_LOG=warn,stencil=info,tern::plugin=debug` keeps `info`/`debug`. Files in section 13. `tern.log.*` target is `tern::plugin` with field `plugin`.
- Driving a window from a script (`guides/debugging.md`, "Driving a window from a script"): `tern --control <sock>`; `tern ctl … plugins run <action>`, `plugins expect "<text>"`, `plugins fixtures` `[UNVERIFIED]` (exact flags not re-checked; run `tern ctl --help`).
- No Luau tooling was available on PATH here (`where luau-analyze` failed), so template files are not type-checked.

## 13. Windows paths (`concepts/packages.md`, "Directories")
- `<config>` = `%APPDATA%\Tern` (override `TERN_CONFIG_DIR`); `<state>` = `%LOCALAPPDATA%\Tern`.
- Plugins folder: `%APPDATA%\Tern\plugins\` (`tern plugin dir` prints it). A subdirectory is a package; `<name>.path` is a link to an absolute path; dot-names are skipped.
- Data: `%LOCALAPPDATA%\Tern\plugin-data\<id>\` (`tern.plugin.data`).
- Logs: `%LOCALAPPDATA%\Tern\Logs` (`tern-daemon.log` host half, `tern.log` window half; `STENCIL_LOG_DIR` overrides; rotates to `.1.log` at 16 MiB) (`guides/debugging.md`).
- Settings: `settings.json` keys `plugins` (default `true`) and `plugins_disabled` (default `[]`); keybind overrides under `keybinds` (`guides/distribution.md`).

## 14. Security and sandbox (`concepts/security.md`, `concepts/runtime.md`)
- Plugins run as the user. No permission system, signing or prompt.
- Reach: `tern.fs`, `tern.process.run` (argv), `tern.fetch`, `tern.getenv`, `tern.secrets` (window), `tern.pane.write` (host), `cx:run` (window; any pane incl. remote).
- Treat pane output, command lines and file names as untrusted; never build typed text (`cx:run`, `tern.pane.write`, `text:` actions) from them. Prefer `tern.process.run` with argv.
- Sandbox: no `io`, `package`, `dofile`, `loadfile`, `os.execute`, `os.getenv`, `os.remove`, `os.exit` (use `tern.getenv`, `tern.fs`). Libraries read-only. 256 MiB per VM.
- Tripped budget: `tern: <hook> exceeded <n> ms`, hook paused 5 s doubling to 5 min, one toast.
- `tern.runtime.jit` is true on Windows release builds when the CPU supports it.

## 15. Support matrix (Windows, `concepts/support-matrix.md`)
Yes: host half, window half, `tern.process.run`, `tern.fetch`, blocks, lens views, plugin CSS, `tern plugin` CLI. Watching uses `ReadDirectoryChangesW`; `tern.runtime.os = "windows"`; in-place daemon upgrade is Unix-only; daemon socket is a named pipe. Web tab: no Lua (manifest `styles` only). iOS: window halves only, interpreted; `tern.process.run` raises.

## 16. Cooperation with omp
No omp-to-plugin API is documented `[INFERENCE]`. Routes:
- Plugin to omp: `tern.process.run`/`tern.fetch`, or `tern.pane.write`/`cx:run` into the pane running omp (quoting differs from argv; treat as typed text).
- omp to plugin: the extension calls `pi.exec("tern", [...])` with argv arrays (`split`, `send`, `capture`, `events`; see `tern-cli.md`). Share state through files in `tern.plugin.data` or `tern.kv`.
- A plugin block can host a UI next to omp. `cx:new_block(kind, args?, how?, opts?)` is a window-half call, so open it from a palette command or bind that the user triggers `[INFERENCE]`.
- Plugin status segments can show omp-adjacent state (e.g. read a status file written by the extension, `tern.chrome.refresh()` from a timer).

## 17. Unverified / not covered
- Pages not read: `guides/views.md`, `guides/routing.md`, `guides/layout.md`, `guides/io.md`, `guides/hooks.md`, `reference/errors.md`, `reference/limits.md`, `styles/index.md`, `reference/ui.md` past line 300 (table opts, `ansi`, `image`, lists), `reference/api-window.md` outside lines 1-200 and 358-470 plus the `tern.on`/`tern.secrets`/`tern.files.button`/`tern.css` tails, `reference/api-host.md` outside the `tern.lens.define` and `tern.pane` sections, `concepts/security.md` "Developing".
- CLI flags come from the docs plus `tern plugin --help`; `tern ctl … plugins …` flags unchecked.
- Shape of non-empty `tern plugin list --json` output.
- `PaneInfo` vs `StatusPaneInfo` annotation in `tern.d.luau`.
- Example repos: `https://github.com/stencil-hq/tern-sdk/tree/main/plugins/examples` (seven plugins; see `examples/index.md`), not read.
