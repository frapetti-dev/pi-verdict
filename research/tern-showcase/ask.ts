/** /tern-ask: the host's rich ask dialog (tabs, radios/checks, recommended badge, previews) from an extension. */
import type { ExtensionAskDialogQuestion, ExtensionAskDialogResultItem, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const QUESTIONS: ExtensionAskDialogQuestion[] = [
	{
		id: "surface",
		header: "Surface",
		question: "Which Tern surface should the next demo use?\n\nPick **one**; the highlighted option's preview shows below the list.",
		recommended: 1,
		options: [
			{
				label: "Overlay sheet",
				description: "Glass sheet over the transcript",
				preview: "```ts\nctx.ui.custom(factory, { overlay: true })\n// + nativeOverlay: { role, head, size }\n```",
			},
			{
				label: "Screen surface",
				description: "Full pane with main + dock regions",
				preview: "```ts\nctx.ui.custom(factory, { overlay: true, overlayOptions: { fullscreen: true } })\n// + describeScreen(cx) -> { role, main, dock }\n```",
			},
			{
				label: "Picker sheet",
				description: "Data-first list with scopes and filter",
				preview: "```ts\n// nativeSheet(cx) { return cx.supports(\"picker\"); }\n// describe(cx) -> n(\"picker\", { items, order, scopes, actions })\n```",
			},
		],
	},
	{
		id: "kinds",
		header: "Kinds",
		multi: true,
		question: "Which element kinds do you want to see?\n\nPick **any number**.",
		options: [
			{ label: "chart", description: "bars, spark, heatmap" },
			{ label: "meter", description: "bar, ring, blocks" },
			{ label: "diff", description: "unified diff with syntax" },
			{ label: "agent", description: "subagent status card" },
			{ label: "media", description: "SVG/image viewer" },
		],
	},
	{
		id: "mode",
		header: "Mode",
		question: "How should it update?",
		options: [
			{ label: "Live", description: "ticks every second" },
			{ label: "Static", description: "render once" },
		],
	},
];

function formatItem(r: ExtensionAskDialogResultItem): string {
	const picked = [...r.selectedOptions, ...(r.customInput ? [`other: ${r.customInput}`] : [])];
	const note = r.note ? ` (note: ${r.note})` : "";
	return `${r.id}: ${picked.join(", ") || "(none)"}${r.timedOut ? " [timed out]" : ""}${note}`;
}

export async function openAsk(ctx: ExtensionContext): Promise<void> {
	// askDialog is optional on the UI context: fall back to a plain select for hosts without it.
	if (!ctx.ui.askDialog) {
		const pick = await ctx.ui.select("Which Tern surface?", QUESTIONS[0].options);
		ctx.ui.notify(pick ? `surface: ${pick}` : "cancelled", "info");
		return;
	}
	const result = await ctx.ui.askDialog(QUESTIONS);
	if (!result) {
		ctx.ui.notify("ask cancelled", "info");
	} else if (result.kind === "chat") {
		ctx.ui.notify("user chose to discuss instead of answering", "info");
	} else {
		ctx.ui.notify(result.results.map(formatItem).join("\n"), "info");
	}
}
