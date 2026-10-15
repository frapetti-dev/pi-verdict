/**
 * Verdict cache benefit simulation: replay a two-key LRU cache offline over historical CC classifier verdicts (1,2xx entries).
 * Key design follows the settled #5 ticket:
 *   commandKey = raw text of the action entry under review (last entry part of the transcript)
 *   contextKey = hash(last 5 User entries)
 *   only cache "real model verdicts" with a parseable <block>yes/no (failed outputs are not cached, matching fail-closed not caching)
 */
const ndjson = (await Bun.file("classifier-io.ndjson").text()).trim().split("\n");
const candMeta = new Map(JSON.parse(await Bun.file("cand-ids.json").text()).map((c) => [c.id, c]));

function parseObs(o) {
  let inp = o.input;
  if (typeof inp === "string") { try { inp = JSON.parse(inp); } catch { return null; } }
  if (!Array.isArray(inp)) return null;
  // find the message containing <transcript>
  for (const m of inp) {
    const parts = Array.isArray(m?.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text ?? "") : null;
    if (!parts) continue;
    const iOpen = parts.findIndex((t) => t.trim() === "<transcript>");
    if (iOpen === -1) continue;
    const iClose = parts.findIndex((t) => t.trim() === "</transcript>");
    if (iClose === -1 || iClose <= iOpen) continue;
    const entries = parts.slice(iOpen + 1, iClose).map((t) => t.replace(/\n$/, ""));
    if (entries.length === 0) continue;
    return { action: entries[entries.length - 1], users: entries.filter((e) => e.startsWith("User: ")) };
  }
  return null;
}

function verdictOf(o) {
  let out = o.output;
  if (typeof out === "string") { try { out = JSON.parse(out); } catch { /* free text */ } }
  let text = "";
  if (typeof out === "string") text = out;
  else if (out?.content) text = typeof out.content === "string" ? out.content : String(out.content);
  else if (Array.isArray(out)) text = out.map((b) => b?.text ?? "").join("");
  const m = text.match(/^\s*<block>\s*(yes|no)/i);
  return m ? (m[1].toLowerCase() === "yes" ? "deny" : "allow") : null; // CC stage1: yes = block (deny), no = allow
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; } return "" + h; }

// replay grouped by session
const bySession = new Map();
for (const line of ndjson) {
  const o = JSON.parse(line);
  const meta = candMeta.get(o.id);
  const sid = meta?.sessionId ?? "_unknown";
  if (!bySession.has(sid)) bySession.set(sid, []);
  bySession.get(sid).push(o);
}

const stats = { total: 0, parsed: 0, verdictNull: 0, hits: 0, missNoEntry: 0, missCtx: 0, cmdOnlyHit: 0 };
const hitVerdicts = { allow: 0, deny: 0 };
const consistency = { agree: 0, cachedAllowActualDeny: 0, cachedDenyActualAllow: 0 };
let savedLatencyMs = 0, savedInputTokens = 0, savedOutputTokens = 0;
const repeatGaps = []; // insert->hit interval in ms on a hit
const topRepeated = new Map(); // commandKey -> hit count (for sampled display)
const sessionRows = [];

