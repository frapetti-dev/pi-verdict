/**
 * Dependency-light helpers for building Tern Surface Protocol (TSP) nodes.
 * Types only from pi-wire; the one value import is `matchesKey` from pi-tui.
 */
import type { DescribeContext, NativeChild, NativeNode } from "@oh-my-pi/pi-tui";
import { matchesKey } from "@oh-my-pi/pi-tui";
import type { TspKind, TspProps, TspSpan } from "@oh-my-pi/pi-wire";

/** Build a node: `{ k, p, c, key }`. */
export function n<K extends TspKind>(
	k: K,
	p?: TspProps<K>,
	c?: readonly NativeChild[],
	key?: string,
): NativeNode {
	return { k, p, c, key } as unknown as NativeNode;
}

/** A `text` node from a plain string or spans. */
export function txt(s: string | readonly TspSpan[], p: TspProps<"text"> = {}): NativeNode {
	return typeof s === "string" ? n("text", { ...p, text: s }) : n("text", { ...p, spans: s });
}

/** Native button: a `row` with role `omp.btn`; a click arrives as `{type:"action", act}`. */
export function button(label: string, act: string, keys?: string): NativeNode {
	const children: NativeChild[] = [txt(label)];
	if (keys) children.push(n("kbd", { keys: keys.split("+") }));
	return n(
		"row",
		{ role: "omp.btn", gap: "xs", align: "center", actions: { click: act }, title: label },
		children,
		act,
	);
}

/** Action bar; `null` entries become a growing spacer. */
export function bar(buttons: readonly (NativeNode | null)[], key = "actions"): NativeNode {
	const children = buttons.map(b => b ?? n("spacer", { grow: 1 }));
	return n("row", { role: "omp.actions", gap: "sm", align: "center" }, children, key);
}

/** Every TSP kind (local copy of `TSP_KINDS` from pi-wire; pi-wire values are not an extension surface). */
export const ALL_KINDS: readonly TspKind[] = [
	"col", "row", "card", "section", "rule", "spacer", "text", "md", "code", "diff", "ansi", "math",
	"image", "media", "kv", "table", "tree", "badge", "kbd", "icon", "spinner", "shimmer", "elapsed",
	"progress", "rate", "list", "item", "tabs", "editor", "input", "status", "seg", "overlay", "toast",
	"rows", "picker", "prefs", "tool", "checklist", "agent", "chart", "meter", "effort",
];

/** `build()` when the terminal supports `kind`, else a muted notice. */
export function guard(cx: DescribeContext, kind: TspKind, build: () => NativeNode): NativeNode {
	return cx.supports(kind) ? build() : txt([{ t: `${kind}: not supported by this Tern build`, s: "muted" }]);
}

/** Truncate plain text to `width` cells with an ellipsis (ANSI fallbacks use plain text only). */
export function fit(line: string, width: number): string {
	if (width <= 0) return "";
	return line.length <= width ? line : `${line.slice(0, Math.max(0, width - 1))}…`;
}

export function isKey(data: string, id: string): boolean {
	return matchesKey(data, id as never);
}

export function isClose(data: string): boolean {
	return isKey(data, "escape") || data === "q";
}

/** Last segment of an event key path (`"a/b/tabs"` -> `"tabs"`). */
export function leafKey(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Memoize `build` on a list of dependencies: returns the same node object
 * while every dependency is unchanged (the describe contract asks for this).
 */
export class Memo {
	#deps: readonly unknown[] | undefined;
	#value: NativeNode | undefined;
	get(deps: readonly unknown[], build: () => NativeNode): NativeNode {
		const d = this.#deps;
		if (this.#value && d && d.length === deps.length && d.every((v, i) => Object.is(v, deps[i]))) {
			return this.#value;
		}
		this.#deps = deps;
		this.#value = build();
		return this.#value;
	}
}
