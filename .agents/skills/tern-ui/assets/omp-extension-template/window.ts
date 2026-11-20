/**
 * Control the Tern window (splits, tabs, pip, preview) through the `tern` CLI.
 *
 * Useful argv shapes (always an argv array, never a shell string):
 *   ["split", pane, "right"|"down", "--keep-open", "--json", "--", "cmd", ...args]
 *   ["new", "tab", "--keep-open", "--", "cmd", ...args]
 *   ["pip", blockId, "--corner", "br"]
 *   ["open", "--preview", absPath]  /  ["open", "--split", "right", `${absPath}:${line}`]
 *   ["ls"]
 * Run `tern <cmd> --help` for the exact flags.
 */
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/** Result of a successful `tern` invocation. */
export interface TernResult {
	stdout: string;
	stderr: string;
	code: number;
}

/** True only inside a Tern pane; every `tern` call MUST be gated on this. */
export function ternAvailable(): boolean {
	return process.env.TERM_PROGRAM === "tern" && Boolean(process.env.TERN_PANE);
}

/** Run `tern <args>`; notifies and returns undefined outside Tern or on a non-zero exit. */
export async function tern(pi: ExtensionAPI, ctx: ExtensionContext, args: string[]): Promise<TernResult | undefined> {
	if (!ternAvailable()) {
		ctx.ui.notify("Not inside a Tern pane (TERM_PROGRAM/TERN_PANE unset)", "warning");
		return undefined;
	}
	const r = await pi.exec("tern", args, { cwd: ctx.cwd });
	if (r.code !== 0) {
		ctx.ui.notify(`tern ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`, "error");
		return undefined;
	}
	return r;
}
