/** Revised version: the AST walk only checks the whitelist for named nodes; (a) classify by structure; the gray zone is replayed with pi-permission's real whitelist */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SRC = fs.readFileSync(path.join(process.cwd(), "extensions/pi-verdict.ts"), "utf8");
const start = SRC.indexOf("const BASH_SAFE_UNCONDITIONAL");
const end = SRC.indexOf("// ============================================================================\n// Rule layer: file path sensitivity");
const js = new Bun.Transpiler({ loader: "ts" }).transformSync(SRC.slice(start, end));
const lib = new Function("path", "os", "\n" + js + "\nreturn { classifyBash };")(path, os) as { classifyBash: (c: string) => { verdict: string; reason?: string } };

// pi-permission whitelist (extracted from its source)
const P = process.env.PI_PERM_PKG + "/src/rules/builtins.ts"; // unpacked npm directory, passed via the PI_PERM_PKG env var
const PSRC = fs.readFileSync(P, "utf8");
function extractSet(name: string): Set<string> {
	const m = PSRC.match(new RegExp(`(?:const|export const) ${name}[^=]*=\\s*new Set\\(\\[([\\s\\S]*?)\\]\\)`));
	if (!m) throw new Error(`${name} not found`);
	return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
}
const THEIR_UNCOND = extractSet("BUILTIN_UNCONDITIONAL_SAFE");
const THEIR_COND = extractSet("CONDITIONAL_SAFE_COMMANDS");
console.log(`pi-permission whitelist: unconditional ${THEIR_UNCOND.size}, conditional ${THEIR_COND.size} (this repo: unconditional 78)`);

// session sampling
const sessRoot = path.join(os.homedir(), ".pi/agent/sessions");
const cutoff = Date.now() - 3 * 86400e3;
const commands: string[] = [];
let toolTotal = 0, bashTotal = 0;
for (const proj of fs.readdirSync(sessRoot)) {
	const dir = path.join(sessRoot, proj);
	if (!fs.statSync(dir).isDirectory()) continue;
	for (const f of fs.readdirSync(dir)) {
		const fp = path.join(dir, f);
		if (!f.endsWith(".jsonl") || fs.statSync(fp).mtimeMs < cutoff) continue;
		for (const line of fs.readFileSync(fp, "utf8").split("\n")) {
			if (!line.includes('"toolCall"')) continue;
			try {
				const d = JSON.parse(line);
				const msg = d?.message;
				if (d?.type !== "message" || msg?.role !== "assistant") continue;
				for (const b of msg.content ?? []) {
					if (b?.type !== "toolCall") continue;
					toolTotal++;
					if (b.name === "bash") { bashTotal++; const c = b.arguments?.command; if (typeof c === "string" && c.trim()) commands.push(c); }
				}
			} catch { }
		}
	}
}

const ours = commands.map((c) => lib.classifyBash(c));
const { Parser, Language } = await import("web-tree-sitter");
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(process.env.TS_BASH_WASM + "/tree-sitter-bash.wasm") as never);
const ALLOWED_KINDS = new Set(["program", "list", "pipeline", "command", "command_name", "word", "string", "string_content", "raw_string", "number", "concatenation"]);
const ALLOWED_PUNCT = new Set(["&&", "||", ";", "|", '"', "'"]);
function isClean(cmd: string): { clean: boolean; kinds: string[] } {
	if (cmd.length > 65536) return { clean: false, kinds: ["too-long"] };
	try {
		const tree = parser.parse(cmd);
		if (tree.rootNode.hasError) return { clean: false, kinds: ["parse-error"] };
		const kinds: string[] = [];
		const walk = (n: any) => {
			if (n.isNamed && !ALLOWED_KINDS.has(n.type)) kinds.push(n.type); // fix: named nodes only
			for (let i = 0; i < n.childCount; i++) {
				const c = n.child(i);
				if (c === null) continue;
				if (c.isNamed) walk(c);
				else if (!/^\s*$/.test(c.text) && !ALLOWED_PUNCT.has(c.text)) kinds.push(`tok:${c.text}`);
			}
		};
		walk(tree.rootNode);
		return { clean: kinds.length === 0, kinds: [...new Set(kinds)] };
	} catch (e) { return { clean: false, kinds: [`throw`] }; }
}
const ast = commands.map((c) => isClean(c));

