/**
 * my-ext: starter omp extension with Tern-native UI (TSP).
 * Commands: /my-ext /my-ext-screen /my-ext-pick /my-ext-widget
 * Tool: my_ext_card
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { openOverlay } from "./overlay";
import { openPicker } from "./picker";
import { openScreen } from "./screen";
import { registerCardTool } from "./tool";
import { toggleWidget } from "./widget";

const SAMPLE_ITEMS = [
	{ id: "a", label: "alpha", detail: "First item" },
	{ id: "b", label: "beta", detail: "Second item" },
	{ id: "c", label: "gamma", detail: "Third item" },
];

/** True when the interactive TUI is available; notifies otherwise. */
function needsUi(ctx: ExtensionContext): boolean {
	if (ctx.hasUI) return true;
	ctx.ui.notify("my-ext needs the interactive TUI", "warning");
	return false;
}

export default function myExt(pi: ExtensionAPI): void {
	pi.registerCommand("my-ext", {
		description: "my-ext: native overlay dialog",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openOverlay(ctx);
		},
	});
	pi.registerCommand("my-ext-screen", {
		description: "my-ext: full-pane screen surface",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openScreen(ctx, SAMPLE_ITEMS);
		},
	});
	pi.registerCommand("my-ext-pick", {
		description: "my-ext: native picker sheet",
		handler: async (_args, ctx) => {
			if (!needsUi(ctx)) return;
			const id = await openPicker(ctx, SAMPLE_ITEMS);
			if (id) ctx.ui.notify(`picked ${id}`, "info");
		},
	});
	pi.registerCommand("my-ext-widget", {
		description: "my-ext: toggle a native widget above the editor",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) toggleWidget(ctx);
		},
	});
	registerCardTool(pi);
}
