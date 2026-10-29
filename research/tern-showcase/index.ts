/**
 * tern-showcase: project-local extension demonstrating Tern-native UI (TSP) from omp.
 * Commands: /tern-gallery /tern-screen /tern-picker /tern-widget /tern-window
 * Tool: tern_showcase_card
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { openAsk } from "./ask";
import { openGallery } from "./gallery";
import { openPicker } from "./picker";
import { openScreen } from "./screen";
import { registerCardTool } from "./tool";
import { toggleWidget } from "./widget";
import { runWindow, WINDOW_ACTIONS } from "./window";

/** True when the interactive TUI is available; notifies otherwise. */
function needsUi(ctx: ExtensionContext): boolean {
	if (ctx.hasUI) return true;
	ctx.ui.notify("tern-showcase needs the interactive TUI", "warning");
	return false;
}

export default function ternShowcase(pi: ExtensionAPI): void {
	pi.registerCommand("tern-gallery", {
		description: "Tern showcase: overlay sheet with every TSP element kind",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openGallery(ctx);
		},
	});
	pi.registerCommand("tern-ask", {
		description: "Tern showcase: the host ask dialog with single/multi-choice questions",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openAsk(ctx);
		},
	});
	pi.registerCommand("tern-screen", {
		description: "Tern showcase: full-pane screen surface with live services",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openScreen(ctx, pi);
		},
	});
	pi.registerCommand("tern-picker", {
		description: "Tern showcase: native picker sheet launching the other demos",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) await openPicker(ctx, pi);
		},
	});
	pi.registerCommand("tern-widget", {
		description: "Tern showcase: toggle a native widget above the editor",
		handler: async (_args, ctx) => {
			if (needsUi(ctx)) toggleWidget(ctx);
		},
	});
	pi.registerCommand("tern-window", {
		description: `Tern showcase: control the Tern window (${WINDOW_ACTIONS.join("|")})`,
		getArgumentCompletions: prefix =>
			WINDOW_ACTIONS.filter(a => a.startsWith(prefix)).map(a => ({ value: a, label: a })),
		handler: async (args, ctx) => {
			if (!needsUi(ctx)) return;
			const action = args.trim();
			if (!(WINDOW_ACTIONS as readonly string[]).includes(action)) {
				ctx.ui.notify(`usage: /tern-window ${WINDOW_ACTIONS.join("|")}`, "warning");
				return;
			}
			await runWindow(pi, ctx, action);
		},
	});
	registerCardTool(pi);
}
