---
name: tern-ui
description: Build native UI for the Tern terminal (Stencil) — Tern Surface Protocol surfaces from omp extensions (describe/describeScreen/handleNativeEvent, overlays, pickers, full-pane screens, widgets, native tool cards), window and pane control through the `tern` CLI (split, tab, pip, open), standalone TSP programs with the @stencil-hq/tern SDK, and Tern Luau plugins (plugin.toml, blocks, lenses, palette commands, status line, CSS). Use whenever the user mentions Tern, TSP, native or Tern-native omp UI, describe() nodes, Tern panes/splits/pip, or a Tern plugin, even if they only ask to make an omp command or tool "look native" in their terminal.
---

# tern-ui

Tern (Stencil Labs, https://stencil.so/tern, docs https://docs.stencil.so/tern/) draws UI that programs describe as semantic nodes (Tern Surface Protocol, TSP). omp, built by the same company, speaks TSP: an omp extension component that implements `describe()` gets drawn natively, and pointer events come back. Tern also has a scripting CLI and a Luau plugin system. Four doors, different reach.

## 1. Pick the door

| Want | Door | Read |
|---|---|---|
| UI inside omp: dialog, sheet, picker, full-pane screen, widget, tool card | omp extension (TSP) | `references/omp-extension.md`, `assets/omp-extension-template/` |
| Open, split, float panes; open files at a line; read/type into other panes | `tern` CLI via `pi.exec` | `references/tern-cli.md` |
| Program CSS, HTML `el` forms, `flow` output kept in scrollback, a non-omp program | standalone SDK program (`@stencil-hq/tern`) | `references/standalone-sdk.md` |
| Tern chrome: tab bar, status line, command palette, key binds, custom pane blocks, output lenses | Luau plugin | `references/luau-plugins.md`, `assets/luau-plugin-template/` |

Reference for node kinds and props: `references/elements.md`. Fonts, roles, padding, overlay sizing: `references/roles-and-layout.md`. Testing: `references/verification.md`.

Doors combine. Example: an omp overlay whose "Open in split" button runs `pi.exec("tern", ["open", "--split", "right", `${file}:${line}`])` (gated on `TERM_PROGRAM==="tern" && TERN_PANE`); or a Luau plugin command that runs `tern.process.run({"omp", ...})`. State which doors you chose and why.

## 2. omp extension workflow

1. Copy `assets/omp-extension-template/` to `<project>/.omp/extensions/<name>/` (or the directory the user names).
2. Rename roles (`omp.overlay.my-ext`, `my-ext.screen`), commands, the tool name, the widget key (checklist in the template README).
3. Build the `describe()` tree from the `nodes.ts` helpers (`n`, `txt`, `prose`, `heading`, `framed`, `button`, `bar`, `guard`). Look up kinds and props in `references/elements.md`.
4. Write the `render(width)` ANSI fallback rows.
5. Wire `handleNativeEvent` (clicks) and `handleInput` (keyboard twin of every button).
6. Run the harness (section 8). Fix until `memo-stable: true` and the tree is what you meant.
7. Optional live check in a side pane (`references/verification.md`). Tell the user to restart omp after edits.

Pick the surface: floating dialog = `overlay.ts`; list/search chooser = `picker.ts`; whole pane = `screen.ts`; persistent strip above the editor = `widget.ts`; rich tool output = `tool.ts`.

## 3. Rules that matter

- Every component needs BOTH `describe` and `render`. TSP is not live in Windows Terminal, tmux/zellij/screen or under `PI_TUI_NATIVE=0`; without `render` the UI is blank there.
- Return the SAME node object while state is unchanged (`Memo` keyed on a version counter, plus `cx.dark`/`cx.cols` if used). The reconciler skips unchanged components by reference; a fresh object every call re-diffs the tree and flickers.
- Give `key`s to dynamic children (list items, tabs) so ids, selection and scroll survive updates. Route events by `leafKey(e.key)`: `key` is a path.
- Guard rare kinds with `guard(cx, kind, build)`/`cx.supports(kind)`; older Tern builds lack some.
- Never compute motion in `describe()`: it has no clock and would force a re-render. Use `spinner`, `elapsed`, `progress`, `shimmer`, `rate`; Tern animates them.
- Every clickable `action` has a keyboard twin in `handleInput`; the ANSI path has no mouse.
- Clear timers in `dispose` AND in `finish`; make `finish` idempotent (click and key can both fire).
- Overlays need a `nativeOverlay.role` (`omp.overlay.<name>`), and the root must not draw a second frame (no head-less `card`).
- Floating dialogs: `overlayOptions: { width: "80%" }` with no declared `size`; use `60%` only when the dialog is really small (a few short lines), `90%` for commands/diffs. A declared `md`/`lg` fills panes under ~100 columns.
- Readability first: monospace is the default and hurts prose. Put every heading, paragraph, label and description in a sans role (`heading()` = `omp.sheet.head`, `prose()` = `omp.advisor.note`; see `references/roles-and-layout.md` for more), and keep monospace for code, paths and commands. Use `framed()` for padding (TSP has no padding prop).
- Timers: prefer the host-managed `ctx.setInterval(cb, ms)` / `ctx.clearTimer(t)` (throws contained, auto-cleared on `session_shutdown`) over raw `setInterval`; still clear in `finish` and `dispose`.
- Fullscreen = `describeScreen` returning `{role, main, dock}` with the component itself in `dock` and `overlayOptions.fullscreen: true`.
- `nativeSheet` is only for `picker`/`prefs` nodes. Pickers drop previews in narrow panes.
- `tern` CLI: gate on `TERM_PROGRAM==="tern" && TERN_PANE`; pass argv arrays to `pi.exec`; never build `tern send`/`tern run` text from untrusted input (it executes in the user's shell).
- Do not write raw ANSI while a surface is live; it is hidden. Do not call `tern` from `describe()`/`render()`.
- Role names (`omp.*`) are Tern-internal and may change; they degrade to monospace, not to breakage.

## 4. Minimal overlay (condensed from `assets/omp-extension-template/overlay.ts`)

```ts
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { bar, button, fit, framed, heading, isClose, Memo, n, prose } from "./nodes";

export async function openOverlay(ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
		let count = 0, version = 0, closed = false;
		const memo = new Memo();
		const bump = () => { version++; tui.requestRender(); };
		const finish = () => { if (closed) return; closed = true; done(); };
		return {
			nativeOverlay: { role: "omp.overlay.my-ext", head: "My extension" },
			describe: (cx: DescribeContext): NativeNode =>
				memo.get([version, cx.dark], () => framed([
					heading("Hello"),
					prose("Body text in sans."),
					n("kv", { items: [{ k: "count", v: String(count) }] }),
					bar([button("Count +1", "inc", "i"), null, button("Close", "close", "escape")]),
				], "md")),
			handleNativeEvent(e: NativeUiEvent) {
				if (e.type === "action") { if (e.act === "inc") count++; else if (e.act === "close") return finish(); }
				bump();
			},
			handleInput(data: string) { if (isClose(data)) return finish(); if (data === "i") count++; bump(); },
			render: (w: number) => [`My extension (count ${count})`, "i increment · esc close"].map(l => fit(l, w)),
			invalidate() {},
			dispose() {},
		};
	}, { overlay: true, overlayOptions: { width: "80%" } });
}
```

## 5. Native tool card (condensed from `assets/omp-extension-template/tool.ts`)

```ts
pi.registerTool({
	name: "my_ext_card", label: "My card", description: "...",
	parameters: pi.zod.object({ title: pi.zod.string(), items: pi.zod.array(pi.zod.string()).optional() }),
	async execute(_id, p) { return { content: [{ type: "text", text: `card ${p.title}` }], details: { title: p.title, items: p.items ?? [] } }; },
	describeCall: a => ({ tool: { title: "My card", target: a.title, targetKind: "text" } }),
	describeResult: (r, _o, a) => ({
		tool: { title: "My card", target: r.details?.title ?? a?.title },
		open: true,
		body: [n("checklist", { phases: [{ id: "p", title: "Items", items: (r.details?.items ?? []).map((text: string, i: number) => ({ id: String(i), text, status: "pending" })) }] })],
	}),
});
```

`describeCall` draws the pending header; `describeResult` the final card. Keep `details` JSON-serializable.

## 6. Luau plugin quick start

For Tern chrome (status line, palette, key binds, blocks, lenses, CSS), not for omp UI.

1. Copy `assets/luau-plugin-template/` (`plugin.toml`, `host.luau`, `window.luau`) to a new folder.
2. Edit `plugin.toml` (`schema = 1`, `id` matching `^[a-z][a-z0-9-]{0,31}$`, `name`, `version`, `host`/`window`; `[[blocks]]`/`[[lenses]]` require a `host`).
3. `tern plugin types DIR` writes `tern.d.luau` for luau-lsp. `tern plugin link DIR` links it so edits hot-reload; `tern plugin reload` forces it; `tern plugin list --json` shows status.

Two halves with hard budgets. `host.luau` runs once per plugin in the session daemon (2 s per call): blocks, lenses, host events, `tern.pane.write`. `window.luau` runs per window on the UI thread (50 ms per call; 4 ms for chrome formatters): palette commands, binds, status/tab formatters, `tern.css`, `cx`. `tern` is a global, never `require("tern")`. Run processes with `tern.process.run({"git", ...}, opts, cb)` (argv, no shell). Details: `references/luau-plugins.md`.

## 7. Limits and gotchas

- omp cannot reach: program CSS (never emits the `s` verb), `flow` surfaces, `el`/`stats`/`button`/`select`/`switch`/`calendar` kinds, Tern chrome, `openTerminal` for Tern. Route those to an SDK program (`tern split ... -- bun app.tsx`) or a Luau plugin.
- Windows: TSP needs Tern's bundled ConPTY (OSC 877 inbound). Outside Tern, omp stays on ANSI, hence `render()`.
- Restart omp after editing an extension (Bun ignores `file://` query strings on Windows).
- Reserved keys in omp (`ctrl+c/d/z/k/p/l/o/t/g/q`, `alt+m`, `shift+tab`) cannot be bound.
- `tui.nativeRendering` (not `TERM_PROGRAM`) says whether a TSP surface is live.
- Tern is in closed beta; the public docs can describe newer behaviour than the installed build.

## 8. Verify before claiming done

```
bun <skill>/scripts/describe-harness.ts <entry.ts> --command <name> [--events ev.json] [--ansi]
```

Expect the JSON tree, `memo-stable: true`, a non-empty `--ansi` render, and `done(...)` on the close event. Exit code 1 means something threw. Without `--command` it lists commands/tools and prints tool cards. For plugins run `tern plugin types` and `tern plugin list`. Live runs, recording, screenshots: `references/verification.md`.