for (const [sid, obs] of bySession) {
  obs.sort((a, b) => (a.startTime < b.startTime ? -1 : 1));
  const lru = new Map(); // commandKey → { ctx, verdict, t }
  const firstSeen = new Map(); // commandKey -> time (for the command-key upper bound)
  const cmdOnlySeen = new Set();
  let sTotal = 0, sHits = 0, sSavedTok = 0;
  for (const o of obs) {
    stats.total++;
    const p = parseObs(o);
    if (!p) continue;
    stats.parsed++;
    const meta = candMeta.get(o.id);
    const t = new Date(o.startTime).getTime();
    const latency = new Date(o.endTime).getTime() - t;
    const inTok = meta?.usage?.input ?? meta?.usage?.inputTokens ?? 0;
    const outTok = meta?.usage?.output ?? meta?.usage?.outputTokens ?? 0;
    const cmdKey = p.action;
    const ctxKey = hash(p.users.slice(-5).join("\0"));
    // command-key upper bound (ignoring context changes)
    if (cmdOnlySeen.has(cmdKey)) stats.cmdOnlyHit++;
    else cmdOnlySeen.add(cmdKey);
    const v = verdictOf(o);
    if (v === null) { stats.verdictNull++; continue; } // failed output: not cached, and lookup? In production a failure still looks up the cache first; simplified here: keep looking up
    // LRU lookup
    const e = lru.get(cmdKey);
    if (!e) {
      stats.missNoEntry++;
      lru.set(cmdKey, { ctx: ctxKey, verdict: v, t });
      if (lru.size > 128) lru.delete(lru.keys().next().value);
    } else if (e.ctx !== ctxKey) {
      stats.missCtx++;
      lru.delete(cmdKey); lru.set(cmdKey, { ctx: ctxKey, verdict: v, t }); // overwrite with the latest context
    } else {
      stats.hits++; sHits++;
      hitVerdicts[e.verdict]++;
      // counterfactual consistency: cached verdict vs the actual verdict this time
      if (e.verdict === v) consistency.agree++;
      else if (e.verdict === "allow" && v === "deny") consistency.cachedAllowActualDeny++;
      else consistency.cachedDenyActualAllow++;
      repeatGaps.push(t - e.t);
      savedLatencyMs += latency; savedInputTokens += inTok; savedOutputTokens += outTok; sSavedTok += inTok;
      const k = cmdKey.slice(0, 70); topRepeated.set(k, (topRepeated.get(k) ?? 0) + 1);
      // LRU refresh
      lru.delete(cmdKey); lru.set(cmdKey, { ctx: ctxKey, verdict: v, t: e.t });
    }
    sTotal++;
  }
  sessionRows.push({ sid, total: sTotal, hits: sHits, inTok: sSavedTok });
}

const pct = (n, d) => (d ? (100 * n / d).toFixed(1) + "%" : "-");
repeatGaps.sort((a, b) => a - b);
const q = (p) => repeatGaps.length ? repeatGaps[Math.min(repeatGaps.length - 1, Math.floor(p * repeatGaps.length))] : 0;

console.log("=== Totals ===");
console.log(`observations ${stats.total}, parseable ${stats.parsed}, missing/failed output (not cached) ${stats.verdictNull}, sessions ${bySession.size}`);
console.log("\n=== Two-key cache hit rate ===");
console.log(`hits ${stats.hits} / parseable ${stats.parsed} = ${pct(stats.hits, stats.parsed)}`);
console.log(`miss: no-entry ${stats.missNoEntry}, context-changed ${stats.missCtx}`);
console.log(`command-key upper bound (ignoring context): ${stats.cmdOnlyHit} = ${pct(stats.cmdOnlyHit, stats.parsed)}`);
console.log("\n=== Cached verdict distribution on hits ===");
console.log(`replay allow ${hitVerdicts.allow}, replay deny ${hitVerdicts.deny}`);
console.log("\n=== Counterfactual consistency (on hit: cached verdict vs actual verdict) ===");
console.log(`agree ${consistency.agree}, dangerous divergence (cached allow/actual deny) ${consistency.cachedAllowActualDeny}, conservative divergence (cached deny/actual allow) ${consistency.cachedDenyActualAllow}`);
console.log("\n=== Savings estimate (calls skipped by hits) ===");
console.log(`total latency ${(savedLatencyMs / 1000).toFixed(1)}s, input tokens ${savedInputTokens.toLocaleString()}, output tokens ${savedOutputTokens.toLocaleString()}`);
console.log(`insert->hit interval: p50=${(q(0.5)/1000).toFixed(1)}s p90=${(q(0.9)/1000).toFixed(1)}s max=${(repeatGaps[repeatGaps.length-1]/1000||0).toFixed(1)}s`);
console.log("\n=== Top 10 frequently repeated actions ===");
for (const [k, c] of [...topRepeated.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ×${c}  ${k.replace(/\n/g, "⏎")}`);
console.log("\n=== Hits per session ===");
for (const r of sessionRows.sort((a, b) => b.hits - a.hits).slice(0, 10)) console.log(`  ${r.sid.slice(0, 14)} verdicts ${r.total}, hits ${r.hits} (${pct(r.hits, r.total)}), input tok saved ${r.inTok.toLocaleString()}`);
