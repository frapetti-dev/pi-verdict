/** /tern-picker: a data-first `picker` sheet used as a launcher for the other demos. */
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { openGallery } from "./gallery";
import { fit, isClose, isKey, Memo, n } from "./nodes";
import { openScreen } from "./screen";
import { toggleWidget } from "./widget";
import { runWindow } from "./window";

type Scope = "all" | "ui" | "window";
const SCOPES: readonly Scope[] = ["all", "ui", "window"];

interface Entry {
	id: string;
	label: string;
	detail: string;
	scope: Exclude<Scope, "all">;
	icon: string;
	kind: string;
	score: number;
	run(): Promise<void>;
}

export async function openPicker(ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
	const win = (id: string) => () => runWindow(pi, ctx, id);
	const entries: Entry[] = [
		{ id: "gallery", label: "gallery", detail: "Overlay sheet with every element kind", scope: "ui", icon: "image", kind: "overlay", score: 0.9, run: () => openGallery(ctx) },
		{ id: "screen", label: "screen", detail: "Full-pane screen surface with live data", scope: "ui", icon: "server", kind: "screen", score: 0.85, run: () => openScreen(ctx, pi) },
		{ id: "widget", label: "widget", detail: "Toggle a native widget above the editor", scope: "ui", icon: "bolt", kind: "widget", score: 0.5, run: async () => toggleWidget(ctx) },
		{ id: "split-right", label: "split-right", detail: "Split the pane right running tern ls", scope: "window", icon: "columns", kind: "tern split", score: 0.6, run: win("split-right") },
		{ id: "split-down", label: "split-down", detail: "Split the pane down streaming tern events", scope: "window", icon: "rows", kind: "tern split", score: 0.7, run: win("split-down") },
		{ id: "tab", label: "tab", detail: "Open a new tab running tern ls", scope: "window", icon: "tab", kind: "tern new", score: 0.4, run: win("tab") },
		{ id: "pip", label: "pip", detail: "Split, then float the new pane picture-in-picture", scope: "window", icon: "window", kind: "tern pip", score: 0.8, run: win("pip") },
		{ id: "open", label: "open", detail: "Preview package.json in a Tern pane", scope: "window", icon: "file", kind: "tern open", score: 0.3, run: win("open") },
		{ id: "ls", label: "ls", detail: "List Tern sessions in a notification", scope: "window", icon: "list", kind: "tern ls", score: 0.2, run: win("ls") },
	];

	const chosen = await ctx.ui.custom<string | undefined>(
		(tui, _theme, _kb, done) => {
			let query = "";
			let scope: Scope = "all";
			let layout: "rows" | "cards" = "cards";
			let selected = entries[0].id;
			let version = 0;
			const memo = new Memo();

			const visible = () =>
				entries.filter(
					e => (scope === "all" || e.scope === scope) && e.label.toLowerCase().includes(query.toLowerCase()),
				);
			const reselect = () => {
				selected = visible()[0]?.id ?? "";
			};
			const bump = () => {
				version++;
				tui.requestRender();
			};
			const setScope = (s: string | undefined) => {
				if (s && (SCOPES as readonly string[]).includes(s)) {
					scope = s as Scope;
					reselect();
				}
			};
			const move = (d: number) => {
				const v = visible();
				if (v.length === 0) return;
				const i = Math.max(0, v.findIndex(e => e.id === selected));
				selected = v[Math.min(v.length - 1, Math.max(0, i + d))].id;
			};
			const scopeCount = (s: Scope) => entries.filter(e => s === "all" || e.scope === s).length;

			return {
				nativeSheet: (cx: DescribeContext) => cx.supports("picker"),
				describe(_cx: DescribeContext): NativeNode {
					return memo.get([version], () => {
						const vis = visible();
						const q = query.toLowerCase();
						const hits: Record<string, [number, number][]> = {};
						if (q) {
							for (const e of vis) {
								const i = e.label.toLowerCase().indexOf(q);
								if (i >= 0) hits[e.id] = [[i, i + q.length]];
							}
						}
						return n("picker", {
							title: "Tern showcase",
							subtitle: "Pick a demo",
							noun: "demos",
							size: "lg",
							layout,
							query,
							cursor: query.length,
							placeholder: "Filter demos",
							scopes: [
								{ id: "all", label: "All", count: scopeCount("all") },
								{ id: "ui", label: "UI", count: scopeCount("ui") },
								{ id: "window", label: "Window", count: scopeCount("window") },
							],
							scope,
							columns: [
								{ id: "kind", head: "Kind", format: "dim" },
								{ id: "score", head: "Wow", format: "bar" },
							],
							items: entries.map(e => ({
								id: e.id,
								label: e.label,
								detail: e.detail,
								icon: e.icon,
								facts: { kind: e.kind, score: e.score },
								badges: e.scope === "window" ? [{ text: "tern CLI", tone: "info" as const }] : [],
							})),
							order: vis.map(e => e.id),
							hits,
							selected,
							total: entries.length,
							preview: "none",
							actions: [
								{ id: "open", label: "Open", keys: ["enter"], primary: true },
								{ id: "layout", label: layout === "cards" ? "Rows" : "Cards", keys: ["ctrl", "l"] },
								{ id: "close", label: "Close", keys: ["escape"], end: true },
							],
							empty: "No demo matches",
							focus: "list",
						});
					});
				},
				handleNativeEvent(e: NativeUiEvent): void {
					if (e.type === "select") {
						selected = e.item;
					} else if (e.type === "activate") {
						return done(e.item);
					} else if (e.type === "action") {
						if (e.act === "scope") setScope(e.value);
						else if (e.act === "open") return done(selected || undefined);
						else if (e.act === "layout") layout = layout === "cards" ? "rows" : "cards";
						else if (e.act === "close") return done(undefined);
					}
					bump();
				},
				handleInput(data: string): void {
					if (isClose(data)) return done(undefined);
					if (isKey(data, "up")) move(-1);
					else if (isKey(data, "down")) move(1);
					else if (isKey(data, "enter")) return done(selected || undefined);
					else if (isKey(data, "tab")) setScope(SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length]);
					else if (isKey(data, "ctrl+l")) layout = layout === "cards" ? "rows" : "cards";
					else if (isKey(data, "backspace")) {
						query = query.slice(0, -1);
						reselect();
					} else if (data.length === 1 && data >= " ") {
						query += data;
						reselect();
					}
					bump();
				},
				render(width: number): readonly string[] {
					return [
						"Tern showcase picker (type to filter, enter to open)",
						`query: ${query}`,
						...visible().map(e => `${e.id === selected ? ">" : " "} ${e.label} — ${e.detail}`),
					].map(l => fit(l, width));
				},
				invalidate(): void {},
			};
		},
		{ overlay: true },
	);

	const entry = entries.find(e => e.id === chosen);
	if (!entry) return;
	try {
		await entry.run();
	} catch (err) {
		ctx.ui.notify(String(err), "error");
	}
}
