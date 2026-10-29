# Tern showcase extension (sample, not shipped)

A sample omp extension built while researching [`../omp-extensions-tern-window.md`](../omp-extensions-tern-window.md): "can omp extensions use the full window capabilities of the `tern` terminal?" It demonstrates the Tern Surface Protocol (TSP) native-UI path and the `tern` CLI window-control path from inside an extension. It is **not** part of pi-verdict's own permission gate; it lives under `research/` so it is excluded from `tsconfig.json`'s `extensions/**/*.ts` scope and from `bun test`.

## Try it

Copy or symlink this directory into a project's `.omp/extensions/`, e.g. from that project's root:

```sh
cp -r <this-dir> .omp/extensions/tern-showcase
```

Then, inside a Tern pane running omp:

| Command | Surface | Shows |
| --- | --- | --- |
| `/tern-gallery` | overlay sheet (`nativeOverlay`) | tabs over (nearly) every TSP element kind: md, code, diff, math, table, tree, badges, checklist, charts, meters, spinners, progress, agent/tool cards, image/media |
| `/tern-screen` | full-pane screen (`describeScreen`, `main`/`dock`) | a live service list + detail card, driven by a 1s timer |
| `/tern-picker` | `picker` node | a searchable, scoped launcher for the other demos |
| `/tern-widget` | `ctx.ui.setWidget` | a persistent strip above the editor |
| `/tern-window <action>` | `pi.exec("tern", …)` | `split-right`/`split-down`/`tab`/`pip`/`open`/`ls` — Tern's scripting CLI, not TSP |
| `/tern-ask` | `ctx.ui.askDialog` | the host's multi-question ask dialog (single-choice with a recommended option + preview, multi-choice, and a plain fallback when `askDialog` is unavailable) |

Every command but `/tern-window` falls back to a plain ANSI `render()` when Tern isn't answering the TSP handshake (e.g. `PI_TUI_NATIVE=0`).

## Tool

`tern_showcase_card` (registered for the LLM, not a slash command) renders its result as a native `checklist` + `md` via `describeCall`/`describeResult`. Demoed by asking the model to "demo the Tern showcase tool".

## Files

| File | Role |
| --- | --- |
| `index.ts` | registers the five commands and the tool |
| `nodes.ts` | dependency-light TSP node builders (`n`, `txt`, `button`, `bar`, `guard`, `Memo`, …) shared by every demo |
| `gallery.ts`, `screen.ts`, `picker.ts`, `widget.ts`, `ask.ts` | one demo each |
| `window.ts` | `tern` CLI wrapper used by `/tern-window` and the picker's "window" scope |
| `tool.ts` | the `tern_showcase_card` LLM tool |
| `assets/demo.svg` | sample image for the gallery's `media` row |

## Verification done

- `omp -p --mode json` loaded the extension and ran `tern_showcase_card` end to end (real omp, real tool call).
- Every `describe()`/`handleNativeEvent()`/`handleInput()` path was exercised against a stubbed `ExtensionAPI`/`ExtensionContext` (Node with `--experimental-strip-types`, pi-tui's native addon mocked since it only loads inside a real omp host).
- `tern ls` and the `tern` CLI invocations built by `window.ts` were checked against a live Tern pane on Windows; `/tern-window pip`'s `--json` block-id parsing was only checked against a stub (`[]`) and still needs a live Tern `--json` sample.
- The gallery/screen/picker/widget/ask surfaces themselves were not opened in a live Tern pane — only their non-native (ANSI fallback) and native `describe()` output were checked.
