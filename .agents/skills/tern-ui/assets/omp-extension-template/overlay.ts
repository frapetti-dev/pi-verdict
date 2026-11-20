/** /my-ext: a floating glass overlay (dialog) with a native `describe()` tree and an ANSI `render()` fallback. */
import type { DescribeContext, NativeNode, NativeUiEvent } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { bar, button, fit, framed, heading, isClose, isKey, leafKey, Memo, n, prose } from "./nodes";

export async function openOverlay(ctx: ExtensionContext): Promise<void> {
	await ctx.ui.custom<void>(
		(tui, _theme, _kb, done) => {
			let count = 0;
			let ticks = 0;
			let version = 0; // bump() on every state change; Memo keys on it
			let closed = false;
			const memo = new Memo();

			const bump = () => {
				version++;
				tui.requestRender();
			};
			// Example of live data. Whatever you start here MUST be cleared in finish() and dispose().
			const timer = ctx.setInterval(() => {
				ticks++;
				bump();
			}, 1000);
			/** Idempotent: a click and a key can both ask to close. */
			const finish = () => {
				if (closed) return;
				closed = true;
				ctx.clearTimer(timer);
				done();
			};

			return {
				// Role + head give the surface its frame. No `size`: pair with `overlayOptions.width` below.
				nativeOverlay: { role: "omp.overlay.my-ext", head: "My extension" },
				describe(cx: DescribeContext): NativeNode {
					return memo.get([version, cx.dark], () =>
						framed(
							[
								heading("Hello from my-ext"),
								prose("Replace this body with your own content."),
								n("kv", { items: [{ k: "count", v: String(count) }, { k: "ticks", v: String(ticks) }] }),
								bar([button("Count +1", "inc", "i"), null, button("Close", "close", "escape")]),
							],
							"md",
						),
					);
				},
				handleNativeEvent(e: NativeUiEvent): void {
					if (e.type === "action") {
						if (e.act === "inc") count++;
						else if (e.act === "close") return finish();
					} else if (e.type === "select" && leafKey(e.key) === "list") {
						// Route list/tabs/etc. events by the LAST segment of e.key (the node's own key).
					}
					bump();
				},
				// Keyboard twin for every clickable action: the ANSI path has no mouse.
				handleInput(data: string): void {
					if (isClose(data)) return finish();
					if (data === "i" || isKey(data, "enter")) count++;
					bump();
				},
				// ANSI fallback: Windows Terminal, multiplexers, PI_TUI_NATIVE=0.
				render(width: number): readonly string[] {
					return [`My extension (count ${count}, ticks ${ticks})`, "i increment · esc close"].map(l => fit(l, width));
				},
				invalidate(): void {},
				dispose(): void {
					ctx.clearTimer(timer);
				},
			};
		},
		// 80% width becomes an undeclared `md` overlay: it floats at every pane width (60% only for really small dialogs).
		// A declared `md`/`lg` size fills panes narrower than ~100 columns.
		{ overlay: true, overlayOptions: { width: "80%" } },
	);
}
