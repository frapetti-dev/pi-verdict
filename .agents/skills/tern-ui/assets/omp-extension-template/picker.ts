/** /my-ext-pick: a data-first `picker` sheet. Resolves to the chosen item id, or undefined when dismissed. */
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { fit, isClose, isKey, Memo, n } from "./nodes";

export interface PickerItem {
	id: string;
	label: string;
	detail: string;
	icon?: string;
}

export async function openPicker(ctx: ExtensionContext, items: PickerItem[]): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>(
		(tui, _theme, _kb, done) => {
			let query = "";
			let selected = items[0]?.id ?? "";
			let version = 0;
			const memo = new Memo();

			const visible = () => items.filter(e => e.label.toLowerCase().includes(query.toLowerCase()));
			const reselect = () => {
				selected = visible()[0]?.id ?? "";
			};
			const bump = () => {
				version++;
				tui.requestRender();
			};
			const move = (d: number) => {
				const v = visible();
				if (v.length === 0) return;
				const i = Math.max(0, v.findIndex(e => e.id === selected));
				selected = v[Math.min(v.length - 1, Math.max(0, i + d))].id;
			};

			return {
				// The picker draws its own frame: opt out of the generic overlay chrome (only for `picker`/`prefs`).
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
							title: "My extension",
							subtitle: "Pick one",
							noun: "items",
							size: "lg",
							layout: "rows",
							query,
							cursor: query.length,
							placeholder: "Filter",
							items: items.map(e => ({ id: e.id, label: e.label, detail: e.detail, icon: e.icon })),
							order: vis.map(e => e.id),
							hits,
							selected,
							total: items.length,
							// Previews are hidden in narrow panes; never put essential info only in a preview.
							preview: "none",
							actions: [
								{ id: "open", label: "Open", keys: ["enter"], primary: true },
								{ id: "close", label: "Close", keys: ["escape"], end: true },
							],
							empty: "No match",
							focus: "list",
						});
					});
				},
				handleNativeEvent(e: NativeUiEvent): void {
					if (e.type === "select") selected = e.item;
					else if (e.type === "activate") return done(e.item);
					else if (e.type === "action") {
						if (e.act === "open") return done(selected || undefined);
						if (e.act === "close") return done(undefined);
					}
					bump();
				},
				handleInput(data: string): void {
					if (isClose(data)) return done(undefined);
					if (isKey(data, "up")) move(-1);
					else if (isKey(data, "down")) move(1);
					else if (isKey(data, "enter")) return done(selected || undefined);
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
						"My extension picker (type to filter, enter to open)",
						`query: ${query}`,
						...visible().map(e => `${e.id === selected ? ">" : " "} ${e.label} — ${e.detail}`),
					].map(l => fit(l, width));
				},
				invalidate(): void {},
			};
		},
		{ overlay: true },
	);
}
