# Typography, roles and layout (omp extensions inside Tern)

Measured live on omp 18.14.0 in Tern 0.9.7 (Windows) by reading computed `fontFamily`/`fontSize`/`fontWeight` from `tern ctl shot NAME` layout dumps. Backgrounds, borders and padding of roles other than `omp.advisor.note` / `omp.plan.*` were judged from screenshots or not inspected.

**Role names are Tern-internal and unstable.** They are Tern's bundled stylesheet hooks for omp's own dialogs, not a documented extension API. A Tern release can rename or restyle them. A renamed role degrades to monospace only; nothing breaks. Re-check after Tern/omp upgrades.

## Contents
- Sans vs monospace by node kind
- Roles that give prose
- Buttons and action bars
- Padding with `framed`
- Overlay sizing
- Gap tokens and meters
- Plan-review anatomy (a model to copy)
- Picker caveat

## Sans vs monospace by node kind

Tern draws Geist (sans) or JetBrains Mono (monospace). Without a role:

| Where | Font |
|---|---|
| `text`, `md`, `code`, `card` content, `kv`, `section` heads, `list`/`item` content, table body cells, inside overlays, docks and widgets | monospace |
| Overlay title (`nativeOverlay.head`), `omp.btn` buttons, `badge` chips, `tabs`, table header cells, the whole `picker` sheet | sans |
| `md` in the chat transcript (`main` region) | sans, but not reachable from a dialog |

A dialog built from plain `text`/`md` is monospace whatever its container. The only sans body text without a role is the `picker` sheet.

## Roles that give prose

`role` on a node hooks Tern's bundled `omp.*` stylesheet. An extension may set the same names on its own nodes. The effect is per kind (`omp.plan.body` makes `md` sans but not `text`). A role replaces the node's own role, so a custom role on the same node is lost.

| Role | on `md` | on `text` | on `col>md` | Look |
|---|---|---|---|---|
| `omp.advisor.note` | sans 13.5/400 | sans 13.5/400 | sans 13.5/400 | compact, no box, no padding (template `prose()`) |
| `omp.plan.body` | sans 13.5/400 | monospace | sans 13.5/400 | plan prose; use for explanation `md` |
| `omp.plan.feedback` | sans 16/400 | sans 16/400 | sans 16/400 | roomy vertical padding per row |
| `omp.plan.prompt` | sans 13/550 | sans 13/550 | sans 13/550 | bold prompt line |
| `omp.plan.note` | sans 12.5/400 | sans 12.5/400 | sans 12.5/400 | boxed note with accent bar on the left |
| `omp.ask.question` | sans 15/550 | monospace | monospace | question line, `md` only |
| `omp.sheet.head` | sans 14/600 | sans 14/600 | sans 14/600 | section heading (template `heading()`) |
| `omp.hub.title` | sans 17/600 | sans 17/600 | sans 17/600 | large title |
| `omp.app.git.body`, `omp.usage.label`, `omp.welcome.tip`, `omp.app.git.message` | sans 12.5-13/400 | same | same | plain sans; padding/boxes not inspected |

Of 578 `omp.*` strings probed, 55 gave sans on `md`, 57 on `text`, 61 on `col>md`.

## Buttons and action bars

- Button: `row` with `role: "omp.btn"`, `actions: { click: act }`, children `[text(label), kbd(keys)?]`, `key: act`. Optional `tone: "accent" | "error"`.
- Bar: `row` with `role: "omp.actions"`, `gap: "sm"`; a `spacer {grow: 1}` entry pushes following buttons to the right.
- Head tools in omp's plan window: right-aligned `row` with role `omp.plan.tools`.
- A `list` with role `omp.plan.options` is laid out by Tern as buttons with the first as hero.

## Padding with `framed`

TSP has no padding prop on `col`/`row`, an overlay role does not pad, and a head-less `card` draws a ring. Build inset content with spacers (template `framed(kids, gap)`):

```
col gap:none
  spacer size:sm            (top)
  row align:start
    spacer min:{w:"2ch"}    (left)
    col gap:<gap> grow:1    (content)
    spacer min:{w:"2ch"}    (right)
  spacer size:sm            (bottom)
```

## Overlay sizing

- `nativeOverlay.size`: `sm|md|lg|full`; `anchor`: `center|top|bottom`. omp carries no other placement (`pi-tui/src/native/backend.ts:256-275`).
- A DECLARED `md`/`lg` becomes `full` in panes narrower than about 100 columns.
- `overlayOptions.width: "80%"` maps to an UNDECLARED `md` that floats at every pane width: the default choice. Use `"60%"` only when the dialog is really small; `"90%"` is the same mapping, wider (commands or diffs).
- `overlayOptions.fullscreen: true` makes a Tern `screen` surface (see `omp-extension.md`).

## Gap tokens and meters

- `col`/`row` `gap`: `none|xs|sm|md|lg` (0/2/6/10/16 px).
- Extents (`min`, `max`, `basis`): `"22ch"`, `"10lines"`, or fractions; pixels are ignored.
- Tern's bar `meter` is `flex: 1 1 60px` and grows to the full row width. In a row with other content give it `max: { w: "22ch" }` (measured fix for a status-label row).

## Plan-review anatomy (a model to copy)

omp's own plan window (`pi-tui/src/overlays/plan-review-overlay.ts`, `PlanReviewOverlay.describe` ~l.1533) is plain TSP nodes with Tern-owned roles, not a `picker`:

- `nativeOverlay = { role: "omp.overlay.planReview", size: "lg", anchor: "center", head: <first heading> }`; root is a borderless `col` (gap `md`); the overlay is the frame.
- Head tools: right-aligned `row` (`omp.plan.tools`) of buttons.
- Body: `col` `omp.plan.body` (grow) with one `md` per section; annotations as `col`s with `omp.plan.note`; a `row` with a Contents `list` (`omp.plan.toc`, depth roles `omp.plan.toc.depthN`) in a 32ch sidebar when there are enough headings.
- Strategy slider: `tabs` (`omp.plan.strategy`); decision bar: `list` (`omp.plan.options`); submitting state: `spinner`.
- Focus is shown with `tone: "accent"` on the focused region.

## Picker caveat

A `picker` with `preview` children shows them only while the sheet is wide. In a narrow pane the sheet gets class `pv-hide` and the preview is dropped, even with `size: "lg"`. Use a picker for choosing; keep commands, opinions and free text in an overlay card dialog.
