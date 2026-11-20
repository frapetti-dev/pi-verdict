# Tern CLI: window and pane control

The `tern` CLI scripts a running Tern window (split, tabs, floating panes, files, typing, capture). Use it from an omp extension via `pi.exec("tern", argv)` to open or arrange panes. It is separate from the TSP UI surfaces (`omp-extension.md`) and from Luau plugins (`luau-plugins.md`). Usage lines below are real output of `tern <cmd> --help` (Tern 0.9.7 closed beta, Windows); public docs may describe newer behaviour (https://docs.stencil.so/tern/).

## Contents
1. Environment gate
2. Calling it from omp (argv only)
3. Command cheatsheet
4. `tern open`
5. Running a side program from omp
6. Quoting and security
7. Targeting: BLOCK, windows, `--json`
8. Limits

## 1. Environment gate

Run `tern` commands only when the extension runs inside a Tern pane. Gate on:

```ts
process.env.TERM_PROGRAM === "tern" && !!process.env.TERN_PANE
```

Why: omp itself uses this gate for its Tern backend (research: omp `src/tools/browser/tern/kind.ts:22-49`). `TERM_PROGRAM=tern` alone is not enough to claim TSP is live; for UI use `tui.nativeRendering`.

Env vars Tern sets in a pane (observed in a live pane: `TERM_PROGRAM=tern`, `TERN_PANE=<block id>`):

| Var | Meaning |
|---|---|
| `TERM_PROGRAM` | `tern` inside Tern |
| `TERN_PANE` | id of the block (pane) the process runs in. Use it as `BLOCK` to split beside omp's own pane |
| `TERN_WINDOW_KEY` | key of the window showing the pane; the CLI uses it to pick the window (see `tern split --help` text, §7) |
| `TERN_PANE_SOCKET` | pane control socket (Windows named pipe `\\.\pipe\tern-<user>`) |
| `TERN_DAEMON_SOCKET` | session daemon's socket (`tern --help`, "environment") |
| `TERN_BLOB_DIR` | [UNVERIFIED] blob directory; named in the assignment, not seen in `tern --help` output |

Do not talk to the sockets directly: omp's own socket protocol is documented only in source comments and is unstable.

## 2. Calling it from omp (argv only)

Pass an argv array to `pi.exec`; never a shell string. Why: no shell means no quoting bugs and no injection through paths or titles.

```ts
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

export function ternAvailable(): boolean {
  return process.env.TERM_PROGRAM === "tern" && !!process.env.TERN_PANE;
}

export async function tern(pi: ExtensionAPI, ctx: ExtensionContext, args: string[]) {
  if (!ternAvailable()) return undefined;
  return pi.exec("tern", args, { cwd: ctx.cwd }); // { code, stdout, stderr }
}

// await tern(pi, ctx, ["open", "--split", "right", `${file}:${line}`]);
```

`tern.exe` is on `PATH` on Windows (probed). Check `result.code` (non-zero = failure; `tern wait` returns 124 on timeout). Offer a no-op or message fallback when `ternAvailable()` is false, so the same extension works in plain Windows Terminal.

## 3. Command cheatsheet

`tern --help` lists: `tern ls|inspect|new|split|run|move|pip|dock|rename|focus|close|kill|wait|keep-open|send|capture|process|events|browser ...`, "script sessions from the command line, every window following live, with Tern running or inside a Tern pane".

LAUNCH (used by `split`, `new`) is `[--cwd DIR] [--keep-open] [--end-on-success] [-- COMMAND...]`. A block whose program succeeds closes unless kept open. With `--end-on-success`, status 0 ends the whole session; other statuses leave the block to read.

| Command | Usage (from `--help`) | Notes |
|---|---|---|
| split | `tern split BLOCK right\|down [LAUNCH]` | a block beside BLOCK. Primary way to run a program in a new pane |
| new | `tern new session NAME [LAUNCH]` / `tern new tab [SESSION] [LAUNCH]` | tab default: in the session shown |
| pip | `tern pip BLOCK [--over BLOCK] [--corner tl\|tr\|bl\|br]` | floats a split block as picture-in-picture over another (default: the one taking its place, in its corner nearest it), or places one again |
| dock | `tern dock BLOCK [left\|right\|up\|down]` | PiP back into the split; no side = where it floated from |
| move | `tern move BLOCK below\|above\|left-of\|right-of BLOCK` / `tern move BLOCK tab N\|new-tab` | |
| focus | `tern focus BLOCK` | its window shows it |
| open | `tern open [--split right\|down\|--tab\|--preview] [--wait] PATH[:LINE[:COL]]...` | see §4 |
| send | `tern send BLOCK keys COMBO... \| text TEXT \| paste TEXT` and `tern send BLOCK mouse press\|release\|move COL ROW [--button B] [--mods M]` | types into a pane; see §6 |
| run | `tern run BLOCK COMMAND...` | types COMMAND and Enter into BLOCK's shell; see §6 |
| capture | `tern capture BLOCK [--html\|--ansi] [--scrollback] [--surfaces]` | `--surfaces` includes surface main-region text in text and HTML; ANSI stays raw |
| wait | `tern wait BLOCK [--until exit\|prompt\|idle=MS] [--timeout SECONDS]` | exits with the program's status; 124 = out of time |
| events | `tern events [--filter KIND,...]` | JSON lines until interrupted. Filter names such as `pane_spawned`, `layout_changed` come from the stencil.so demo [UNVERIFIED against this build] |
| browser | `tern browser JSON [--timeout SECONDS]` | browser automation op; prints `{"ok": ...}` or `{"error": {"kind","message"}}` with exit 1; 124 on timeout. e.g. `'{"op":"open","owner":BLOCK,"url":URL}'` opens a browser PiP over BLOCK. omp's `browser` tool already uses this |
| ls | `tern ls [--json]` | sessions, tabs and blocks. JSON shape: `sessions[].tabs[].blocks[]` with `id` (number), `title`, `cwd`, `program`, `args`, `cols`, `rows`, `exited`, `keep_open`, `focused`, `live`; also `splits` tree (observed) |
| inspect | `tern inspect [--json]` | that, every pane and every client; shows each window's key |
| whoami | `tern whoami [--json]` | identity chain of the pane it runs in. Observed JSON: `{"hops":[{"principal","method":"local","from","host","user"}]}` |
| rename | `tern rename SESSION\|BLOCK NAME` | a session, or a block's tab |
| close | `tern close BLOCK` | |
| kill | `tern kill session SESSION` | ends a whole session; avoid |
| keep-open | `tern keep-open BLOCK on\|off` | |
| process | `tern process BLOCK [--json]` | |
| restart | `tern restart [--json]` | restarts Tern; never call from an extension |
| plugin | `tern plugin list\|reload\|dir\|install\|remove\|link\|unlink\|types` | see `luau-plugins.md` |
| ctl | `tern ctl COMMAND...` | **developer tooling only** (`tern help dev`): control endpoint of the window: `css reload`, `state`, `shot NAME`, `dump`, `tree`, `stats`... Use for verification (`verification.md`), never in shipped extension logic |

`BLOCK` is "an id, `@focused`, a title or a program name, as `SESSION/BLOCK` to look in one session". Prefer `$TERN_PANE` (or `@focused`) over titles: titles and program names can match several blocks.

Also: `tern [DIR]`, `tern FILE[:LINE[:COL]]`, `tern -e COMMAND [ARGS...]` open a new window; `tern ssh`, `tern daemon`, `tern remote ...`, `tern web serve ...` exist but are out of scope for extensions.

## 4. `tern open`

```
tern open [--split right|down|--tab|--preview] [--wait] PATH[:LINE[:COL]]...
```

- Shows files in file blocks beside the block it runs in (else the focused one), caret at LINE and COL. `PATH:LINE` (and `PATH:LINE:COL`) jumps to that line.
- A file already open is focused instead, unless `--split` or `--tab` asks for a new block.
- `--preview` puts one file in the tab's preview block and keeps the focus.
- With no Tern running it starts one.
- `--wait` returns once every block it opened closes (or the last window does): 0 when each was saved or clean, 1 when unsaved changes were discarded. So `EDITOR='tern open --wait'` edits a git commit message beside the shell.

```ts
await tern(pi, ctx, ["open", "--split", "right", `${absPath}:${line}`]);
await tern(pi, ctx, ["open", "--preview", absPath]); // keeps focus in omp
```

Windows note: a path like `C:\x\y.ts:12` contains a drive colon; [UNVERIFIED] how Tern splits `:LINE` from a drive letter. Test with a real path before relying on it.

## 5. Running a side program from omp

Launch a separate program (a standalone SDK app, see `standalone-sdk.md`, or any CLI) in a pane beside omp:

```ts
const r = await tern(pi, ctx, [
  "split", process.env.TERN_PANE!, "right",
  "--keep-open", "--json", "--cwd", ctx.cwd,
  "--", "bun", "app.tsx",
]);
```

- `--keep-open` keeps the pane after the program exits so the user can read errors.
- Everything after `--` is the program and its arguments, passed as separate args (no shell). This is the safe way to run commands.
- `--json` makes the command print what it did as JSON. The new block id is the handle for later `focus`, `capture`, `wait`, `pip`, `close`.

Parsing the result. [UNVERIFIED] The exact `--json` shape of `split` was not captured: producing a sample would open a pane in the user's window, which is a state change. Parse tolerantly and fall back to `tern ls --json` (real shape, see §3) if no id is found:

```ts
function findBlockId(stdout: string): number | undefined {
  try {
    const j = JSON.parse(stdout);
    const v = j?.id ?? j?.block?.id ?? j?.block;
    return typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : undefined;
  } catch { return undefined; }
}
```

Block ids seen live are numbers up to ~3e10 (e.g. `30064771079`), within JS safe-integer range. Wait for it to finish with `tern wait ID --until exit --timeout 60`; the exit code is the program's status.

Pair with a UI: an omp overlay button whose action calls `tern split ...` is a normal combination (omp-native UI + Tern-native pane).

## 6. Quoting and security

`tern run` and `tern send ... text|paste` type text into a pane's shell. That text runs under the user's shell with its quoting rules. Tern's docs warn the same for plugin `cx:run` / `tern.pane.write` (https://docs.stencil.so/tern/concepts/security.md, "Developing").

- Never build `run`/`send` text from untrusted input (file names from a repo, model output, issue text, web content): it is command injection into the user's shell.
- Prefer `tern split BLOCK right -- COMMAND ARG...`: argv is passed without a shell.
- If you must type text, use only constants you wrote, or validate against a strict allowlist.
- `tern send BLOCK keys ...` (key combos like `enter`) is safe for fixed combos; `text`/`paste` carry the risk.
- `tern kill`, `tern close`, `tern restart` are destructive; do not call them without explicit user intent.

## 7. Targeting: windows and `--json`

From `tern split --help`: "`--json` prints what a command found or did as JSON." Every command works on one window's sessions: `--window KEY`'s, else the window of the pane it runs in (the window whose sessions hold `$TERN_PANE` now, else `$TERN_WINDOW_KEY`'s), else the first window. `tern inspect` shows each window's key after its kind (`window 2`); the first window's key is empty: `--window ""`.

Inside a Tern pane no `--window` is needed. A process outside any pane (e.g. a daemon) must pass `--window`.

## 8. Limits

- omp's `ctx.ui.openTerminal` has no Tern provider on any OS (and Herdr launches are rejected on Windows). Use `tern split` instead.
- `tern` shell-outs spawn a process each time (~ tens to hundreds of ms; `tern --help` took seconds on a cold call here). Never call from `describe()` or any render path; call from event handlers or commands, and await.
- No sandbox: the CLI acts as the user. Gate on the env check (§1), and degrade without it.
- Raw `tern ctl` is dev tooling, undocumented as an extension API.
