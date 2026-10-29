/** LLM tool `tern_showcase_card`: result drawn as a native Tern checklist card. */
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { n } from "./nodes";

const DEFAULT_ITEMS = ["describe()", "handleNativeEvent()", "describeScreen()"];

interface CardDetails {
	title: string;
	items: string[];
}

export function registerCardTool(pi: ExtensionAPI): void {
	const z = pi.zod;
	pi.registerTool({
		name: "tern_showcase_card",
		label: "Tern card",
		description:
			"Demo tool: renders a native Tern checklist card. Use only when the user asks to demo the Tern showcase tool.",
		parameters: z.object({ title: z.string(), items: z.array(z.string()).optional() }),
		loadMode: "essential",
		approval: "read",
		async execute(_id, params) {
			const items = params.items ?? DEFAULT_ITEMS;
			const details: CardDetails = { title: params.title, items };
			return {
				content: [{ type: "text", text: `Rendered card "${params.title}" with ${items.length} items` }],
				details,
			};
		},
		describeCall(args) {
			return {
				tool: { title: "Tern card", target: args.title, targetKind: "text", badges: [{ text: "showcase", tone: "accent" }] },
			};
		},
		describeResult(result, _opts, args) {
			const d = result.details as CardDetails | undefined;
			const items = d?.items ?? [];
			return {
				tool: { title: "Tern card", target: d?.title ?? args?.title, meta: [`${items.length} items`] },
				open: true,
				body: [
					n("checklist", {
						phases: [
							{
								id: "p",
								title: "Rendered by Tern",
								items: items.map((text, i) => ({
									id: String(i),
									text,
									status: i === 0 ? ("done" as const) : i === 1 ? ("active" as const) : ("pending" as const),
								})),
							},
						],
					}),
					n("md", { text: "Drawn natively via **TSP** `describeResult`." }),
				],
			};
		},
	});
}
