/** LLM tool `my_ext_card`: result drawn as a native Tern checklist card (describeCall / describeResult). */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { n } from "./nodes";

const DEFAULT_ITEMS = ["first", "second", "third"];

interface CardDetails {
	title: string;
	items: string[];
}

export function registerCardTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.registerTool({
		name: "my_ext_card",
		label: "My card",
		description: "Renders a native Tern checklist card. Replace with a description the model can act on.",
		parameters: z.object({ title: z.string(), items: z.array(z.string()).optional() }),
		loadMode: "essential",
		approval: "read",
		async execute(_id, params) {
			const items = params.items ?? DEFAULT_ITEMS;
			const details: CardDetails = { title: params.title, items };
			return {
				content: [{ type: "text", text: `Rendered card "${params.title}" with ${items.length} items` }],
				details, // describeResult reads this back; keep it JSON-serializable
			};
		},
		// Header while the call is pending / streaming.
		describeCall(args) {
			return {
				tool: { title: "My card", target: args.title, targetKind: "text", badges: [{ text: "my-ext", tone: "accent" }] },
			};
		},
		// Final card: `tool` header, `open` expands it, `body` is a list of TSP nodes.
		describeResult(result, _opts, args) {
			const d = result.details as CardDetails | undefined;
			const items = d?.items ?? [];
			return {
				tool: { title: "My card", target: d?.title ?? args?.title, meta: [`${items.length} items`] },
				open: true,
				body: [
					n("checklist", {
						phases: [
							{
								id: "p",
								title: "Items",
								items: items.map((text, i) => ({
									id: String(i),
									text,
									status: i === 0 ? ("done" as const) : i === 1 ? ("active" as const) : ("pending" as const),
								})),
							},
						],
					}),
				],
			};
		},
	});
}
