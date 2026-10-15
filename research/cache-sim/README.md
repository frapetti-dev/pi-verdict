# Offline replay of verdict cache benefit (basis for the .issue #5 decision)

Uses historical verdicts of the Claude Code permission classifier from Langfuse to replay a "two-key LRU(128) verdict cache" offline and measure hit rate and counterfactual consistency. **Conclusion: the two-key hit rate is only 3.2%, and the benefit is concentrated in retry/polling loops, which does not support a claim of significant overall benefit -> defer introducing the cache and instead measure pi's own hit rate with a shadow cache.**

## Data and method

- Data source: self-hosted Langfuse v4 instance (address not public), window 2026-08-24 -> 08-26; filtering on `type=GENERATION` + `max_tokens=64` yields the CC stage-1 classifier calls: **1,2xx entries / 2x sessions** (counts redacted; metadata pulled in hundreds of MB + io pulled in parallel by id, zero failures)
- Key structural finding: the transcript in the CC classifier input is **append-only text parts** (exactly one entry per part); the action under review = the last part before `</transcript>`, and a user message = a part starting with `User: ` -> entry boundaries are exact, no heuristic splitting needed
- Key design (aligned with the #5 decision): `commandKey` = raw text of the action-under-review part; `contextKey` = hash(last 5 User entries); LRU 128 replayed per session; failed outputs (unparseable `<block>`, 47 entries) are not cached (aligned with fail-closed not caching)
- Counterfactual consistency: every call in the historical data really happened, so on a hit we can compare "cached verdict vs the verdict actually produced"

## Scripts

- `fetch-io.ts` - fetch observation io by id with concurrency 10, write NDJSON (credentials come from `LANGFUSE_*` environment variables)
- `simulate.ts` - session-level two-key LRU replay: hit rate / miss composition / consistency / savings estimate / frequently repeated actions
- `kinds.ts` - gray-zone composition split by tool family (repeat-rate difference between MCP and Bash)

Reproduce: `npx langfuse-cli api observations list --type GENERATION --from-start-time <t> --fields core,basic,model,usage --limit 500 --all --json` -> filter `max_tokens==64` to get `cand-ids.json` -> `bun fetch-io.ts` -> `bun simulate.ts`

## Results (replay of 2026-08-26)

| Metric | Value |
|---|---|
| Two-key hit rate | **41/1265 = 3.2%** |
| Command-key upper bound (ignoring context) | 8.2% (contextHash cuts 45% of command-level repeats) |
| Miss composition | no-entry 1144 (90%) / context-changed 33 |
| Consistency on hits | 39/41 agree; **dangerous divergence (cached allow/actual deny) 0**; conservative divergence 2 |
| Replay distribution on hits | allow 39 / deny 2 |
| Savings (CC-side accounting) | 606s latency + 40K input tokens / 2 days |

Structural distribution:

- Benefit is concentrated in **retry/polling loops** - `Bash sleep 115; cat ...` polling x18 (38% hit rate in a single session, contributing 44% of all hits); MCP verification loops (`browser_snapshot` 23 calls with 14 repeats, `browser_navigate` 15 calls with 10 repeats)
- By tool family: MCP calls have a ~29% repeat rate (38/130), Bash only 6% (84% of the CC gray zone is one-off bash)
- Per session: most are <3%, the largest session (202 verdicts) is 0%

Extrapolation to pi (conservative): pi's prototype has a thicker bash whitelist and **all MCP/custom tools go to the gray zone**, so its gray-zone composition skews toward the high-repeat MCP class -> pi's actual hit rate is expected to be higher than 3.2%, to be measured with a shadow cache.

## Appendix: ai-guard semantics check (source `pi-permission-ai-guard@0.7.0`)

- The "recoverable tier" is a throttle: 3 consecutive denies only short-circuit the **next** call and then the counter is cleared; the real fuse is the hard cap of 20 cumulative denies per session (never reset)
- The circuit-breaker check happens **before** the cache lookup; `contextHash` = hash of the sanitized user message stream (excluding the tool-call stream) - the basis of the two-key design
