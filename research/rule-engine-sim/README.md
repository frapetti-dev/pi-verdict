# Rule engine benefit measurement: tree-sitter AST port vs whitelist breadth (basis for the .issue #6 decision)

Cross-replays all real bash tool calls from the last 3 days of sessions (746 entries / 1027 tool calls) through "this repo's rule layer x pi-permission@1.3.3's tree-sitter AST (same-version wasm + the same 11-node whitelist)". **Conclusion: the measured benefit of porting is zero with a negative side effect (gray zone +16%), and real security holes are zero; the real targets are whitelist breadth and the classifier cost structure.**

## Method

- Data source: all project sessions under `~/.pi/agent/sessions` from the last 3 days, bash toolCalls in assistant messages (pure-function replay, the extension need not actually be online)
- This repo's rule layer: extracted verbatim from the `extensions/pi-verdict.ts` source (types stripped with Bun.Transpiler, then eval), behavior identical to production
- AST check: web-tree-sitter@0.26.11 + tree-sitter-bash@0.25.1, replicating pi-permission `src/ast/analyzer.ts`'s ALLOWED_KINDS (11 nodes) + ALLOWED_PUNCT (6 punctuation marks), fail-closed semantics
- Their whitelist: extracted from their `src/rules/builtins.ts` source (unconditional 50 + conditional 9 - **narrower than this repo's 78+9**)
- Reproduce: `cd ~/tmp/ast-lab && npm i web-tree-sitter@0.26.11 tree-sitter-bash@0.25.1 && bun measure.ts` (see the script header for paths)

## Results (replay of 2026-08-26)

| Metric | Value |
|---|---|
| Absorption rate of this layer (746 bash entries) | allow 140 (18.8%) / deny 19 (2.6%) / **gray 590 (78.8%)** |
| Gray zone absorbable by the port (AST clean AND their whitelist hit) | **0 entries** |
| AST clean but not covered by the whitelist | 148 entries (upper bound; actual hits are zero) |
| Side effect: benign allows downgraded by "unclean -> send to classifier" | 94 entries -> gray-zone rate 78.8% -> ~91.8% |
| Redirects to sensitive paths (real security holes) | **0 entries** |

The 94 entries "allowed AND AST unclean" were reviewed class by class and are all benign: `2>/dev/null` class 67, variable-prefix assignment (`P=... && cat $P/...`) 25, heredoc writing a file inside the project 2; command_substitution appears in only 2 entries and is benign (`ls -la $(which pi)`).

## Attribution: why the port has no benefit

pi-permission's architecture is "AST picks structurally clean commands x narrow whitelist (50)" - the AST's role is to make auto-allow pickier, not to widen absorption. The bulk of the gray zone in this repo's traffic is **whitelist breadth** (first-word targets: `head 459/echo 328/grep 291/cd 262/git 170/gh 109/python3 86/sed 67/if·for 96/bun 42`) and **compound statements** (if/for/heredoc wrongly split by the naive splitter; the AST would only "correctly send them to the classifier" - the same destination as today). Neither end lines up.

## Real targets (data-indicated, not yet decided)

1. **Whitelist breadth**: conditionalize the read-only subset of gh (~109 entries), quote-aware sed (`sed -n '125,170p'` mismatches because of quoting), fix wrong splitting of if/for/heredoc pseudo-segments - roughly 100-200 entries absorbable by rough estimate, gray-zone rate -> ~65%
2. **Classifier cost structure**: the gray zone is structural (78.8%); pointing `--auto-mode-model` at a lightweight model dilutes all cost with a single configuration (introspective large model 3-15s/call + ~8K tokens vs a lightweight flash class)
3. "Strip the rule layer and focus on the classifier" was rejected by measurement: load x1.7 (590 -> 1027), losing 19 zero-cost denies and the only online brake when the classifier is down

## Signal to revisit

Reopen the AST adoption discussion when real traffic shows a **sensitive-path redirect bypass** (e.g. `echo x > /etc/passwd`: the rule layer allows it, the danger regexes miss, and the path sensitivity layer does not cover bash redirects) - the theoretical hole exists but did not appear in 3 days of traffic.
