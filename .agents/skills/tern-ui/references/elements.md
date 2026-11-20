# Tern element kinds (TSP)

Reference for every node kind Tern draws. Use it when writing `n(kind, props)` in an omp extension, `ui.node(kind, props, children)` in a Luau plugin, or JSX in a standalone SDK program.

**Reading the tables.** "omp-typed?" = the kind is in omp's `TSP_KINDS` (`@oh-my-pi/pi-wire/src/tsp.ts:38-82`) and its props are typed in `TspPropsByKind` (`tsp.ts` ~140-880). An omp extension's `n(kind, props)` (see `assets/omp-extension-template/nodes.ts`) is typed `n<K extends TspKind>(k: K, p?: TspProps<K>)`, so TypeScript only accepts omp-typed kinds and omp-typed props. Props marked *(docs only)* are documented by Tern but missing from omp's types: TS rejects them without a cast, and whether omp forwards them to Tern is `[UNVERIFIED]` (omp builds frames from the node object, so it very likely does; test with the harness and a live pane).

Props come from the docs pages `https://docs.stencil.so/tern/elements/<page>.md` (`layout`, `text`, `data`, `lists`, `motion`, `input`, `chrome`, `work`, `el`) cross-checked with `tsp.ts`. Where docs and omp's types disagree, the omp type is what compiles.

## Contents

