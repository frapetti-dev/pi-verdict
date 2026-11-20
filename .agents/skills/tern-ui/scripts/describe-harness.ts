#!/usr/bin/env bun
/**
 * describe-harness: load an omp extension outside omp, run a command or tool,
 * and print the TSP node tree its components produce.
 *
 *   bun describe-harness.ts <entry.ts> [--command <name>] [--args "<str>"]
 *        [--events <file.json>] [--ansi] [--cols 100]
 *
 * @oh-my-pi/pi-tui: when the extension only value-imports `matchesKey`, a tiny stub is used (fast, no natives).
 * When it value-imports anything else (`col`, `node`, `truncateToWidth`, ...), the real installed package is
 * loaded (default ~/.bun/install/global/node_modules/@oh-my-pi/pi-tui, override with PI_TUI_PATH); it takes ~5 s to
 * load, which does not count against the 3 s run timeout.
 * Exit 1 if anything throws. A hard 3 s timeout (started after the module loads) stops setInterval timers from hanging the run.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------- pi-tui stub
const KEYS: Record<string, string> = {
	escape: "\x1b",
	enter: "\r",
	up: "\x1b[A",
	down: "\x1b[B",
	right: "\x1b[C",
	left: "\x1b[D",
	tab: "\t",
	backspace: "\x7f",
};

export function matchesKey(data: string, id: string): boolean {
	if (id in KEYS) return data === KEYS[id];
	const m = /^ctrl\+([a-z])$/.exec(id);
	if (m) return data === String.fromCharCode(m[1].charCodeAt(0) - 96);
	return false;
}

const piTuiStub = { matchesKey };

/** Value-import names from `@oh-my-pi/pi-tui` across the entry's directory (type-only imports are erased and ignored). */
function piTuiValueImports(entry: string): Set<string> {
	const names = new Set<string>();
	const dir = resolve(entry, "..");
	for (const f of readdirSync(dir, { recursive: true }) as string[]) {
		if (!/\.(ts|tsx|js|mjs)$/.test(f) || f.includes("node_modules")) continue;
		const src = readFileSync(join(dir, f), "utf8");
		for (const m of src.matchAll(/^import\s+(?!type\b)([^;"']*?)\s+from\s+["']@oh-my-pi\/pi-tui["']/gm)) {
			if (m[1].includes("*")) names.add("*");
			for (const part of m[1].replace(/[{}]/g, "").split(",")) {
				const name = part.trim().split(/\s+as\s+/)[0];
				if (name && !name.startsWith("type ")) names.add(name);
			}
		}
	}
	return names;
}

/** Must run (and be awaited) before the entry is imported. */
async function installPiTui(entry: string): Promise<void> {
	const needed = [...piTuiValueImports(entry)].filter(n => n !== "matchesKey");
	if (needed.length === 0) {
		Bun.plugin({
			name: "pi-tui-stub",
			setup(b) {
				b.module("@oh-my-pi/pi-tui", () => ({ loader: "object", exports: piTuiStub }));
			},
		});
		return;
	}
	const real = process.env.PI_TUI_PATH ?? join(homedir(), ".bun/install/global/node_modules/@oh-my-pi/pi-tui");
	if (!existsSync(real)) {
		throw new Error(`extension value-imports ${needed.join(", ")} from @oh-my-pi/pi-tui, but the package was not found at ${real} (set PI_TUI_PATH)`);
	}
	console.log(`using real @oh-my-pi/pi-tui (value imports: ${needed.join(", ")})`);
	// Import by the install path (not a realpath) so its native-addon siblings resolve.
	const realModule = (await import(real)) as Record<string, unknown>;
	Bun.plugin({
		name: "pi-tui-real",
		setup(b) {
			b.module("@oh-my-pi/pi-tui", () => ({ loader: "object", exports: realModule }));
		},
	});
}

// ----------------------------------------------------------------------- args
interface Args {
	entry: string;
	command?: string;
	args: string;
	events?: string;
	ansi: boolean;
	cols: number;
}

function parseArgs(argv: string[]): Args {
	const out: Args = { entry: "", args: "", ansi: false, cols: 100 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--command") out.command = argv[++i];
		else if (a === "--args") out.args = argv[++i] ?? "";
		else if (a === "--events") out.events = argv[++i];
		else if (a === "--ansi") out.ansi = true;
		else if (a === "--cols") out.cols = Number(argv[++i]);
		else if (!out.entry) out.entry = a;
	}
	if (!out.entry) {
		console.error('usage: bun describe-harness.ts <entry.ts> [--command <name>] [--args "<str>"] [--events <file.json>] [--ansi] [--cols 100]');
		process.exit(2);
	}
	return out;
}

// ------------------------------------------------------------------ fakes
type AnyFn = (...a: unknown[]) => unknown;
interface Component {
	describe?: AnyFn;
	describeScreen?: AnyFn;
	handleNativeEvent?: AnyFn;
	handleInput?: AnyFn;
	render?: AnyFn;
	dispose?: AnyFn;
	nativeOverlay?: unknown;
	nativeSheet?: AnyFn;
}

/** Recursive proxy: every property get and call returns itself (stand-in for zod). */
function chain(): unknown {
	const f: unknown = new Proxy(function () {}, {
		get: (_t, p) => (p === Symbol.toPrimitive ? () => "zod" : f),
		apply: () => f,
	});
	return f;
}

const commands = new Map<string, { handler: AnyFn; description?: string }>();
const tools = new Map<string, Record<string, AnyFn>>();
const execLog: string[][] = [];

const fakePi = {
	zod: chain(),
	registerCommand(name: string, spec: { handler: AnyFn; description?: string }) {
		commands.set(name, spec);
	},
	registerTool(spec: { name: string } & Record<string, AnyFn>) {
		tools.set(spec.name, spec);
	},
	on() {},
	async exec(cmd: string, argv: string[]) {
		execLog.push([cmd, ...argv]);
		console.log(`exec: ${JSON.stringify([cmd, ...argv])}`);
		return { code: 0, stdout: "[]", stderr: "" };
	},
};

const fakeTui = { nativeRendering: true, requestRender() {} };

/** Theme stand-in: every method (`fg`, `bg`, `bold`, ...) returns its last string argument unstyled. */
const fakeTheme = new Proxy(
	{},
	{ get: () => (...a: unknown[]) => (typeof a[a.length - 1] === "string" ? a[a.length - 1] : "") },
);

function fakeCx(cols: number) {
	return { cols, dark: true, reduceMotion: false, supports: () => true, feature: () => false };
}

let failed = false;

const fail = (msg: string, err?: unknown) => {
	failed = true;
	console.error(`ERROR: ${msg}${err instanceof Error ? `\n${err.stack}` : err ? `\n${String(err)}` : ""}`);
};

// -------------------------------------------------------------- inspection
function isComponent(v: unknown): v is Component {
	if (!v || typeof v !== "object" || Array.isArray(v) || "k" in v) return false;
	const c = v as Component;
	return typeof c.describe === "function" || typeof c.describeScreen === "function";
}

/** Turn a describe() result into plain JSON: nested components (screen regions, component children) are described recursively. */
function expand(v: unknown, cx: unknown, active: Set<Component>): unknown {
	if (Array.isArray(v)) return v.map(x => expand(x, cx, active));
	if (isComponent(v)) {
		if (active.has(v)) return { component: true, self: true, describe: expand(v.describe?.(cx) ?? null, cx, active) };
		active.add(v);
		const out = v.describeScreen
			? (() => {
					const s = v.describeScreen(cx) as { role: string; main: unknown[]; dock: unknown[] };
					return { component: true, screen: { role: s.role, main: expand(s.main, cx, active), dock: expand(s.dock, cx, active) } };
				})()
			: { component: true, describe: expand(v.describe?.(cx) ?? null, cx, active) };
		active.delete(v);
		return out;
	}
	if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x, cx, active)]));
	return v;
}

