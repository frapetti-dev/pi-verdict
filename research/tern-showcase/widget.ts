/** /tern-widget: a native widget above the editor (toggle). */
import type { DescribeContext, NativeNode } from "@oh-my-pi/pi-tui";
import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { fit, n, txt } from "./nodes";

const KEY = "tern-showcase";
let on = false;

export function toggleWidget(ctx: ExtensionContext): void {
	on = !on;
	if (!on) {
		ctx.ui.setWidget(KEY, undefined);
		ctx.ui.notify("tern-showcase widget off", "info");
		return;
	}
	ctx.ui.setWidget(
		KEY,
		tui => {
			const startedAt = Date.now();
			let load = 0.3;
			let version = 0;
			let cached: { version: number; node: NativeNode } | undefined;
			const timer = setInterval(() => {
				load = Math.min(0.98, Math.max(0.02, load + (Math.random() - 0.5) * 0.2));
				version++;
				tui.requestRender();
			}, 1000);
			return {
				describe(_cx: DescribeContext): NativeNode {
					if (cached?.version === version) return cached.node;
					const node = n("row", { gap: "sm", align: "center" }, [
						n("spinner", { style: "orbit" }),
						txt([{ t: "tern-showcase widget", s: "accent" }]),
						n("meter", { value: load, style: "blocks", steps: 10, size: "sm" }),
						n("elapsed", { age: Date.now() - startedAt, format: "short" }),
					]);
					cached = { version, node };
					return node;
				},
				render(width: number): readonly string[] {
					return [fit(`tern-showcase widget · load ${Math.round(load * 100)}%`, width)];
				},
				invalidate(): void {},
				dispose(): void {
					clearInterval(timer);
				},
			};
		},
		{ placement: "aboveEditor" },
	);
	ctx.ui.notify("tern-showcase widget on", "info");
}
