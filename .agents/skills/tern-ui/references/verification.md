# Verifying Tern UI work

Cheapest first. Do 1 before claiming anything works; do 2-4 when the user asks for live proof or the change is visual.

## 1. Harness (no Tern, no omp)

`scripts/describe-harness.ts` loads the extension with `@oh-my-pi/pi-tui` stubbed, fakes `pi`/`ctx`, runs a command and prints the node tree.

```
bun <skill>/scripts/describe-harness.ts <entry.ts> [--command <name>] [--args "<str>"] [--events <file.json>] [--ansi] [--cols 100]
```

- `--command <name>`: run the registered slash command. Without it, the harness lists commands/tools and prints each tool's `describeCall({})` / `describeResult(...)`.
- Output: `custom: {...mount options}`, `nativeOverlay` / `nativeSheet`, the JSON tree (screens print `{screen: {role, main, dock}}` with nested components expanded), then `memo-stable: true|false`.
- `memo-stable: false` = `describe()` builds a new object when nothing changed. Fix with `Memo` keyed on a version counter.
- `--ansi` prints `render(cols)` rows: must be non-empty and readable.
- `--events file.json`: array of `NativeUiEvent` objects and/or `{ "input": "<raw keys>" }` entries. After each one the tree is re-described. `{"input":"\u001b"}` = Escape, `"\u001b[B"` = Down, `"\r"` = Enter.
- `done(<value>)` is printed when the component closes; the harness then calls `dispose()`.
- `exec: [...]` lines show every `pi.exec` argv the code attempted (the fake returns `{code:0, stdout:"[]"}`).
- Exit code 1 if anything throws or a command is missing. Hard 3 s timeout so timers can't hang the run. A `describe()` returning `null` is reported, not an error.

Example against the template:

```
echo '[{"type":"action","key":"actions/inc","act":"inc","mods":[]},{"input":"\u001b"}]' > ev.json
bun scripts/describe-harness.ts assets/omp-extension-template/index.ts --command my-ext --events ev.json --ansi
```

Checklist from the output: root `k` is what you intended; buttons are `omp.btn` rows; every keyed child has a `key`; `memo-stable: true`; `nativeOverlay.role` present for overlays; `done()` fires on the close action AND on the escape input.

Limits: the harness cannot show how Tern draws or lays out the tree, and it fakes `cx.supports()` as always true.

## 2. Live run in a side pane (Tern only)

```
tern split "$TERN_PANE" right --keep-open --cwd DIR --json -- omp -e EXT/index.ts
```

`--json` prints the new block id. Drive it:

```
tern send ID text "/my-ext"
tern send ID keys enter
tern capture ID --surfaces        # text/surface capture
```

Gotchas: restart the pane's omp after each edit (Bun ignores `file://` query strings). Use a fresh pane per probe (an overlay left open swallows Escape in the next probe). Give the child omp working auth, e.g. an isolated `PI_CODING_AGENT_DIR` copied from your agent dir if you start it with `--no-extensions -e`.

Expect for the template's `/my-ext`: a floating glass sheet, sans heading text, buttons with keycaps.

## 3. Record and replay

`PI_TUI_TSP_RECORD=<file.jsonl> omp -e EXT/index.ts` writes every TSP message. Replay in Tern with `surface-play "<file.jsonl>" [from] [until] [paced]`. Read the `r` (reply) line of the recording to see the terminal's real `kinds` and `features`. SDK programs use `TERN_TSP_RECORD`.

## 4. Screenshot and layout dump

`tern ctl shot NAME` writes `NAME.png` and `NAME.layout.json` (every element with computed `fontFamily`, `fontSize`, `fontWeight`) under `%LOCALAPPDATA%\Programs\Tern\target\shots\tern\live\`. Use it to prove sans vs monospace and sizes. `tern ctl` is dev tooling: not for shipped features.

## 5. ANSI fallback

`PI_TUI_NATIVE=0 omp -e EXT/index.ts` forces the row path. Open each surface; confirm the keyboard twin of every button works and Escape closes. Running omp in plain Windows Terminal gives the same result.

## 6. Luau plugins

```
tern plugin types DIR        # writes DIR/tern.d.luau for luau-lsp
tern plugin link DIR         # dev link; edits hot-reload
tern plugin list --json      # status: ok / failed
tern plugin reload [ID]      # exit 1 if any plugin failed
```

- A failed HOST entry shows status `failed` in `tern plugin list`. A failed WINDOW entry does not: look for the toast "Plugin NAME failed to load" and Preferences > Plugins.
- Logs: `%LOCALAPPDATA%\Tern\Logs` (`tern-daemon.log` host, `tern.log` window). `tern.log.info` is hidden unless `STENCIL_LOG=warn,stencil=info,tern::plugin=debug`.
- Budgets: host 2 s, window 50 ms, chrome formatters 4 ms; an overrun raises `tern: <hook> exceeded <n> ms`, pauses the hook 5 s and toasts.
- Driving a window from a script: `tern --control <sock>`, `tern ctl ... plugins run <action>`, `plugins expect "<text>"`.
