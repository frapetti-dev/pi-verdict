/** /tern-gallery: a glass overlay sheet showing (nearly) every TSP element kind. */
import { fileURLToPath } from "node:url";
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { TspSpan } from "@oh-my-pi/pi-wire";
import { ALL_KINDS, bar, button, fit, guard, isClose, isKey, leafKey, Memo, n, txt } from "./nodes";

const TABS = ["text", "data", "motion", "media"] as const;
type Tab = (typeof TABS)[number];
const TAB_ITEMS = TABS.map(id => ({ id, label: id }));
const DEMO_SVG = fileURLToPath(new URL("./assets/demo.svg", import.meta.url));

const MD_SAMPLE = [
	"## Markdown",
	"",
	"- bullet **one**",
	"- bullet *two* with `code`",
	"",
	"| col | value |",
	"| --- | ----- |",
	"| a | 1 |",
	"| b | 2 |",
	"",
	"A [link](https://docs.stencil.so/tern/).",
].join("\n");

const CODE_SAMPLE = [
	"interface Point { x: number; y: number }",
	"",
	"export function dist(a: Point, b: Point): number {",
	"\tconst dx = a.x - b.x;",
	"\tconst dy = a.y - b.y;",
	"\treturn Math.hypot(dx, dy);",
	"}",
	"",
	"const origin: Point = { x: 0, y: 0 };",
	'console.log(dist(origin, { x: 3, y: 4 })); // 5',
].join("\n");

const DIFF_SAMPLE = [
	"--- a/demo.ts",
	"+++ b/demo.ts",
	"@@ -1,4 +1,4 @@",
	" function greet(name: string) {",
	'-\treturn "hi " + name;',
	"+\treturn `hello ${name}`;",
	" }",
	" export { greet };",
].join("\n");

const TOKENS = ["strong", "em", "accent", "success", "warning", "error", "mark", "typo", "code"];