// (a) safety-increment classification: allow AND unclean, grouped by kind; redirects are further graded by target path
const SENSITIVE = /(^|\/)(\.ssh|\.aws|\.gnupg|\.env|credentials?|id_rsa|\.pem|authorized_keys)(\/|$)|^\/(etc|usr|var|System|Library\/LaunchAgents)(\/|$)|_history$|~\/\.(bashrc|zshrc|profile|gitconfig)/i;
function classifyRedirect(cmd: string): "sensitive target" | "in-project/dev-null" | "no redirect" {
	if (!/[^>]\s*>{1,2}\s*/.test(cmd) && !/\d>&\d/.test(cmd)) return "no redirect";
	const targets = [...cmd.matchAll(/(?:\d*)>>?\s*(\S+)/g)].map((m) => m[1]);
	const anySensitive = targets.some((t) => SENSITIVE.test(t.replace(/^["']|["']$/g, "")));
	return anySensitive ? "sensitive target" : "in-project/dev-null";
}
type Bucket = { n: number; samples: string[] };
const aBuckets: Record<string, Bucket> = {};
let aTotal = 0, aSensitiveRedirect = 0;
for (let i = 0; i < commands.length; i++) {
	if (ours[i].verdict !== "allow" || ast[i].clean) continue;
	aTotal++;
	const kinds = ast[i].kinds.filter((k) => k !== "redirected_statement" && k !== "file_descriptor" && k !== "file_redirect");
	const other = kinds.length ? kinds.join("+") : "redirect only";
	const key = ast[i].kinds.includes("file_redirect") ? `redirect(${classifyRedirect(commands[i])})` + (other !== "redirect only" ? `+${other}` : "") : other;
	(aBuckets[key] ??= { n: 0, samples: [] }).n++;
	if (aBuckets[key].samples.length < 3) aBuckets[key].samples.push(commands[i]);
	if (ast[i].kinds.includes("file_redirect") && classifyRedirect(commands[i]) === "sensitive target") aSensitiveRedirect++;
}
console.log(`\n(a) Safety increment (allowed by this layer AND AST not clean, after fix): ${aTotal} entries`);
for (const [k, v] of Object.entries(aBuckets).sort((x, y) => y[1].n - x[1].n)) {
	console.log(`    ${String(v.n).padStart(3)}  ${k}`);
	for (const s of v.samples) console.log(`         ${s.slice(0, 88).replace(/\n/g, "⏎")}`);
}
console.log(`    of which redirect to a sensitive path: ${aSensitiveRedirect} entries (real security holes)`);

// (b) gray-zone absorption: two-layer approximation - AST clean AND their whitelist (first-word match with quote stripping)
function theirWhitelistAllows(cmd: string): boolean {
	// approximation: the first word of each pipeline segment (quotes/assignment prefix/path stripped) must be in their unconditional set; their 160 lines of conditional rules are not replicated -> lower bound
	for (const seg of cmd.split(/&&|\|\||[;|]/)) {
		const t = seg.trim().replace(/^\\\w+=\w+\s+/, "").split(/\s+/).filter(Boolean);
		if (!t.length) continue;
		const head = t[0].replace(/^["']|["']$/g, "").split("/").pop() ?? "";
		if (!THEIR_UNCOND.has(head)) return false;
	}
	return true;
}
let bAstOnly = 0, bAstPlusTheirs = 0, bTheirsSamples: string[] = [];
for (let i = 0; i < commands.length; i++) {
	if (ours[i].verdict !== "gray") continue;
	if (ast[i].clean) bAstOnly++;
	if (ast[i].clean && theirWhitelistAllows(commands[i])) { bAstPlusTheirs++; if (bTheirsSamples.length < 6) bTheirsSamples.push(commands[i]); }
}
const grayN = ours.filter((v) => v.verdict === "gray").length;
console.log(`\n(b) Absorbable amount among ${grayN} gray-zone entries (this layer):`);
console.log(`    AST clean: ${bAstOnly} (upper bound, still needs a whitelist hit)`);
console.log(`    AST clean AND their unconditional whitelist (lower-bound approximation): ${bAstPlusTheirs}`);
for (const s of bTheirsSamples) console.log(`         ${s.slice(0, 88).replace(/\n/g, "⏎")}`);

// gray-zone first-word distribution: the real targets for whitelist expansion
const grayHeads: Record<string, number> = {};
for (let i = 0; i < commands.length; i++) {
	if (ours[i].verdict !== "gray") continue;
	const segs = commands[i].split(/&&|\|\||[;|]/);
	for (const seg of segs) {
		const t = seg.trim().replace(/^\w+=\S+\s+/, "").split(/\s+/).filter(Boolean);
		if (!t.length) continue;
		const h = (t[0].replace(/^["']|["']$/g, "").split("/").pop() ?? "?").replace(/["']/g, "");
		grayHeads[h] = (grayHeads[h] ?? 0) + 1;
	}
}
console.log(`\nGray-zone first word top15 (whitelist mismatch targets):`);
for (const [k, v] of Object.entries(grayHeads).sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`    ${String(v).padStart(3)}  ${k}`);
console.log(`\n(c) Absorption overview: allow ${ours.filter(v=>v.verdict==="allow").length} / deny ${ours.filter(v=>v.verdict==="deny").length} / gray ${grayN} (bash gray-zone rate ${(100*grayN/commands.length).toFixed(1)}%)`);
