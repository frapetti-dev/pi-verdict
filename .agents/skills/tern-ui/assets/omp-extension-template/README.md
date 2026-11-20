# omp-extension-template

Starter omp extension with Tern-native UI. Copy, rename, edit.

## Install

1. Copy this directory to `<project>/.omp/extensions/<name>/` (project-local) or the user extensions directory.
2. **Restart omp after every edit.** Bun ignores `file://` query strings on Windows, so live reload is not guaranteed.
3. Try it: `/my-ext`, `/my-ext-screen`, `/my-ext-pick`, `/my-ext-widget`; the `my_ext_card` tool renders a native card.

One-off run without installing: `omp -e path/to/index.ts`.

## Files

| File | Surface |
|---|---|
| `nodes.ts` | Node builders (`n`, `txt`, `prose`, `heading`, `framed`, `button`, `bar`, `guard`), `fit`, `isKey`, `isClose`, `leafKey`, `Memo` |
| `overlay.ts` | Floating glass dialog (`nativeOverlay`) |
| `screen.ts` | Full-pane `describeScreen` (`main` + `dock`) |
| `picker.ts` | `picker` node with `nativeSheet` |
| `widget.ts` | `setWidget` above the editor |
| `tool.ts` | Native tool card via `describeCall` / `describeResult` |
| `window.ts` | `tern` CLI wrapper (gated on `TERM_PROGRAM`/`TERN_PANE`) |
| `index.ts` | Command + tool registration |

## Rename checklist

- [ ] Role strings: `omp.overlay.my-ext`, `my-ext.screen`
- [ ] Command names: `my-ext`, `my-ext-screen`, `my-ext-pick`, `my-ext-widget`
- [ ] Tool name `my_ext_card` (and label/description)
- [ ] Widget key `my-ext` in `widget.ts`
- [ ] Heading/head text, `SAMPLE_ITEMS` in `index.ts`

## Verify

```
bun <skill>/scripts/describe-harness.ts index.ts --command my-ext
```

Imports from `@oh-my-pi/*` are provided by omp at runtime; the harness stubs them. Do not add a `package.json` dependency on them.