export async function openGallery(ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, _theme, _kb, done) => {
			let tab: Tab = "text";
			let count = 0;
			let toastN = 0;
			let progress = 0;
			let version = 0;
			const openedAt = Date.now();
			const memo = new Memo();
			let closed = false;

			const bump = () => {
				version++;
				tui.requestRender();
			};
			const timer = setInterval(() => {
				progress = (progress + 0.05) % 1.05;
				bump();
			}, 500);
			const finish = () => {
				if (closed) return;
				closed = true;
				clearInterval(timer);
				done();
			};
			const setTab = (t: string | undefined) => {
				if (t && (TABS as readonly string[]).includes(t)) tab = t as Tab;
			};
			const cycleTab = (d: number) => {
				tab = TABS[(TABS.indexOf(tab) + d + TABS.length) % TABS.length];
			};

			const capabilities = (cx: DescribeContext): NativeNode => {
				const features = ["aside", "edit", "undo", "send", "flow"].filter(f => cx.feature(f));
				const unsupported = ALL_KINDS.filter(k => !cx.supports(k));
				return n("kv", {
					layout: "grid",
					items: [
						{ k: "native", v: String(tui.nativeRendering) },
						{ k: "terminal", v: `${process.env.TERM_PROGRAM ?? "?"} ${process.env.TERM_PROGRAM_VERSION ?? ""}`.trim() },
						{ k: "cols", v: String(cx.cols) },
						{ k: "dark", v: String(cx.dark) },
						{ k: "reduceMotion", v: String(cx.reduceMotion) },
						{ k: "features", v: features.join(", ") || "none" },
						{ k: "unsupported kinds", v: unsupported.join(", ") || "none" },
					],
				});
			};

			const textSection = (cx: DescribeContext): NativeNode =>
				n("col", { gap: "md" }, [
					guard(cx, "md", () => n("md", { text: MD_SAMPLE })),
					guard(cx, "code", () => n("code", { text: CODE_SAMPLE, lang: "ts", numbers: true })),
					guard(cx, "diff", () => n("diff", { text: DIFF_SAMPLE, path: "demo.ts" })),
					guard(cx, "math", () => n("math", { text: "e^{i\\pi}+1=0", display: true })),
					guard(cx, "text", () =>
						n("text", {
							spans: [
								...TOKENS.flatMap((t): TspSpan[] => [{ t, s: t }, { t: " " }]),
								{ t: "link", s: "link", href: "https://docs.stencil.so/tern/" },
							],
							wrap: "word",
						}),
					),
					guard(cx, "kbd", () => n("kbd", { keys: ["ctrl", "shift", "p"] })),
				]);

			const dataSection = (cx: DescribeContext): NativeNode =>
				n("col", { gap: "md" }, [
					guard(cx, "table", () =>
						n("table", {
							cols: [
								{ id: "name", head: "name" },
								{ id: "kind", head: "kind" },
								{ id: "status", head: "status" },
							],
							rows: [
								{ id: "r1", cells: { name: "alpha", kind: "service", status: [{ t: "ok", s: "success" }] } },
								{ id: "r2", cells: { name: "beta", kind: "job", status: [{ t: "slow", s: "warning" }] } },
								{ id: "r3", cells: { name: "gamma", kind: "service", status: [{ t: "down", s: "error" }] } },
								{ id: "r4", cells: { name: "delta", kind: "cron", status: "idle" } },
							],
						}),
					),
					guard(cx, "tree", () =>
						n("tree", {
							nodes: [
								{
									id: "src",
									label: "src",
									icon: "folder",
									open: true,
									children: [
										{ id: "src/a", label: "a.ts" },
										{ id: "src/b", label: "b.ts" },
									],
								},
								{
									id: "docs",
									label: "docs",
									icon: "folder",
									open: true,
									children: [{ id: "docs/r", label: "README.md" }],
								},
							],
						}),
					),
					guard(cx, "row", () =>
						n("row", { gap: "sm", wrap: true }, [
							n("badge", { text: "neutral" }),
							n("badge", { text: "info", tone: "info" }),
							n("badge", { text: "success", tone: "success" }),
							n("badge", { text: "warning", tone: "warning" }),
							n("badge", { text: "error", tone: "error" }),
						]),
					),
					guard(cx, "checklist", () =>
						n("checklist", {
							phases: [
								{
									id: "p1",
									title: "Phase one",
									items: [
										{ id: "1", text: "done item", status: "done" },
										{ id: "2", text: "active item", status: "active" },
										{ id: "3", text: "pending item", status: "pending" },
									],
								},
								{
									id: "p2",
									title: "Phase two",
									items: [
										{ id: "4", text: "blocked item", status: "blocked", note: "waiting on 2" },
										{ id: "5", text: "dropped item", status: "dropped" },
									],
								},
							],
						}),
					),
					guard(cx, "chart", () =>
						n("chart", {
							kind: "bars",
							series: [30, 55, 42, 70, 38, 61, 48].map((value, i) => ({ label: `d${i + 1}`, value })),
							marks: [{ value: 50, tone: "warning", title: "target" }],
							size: "md",
						}),
					),
					guard(cx, "chart", () =>
						n("chart", {
							kind: "spark",
							series: Array.from({ length: 20 }, (_, i) => ({ value: 50 + Math.round(40 * Math.sin(i / 3)) })),
							size: "sm",
						}),
					),
					guard(cx, "chart", () =>
						n("chart", {
							kind: "heatmap",
							cells: Array.from({ length: 7 }, (_, r) =>
								Array.from({ length: 12 }, (_, c) => ((r * 7 + c * 3) % 10) / 10),
							),
							rows: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
						}),
					),
					guard(cx, "meter", () =>
						n("row", { gap: "lg", align: "center" }, [
							n("meter", { value: progress, style: "bar", thresholds: { warn: 0.7, bad: 0.9 } }),
							n("meter", { value: progress, style: "ring", thresholds: { warn: 0.7, bad: 0.9 } }),
							n("meter", { value: progress, style: "blocks", steps: 10, thresholds: { warn: 0.7, bad: 0.9 } }),
						]),
					),
				]);

			const motionSection = (cx: DescribeContext): NativeNode => {
				const age = Date.now() - openedAt;
				return n("col", { gap: "md" }, [
					guard(cx, "spinner", () =>
						n("row", { gap: "lg", wrap: true }, [
							n("spinner", { style: "dots", label: "dots" }),
							n("spinner", { style: "braille", label: "braille" }),
							n("spinner", { style: "starburst", label: "starburst" }),
							n("spinner", { style: "orbit", label: "orbit" }),
						]),
					),
					guard(cx, "shimmer", () => n("shimmer", { text: "Tern clocks this shimmer" })),
					guard(cx, "elapsed", () => n("elapsed", { age, format: "clock" })),
					guard(cx, "progress", () =>
						n("col", { gap: "xs" }, [
							n("progress", { value: progress, label: "determinate" }),
							n("progress", { value: null, label: "indeterminate" }),
						]),
					),
					guard(cx, "rate", () => n("rate", { value: 42.5, unit: "tok/s" })),
					guard(cx, "effort", () =>
						n(
							"row",
							{ gap: "md", align: "center" },
							["off", "minimal", "low", "medium", "high", "xhigh", "max"].map(level =>
								n("effort", { level, title: level }, undefined, `effort-${level}`),
							),
						),
					),
					guard(cx, "agent", () =>
						n("agent", {
							name: "DemoAgent",
							agent: "task",
							task: "Showing agent card",
							status: "running",
							stats: { tools: 3, tokens: 12000, done: Math.min(progress, 1) },
						}),
					),
					guard(cx, "tool", () =>
						n("tool", {
							name: "bash",
							title: "Bash",
							target: "tern ls",
							targetKind: "command",
							status: "running",
							age,
						}),
					),
				]);
			};

			const mediaSection = (cx: DescribeContext): NativeNode =>
				n("col", { gap: "md" }, [
					guard(cx, "image", () => n("image", { builtin: "omp", alt: "omp mark", max: { w: "30ch" } })),
					guard(cx, "media", () => n("media", { path: DEMO_SVG, max: { h: "12lines" } })),
					guard(cx, "card", () =>
						n(
							"card",
							{ head: "Collapsible card", collapsible: true, collapsed: true, preview: { lines: 2 } },
							[
								n("md", {
									text: Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of the collapsible body`).join("\n\n"),
								}),
							],
							"collapsible",
						),
					),
					guard(cx, "card", () =>
						n(
							"card",
							{
								head: "Actions",
								status: "done",
								actions: { click: "copy", menu: ["copy", "open"] },
								href: "https://stencil.so/tern",
							},
							[txt("Click copies; the context menu offers copy/open.")],
							"actions-card",
						),
					),
					guard(cx, "icon", () =>
						n("row", { gap: "md", align: "center" }, [
							n("icon", { name: "folder" }),
							n("icon", { name: "git" }),
							n("icon", { name: "check" }),
						]),
					),
				]);

			const section = (cx: DescribeContext): NativeNode => {
				switch (tab) {
					case "text":
						return textSection(cx);
					case "data":
						return dataSection(cx);
					case "motion":
						return motionSection(cx);
					case "media":
						return mediaSection(cx);
				}
			};

			return {
				nativeOverlay: { role: "omp.overlay.tern-showcase", head: "Tern showcase · gallery", size: "lg" as const },
				describe(cx: DescribeContext): NativeNode {
					return memo.get([version, cx.dark, cx.cols], () =>
						n("col", { gap: "md" }, [
							capabilities(cx),
							n("tabs", { items: TAB_ITEMS, active: tab }, undefined, "tabs"),
							n("col", { gap: "md" }, [section(cx)], `section-${tab}`),
							...(toastN > 0
								? [
										n(
											"toast",
											{ text: "Hello from tern-showcase", sub: `count = ${count}`, ttl: 3000 },
											undefined,
											`toast-${toastN}`,
										),
									]
								: []),
							bar([
								button("Toast", "toast", "t"),
								button("Count +1", "inc", "+"),
								null,
								button("Close", "close", "escape"),
							]),
						]),
					);
				},
				handleNativeEvent(e: NativeUiEvent): void {
					if ((e.type === "select" || e.type === "activate") && leafKey(e.key) === "tabs") {
						setTab(e.item);
					} else if (e.type === "action") {
						if (e.act === "toast") toastN++;
						else if (e.act === "inc") count++;
						else if (e.act === "close") return finish();
					}
					bump();
				},
				handleInput(data: string): void {
					if (isClose(data)) return finish();
					if (data >= "1" && data <= "4") tab = TABS[Number(data) - 1];
					else if (isKey(data, "left")) cycleTab(-1);
					else if (isKey(data, "right")) cycleTab(1);
					else if (data === "t") toastN++;
					else if (data === "+") count++;
					bump();
				},
				render(width: number): readonly string[] {
					return [
						"Tern showcase (ANSI fallback — TSP not live)",
						`TERM_PROGRAM=${process.env.TERM_PROGRAM ?? ""}`,
						`tab: ${tab}  count: ${count}`,
						"1-4 tabs · t toast · + count · esc close",
					].map(l => fit(l, width));
				},
				invalidate(): void {},
				dispose(): void {
					clearInterval(timer);
				},
			};
		},
		{ overlay: true },
	);
}
