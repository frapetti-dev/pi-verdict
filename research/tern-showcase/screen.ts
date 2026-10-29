/** /tern-screen: a fullscreen overlay that becomes a Tern `screen` surface (main + dock regions). */
import type { Component, DescribeContext, NativeNode, NativeScreen, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { bar, button, fit, guard, isClose, isKey, Memo, n, txt } from "./nodes";
import { runWindow } from "./window";

interface Service {
	id: string;
	label: string;
	icon: string;
	running: boolean;
	cpu: number;
	history: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export async function openScreen(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, _theme, _kb, done) => {
			const openedAt = Date.now();
			const services: Service[] = [
				["api", "API", "server"],
				["db", "Database", "database"],
				["cache", "Cache", "bolt"],
				["queue", "Queue", "list"],
				["search", "Search", "search"],
				["mail", "Mail", "mail"],
			].map(([id, label, icon], i) => ({
				id,
				label,
				icon,
				running: i % 2 === 0,
				cpu: 0.3,
				history: [0.3],
			}));
			let selected = "api";
			let version = 0;
			let closed = false;

			const current = () => services.find(s => s.id === selected) ?? services[0];
			const bump = () => {
				version++;
				tui.requestRender();
			};
			const timer = setInterval(() => {
				for (const s of services) {
					if (!s.running) continue;
					s.cpu = clamp(s.cpu + (Math.random() - 0.5) * 0.2, 0.02, 0.98);
					s.history.push(s.cpu);
					if (s.history.length > 30) s.history.shift();
				}
				bump();
			}, 1000);
			const finish = () => {
				if (closed) return;
				closed = true;
				clearInterval(timer);
				done();
			};
			const toggle = () => {
				const s = current();
				s.running = !s.running;
			};
			const move = (d: number) => {
				const i = services.findIndex(s => s.id === selected);
				selected = services[clamp(i + d, 0, services.length - 1)].id;
			};
			const onEvent = (e: NativeUiEvent): void => {
				if (e.type === "select") {
					selected = e.item;
				} else if (e.type === "activate") {
					selected = e.item;
					toggle();
				} else if (e.type === "action") {
					if (e.act === "toggle") toggle();
					else if (e.act === "split") void runWindow(pi, ctx, "split-right");
					else if (e.act === "close") return finish();
				}
				bump();
			};

			const bodyMemo = new Memo();
			const body: Component = {
				describe(cx: DescribeContext): NativeNode {
					return bodyMemo.get([version, cx.supports("chart")], () => {
						const sel = current();
						const pct = Math.round(sel.cpu * 100);
						return n("col", { gap: "md" }, [
							n("row", { gap: "sm", align: "center" }, [
								n("icon", { name: "server" }),
								txt([{ t: "Tern showcase · screen surface", s: "strong" }]),
								n("spacer", { grow: 1 }),
								n("elapsed", { age: Date.now() - openedAt, format: "clock" }),
							]),
							n("row", { gap: "lg", align: "stretch" }, [
								n(
									"list",
									{ selected },
									services.map(s =>
										n(
											"item",
											{
												label: s.label,
												detail: s.running ? "running" : "stopped",
												icon: s.icon,
												value: `${Math.round(s.cpu * 100)}%`,
											},
											undefined,
											s.id,
										),
									),
									"services",
								),
								n(
									"card",
									{ head: sel.label, status: sel.running ? "running" : "cancelled", grow: 1 },
									[
										n("kv", {
											items: [
												{ k: "id", v: sel.id },
												{ k: "state", v: sel.running ? "running" : "stopped" },
												{ k: "cpu", v: `${pct}%` },
											],
										}),
										n("meter", {
											value: sel.cpu,
											style: "bar",
											thresholds: { warn: 0.7, bad: 0.9 },
											label: `${pct}%`,
										}),
										guard(cx, "chart", () =>
											n("chart", {
												kind: "spark",
												series: sel.history.map(v => ({ value: Math.round(v * 100) })),
												min: 0,
												max: 100,
												size: "md",
											}),
										),
										n("progress", { value: sel.running ? sel.cpu : null, label: "load" }),
									],
									"detail",
								),
							]),
						]);
					});
				},
				handleNativeEvent: onEvent,
				render(): readonly string[] {
					return [];
				},
				invalidate(): void {},
			};

			const rootMemo = new Memo();
			const root: Component = {
				// No nativeOverlay / nativeSheet: that is what makes the backend treat this as a screen.
				describeScreen(_cx: DescribeContext): NativeScreen {
					return { role: "tern-showcase.screen", main: [body], dock: [root] };
				},
				describe(_cx: DescribeContext): NativeNode {
					return rootMemo.get([version], () => {
						const running = services.filter(s => s.running).length;
						return n("col", { gap: "sm" }, [
							n("status", {}, [
								n("seg", { spans: [{ t: `${services.length} services` }], side: "left" }),
								n("seg", { spans: [{ t: `${running} running`, s: "success" }], side: "left" }),
								n("seg", {
									spans: [{ t: "↑↓ select · enter toggle · s split · esc close", s: "muted" }],
									side: "right",
								}),
							]),
							bar([
								button("Start/Stop", "toggle", "enter"),
								button("Split pane", "split", "s"),
								null,
								button("Close", "close", "escape"),
							]),
						]);
					});
				},
				handleNativeEvent: onEvent,
				handleInput(data: string): void {
					if (isClose(data)) return finish();
					if (isKey(data, "up")) move(-1);
					else if (isKey(data, "down")) move(1);
					else if (isKey(data, "enter")) toggle();
					else if (data === "s") void runWindow(pi, ctx, "split-right");
					bump();
				},
				render(width: number): readonly string[] {
					return [
						fit("Tern showcase · screen (ANSI fallback) — ↑↓ enter s esc", width),
						...services.map(s =>
							fit(
								`${s.id === selected ? ">" : " "} ${s.label.padEnd(8)} ${s.running ? "●" : "○"} ${Math.round(s.cpu * 100)}%`,
								width,
							),
						),
					];
				},
				invalidate(): void {},
				dispose(): void {
					clearInterval(timer);
				},
			};
			return root;
		},
		{ overlay: true, overlayOptions: { fullscreen: true } },
	);
}