const jsonOf = (v: unknown, cx: unknown): string => JSON.stringify(expand(v, cx, new Set()), null, 2);

function show(c: Component, cx: unknown, label: string) {
	console.log(`--- ${label}`);
	if (c.nativeOverlay) console.log(`nativeOverlay: ${JSON.stringify(c.nativeOverlay)}`);
	if (c.nativeSheet) console.log(`nativeSheet: ${JSON.stringify(c.nativeSheet(cx))}`);
	if (c.describeScreen) {
		console.log(jsonOf(c, cx));
	} else if (c.describe) {
		const node = c.describe(cx);
		if (node === null || node === undefined) console.log("describe() returned null (falls back to render())");
		else console.log(jsonOf(node, cx));
	} else {
		console.log("(no describe: ANSI only)");
	}
}

function inspect(c: Component, args: Args, done: { called: boolean; value: unknown }) {
	const cx = fakeCx(args.cols);
	show(c, cx, "initial describe");

	if (c.describe) {
		const a = c.describe(cx);
		const b = c.describe(cx);
		const d = c.describe(cx);
		console.log(`memo-stable: ${a === b && b === d}`);
	}
	if (args.ansi && c.render) {
		console.log("--- render(cols)");
		const lines = c.render(args.cols) as string[];
		for (const l of lines) console.log(l);
		console.log(`(${lines.length} rows)`);
	}

	if (args.events) {
		const events = JSON.parse(readFileSync(args.events, "utf8")) as Array<Record<string, unknown>>;
		for (const [i, ev] of events.entries()) {
			if (done.called) break;
			console.log(`event ${i}: ${typeof ev.input === "string" ? `input ${JSON.stringify(ev.input)}` : JSON.stringify(ev)}`);
			if (typeof ev.input === "string") c.handleInput?.(ev.input);
			else c.handleNativeEvent?.(ev);
			if (!done.called) show(c, cx, `describe after event ${i}`);
		}
	}

}

