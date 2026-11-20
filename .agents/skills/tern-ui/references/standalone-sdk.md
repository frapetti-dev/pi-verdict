# Standalone SDK programs (`@stencil-hq/tern`)

A standalone program talks TSP (Tern Surface Protocol) directly, without omp. It reaches things an omp extension cannot: program CSS, `el` HTML forms, `flow` (scrollback) output, and kinds omp does not type.

## Contents

1. [When to choose a standalone program](#1-when-to-choose-a-standalone-program)
2. [The TypeScript SDK](#2-the-typescript-sdk)
3. [Launching from omp](#3-launching-from-omp)
4. [Protocol essentials and limits](#4-protocol-essentials-and-limits)
5. [Program CSS rules](#5-program-css-rules)
6. [What omp can / cannot reach](#6-what-omp-can--cannot-reach)

Marker: `[UNVERIFIED]` = not confirmed by a doc fetch or source read.

---

## 1. When to choose a standalone program

Choose a standalone SDK program (not an omp extension) when you need any of:

- Program CSS (the `s` verb). omp never emits it.
- `el` HTML forms (`html.form`, `html.input type=radio`, ...). `el` is not in omp's `TSP_KINDS`.
- `flow` output: a static view kept in scrollback (`print`) or a running card in scrollback. omp only uses `inline` and `screen`.
- Kinds omp does not type: `stats`, `button`, `select`, `switch`, `calendar`, `slider`, `field`, ... (see [section 6](#6-what-omp-can--cannot-reach)).
- A program that is not omp (a CLI, a deploy tool, a dashboard).

Stay with an omp extension (`references/omp-extension.md`) when the UI belongs inside an omp session (overlay, sheet, widget, tool card). Combine: an omp overlay button can launch a standalone program in a split pane ([section 3](#3-launching-from-omp)).

Prefer kinds and props over CSS. The SDK README says: "Use `button`, `table`, `stats`, `kv`, `tabs` and `card`s, not `html.*` plus CSS; write no stylesheet for looks the kinds already have." Source: https://raw.githubusercontent.com/stencil-hq/tern-sdk/main/typescript/README.md

SDKs exist for other languages (https://docs.stencil.so/tern/protocol/sdks.md): Rust crate `tern-sdk`, Python `tern-sdk` (import `tern_sdk`), Go `github.com/stencil-hq/tern-sdk/go/tern`. The rest of this file covers TypeScript.

## 2. The TypeScript SDK

Source: https://github.com/stencil-hq/tern-sdk/tree/main/typescript (MIT, ESM, zero runtime deps; Bun runs from source, Node 22+ from `dist/`).

### Install and JSX setup

```sh
bun add @stencil-hq/tern
```

For TSX, point the JSX runtime at the package in `tsconfig.json` (README):

```json
{
   "compilerOptions": {
      "jsx": "react-jsx",
      "jsxImportSource": "@stencil-hq/tern"
   }
}
```

- Lowercase JSX tags are TSP kinds with typed props (`<card>`, `<md>`, `<table>`, ... every kind except Tern's own `block`) plus common props (`key`, `role`, `tone`, `hidden`, `actions`, `min`, `max`).
- String children become the `text` of text kinds. `<span s="accent">` inside `<text>` builds styled spans.
- `el` nodes come from the `html` namespace: `<html.form class="ask">`, `<html.input type="radio" name="size" value="s" />`.
- Without JSX: `ui.<kind>(props, ...children)`, `html.<tag>`, `node(kind, props, children)`, `span()`.

### Core API

| API | Purpose |
|---|---|
| `connect({ app })` | Handshake. Returns a session, or `null` when TSP is unavailable. Always null-check. |
| `session.open({ mode, font, id?, title?, role?, closable?, adopt?, forwardActions? })` | Open a surface. `mode`: `'inline'` \| `'screen'` \| `'flow'`. `font: 'sans'` gives the UI face (README: open apps with `font: 'sans'`). |
| `surface.render(view)` | Send the view. Takes a node/list/fragment (becomes `main`) or `{ main?, dock?, layer? }`. Only the diff against the last view goes out. |
| `for await (const input of session)` | Input loop. Yields `{type:'key', key}` and `{type:'event', event}` for anything no handler consumed. |
| `session.close()` / `await using` | Close and restore the tty. `surface.close()` sends the pending frame then `x`. |
| `print(view, {css?, font?, fallback?})` | Static view kept in scrollback: `flow` surface, `listen:false`, one frame, closed with `keep`. Outside Tern or without a tty it writes `plain(view)` or `fallback`. |
| `ask(view, {css?, font?, submit?='submit'})` | Form. Resolves `{type:'answer', id, act, values}` on the first `submit` action; `null` on Esc/Ctrl+C/Ctrl+D; `{type:'unsupported'}` without TSP. |
| `plain(view, cols?)` | Escape-free text fallback. Prints a `row`'s children on one line, so build fallback-friendly views (a `col` of cards) or pass `fallback` to `print`. |
| `bar(fraction?, width=20)` | `[####----] 50%` plain progress bar (`[--------]` when unknown). |
| `css` | Tagged template returning the sheet as written (editor highlighting only). Pass it via `css:` in `print`/`ask`/`open`. |

Handlers replace manual action names (README "Handlers"): `onClick`, `onDblClick`, `onMenu`, `onAction={{name: fn}}`, `onToggle`, `onSelect`, `onActivate`, `onChange`, `onFocus`, `onEdit`, `onUndo`, `onSend`. Events route by `sf` and `id` to the node in the last rendered view. A handled event is consumed; the rest reach `for await`. `open({forwardActions: ['submit']})` also yields those actions after their handlers run.

Keys are `{ name, text?, ctrl, alt, shift, meta }`. Match on `name` (`'enter'`, `'escape'`, `'tab'`, `'up'`, `'down'`, `'page_up'`, `'f1'`, ...; letters are lowercase, Shift+A is `name:'a', shift:true`). With Ctrl/Alt/Meta there is no `text`.

Child ids are `<parent id>.<key>` (the `key` prop, else the index). Two siblings with one id reject the whole view with a `ViewError`, before anything is sent. Give dynamic children `key`s.

### Environment variables

| Variable | Effect (README) |
|---|---|
| `TERN_TSP=0` | Never speak TSP (program uses its plain fallback). |
| `TERN_TSP_RECORD=<file>` | Append every message, both directions, as JSONL. `surface-play` replays it. |
| `TMUX`, `TMUX_PANE` | In tmux, probe only when Tern draws the session (`@tern-tsp` set); the pane's `allow-set-title` is off while connected. |
| `STY`, `ZELLIJ` | Inside screen or zellij, do not probe. |

### Example: interactive screen program

Verbatim from the SDK README "Quick start" (https://raw.githubusercontent.com/stencil-hq/tern-sdk/main/typescript/README.md). Save as `app.tsx`; it needs the `tsconfig.json` above.

```tsx
import { connect } from '@stencil-hq/tern';

const session = await connect({ app: 'deploy' });
if (session) {
   const surface = session.open({ mode: 'screen', font: 'sans' });
   surface.render(
      <card head="Deploy" icon="rocket" meta="api-gateway" status="running">
         <md>{'Uploading **api-gateway**'}</md>
         <progress value={0.4} label="40%" />
         <button
            variant="danger"
            keys={['esc']}
            onClick={() => surface.render(<md>{'Cancelled'}</md>)}
         >
            Cancel
         </button>
      </card>
   );
   for await (const input of session) {
      if (input.type === 'key' && input.key.name === 'escape') break;
   }
   await session.close();
}
```

Note: when `connect` returns `null` this example does nothing. A real program should print a plain fallback in that branch.

### Example: `print`

Verbatim from `typescript/examples/table.tsx` (https://raw.githubusercontent.com/stencil-hq/tern-sdk/main/typescript/examples/table.tsx):

```tsx
/** `print`: the current directory as a `table`, sizes right-aligned in a mono column. */
import { readdirSync, statSync } from 'node:fs';
import { print } from '@stencil-hq/tern';

/** A byte count as `312`, `2.1K`, `14M`. */
function human(bytes: number): string {
   const units = ['', 'K', 'M', 'G', 'T'];
   let value = bytes;
   let unit = 0;
   while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
   }
   const shown = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
   return shown + (units[unit] ?? '');
}

const entries = readdirSync('.', { withFileTypes: true })
   .filter(entry => !entry.name.startsWith('.'))
   .map(entry => ({
      name: entry.isDirectory() ? `${entry.name}/` : entry.name,
      dir: entry.isDirectory(),
      size: entry.isDirectory() ? '-' : human(statSync(entry.name).size),
   }))
   .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));

await print(
   <table
      cols={[
         { id: 'name', head: 'Name', mono: true, grow: 1 },
         { id: 'size', head: 'Size', align: 'end', mono: true },
      ]}
      rows={entries.map(entry => ({
         id: entry.name,
         cells: {
            name: { text: entry.name, icon: entry.dir ? 'folder' : 'file' },
            size: entry.size,
         },
      }))}
   />
);
```

Larger reference apps in the repo's `typescript/examples/`: `ask.tsx`, `progress.tsx`, `chat.tsx` (inline surface with an `editor` in the dock), `dashboard.tsx` (sans screen app: head row, `stats`, tabs, table + detail card, ~960 lines).

### View design rules (README "Design rules")

- Machine strings (versions, paths, numbers) go in `mono` columns or `mono`/`code`/`path` span tokens.
- Page layout: head row (`row justify="between"`: title span token + muted meta, badges, global buttons) -> optional `stats` strip (max 4 tiles, placed directly on the page, never in a card) -> underline `tabs` if more than two views (render only the active one) -> full-width table, beside a detail `card` (`min={{ w: '44ch' }} max={{ w: '56ch' }}`) for master/detail. The dock holds the confirm strip and a key legend.
- Color carries meaning only: use `tone` and span tokens, never custom colors.
- One `primary` button per view. Destructive actions ask first in a `card tone="error"` strip with `quiet` + `danger` buttons.
- Tables: exactly one `grow` column; numbers `align:'end'` + `mono`; spark/meter/badge columns never grow; narrow tables hide the lowest `priority` columns first (missing = 0).
- Design all four states: loading, `empty`, error, success.
- Full guide: https://docs.stencil.so/tern/guides/design.html

## 3. Launching from omp

An omp extension (or the user) opens a standalone program in a new pane with the `tern` CLI. Always pass an argv array to `pi.exec`, never a shell string:

```ts
// Gate first: TERM_PROGRAM === "tern" && TERN_PANE (see references/tern-cli.md)
const pane = process.env.TERN_PANE;
if (process.env.TERM_PROGRAM === "tern" && pane) {
  await pi.exec("tern", ["split", pane, "right", "--keep-open", "--", "bun", "app.tsx"]);
}
```

Equivalent shell: `tern split $TERN_PANE right --keep-open -- bun app.tsx`.

- `--keep-open` keeps the pane after the program exits, so output and errors stay readable.
- Everything after `--` is the program's argv.
- Pass working directory with `--cwd DIR` (see `references/tern-cli.md` for exact flags).
- Outside Tern the program's own fallback runs (`connect` returns `null`; `print` writes `plain(view)`).
- The standalone program owns its pane. It does not share state with omp; exchange data via files, args, or stdout.

## 4. Protocol essentials and limits

Sources: https://docs.stencil.so/tern/protocol/{handshake,transport,surfaces,documents,input,operations}.md. You rarely write these by hand with the SDK; they matter for recordings (`TERN_TSP_RECORD`) and debugging.

### Handshake

Send the `hello` query, then DA1 (`ESC [ c`):

```
ESC _ tsp;q;{"q":"hello","v":[1],"app":"…","ver":"…","features":["edit","undo","send"]} ESC \
ESC [ c
```

A DA1 reply with no `tsp;r` before it means no TSP. Reply fields: `v`, `term`, `ver`, `kinds`, `features`, `apc` (65536), `credits` (2), `cols`, `cell`, `dark`, `reduceMotion`, `hour12`. Terminal features: `blobs settle adopt dock reduce-motion aside scroll styles flow font`. Program features: `edit undo send`. Starting without waiting for the reply is allowed under `TERM_PROGRAM=tern` outside a multiplexer.

### Transport and verbs

Framing: `ESC _ tsp ; <verb> [; key=value]* ; <body> ESC \`.

| Verb | Dir | Meaning |
|---|---|---|
| `q` | p->t | query (`hello`, `blobs`) |
| `o` | p->t | open surface |
| `f` | p->t | frame |
| `b` | p->t | blob |
| `t` | p->t | obsolete, ignored (transport.md) |
| `s` | p->t | stylesheet (program CSS) |
| `x` | p->t | close (`keep`, default true) |
| `r` | t->p | reply |
| `e` | t->p | event |

Chunking: `c=<id>`, `m=1`; chunks drop after 1 s idle; max APC string 262144 bytes.

**Windows:** t->p messages arrive as OSC 877 (`ESC ] 877 ; tsp ; … ESC \`) because ConPTY drops inbound APC. p->t stays APC. This needs Tern's bundled `conpty.dll` and `OpenConsole.exe` next to `tern.exe`. The SDK handles it; custom clients must parse OSC 877.

### Surfaces

`o` fields: `id` (required), `mode` (`inline` default | `screen` | `flow`), `title`, `role`, `adopt`, `listen`, `closable`, `font` (`sans` | `mono`, default mono).

- `inline`: anchors at the cursor row, owns the pane.
- `screen`: fills the pane.
- `flow`: anchors and stays in scrollback.
- Regions: `main`, `dock`, `layer`. Overlays go in `layer`. A `prefs` in `layer` docks as an aside (feature `aside`).
- `font:"sans"` adds the `sf-sans` class.

### Documents, frames, ops

Node `{id, k, p, c}`. Frame `{sf, s, ops}`. Ops:

- `add [add,id,parent,before|null,node]`
- `set [set,id,props]` (null deletes a prop)
- `text [text,id,"append"|"replace",string]`
- `splice [splice,id,at,del,string]`
- `move`, `del`, `settle`
- `focus [focus,id|null]`, `reveal`
- `scroll` (feature `scroll`)
- `suspend` / `resume`

Per-op errors carry the `op` index.

### Input events

Keys arrive as pty input (kitty keyboard, bracketed paste). Native editing needs feature `edit` (events carry `id, from, to, text, cursor, len`); `undo` event; `send` event needs target `sendable:true`. Pointer `actions` object: `{click, dblclick, menu[]}`. Built-in action names: `toggle`, `copy`, `open`, `zoom`, `select`, `activate`; any other name fires an `action` event with `act`, `value`, `item`, `mods`, `checked`, `values`. Events: `ack resize theme motion visible toggle select activate action change focus edit undo send error gone`.

### Limits (operations.md)

| Limit | Value |
|---|---|
| Nodes per surface | 200 000 |
| Depth | 64 |
| Stylesheets | 256 KiB per surface |
| One blob | 16 MiB (base64 body, id = SHA-256 hex, dir `TERN_BLOB_DIR`) |
| Blobs per screen | 256 MiB; 1 GiB on disk |
| Chunked message | 24 MiB (frame 400 MB) |
| Retention | 64 MiB per pane |
| Flow control | credits (default 2) + acks; the SDK keeps only the newest view while blocked |

Debug: `TERN_TSP_RECORD=<file>` then `surface-play "<file.jsonl>" [from] [until] [paced]`. Security: `el` allows a fixed tag list and attribute allowlist; no raw colors in spans or props.

### `el` constraints (https://docs.stencil.so/tern/elements/el.md)

- Allowed tags: `div span p section header footer nav aside main article figure blockquote ul ol li dl dt dd h1 h2 h3 h4 pre code kbd strong b em i del mark hr table thead tbody tr th td label button`. `form` draws as a div. `input` works only for checkbox and radio; other types draw an empty div plus an `unknown el tag input type <type>` error. Other tags draw as a div plus `unknown el tag <tag>`.
- Attribute allowlist: `data-*`, `aria-*`, `role` (not on controls), `aria-labelledby`, `colspan`, `rowspan`. Tern owns `data-id`, `data-role`, `data-tone`, `data-mark`, `data-href`, `data-scope`, `aria-label`, `aria-checked`.
- `button` needs `actions`. Controls are pointer-only (no tabindex). `text` is plain. Change event: `{ev:"change", id, name?, value, checked, values?}`. `checked` from the program wins over a local flip.
- `[UNVERIFIED]` lines 421-758 of el.md were not read.

## 5. Program CSS rules

Sources: https://docs.stencil.so/tern/protocol/theme.md, https://docs.stencil.so/tern/styles/index.md, https://docs.stencil.so/tern/styles/css.md. Tern draws views with its own engine, not a browser; it accepts a defined subset of CSS.

Reach for a prop before a sheet: `button`, selectable `table`, `tabs`, `stats`, `card`, `tone`, and `font: 'sans'` already look like Tern. Never set `cursor`. `print` and `ask` take a `css` option (README Helpers); the SDK sends it with the `s` verb. [UNVERIFIED] whether `session.open` also takes `css`.

### The `s` verb

`s` body: `{"sf":"s1","name":"main","css":"…"}`.

- `name`: 1-64 chars, `A-Z a-z 0-9 _ -`. Null or empty `css` removes the sheet.
- Sheet name in Tern: `tsp:<scope>:<name>`.
- Cascade order between your sheets is first-sent order.
- Max 256 KiB per surface.
- Plugins (Luau) do not use `s`; they use manifest `styles` or `tern.css` (see `references/luau-plugins.md`).

### Scoping

A program sheet is confined to its surface. Rules are scoped to the region via `[data-scope="sf<N>"]`, which adds no specificity. Regions are `.sf-region` with `.sf-main` / `.sf-dock` / `.sf-layer`, carrying `data-scope`, `data-surface`, `data-role`. So a plain `.row { ... }` in your sheet only affects your own surface.

### Dropped / rejected constructs

| Construct | Result |
|---|---|
| `url()` (in program sheets) | Dropped, `error` event |
| `position: fixed` | Dropped, `error` event |
| `@font-face` | Ignored |
| `@import`, `@supports`, `@container`, other at-rules | Dropped, `unsupported at-rule` error |
| Allowed rules | style rules, `@media`, `@layer`, `@keyframes`, `@font-face` (ignored) |
| Unknown property / invalid value | Declaration dropped, error |
| Unsupported selector, pseudo-class, pseudo-element | Whole rule dropped, error |
| Length units other than `px em ch vw vh %` and bare `0` | Rejected (`rem`, `lh`, `vmin`, `pt` ... fail with `unsupported length unit`) |
| `conic-gradient()`, `image-set()`, `hwb()`/`lab()`/`lch()`/`color()` | Rejected |
| `revert`, `revert-layer`, `@property` | Not supported |

The parser never fails the whole sheet: it drops what it cannot use and keeps the rest. Errors return to the program as one event per sheet: `{"ev":"error","sheet":"main","msg":"2:6: unsupported length unit `rem` in `width: 2rem;`; 3:1: …","sf":"s1"}`. Handle `error` events during development.

Supported: CSS Nesting (`&`), `!important`, `var()` with fallback, `calc/min/max/clamp`, colors (hex, named, `rgb`, `hsl`, `oklab`, `oklch`, relative colors, `color-mix`, `light-dark`), linear/radial gradients, transforms, filters, `@keyframes`. Stencil extensions exist (`color-field`, `mesh-gradient`, `perimeter-gradient`, `-stencil-shape`).

### Region and state classes

- Regions: `.sf-region .sf-main | .sf-dock | .sf-layer`.
- Node markup: `<tag class="sf sf-<kind>" data-id data-role data-tone data-mark data-href title aria-label>`.
- State classes: `.sf-hidden`, `.sf-void`, `.sf-clip`, `.sf-act`, `.sf-deco`; `.sf-sans` (from `font:'sans'`); `.sf-still` (Reduce Motion on); `.sf-paused` (hidden pane); `.sf-covered` (sheet over pane); chat skins `.sf-chat-reader|spine|console` on inline/screen regions (flow output takes none).
- Style by `[data-role]` (give nodes your own `role`) or `[data-mark]` (stable). Avoid inner classes (`.sf-card-head`, `.sf-tbl-c`, ...): they are Tern's structure and may change.
- Flex props (`grow`, `shrink`, `basis`, `min`, `max`) are inline styles. Set them as props. A sheet rule only wins with `!important`.

### Tones, tokens, variables

- Tones map to `--tc`: neutral `--sf-neutral`, accent `--sf-accent`/`--accent`, info `--sf-info`, success `--sf-ok`, warning `--sf-warn`, error `--sf-bad`, pending `--live`, muted `--sf-muted`, user `--sf-user`. Other tone values are dropped. Override on the same element: `[data-role^='x.'][data-tone='pending'] { --tc: light-dark(#0f8a8a, #3fd0c9); }`.
- Color with variables, never hard-coded: `--tc`, `--t1`..`--t4`, `--accent`, `--accent-fill` (white text on accent), `--ok`, `--warn`, `--bad`, `--sf-c-<token>`, `--l2`, `--mono`, `--sf-fs`, `--sf-lh`. Full list: https://docs.stencil.so/tern/styles/variables.md `[UNVERIFIED: page not fetched; names above come from styles/index.md and css.md examples]`.
- Light/dark: Tern sets `data-theme='light|dark'` on the root. Use `light-dark(a, b)` in colors, or `[data-theme='dark'] sel`. `@media (prefers-color-scheme)` matches the shown theme. The theme also arrives as a `{"ev":"theme","dark":bool}` event.
- Sizes: use px. Views zoom by UI font size / 13; `var(--sf-fs)` follows the terminal font.
- Span token classes `.sf-t-<token>`. Tokens: `muted dim strong em accent success warning error info pending title code mono path key link num ins del mark typo icon hide`. omp theme names (e.g. `toolTitle`) also work in `s`, mapped to the nearest token (https://docs.stencil.so/tern/elements/text.md).
- Motion: stop your own animations under `.sf-still`, pause under `.sf-paused`. Use ordinary easing; Tern paces endless animations. Reserve `steps()` for blinks.

### Cascade order

Per element, later wins:

1. Tern's user-agent sheet.
2. Author rules: Tern's built-in sheets, then plugin/program sheets (registered after Tern's, so equal-specificity rules win), ordered by `@layer`, then specificity, then sheet order, then position.
3. Inline style.
4. `!important` declarations (author rules with layers reversed, then a CSS theme, then inline `!important`).

Kit sheets come first, then surface sheets (`surface*.css`, `omp*.css`), then Tern window sheets, then plugin and program sheets last (styles/index.md).

### Debugging styles

`tern --control /tmp/tern-ctl.sock <plugin-dir> &` then `tern ctl --control /tmp/tern-ctl.sock css` (sheets in cascade order) or `tree "<selector>"` (matched elements with classes/attributes). This is documented for plugin windows; whether it exposes `tsp:` sheets of a running program `[UNVERIFIED]`.

## 6. What omp can / cannot reach

Sources: `pi-wire/src/tsp.ts` (`TspVerb` at :31, `TSP_KINDS` at :38-82, props :299-423, op/open types :928-962) and `pi-tui/src/native/backend.ts` (open :468/:610, close :615, frame :665, blobs query :720, palette `t` :405). Verified at `@oh-my-pi/*` v18.13.2.

| Capability | From omp extension | From standalone SDK |
|---|---|---|
| `o` open, `f` frame, `x` close, `q` blobs | Yes | Yes |
| `s` stylesheet (program CSS) | **No**: omp never emits `s` (no `#write("s"` in backend.ts) | Yes |
| `t` verb | omp sends its palette with it, but Tern ignores `t` (transport.md); effect on 0.9.7 `[UNVERIFIED]` | Do not use |
| Mode `inline` | Yes (session surface, `adopt:true`) | Yes |
| Mode `screen` | Yes (fullscreen overlays) | Yes |
| Mode `flow` (scrollback) | **No**: `mode: "inline"\|"screen"` only (tsp.ts:958-962) | Yes (`print`, flow surfaces) |
| `el` (HTML) and `html.*` forms | **No**: not in `TSP_KINDS` | Yes |
| `block` | No | No: Tern-made around lens views; SDK excludes it |
| `stats`, `button`, `select` | **No**: not in `TSP_KINDS` | Yes |
| `switch`, `calendar`, `slider`, `field`, ... | Not typed in omp `[UNVERIFIED]` per kind; check `TSP_KINDS` before use | Yes |
| `table`, `tree`, `badge`, `kbd`, `icon`, `spinner`, `shimmer`, `elapsed`, `progress`, `rate`, `list`, `item`, `tabs`, `editor`, `input`, `status`, `seg`, `overlay`, `toast` | Typed props (tsp.ts:299-423) | Yes |
| Opening a Tern terminal pane | `ctx.ui.openTerminal` has **no Tern provider**; use `tern split` via `pi.exec` instead | n/a |
| Raw ANSI output | Hidden while a TSP surface is live; always provide `render()` fallbacks | `connect` returns `null` without TSP; use `print`/`plain` fallback |
| Frame ops | `set`, `text`, `splice`, `move`, `del` typed (tsp.ts:928-932); `scroll`/`settle`/`focus`/`reveal`/`suspend`/`resume` handling `[UNVERIFIED]` | All |
| Input events | `toggle select activate action change edit undo send` through `handleNativeEvent`; `edit`/`undo`/`send` routing `[UNVERIFIED]` | All |

Rule of thumb: if the feature needs `s`, `flow`, `el`, `stats`, `button`, or `select`, build a standalone program and launch it with `tern split` ([section 3](#3-launching-from-omp)). Otherwise stay in omp (`references/omp-extension.md`).
