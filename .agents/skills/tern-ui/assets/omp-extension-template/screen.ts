/** /my-ext-screen: a fullscreen overlay that becomes a Tern `screen` surface (main + dock regions). */
import type { Component, DescribeContext, NativeNode, NativeScreen, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { bar, button, fit, isClose, isKey, Memo, n, txt } from "./nodes";

export interface ScreenItem {
	id: string;
	label: string;
	detail: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export async function openScreen(ctx: ExtensionContext, items: ScreenItem[]): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, _theme, _kb, done) => {
			let selected = items[0]?.id ?? "";
			let version = 0;
			let closed = false;

			const current = () => items.find(i => i.id === selected) ?? items[0];
			const bump = () => {
				version++;
				tui.requestRender();
			};
			// Live-data example: refresh `items` here, then bump(). Clear it in finish() AND dispose().
			// const timer = setInterval(() => { /* mutate items */ bump(); }, 1000);
			const finish = () => {
				if (closed) return;
				closed = true;
				// clearInterval(timer);
				done();
			};
			const move = (d: number) => {
				const i = items.findIndex(x => x.id === selected);
				selected = items[clamp(i + d, 0, items.length - 1)]?.id ?? selected;
			};
			const onEvent = (e: NativeUiEvent): void => {
				if (e.type === "select" || e.type === "activate") selected = e.item;
				else if (e.type === "action" && e.act === "close") return finish();
				bump();
			};

			// `main` region: the content. Its own events arrive at its own handleNativeEvent.
			const bodyMemo = new Memo();
			const body: Component = {
				describe(_cx: DescribeContext): NativeNode {
					return bodyMemo.get([version], () => {
						const sel = current();
						return n("row", { gap: "lg", align: "stretch" }, [
							n(
								"list",
								{ selected },
								items.map(i => n("item", { label: i.label, detail: i.detail }, undefined, i.id)),
								"items",
							),
							n("card", { head: sel?.label ?? "(empty)", grow: 1 }, [txt(sel?.detail ?? "")], "detail"),
						]);
					});
				},
				handleNativeEvent: onEvent,
				render(): readonly string[] {
					return [];
				},
				invalidate(): void {},
			};

			// `dock` region (status + actions) holds THE component itself, so it keeps focus and handleInput.
			const rootMemo = new Memo();
			const root: Component = {
				// No nativeOverlay / nativeSheet: that is what makes the backend treat this as a screen.
				describeScreen(_cx: DescribeContext): NativeScreen {
					return { role: "my-ext.screen", main: [body], dock: [root] };
				},
				describe(_cx: DescribeContext): NativeNode {
					return rootMemo.get([version], () =>
						n("col", { gap: "sm" }, [
							n("status", {}, [
								n("seg", { spans: [{ t: `${items.length} items` }], side: "left" }),
								n("seg", { spans: [{ t: "↑↓ select · esc close", s: "muted" }], side: "right" }),
							]),
							bar([null, button("Close", "close", "escape")]),
						]),
					);
				},
				handleNativeEvent: onEvent,
				handleInput(data: string): void {
					if (isClose(data)) return finish();
					if (isKey(data, "up")) move(-1);
					else if (isKey(data, "down")) move(1);
					bump();
				},
				render(width: number): readonly string[] {
					return [
						fit("My extension · screen (ANSI fallback) — ↑↓ esc", width),
						...items.map(i => fit(`${i.id === selected ? ">" : " "} ${i.label} — ${i.detail}`, width)),
					];
				},
				invalidate(): void {},
				dispose(): void {
					// clearInterval(timer);
				},
			};
			return root;
		},
		{ overlay: true, overlayOptions: { fullscreen: true } },
	);
}