function makeCtx() {
	const done = { called: false, value: undefined as unknown };
	let current: Component | undefined;
	const ctx = {
		hasUI: true,
		// ExtensionContext timer helpers (the host clears them on session_shutdown; the harness just exits).
		setInterval: (cb: AnyFn, ms?: number) => setInterval(cb as () => void, ms),
		setTimeout: (cb: AnyFn, ms?: number) => setTimeout(cb as () => void, ms),
		clearTimer: (t: unknown) => clearTimeout(t as number),
		cwd: process.cwd(),
		ui: {
			notify: (m: string, level?: string) => console.log(`notify[${level ?? "info"}]: ${m}`),
			setStatus: (k: string, v: unknown) => console.log(`setStatus ${k}: ${JSON.stringify(v)}`),
			setWidget: (key: string, factory: unknown, opts?: unknown) => {
				if (typeof factory !== "function") return console.log(`setWidget ${key}: cleared`);
				const comp = (factory as AnyFn)(fakeTui, fakeTheme) as Component;
				console.log(`setWidget ${key}: ${JSON.stringify(opts)}`);
				current = comp;
				pending.push(() => inspect(comp, args, done));
			},
			custom: async (factory: AnyFn, opts?: unknown) => {
				console.log(`custom: ${JSON.stringify(opts)}`);
				const { promise: p, resolve: settle } = Promise.withResolvers<unknown>();
				const comp = factory(fakeTui, fakeTheme, {}, (v: unknown) => {
					done.called = true;
					done.value = v;
					console.log(`done(${v === undefined ? "" : JSON.stringify(v)})`);
					comp.dispose?.();
					settle(v);
				}) as Component;
				current = comp;
				inspect(comp, args, done);
				if (!done.called) {
					comp.dispose?.();
					settle(undefined);
				}
				return p;
			},
			select: async () => undefined,
			askDialog: async () => undefined,
			input: async () => undefined,
			confirm: async () => false,
			onTerminalInput: () => () => {},
			setFooter: () => {},
			setHeader: () => {},
		},
	};
	return { ctx, current: () => current };
}

const pending: Array<() => void> = [];
let args: Args;

// --------------------------------------------------------------------- main
async function main() {
	args = parseArgs(process.argv.slice(2));
	// Dynamic: the pi-tui plugin must be registered before the entry module loads.
	await installPiTui(resolve(args.entry));
	const mod = await import(pathToFileURL(resolve(args.entry)).href);
	const timeout = setTimeout(() => {
		console.log("(3 s timeout: stopping)");
		process.exit(failed ? 1 : 0);
	}, 3000);
	const factory = (mod.default ?? mod) as AnyFn;
	factory(fakePi);

	const { ctx } = makeCtx();
	if (args.command) {
		const cmd = commands.get(args.command);
		if (!cmd) {
			fail(`no command "${args.command}"; registered: ${[...commands.keys()].join(", ") || "(none)"}`);
		} else {
			try {
				await cmd.handler(args.args, ctx);
				for (const run of pending) run();
			} catch (err) {
				fail(`command ${args.command} threw`, err);
			}
		}
	} else {
		console.log(`commands: ${[...commands.keys()].join(", ") || "(none)"}`);
		console.log(`tools: ${[...tools.keys()].join(", ") || "(none)"}`);
		for (const [name, t] of tools) {
			console.log(`--- tool ${name}`);
			try {
				console.log(`describeCall: ${JSON.stringify(t.describeCall?.({}), null, 2)}`);
			} catch (err) {
				fail(`${name}.describeCall threw`, err);
			}
			try {
				console.log(`describeResult: ${JSON.stringify(t.describeResult?.({ content: [], details: undefined }, {}, {}), null, 2)}`);
			} catch (err) {
				fail(`${name}.describeResult threw`, err);
			}
		}
	}

	clearTimeout(timeout);
	process.exit(failed ? 1 : 0);
}

main().catch(err => {
	fail("harness crashed", err);
	process.exit(1);
});

