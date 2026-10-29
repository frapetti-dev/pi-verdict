/** /tern-window: control the Tern window (splits, tabs, pip, preview) through the `tern` CLI. */
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Result of a successful `tern` invocation. */
interface TernResult {
	stdout: string;
	stderr: string;
	code: number;
}

export const WINDOW_ACTIONS = ["split-right", "split-down", "tab", "pip", "open", "ls"] as const;
export type WindowAction = (typeof WINDOW_ACTIONS)[number];

/** First string/number found at `id`, `block`, or `block.id` of a parsed `--json` result. */
function findBlockId(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const o = value as Record<string, unknown>;
	for (const c of [o.id, o.block, (o.block as Record<string, unknown> | undefined)?.id]) {
		if (typeof c === "string" || typeof c === "number") return String(c);
	}
	return undefined;
}

export async function runWindow(pi: ExtensionAPI, ctx: ExtensionContext, action: string): Promise<void> {
	if (!(process.env.TERM_PROGRAM === "tern" && process.env.TERN_PANE)) {
		ctx.ui.notify("Not inside a Tern pane (TERM_PROGRAM/TERN_PANE unset)", "warning");
		return;
	}
	const pane = process.env.TERN_PANE;
	const run = async (args: string[]): Promise<TernResult | undefined> => {
		const r = await pi.exec("tern", args, { cwd: ctx.cwd });
		if (r.code !== 0) {
			ctx.ui.notify(`tern ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`, "error");
			return undefined;
		}
		return r;
	};

	let r: TernResult | undefined;
	switch (action as WindowAction) {
		case "split-right":
			r = await run(["split", pane, "right", "--keep-open", "--", "tern", "ls"]);
			break;
		case "split-down":
			r = await run(["split", pane, "down", "--keep-open", "--", "tern", "events"]);
			break;
		case "tab":
			r = await run(["new", "tab", "--keep-open", "--", "tern", "ls"]);
			break;
		case "pip": {
			const split = await run(["split", pane, "right", "--keep-open", "--json", "--", "tern", "events"]);
			if (!split) return;
			let id: string | undefined;
			try {
				id = findBlockId(JSON.parse(split.stdout));
			} catch {
				id = undefined;
			}
			if (!id) {
				ctx.ui.notify(
					`split created; pip skipped, unrecognized --json output: ${split.stdout.slice(0, 200)}`,
					"warning",
				);
				return;
			}
			r = await run(["pip", id, "--corner", "br"]);
			break;
		}
		case "open":
			r = await run(["open", "--preview", path.join(ctx.cwd, "package.json")]);
			break;
		case "ls": {
			const ls = await run(["ls"]);
			if (ls) ctx.ui.notify(ls.stdout.slice(0, 400), "info");
			return;
		}
		default:
			ctx.ui.notify(`usage: /tern-window ${WINDOW_ACTIONS.join("|")}`, "warning");
			return;
	}
	if (r) ctx.ui.notify(`tern ${action} ok`, "info");
}