1. [Common props and layout tokens](#1-common-props-and-layout-tokens)
2. [Kinds omp can build](#2-kinds-omp-can-build) (layout, text/code, data, lists/nav, motion, input, chrome, work/agent, media)
3. [Standalone-SDK-only kinds](#3-standalone-sdk-only-kinds), including `el`
4. [Spans](#4-spans)
5. [Tones](#5-tones)
6. [Icon names](#6-icon-names)
7. [Events and key-path routing](#7-events-and-key-path-routing)

---

## 1. Common props and layout tokens

Every node takes these (`tsp.ts` `TspCommonProps`; docs https://docs.stencil.so/tern/elements/index.md):

| Prop | Type | Effect |
| --- | --- | --- |
| `key` | string | Identity among siblings. Keeps the node id (and local view state: fold, scroll, caret) across reorders. State is remembered per key under the same parent. Duplicate sibling keys are an error. In omp it also builds the event key path (section 7). `n()` takes it as the 4th arg. |
| `role` | string | Exposed to CSS as `data-role`. omp's own roles (`omp.btn`, `omp.sheet.head`, ...) are Tern-internal; see `roles-and-layout.md`. |
| `tone` | tone | Semantic chrome colour. Other values are dropped (section 5). |
| `hidden` | boolean | Mounted but not laid out (`display:none`). Cheaper than remove/add. |
| `mark` | `"pick"` \| `"drop"` | Transient selection overlay: `pick` = accent bar at the left edge, `drop` = dimmed. |
| `actions` | `{click?, dblclick?, menu?: string[]}` | Pointer behaviour. Built-in names: `toggle copy open zoom select activate`. Any other name fires an `action` event with that `act`. A node with `click`/`dblclick` gets `sf-act` + pointer cursor. `menu` = right-click entries (Copy is appended unless listed). |
| `title` | string | Tooltip. |
| `hovercard` | node tree `{k,p?,c?}` | Rich tooltip card on ~350 ms hover; replaces `title` while open. Ids/keys inside are ignored. |
| `aria` | string | Accessible name for icon-only / visual-only nodes. |
| `href` | string | URL or `file://` path: Cmd-click opens it; target of the `open` action. |
| `grow`, `shrink` | number | Flex grow/shrink in a `row`/`col`. Inline style, so a stylesheet needs `!important` to override. |
| `basis` | `"auto"` \| `"content"` \| number | Number = fraction of the parent (`0.5` = 50%). `"content"` = own size, no shrink. |
| `min`, `max` | `{w?, h?}` | Extents: `"40ch"` (cells), `"10lines"` (text lines), or a number = fraction of the parent (`0.4`). **Never pixels.** `max.h` also clips (`sf-clip`). A `chart`'s numeric `min`/`max` (value domain) replace these on that kind. |

**Gap/size tokens** (`TspSpace` = `none|xs|sm|md|lg`, https://docs.stencil.so/tern/elements/layout.md):

| Token | `col`/`row` `gap` | `spacer` `size` |
| --- | --- | --- |
| `none` | 0 | 0 |
| `xs` | 2 px | 2 px |
| `sm` | 6 px | 6 px |
| `md` | 10 px | 12 px |
| `lg` | 16 px | 20 px |

Sizes are px at the default font; the docs state they scale with the font. There is no padding prop: use `spacer` children (see `roles-and-layout.md`, `framed`).

---

## 2. Kinds omp can build

All 43 kinds of `TSP_KINDS`, grouped as the docs group them. "Key props" lists omp-typed props first; *(docs only)* props follow. Events use the `NativeUiEvent` names from section 7; the wire names (`ev`) are identical.

### Layout (`layout.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `col` | `gap` (token), `align` `start\|center\|end\|stretch` (docs add `baseline`) | none | yes |
| `row` | `gap`, `align` `start\|center\|baseline\|end\|stretch`, `justify` `start\|between\|end`, `wrap` boolean. `align` defaults to center. | none | yes |
| `card` | `head` (text or child id), `status` `pending\|running\|done\|error\|cancelled`, `collapsible`, `collapsed`, `preview` `{lines:n}\|"auto"` (auto = 10), `selected`, `inset` (body unpadded, for a flush `code`), `variant:"bare"` (no ring/fill). *(docs only)* `icon`, `meta`, `end` (child id drawn at head's right) | `toggle` (collapsible head) | yes |
| `section` | `head`, `collapsible`, `collapsed`, `took` (ms; finished thinking section). Lighter than `card`: no ring. | `toggle` | yes |
| `rule` | `label` (text). *(docs only)* `variant` `line\|note\|pin`, `icon`, `time`, `tone`, `end` (child id) | none | yes |
| `spacer` | `size` (token) | none | yes |

### Text and code (`text.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `text` | `text` (string) or `spans` (wins), `wrap` `word\|char\|none`, `truncate` `end\|start\|middle`, `lines` (clamp, ends in `...`), `measure` `prose\|fill` (docs: `"prose"` caps at 80 cells). *(docs only)* `cite` `chip\|pill\|note`, `sources` | none (link/citation clicks are Tern's) | yes |
| `md` | `text` (Markdown), `stream` (tail still arriving), `marks` (spans drawn in place of literal runs) | none (copy/open/run/link are Tern's) | yes |
| `code` | `text`, `lang` (wins over `path`), `path` (picks grammar, headers a block), `start`, `numbers`, `marks` `{line,tone}[]`, `wrap`, `preview` `{lines}\|"auto"`. *(docs only)* `nums`, `folds`, `overview` | none | yes |
| `diff` | `text` (unified diff) or `hunks` `{oldStart,newStart,lines}[]`, `path`, `lang`, `mode` `unified\|split\|auto` | none | yes |
| `ansi` | `text` (raw SGR/OSC 8/`\r`/`\b`), `follow`, `preview`, `cols` (wrap width). With `max.h` the block scrolls. | none | yes |
| `rows` | `cols` (width rendered at), `lines` (pre-rendered ANSI rows). Migration fallback only; prefer real kinds. | none | yes |
| `math` | `text` (TeX, no delimiters), `display` | none | yes |

Text kinds (`text md code ansi math editor input shimmer`) keep their text in the `text` prop; omp can stream-append through the `text`/`splice` ops (`tsp.ts` `TSP_TEXT_KINDS`).

### Data (`data.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `kv` | `items: {k: text, v: text}[]`, `layout` `grid\|inline`. No children. Position is identity. | none | yes |
| `table` | `cols: {id, head?, align?, truncate?, priority?, grow?}[]`, `rows: {id, cells: Record<colId, text>}[]`. Cells are string or spans in omp's type. *(docs only)* `selectable`, `selected` (row id), `empty`, `sort {col,dir}`, `multi`, `picked`, `variant` `check\|bar`, `bar` (selection-bar buttons), `hint`; column `mono`, `sortable`; row `disabled`, `menu`, `title`; rich cells `{text,dot}`, `{text,icon,tone}`, `{badge:{text,tone?}}`, `{button:{text,act}}`, `{spark:{values,tone?,min?,max?}}`, `{meter:{value\|parts,...}}` | with `selectable`: `select` (click, `item`=row id), `activate` (dblclick); `action` `act`=button/menu act with `item`=row; `action` `act:"sort"` `value={col,dir}`; with `multi`: `change` `value`=picked ids | yes (cols/rows only) |
| `tree` | `nodes: {id, label, icon?, open?, children?}[]` | `toggle` (`key` = item id, `collapsed`); store it and send back `open` | yes |
| `badge` | `text` (plain only), `tone` | none | yes |
| `kbd` | `keys: string[]` (`ctrl alt shift cmd enter esc tab backspace delete space up/down/left/right pageup/pagedown home end f1..f24`, one char = upper-cased). Display only. | none | yes |
| `icon` | `name` (section 6). `tone` colours it. An icon with `actions.click` acts as a compact button. | none | yes |
| `image` | `blob` (sha256 of a blob sent with verb `b`) or `builtin:"omp"`, `alt`, `w`, `h`, `max`. Children draw over it. omp only exposes `builtin:"omp"` practically; no blob upload API is known `[UNVERIFIED]`. | click runs `zoom` | yes |
| `media` | `path` (required, absolute or pane-cwd relative), `rev` (git commit-ish or `:0` for index), `link` (same-name nodes pan/zoom together), `max`. Pictures, SVG, 3D, PDF, video, audio. Guard with `cx.supports("media")`. | none | yes |

### Lists, menus, navigation (`lists.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `list` | `selected` (child **node id**, i.e. the item `key`), `filter` (marks hits only; it hides nothing), `empty`, `max` `{lines:n}\|fraction` (caps height, scrolls inside), `virtual` (auto past 200 items). Children: `item`s. | none itself; its items send `select`/`activate` with `key`=list path, `item`=item id | yes |
| `item` | `label`, `detail`, `value`, `icon`, `hint: string[]` (display-only keycaps), `disabled`. `tone` tints icon. Truncates, never wraps. | `select` (click), `activate` (dblclick); per-item `actions.click` replaces `select` | yes |
| `tabs` | `items: {id, label}[]`, `active` (id). *(docs only)* `variant` `underline\|segmented` | `select` (`item` = tab id; in omp the leaf `key` names the tabs node) | yes |
| `picker` | Modal glass sheet, **children = preview**. `title`, `subtitle`, `icon`, `noun`, `size` `md\|lg\|screen`, `layout` `rows\|cards\|timeline\|tree`, `query` (null hides search), `cursor`, `placeholder`, `scopes` `{id,label,count?,group?,icon?,mark?,dot?,disabled?}[]`, `scope`, `tabs` `{id,label,count?}[]`, `tab`, `columns` `{id,head?,format,priority?,min?}[]` (format `text\|num\|price\|bar\|time\|elapsed\|dim`, max 8), `items`/`itemsAdd`/`itemsDel`, `order` (ids + `{group,label,count?}` headers), `hits` (per item id, UTF-16 `[from,to)`), `selected`, `current`, `total`, `preview` `side\|below\|none`, `actions` `{id,label,keys?,primary?,danger?,end?,on?,disabled?}[]`, `strip`, `state` `ready\|loading\|error`, `message`, `empty`, `confirm`, `focus` `list\|scopes\|tabs\|strip\|preview`. Item: `id,label,detail,icon,mark,dot,mono,facts,badges,chips,tone,disabled,hits,node,depth,open,role,title`. Pair with `nativeSheet` (`omp-extension.md`). Verified shape: `assets/omp-extension-template/picker.ts`. | `select` (row), `activate` (2nd click/dblclick), `action` `act:"scope"\|"tab"\|"strip"` with `value`=id, `act`=action id, `act:"close"` (backdrop/esc), `act:"clear"`, confirm acts | yes |
| `menu` | see section 3 | | no |
| `menubar`, `nav`, `breadcrumb`, `pager` | see section 3 | | no |

### Progress and motion (`motion.md`)

Tern clocks all motion; a program sends the node once. `DescribeContext` has no clock: never animate in `describe`.

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `spinner` | `style` `braille\|dots\|starburst\|orbit` (default braille), `label`, `tone`, `aria` | none | yes |
| `shimmer` | `text` or `spans`, `mode` `classic\|kitt`, `palette {low,mid,high}` (span colour tokens) | none | yes |
| `elapsed` | `age` (ms already elapsed; **negative = countdown**), `stopped` (freeze ms), `format` `short\|clock`. Send ages, never timestamps. | none | yes |
| `rate` | `value`, `unit`. Eases over ~420 ms. | none | yes |
| `progress` | `value` 0-1 or `null` (indeterminate), `label`, `tone` | none | yes |
| `meter` | `value` 0-1 or null, `style` `bar\|ring\|blocks`, `steps` (blocks only, 1-20), `parts` `{value,token?,label?,hatch?}[]` (sum <= 1), `marks` `{at,tone?,title?,icon?}[]`, `thresholds {warn?,bad?}` (>= warn -> warning, >= bad -> error), `label`, `total`, `size` `sm\|md\|lg`. In a `row` a bar meter is `flex:1 1 60px`: cap it with `max: {w:"22ch"}` (see `roles-and-layout.md`). | none | yes |
| `chart` | `kind` `heatmap\|bars\|spark` (docs add `line\|area\|donut` *(docs only)*), `series` `{value,label?,title?,tone?}[]` (bars/spark), `min`/`max` (value domain; number, not extent), `marks` `{value,tone?,title?}[]` (dashed reference lines), `token` (fill colour token), `summary`, `size` `sm\|md\|lg` (heatmap cell 8/11/13 px; bars 2/4/8 lines; spark = 1 line). Heatmap: `cells` (rows x cols of 0-1 or null), `rows` (labels), `cols` `{at,label}[]`, `tips`. *(docs only)* line/area: `labels`, `unit`, `last`, multi-series `{label,token,values}`; donut: `total`, `caption`. Verified: bars/spark/heatmap in `gallery.ts` (template: see `screen.ts`). | none (tooltips only) | yes (bars/spark/heatmap) |
| `effort` | `level` `off\|minimal\|low\|medium\|high\|xhigh\|max`; others draw a dashed ring | none | yes |
| `skeleton`, `shimmer` variants | see section 3 for `skeleton` | | no |

### Input (`input.md`)

The program owns text: Tern draws the caret and selection but never edits. Offsets (`cursor`, `anchor`, `decor`) are **UTF-16 code units**.

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `editor` | `text`, `cursor`, `anchor` (null = no selection), `decor` `{from,to,s,fx?}[]`, `ghost` (inline completion), `placeholder`, `prompt`, `mode` (vim label; disables native editing), `lang`, `readonly`, `sendable`, `maxLines`. *(docs only)* `highlight`, `typeahead`, `nowrap`, `topline`, `followCursor`, `gutter`, `virt`, `variant` `well\|field`, `buttons` | `edit`, `undo`, `send`, `focus` (wire only) | yes |
| `input` | single line; `Omit<editor, maxLines>` in omp's type. *(docs only)* `icon`, `keys`, `mono`, `clear`, `prefix`, `suffix`, `unit`, `stepper`, `secret`, `reveal`, `buttons` | as `editor`; plus `action` `act:"clear"\|"inc"\|"dec"\|<button act>` | yes |

`edit`/`undo` are only sent when the program advertised those features in `hello`; `send` needs `sendable:true`. omp wires these for its composer; a plain extension component rarely needs them.

### Chrome (`chrome.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `status` | `transparent` (also `aria`, common). Children: `seg`s. 24 px strip. | none | yes |
| `seg` | `spans` (wins) or *(docs)* `text`, `icon`, `tone`, `priority` (low drops first when narrow), `min {w}` (truncate instead of drop), `side` `left\|right` (docs: `"right"` only; omp types both). Verified: `side:"left"` works in `screen.ts`. | `action` via `actions` | yes |
| `toast` | `text`, `sub` (mono, first line, <=120 chars), `ttl` (ms). Tone: `error`, `info`/`accent`; else neutral. Hidden node: Tern shows a notice. | none | yes |
| `overlay` | `anchor` `center\|top\|bottom\|{node,side:above\|below}\|{caret}`, `size` `sm\|md\|lg\|full`, `modal`, `head`. *(docs only)* `side` `right\|left\|bottom` (edge sheet/drawer), `variant` `edge\|inset`, `icon`, `meta`, `end`/`foot` (child ids for title-row and footer-bar), `size` as fraction (0,1] | none itself; children send theirs | yes. In omp you rarely build it directly: `nativeOverlay` (`omp-extension.md`) makes one. |

### Work and agent kinds (`work.md`)

| Kind | Key props | Events | omp-typed? |
| --- | --- | --- | --- |
| `tool` | `name` (icon by `omp.tool.<name>`), `title` (required), `target`, `targetKind` `command\|path\|pattern\|query\|text`, `lang`, `command`, `href`, `meta: text[]`, `badges {text,tone?,title?}[]`, `status` (required) `pending\|running\|done\|error\|cancelled` (docs add `ask`), `age`, `took`, `exit`, `note`, `intent`, `frame` `card\|inline`, `collapsible`, `collapsed`, `preview` `{lines}\|{tail}\|"none"\|"children"`, `tools: {id,label,keys?}[]` (hover actions). *(docs only)* `confirm`, `ask.{text,allow,deny,always,scopes,scope}`, `approved`. Children = body. | `toggle`; `action` (head tools; approval buttons `act=allow\|deny\|always` with `value`=scope) | yes |
| `agent` | `name` (required), `agent` (type badge), `task`, `status` (required) `pending\|running\|done\|failed\|aborted\|idle\|parked`, `model`, `thinking`, `tool {name,intent?,age?}`, `stats {tools,requests,tokens,context,contextLabel,done,cost,age,took}`, `retry {attempt,max,age,delay,error?}`, `badges`, `depth` (cap 6), `collapsible`, `collapsed`. Children = expanded content. Without `stats` there is no timer. | `toggle` | yes |
| `checklist` | `phases: {id,title,items:{id,text,status,note?}[],collapsed?}[]`, `mode` `full\|hud\|reminder`, `note`. Item status `pending\|active\|done\|dropped\|blocked`. Verified shape in `gallery.ts`. | `activate` `item:"hud"` (hud pill) | yes |
| `prefs` | Native settings window. `title`, `pages {id,label,icon?,changed?,group?,disabled?}[]`, `page`, `lead`, `query`, `cursor`, `sections {id,title,page?,rows}[]`, `focus`, `editing`. Row: `{id,label,hint?,warning?,changed?,defaultLabel?,disabled?,control}`; control `k` = `switch{on}`, `choice{value,options,style?,mono?}`, `number{value,min?,max?,step?,unit?,labels?}`, `text{value,placeholder?,secret?,mono?}`, `keys{keys}`, `multi{values,options,ordered?}`, `action{label,act}`. Children = previews placed by `role`. Pair with `nativeSheet` (`omp-extension.md`). | `change` (`item`=row id, `value`), `action` (`value`=row), `select` | yes |
| `trace`, `stacktrace`, `message`, `suggestions`, `questions`, `block` | see section 3 | | no |

Docs for this page: https://docs.stencil.so/tern/elements/work.md. `prefs` events (docs): `action act:"page" value=<page id>`, `action act:"close"`, `change item=<row> value` (switch bool, choice string, number number, multi string[], Reset null), `activate item=<row>` (popup/text field), `select item="<row>=<value>"` (menu option hover, for live preview), `action act=<control.act> value=<row>`. `[UNVERIFIED]`: that omp forwards every one of these to `handleNativeEvent`; only the `picker` flow is verified in `picker.ts`.

---

## 3. Standalone-SDK-only kinds

Kinds **not** in omp's `TSP_KINDS`. omp's typed `n()` rejects them. Use them from a standalone `@stencil-hq/tern` program (`standalone-sdk.md`) or a Luau plugin (`luau-plugins.md`; `ui.node(kind, props, children)`). Whether omp's backend would forward an un-typed kind if you cast past `n()` is `[UNVERIFIED]`; Tern advertises supported kinds in the `hello` reply (`kinds`), and `cx.supports(kind)` is the omp guard. Treat them as unavailable from omp.

Page names are under `https://docs.stencil.so/tern/elements/`.

### Layout / text

| Kind | Page | Key props | Events |
| --- | --- | --- | --- |
| `split` | layout | `variant` `hairline\|gutter\|tiles`, `dir` `row\|col`, `sizes` number[] (normalised to 1), `min`, `h`, `active`, `key` (drag memory). Children = panes (each padded 10x12 px). | `change` `value` = every pane's share (4 decimals, sums to 1) on handle release; dblclick on a handle resets to `sizes` |
| `scroll` | layout | `variant` `bar\|fade`, `stick:"end"`, `pinned`, `bar` `auto\|always`, `gap`, `noun`. Pins to end while content grows. | none |
| `empty` | layout | `variant` `center\|inline\|drop`, `icon`, `title`, `text`, `tone`, `frame`, `over`. Children = action buttons. | children's own |

### Data

| Kind | Key props | Events |
| --- | --- | --- |
| `stats` | `items: {label, value, sub?, tone?, title?}[]`. Flat strip, <= 4 tiles, never inside a card. | none |
| `json` | `value` (any JSON), `open` (levels expanded) | none |
| `avatar` | `variant` `circle\|square`, `text` (initials), `seed`, `icon` (or `provider:<id>`), `blob`, `size` `xs\|sm\|md\|lg` (16/20/28/36 px), `status` (tone dot) | none |
| `avatars` | `items` (avatar props), `max`, `size`, `label` | none |
| `carousel` | `index`, `loop`, `variant` `peek\|arrows\|strip`, `h`. Children = slides. | `change` `value`=index |
| `attachment` | `name`, `variant` `chip\|tile\|pill`, `ext`, `mime`, `size`, `meta`, `blob`, `href`, `path`, `state` `idle\|uploading\|processing\|error\|done`, `progress`, `error`, `removable`, `actions: {act,icon?,title?}[]` | `action` `act:"remove"\|"retry"\|<yours>` |

### Lists, menus, navigation

| Kind | Key props | Events |
| --- | --- | --- |
| `menu` | trigger: `text`, `icon`, `trigger` `default\|quiet\|primary`, `caret`, `size` `md\|sm`, `variant` `default\|dense`, `open`, `active`, `align` `start\|end`, `disabled`, `title`. `items`: `{id,label,icon?,keys?,detail?,checked?,radio?,disabled?,danger?,items?}`; `"-"` = separator; `{header:"..."}` = section title. | `action` `act`=row id (`checked?` for check/radio rows) |
| `menubar` | `menus: {id,label?,items}[]`, `variant` `strip\|pill`, `icon`, `open`, `active` | `toggle` `{item=menuId, open}`, `action` `{act=rowId, item=menuId}` |
| `nav` | `items: {id,label?,icon?,count?,items?}[]`, `active`, `open`, `variant` `pills\|links` | `select` `item`=item or sub-item id |
| `breadcrumb` | `items: {id,label?,icon?,href?}[]`, `variant` `chevron\|path`, `max`, `open`, `active` | `select` `item`=crumb id |
| `pager` | `variant` `range\|pages\|more`, `page` (1-based), `pages`, `total`, `size`, `loading`, `label` | `change` `value`=page; `action` `act:"more"` |

### Motion

| Kind | Key props | Events |
| --- | --- | --- |
| `skeleton` | `variant` `shimmer\|pulse\|wire`, `shape` `text\|avatar\|rows\|card\|block`, `lines` (1-24), `rows` (1-50), `tiles` (1-8), `tone`, `aria`. Give it the real view's `key` and swap in place so nothing jumps. | none |

### Inputs and buttons (all pointer-only; keys stay with the program)

| Kind | Key props | Events |
| --- | --- | --- |
| `button` | `text`, `icon`, `keys` (display-only keycaps), `variant` `default\|primary\|quiet\|danger`, `size` `sm\|md` (22/28 px), `on` (pressed toggle), `disabled`, `busy`. Set the act with `actions: {click: "deploy"}`. | `action` `act` = `actions.click` (default `"click"`) |
| `buttons` | `variant` `joined\|split\|toolbar`, `size`, `label`. Children = `button`s. | each child's `action` |
| `select` | `value`, `options` (strings or `{value,label?,detail?,icon?,group?,disabled?}`), `variant` `field\|quiet`, `label`, `placeholder`, `size`, `disabled`, `open`, `active`, `search` (combobox), `query`, `cursor`, `total`, `empty` | `change` `value`; `toggle` `{open}` (not `collapsed`) |
| `switch` | `on`, `variant` `default\|compact\|segment`, `label`, `hint`, `labels` `[off,on]`, `disabled` | `change` `value`=boolean |
| `slider` | `value` (number or `{lo,hi}`), `min`, `max`, `step`, `label`, `unit`, `format` `number\|percent\|duration`, `ticks`, `variant` `default\|accent`, `disabled` | `change` `value` on release |
| `otp` | `text`, `length` (1-12), `group`, `cursor` (int or `false`), `variant` `cells\|joined\|underline`, `mask`, `state` `error\|success`, `hint`, `disabled` | `action` `act:"focus"` `value`=cell |
| `calendar` | `variant` `month\|week`, `value` (`"YYYY-MM-DD"` or `[from,to]`), `range`, `month` (`"YYYY-MM"`), `today`, `min`, `max`, `weekStart` `mon\|sun`, `marks`, `cursor`, `presets`, `preset`, `note` | `change` (value), `select` (preset), `action` `act:"month"` `value`=`"YYYY-MM"` |
| `date` | as `calendar` plus `open`, `placeholder` | `toggle`, `change`, `action` |
| `field` | form row: `label`, `hint`, `error` (text or bool), `warning`, `required` (display only), `labelWidth`, `variant` `stacked\|row\|grid`. Children = its control(s). | children's own |

### Agent and chat

| Kind | Key props | Events |
| --- | --- | --- |
| `trace` | `variant` `rail\|summary\|card`, `lines: {id,icon?,title,target?,detail?,status,age?,took?,open?,sources?}[]`, `status`, `title`, `summary`, `icon`, `age`, `took`, `open`, `sources`. A child keyed to a line id is placed under it. | `toggle` `{id, item?, open}` |
| `stacktrace` | `error {type?,message?}`, `frames: {fn,file,line,col,app,code?}[]` (innermost first), `selected`, `lang`, `variant` `frames\|split\|mono` | `select` `item`=frame index |
| `message` | `variant` `auto\|bubble\|flat`, `side` `start\|end`, `author`, `time`, `avatar` (child id), `continued`, `reactions`, `actions` (list), `reveal` `hover\|always`, `status`, `pending` | `change` `{value,on}` (reaction flip) |
| `suggestions` | `variant` `chips\|rows\|cards`, `items: {id?,text,detail?,icon?,keys?}[]` | `activate` `item` |
| `questions` | `items: {id,prompt,description?,choices,multi?,other?,required?}[]`, `step`, `answers`, `variant` `steps\|inline\|list`, `hint`, `submit`. Children: `input`s keyed `<id>.other`. | `change` `{item,value}`; `action` `act:"next"\|"back"\|"skip"\|"submit"`; `select` |
| `block` | Tern-made wrapper around a shell command's output and lens view (`cmd`, `line`, `cwd`, `lens`, `state`, `exit`, `took`). Plugins do not build it; lens views are placed inside it. | none |

Docs: `data.md`, `lists.md`, `motion.md`, `input.md`, `work.md` under https://docs.stencil.so/tern/elements/.

### `el`: plain HTML elements (https://docs.stencil.so/tern/elements/el.md)

Use `el` only when no built-in kind fits (forms with checkboxes/radios, bespoke widgets). Built-in kinds bring Tern's look, keyboard and copy behaviour for free. `el` is styled by **your own CSS**, which only a standalone SDK program (`s` verb) or a Luau plugin sheet can send.

| Prop | Meaning |
| --- | --- |
| `tag` | Default `div`. Allowed tags (exactly): `div span p section header footer nav aside main article figure blockquote ul ol li dl dt dd h1 h2 h3 h4 pre code kbd strong b em i del mark hr table thead tbody tr th td label button input form`. |
| `class` | Space-separated. `sf` and any `sf-*` class are dropped (Tern's). |
| `attrs` | string -> string\|number\|boolean, **allowlist only**: `data-*`, `aria-*`, `role`, `colspan`, `rowspan`. Other names/types ignored. |
| `text` | Plain text node drawn **before** children. |
| `type`, `name`, `value`, `checked`, `disabled` | `input` only: `type` is `checkbox` or `radio`; `name` = form key and radio group; `value` default `"on"`. |

Constraints:

- `form` draws as a `div` (it only groups controls). `input` works only for `checkbox`/`radio`; other input types draw an empty div and report `unknown el tag input type <type>`. Any unlisted tag draws as a `div` and reports `unknown el tag <tag>`. Reports arrive as `error` events.
- `button` needs `actions` to do anything (`actions:{click:"go"}`); it draws in the `button` kind's `md` look (classes `primary`, `quiet`, `danger`, `sm`).
- Tern owns these attributes: `data-id data-role data-tone data-mark data-href data-scope aria-label aria-checked`. Set a name via the `aria` common prop (becomes `aria-label`), not `attrs`. `role` on `attrs` is not allowed on controls.
- Controls are pointer-only (no tabindex, no focus ring). Keys stay with the program.
- `checked` from the program wins over a local flip. Mirror every `change` back into `checked` to stay the owner. A disabled control is left out of `values`.
- Change event: `{ev:"change", id, name?, value, checked, values?}`; inside a form, `action` events carry `values` (name -> value of every enabled control).
- `actions` (`click`, `dblclick`, `menu`) work on any `el`; clickable ones get `sf-act`. `tr` with a `click` action tints on hover.
- Common props on `el`: `role` -> `data-role`, `tone` -> `data-tone`, `mark` -> `data-mark`, `href` -> `data-href`, `title`, `hovercard`, `aria`, `hidden`, `key`, flex/size props.
- Style hooks: `.sf-el`, tag selectors, your classes, `[data-id]`, `[data-role]`, `[data-tone]`, `:checked`, `:disabled`, `.sf-act`, `.sf-hidden`. Scope rules to your surface: `[data-surface='plugin.<plugin>.<block>']`. Tern's sheets have no `:has()`; style a label by its checked control with `:checked + span`.

Minimal radio+checkbox form (Luau, verbatim shape from the docs recipe):

```lua
local ui = tern.ui
local function radio(state, value, label)
	return ui.el("label", { class = "opt" }, {
		ui.el("input", { type = "radio", name = "env", value = value, checked = state.env == value }),
		ui.el("span", { text = label }),
	})
end
```

The docs page continues with a styled-form recipe, a segmented-control recipe, and a key/value grid built from `dl/dt/dd`. For a segmented control with no CSS, `tabs` with `variant:"segmented"` does the same job.

---

## 4. Spans

Anywhere text is taken (`TspText`) you may pass a string or an array of spans (`tsp.ts` `TspSpan`; https://docs.stencil.so/tern/elements/text.md):

```ts
{ t: string,            // the text; empty draws nothing
  s?: string,           // space-separated style tokens
  href?: string,        // makes the span a link (Cmd-click opens; some settings open on plain click)
  fx?: "shimmer" | "pulse" | "none" }   // effect, clocked by Tern
```

`href` accepts a URL with a scheme, `file://...`, or a path (`./README.md`, `src/a.rs:10-20`, `~/x`); relative paths resolve against the pane's cwd and open in a file block at the line. Docs-only span field: `cite` (source table or list; marker follows the run).

**Style tokens** (`s`):

| Token | Look |
| --- | --- |
| `muted`, `dim` | quiet / quieter text |
| `strong` | weight 600, primary colour |
| `em` | italic |
| `accent`, `success`, `warning`, `error`, `info` | semantic colours |
| `pending` | the `pending` tone colour, for a word that waits on someone |
| `title` | page title in a head row: sans 550 15px |
| `code` | inline code chip |
| `mono` | tabular figures; in a sans region also the mono face |
| `path` | file path; a `/` splits into dim directory + name; `truncate:"middle"` shortens by directory |
| `key` | keycap; a no-space key id (`ctrl+r`, `shift+enter`, `f5`) draws as its platform keycap with the id as tooltip |
| `link` | link colour without making it a link (use `href` for a real one) |
| `num` | code-number colour, tabular. For numbers in `kv`/text prefer `mono` |
| `ins`, `del` | inserted / struck-through deleted |
| `mark` | highlight (search match, selected row) |
| `typo` | misspelled word (dotted underline) |
| `icon` | a run of Nerd Font / PUA glyphs: Tern draws them in its icon face and spaces them itself, so omit padding spaces |
| `hide` | not drawn, still in the text (e.g. an editor's mode sigil a chip stands for) |

Unknown tokens draw no class and no colour. There are **no raw colours** in spans or props.

**omp theme tokens also work** as `s` values and draw in the theme's own colour, falling back to the mapped semantic token (docs `text.md`, "Program (theme) tokens"):

| omp token(s) | Maps to |
| --- | --- |
| `text`, `customMessageText`, `syntaxVariable`, `toolOutput`, `userMessageText` | plain |
| `borderAccent`, `customMessageLabel`, `mdListBullet`, `statusLineModel`, `syntaxFunction`, `thinkingMedium` | `accent` |
| `borderMuted`, `statusLineSep`, `thinkingOff` | `dim` |
| `border`, `mdCodeBlockBorder`, `mdHr`, `mdLinkUrl`, `mdQuote`, `mdQuoteBorder`, `statusLineOutput`, `statusLineSpend`, `statusLineUntracked`, `syntaxComment`, `syntaxOperator`, `syntaxPunctuation`, `thinkingText`, `thinkingMinimal`, `toolDiffContext` | `muted` |
| `thinkingXhigh`, `thinkingMax`, `toolDiffRemoved` | `error` |
| `statusLineCost`, `statusLineGitClean`, `statusLineStaged`, `syntaxString` | `success` |
| `bashMode`, `statusLineDirty`, `statusLineGitDirty`, `thinkingHigh` | `warning` |
| `pythonMode`, `statusLineContext`, `statusLineSubagents`, `syntaxKeyword`, `syntaxType`, `thinkingLow` | `info` |
| `mdCode` / `mdCodeBlock` / `mdHeading`, `toolTitle` / `mdLink` / `statusLinePath` / `syntaxNumber` / `toolDiffAdded` | `code` / `mono` / `strong` / `link` / `path` / `num` / `ins` |
| `customMessageBg`, `selectedBg`, `statusLineBg`, `toolErrorBg`, `toolPendingBg`, `toolSuccessBg`, `userMessageBg` | nothing (fills never colour text) |

Meter `parts[].token`, chart `token`, and shimmer `palette` take the same tokens (colour ones only; `strong` names no colour and falls back).

---

## 5. Tones

`tone` on any node (`TspTone`, `tsp.ts:87`): `neutral accent info success warning error pending muted user`. Other values are dropped. Mapping (docs `styles/index.md`, https://docs.stencil.so/tern/styles/index.md): sets `--tc` on the element.

| Tone | `--tc` |
| --- | --- |
| `neutral` | `--sf-neutral` (a neutral `badge` is a grey chip; a neutral `progress` fills with the accent) |
| `accent` | `--sf-accent` / `--accent` |
| `info` | `--sf-info` |
| `success` | `--sf-ok` |
| `warning` | `--sf-warn` |
| `error` | `--sf-bad` |
| `pending` | `--live` |
| `muted` | `--sf-muted` |
| `user` | `--sf-user` |

What it colours depends on the kind: a card's ring and tint, a badge's pill, a spinner, a progress fill, a list row's icon, a `stats` value. `toast` accepts only `error` (error toast) and `info`/`accent` (info toast), everything else is neutral.

---

## 6. Icon names

`icon.name`, `item.icon`, `card.icon`, `tree` node `icon`, picker `icon`, `seg.icon`, etc. Case-sensitive. Anything up to the last `.` is dropped (`status.error` = `error`). Unknown names draw nothing. From https://docs.stencil.so/tern/elements/data.md#icon-names (208 icons):

- **Apps/brands:** `app-btop app-bun app-claude app-codex app-deno app-docker app-go app-hammer app-helix app-hermes app-htop app-java app-node app-omp app-python app-ruby app-rust app-vim logo tern pi-mark`
- **Arrows/navigation:** `arrow-up arrow-down arrow-left arrow-right back forward chev chev-r chev-up corner-down-right expand shrink minimize fit zoom-in zoom-out more grip compass`
- **Status/alerts:** `check x x-circle warn info help bell shield shield-alert slash slash-circle lock key key-round plus minus clock timer`
- **Files/documents:** `doc file file-code file-image file-pdf file-plus files folder folder-go folder-minus folder-open folder-plus markdown note clipboard save inbox image newspaper trash`
- **Version control:** `branch commit merge rebase pull push fetch stash cherry diff unified split split-down revert history`
- **Playback/actions:** `play pause stop rewind fast-forward frame-next frame-prev repeat redo undo run reel mic wave vibrate power send share open download copy scissors`
- **Text/editing:** `bold italic underline type align-left align-center align-right align-justify pen eraser wand cursor selection path-insert prompt vector blur ink palette`
- **Layout/windows:** `columns grid sidebar tabs-h tabs-v dock-up dock-down dock-left dock-right pip pip-tl pip-tr pip-bl pip-exit layers stack kanban canvas diagram flow peek tree box eye eye-off`
- **Development/system:** `terminal code braces binary bug cpu database server laptop monitor gauge activity chart plug puzzle wrench gear sliders stethoscope hash tag link globe broadcast search funnel funnel-x sort-x swap list list-checks pin keyboard`
- **People/misc:** `user users message brain sparkle lightbulb bolt flame rocket moon sun cart footprints scale log-in log-out`

Also: ~1000 filled file/folder glyphs from Material Icon Theme named `mi-<id>` (`mi-rust mi-typescript mi-docker mi-folder-src mi-folder-src-open`) and model-provider logos as `provider:<id>` (e.g. `provider:anthropic`). Note: the picker demo in the showcase used `rows`/`tab`/`window` as icon names; those are **not** in this list `[UNVERIFIED whether aliased]`, so stick to the list above.

---

## 7. Events and key-path routing

omp turns every terminal event into a `NativeUiEvent` and calls the owning component's `handleNativeEvent(event)` (`@oh-my-pi/pi-tui/src/native/node.ts:118-142`). Wire events (`tsp.ts` `TspEvent`) have the same names; omp renames the node `id` to `key`.

| `type` | Fields | When / source kinds |
| --- | --- | --- |
| `toggle` | `key`, `collapsed: boolean` | A collapsible `card`/`section`/`tool`/`agent`/`tree`/`trace` flipped. `key === ""` means the component's **root** node (see `rootToggleExpanded`). `select`/`date`/`menubar` toggles carry `open`/`item` instead of `collapsed` (standalone only). |
| `select` | `key`, `item: string` | Click on a `list`/`item`, `table` row (with `selectable`), `tabs` tab, `picker` row, `nav`/`breadcrumb` entry, `stacktrace` frame. `item` is the child/row/tab id. |
| `activate` | `key`, `item: string` | Double-click (or click of the already-selected row) on the same kinds; `suggestions` click; `checklist` hud pill (`item:"hud"`). |
| `action` | `key`, `act: string`, `value?: string`, `mods: string[]` | Any non-built-in `actions` name (`actions:{click:"close"}` -> `act:"close"`), `button` click, picker scope/tab/strip/action-bar (`act:"scope"\|"tab"\|"strip"\|<id>`, `value`=id), table sort (`act:"sort"`) and row buttons, tool approval. `mods` = modifier names held. |
| `change` | `key`, `item: string`, `value: boolean \| number \| string \| string[] \| null` | A typed value changed by pointer (prefs rows, picker toggles, table `multi` picks); `null` resets to default. |
| `edit` | `key`, `from`, `to`, `text`, `cursor`, `len` | Terminal edited its own selection in an `editor`/`input`: replace `[from,to)` with `text`, caret to `cursor` (UTF-16). If your current text length differs from `len`, the edit is stale: ignore it. `from==to` + empty `text` = caret move. |
| `undo` | `key` | Terminal's Ctrl+Z over an `editor`/`input`. |
| `send` | `key`, `text` | Submit `text` as one prompt through the composer. Only for a `sendable` composer; not for ordinary extension components. |

Wire-only events omp handles itself and does not forward to a component `[UNVERIFIED which are forwarded]`: `ack resize theme motion visible focus error gone`.

### Key path and `leafKey`

`key` is the node's **key path inside the component**: `""` = the root node, `"body/3"` = a nested child; segments are the keys you gave (`n(kind, props, children, key)`), or the child index when you gave none. To dispatch, take the last segment (`pi-tui/src/native/node.ts:241`; copied into the template's `nodes.ts`):

```ts
export function leafKey(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}
```

Rules that follow:

- **Key every node you need to recognise.** `button()` keys itself by its `act`; `n("tabs", ..., undefined, "tabs")` keys the tabs node so `leafKey(e.key) === "tabs"`. Unkeyed children come back as indices and shift when the list changes.
- **Two nodes with the same leaf key in different subtrees collide** under `leafKey`: use unique leaf names, or compare the full path.
- `action` for a button needs no key lookup: switch on `e.act` (`"close"`, `"open"`, ...). For `select`/`activate` switch on `leafKey(e.key)` first (which list?) and then `e.item`.
- Replace state, don't read it back from the event: Tern draws, you own `selected`, `active`, `value`, `text`. Update state, bump a version, and return a new node on the next `describe` (see `omp-extension.md`, Memo rules).
- A keyboard path is never an event: keys reach `handleInput(data)`, so every clickable `action` needs a keyboard twin there.
