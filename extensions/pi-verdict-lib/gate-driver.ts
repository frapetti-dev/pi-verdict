// ============================================================================
// Gate driver (PR-1, PR-2, PR-3, PR-7, AU-3): the per-session handling of one tool call from adjudication to its
// presented outcome: the verdict, the ask dialog or block, the audit record and the verdict label.
// Imported values are read only inside functions: pi-verdict.ts imports this file (import cycle).
// ============================================================================

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseJevReason } from "../jev-adapter";
import {
	adjudicate,
	blockedReason,
	confirmAsk,
	declineDetail,
	EXEC_GATED_TOOL_NAME,
	GATED_TOOL_HINT,
	grantInvitationText,
	resolveAskWithoutHuman,
	showStatusRow,
	STATUS_WIDGET_KEY,
	subagentIdentity,
	subagentLabel,
	verdictLabelFor,
} from "../pi-verdict";
import type { AdjudicateEnv, AuditRecord, ExplainGateResult, SessionState, UiContext, Verdict, VerdictLabel } from "../pi-verdict";

export type GateCall = { toolName: string; input: Record<string, unknown> };
export type GateBlock = { block: true; reason: string };

/** What the driver needs from one `autoMode` instance; everything UI-shaped goes through `ExtensionContext.ui` (`UiContext`). */
export interface GateDriverHost {
	state: SessionState;
	isDebug(): boolean;
	pipelineEnv(ctx: ExtensionContext): AdjudicateEnv;
	refreshStatus(ctx: ExtensionContext): void;
	explainAsk(ctx: ExtensionContext, call: GateCall, action: string, reasonLine: string, question: string | null): Promise<ExplainGateResult>;
	describeAction(toolName: string, input: Record<string, unknown>): string;
	/** The root session's UI, published at module level so subagent sessions (which re-run the factory) can reach it. */
	rootUi(): UiContext | null;
}

export interface GateDriver {
	/** The gate for one tool call: adjudicate, present, audit, label. `undefined` = allowed (or the gate is off for this session/subagent). */
	gateCall(call: GateCall, ctx: ExtensionContext, callId?: string, extra?: { files: readonly string[]; explanation: string | null }, out?: { verdict?: Verdict }): Promise<GateBlock | undefined>;
}

export function createGateDriver(host: GateDriverHost): GateDriver {
	const { state } = host;
	const isDebug = (): boolean => host.isDebug();
	const refreshStatus = (ctx: ExtensionContext): void => host.refreshStatus(ctx);
	const explainAsk = host.explainAsk;
	const describeAction = host.describeAction;
	const pipelineEnv = host.pipelineEnv;

	/** PR-9: store a remembered approval; tool name only in the notification (PP-6). */
	function rememberApproval(key: string, toolName: string, ctx: ExtensionContext, note: (m: string, l: "info") => void): void {
		state.rememberApproval(key);
		note(`🛡️ approval remembered: identical ${toolName} calls run without asking for the rest of this session (/automode forget)`, "info");
		if (!subagentIdentity(ctx)) refreshStatus(ctx);
	}

	/** Verdict -> UI (this extension's single verdict presentation point): look up the template by source x degraded, text is
	 *  byte-identical to before the refactor. Notifications on the protected-path branch never carry path plaintext or the action line
	 *  (PP-6: notifications and block reason flow back into the agent context). */
	async function presentVerdict(v: Verdict, call: { toolName: string; input: Record<string, unknown> }, action: string, ui: UiContext, opts: { label: string | null; signal?: AbortSignal; ctx: ExtensionContext; callId?: string }): Promise<{ block: true; reason: string } | undefined | "aborted"> {
		const note = (msg: string, level: "info" | "warning" | "error"): void => ui.notify(opts.label ? msg.replace(/^🛡️ /u, `🛡️ [${opts.label}] `) : msg, level);
		const titled = (t: string): string => (opts.label ? t.replace(/^🛡️ /u, `🛡️ [${opts.label}] `) : t);
		// PR-10: root sessions only (subagents cannot call verdict_grant); without a call id the invitation cannot be delivered
		const invite = v.approvalKey !== undefined && opts.label === null && opts.callId !== undefined;
		const noteInvite = (d: { allow: boolean; invite?: true }): void => {
			if (d.allow && d.invite && opts.callId !== undefined) state.noteInvite(opts.callId, grantInvitationText(call.toolName, v.grantScope ?? { rules: [], paths: false }));
		};
		if (v.verdict === "allow") {
			if (v.remembered) {
				// PR-9: silent like mechanical allows (PR-3); no action line for gate hits (PP-6)
				if (isDebug()) note(v.source === "protected-path" ? "🛡️ allow (remembered approval)" : `🛡️ allow (remembered approval): ${action}`, "info");
				return undefined;
			}
			// #60 (CONTEXT.md notifications entry): classifier allows surface via notifyAllows OR
			// debug — exactly one notification either way; the shadow suffix stays
			// debug-only; mechanical passes (rule echo, protected-path confirm) stay
			// debug-only — notifications carry judgment, the audit log carries completeness
			if (isDebug()) {
				if (v.source === "rule") note(`🛡️ allow (rule): ${action}`, "info");
				else if (v.source === "protected-path") note("🛡️ allow (protected-path confirm)", "info");
				else note(`🛡️ allow (classifier): ${v.reason}\n  ${action}${v.shadow ? " " + v.shadow : ""}`, "info");
			} else if (state.userRules.notifyAllows && v.source === "classifier") {
				note(`🛡️ allow (classifier): ${v.reason}\n  ${action}`, "info");
			}
			return undefined;
		}
		if (v.verdict === "deny") {
			if (v.retry) {
				note(`🛡️ Auto Mode (unattended) blocked — needs justification: ${v.reason}\n  ${action}${isDebug() && v.shadow ? " " + v.shadow : ""}`, "warning");
				return { block: true, reason: blockedReason("unattended-retry", v.reason) };
			}
			if (v.source === "protected-path" && !v.degraded) {
				// unattended: no action line and no detail — the path plaintext must not reach notifications or the agent (PP-6)
				note(`🛡️ Auto Mode (unattended) blocked protected-path access: ${v.reason}`, "warning");
				return { block: true, reason: blockedReason("protected-path", `unattended mode denies protected-path access: ${v.reason}`) };
			}
			if (v.source === "protected-path") {
				// No action line: the action string may embed the touched path, notifications must not carry protected-path plaintext
				note(`🛡️ Auto Mode blocked (non-interactive, protected-path ask→deny): ${v.reason}`, "warning");
				return { block: true, reason: blockedReason("protected-path", `ask degraded to block in non-interactive mode: ${v.reason}`) };
			}
			if (v.source === "fail-closed") {
				note(`🛡️ Auto Mode blocked: ${v.reason}\n  ${action}`, "warning");
				return { block: true, reason: blockedReason("fail-closed", v.reason) };
			}
			if (v.source === "rule") {
				note(`🛡️ Auto Mode blocked: ${v.reason}\n  ${action}`, "warning");
				return { block: true, reason: blockedReason("rule", v.degraded ? `ask degraded to block in non-interactive mode: ${v.reason}` : v.reason, v.grantable === true) };
			}
			note(`🛡️ Auto Mode blocked: ${v.reason}\n  ${action}${isDebug() && v.shadow ? " " + v.shadow : ""}`, "warning");
			return { block: true, reason: blockedReason("classifier", v.reason + (v.missingContext ? GATED_TOOL_HINT : "")) };
		}
		// ask -> human confirmation; non-interactive was already downgraded inside the pipeline, reaching here implies a UI exists
		if (v.source === "protected-path") {
			// no EXPLAIN-GATE here: the protected path plaintext must not reach a model provider (PP-9)
			const d = await confirmAsk(ui, {
				title: titled("🛡️ Auto Mode: protected path"),
				toolName: call.toolName,
				input: call.input,
				action,
				reasonLine: v.reason,
				detail: v.detail ?? "(see pi-verdict.json)",
				question: "Allow this access?",
				remember: v.approvalKey !== undefined,
				invite,
				jev: null,
				minConfidence: null,
				nerdFont: state.userRules.footer === "full",
				fallbackMessage: `${action}\n\n${v.reason}\n\nProtected path: ${v.detail ?? "(see pi-verdict.json)"}\n\nAllow this access?`,
			}, { signal: opts.signal });
			if (d === "aborted") return "aborted";
			if (d.allow && d.remember && v.approvalKey) rememberApproval(v.approvalKey, call.toolName, opts.ctx, note);
			noteInvite(d);
			if (d.allow) {
				// debug notify carries no action line: same as above, notifications must not carry protected-path plaintext
				if (isDebug()) note("🛡️ allow (protected-path confirm)", "info");
				return undefined;
			}
			return { block: true, reason: blockedReason("user-declined", declineDetail("user declined protected-path access", d.reason)) };
		}
		const label = v.source === "rule" ? "Rule" : v.source === "fail-closed" ? "Fail-closed" : "Classifier opinion";
		const reasonLine = `${label}: ${v.reason}`;
		const d = await confirmAsk(ui, {
			title: titled("🛡️ Auto Mode confirmation"),
			toolName: call.toolName,
			input: call.input,
			action,
			reasonLine,
			question: "Allow execution?",
			...(v.files ? { files: v.files } : {}),
			remember: v.approvalKey !== undefined,
			invite,
			jev: v.source === "classifier" ? parseJevReason(v.reason) : null,
			minConfidence: state.userRules.confidenceThreshold,
			nerdFont: state.userRules.footer === "full",
			fallbackMessage: `${action}\n\n${label}: ${v.reason}\n\nAllow execution?`,
		}, { signal: opts.signal, ...(v.noExplain ? {} : { explain: (question: string | null) => explainAsk(opts.ctx, call, action, reasonLine, question) }) });
		if (d === "aborted") return "aborted";
		if (d.allow && d.remember && v.approvalKey) rememberApproval(v.approvalKey, call.toolName, opts.ctx, note);
		noteInvite(d);
		return d.allow ? undefined : { block: true, reason: blockedReason("user-declined", declineDetail("user declined", d.reason) + (v.missingContext ? GATED_TOOL_HINT : "")) };
	}

	/** The gate for one tool call: adjudicate, present, audit, label. Shared by the `tool_call` hook and `execute_gated_tool` (which passes `extra` and reads the final verdict back through `out`). `undefined` = allowed (or the gate is off for this session/subagent). */
	async function gateCall(
		call: { toolName: string; input: Record<string, unknown> },
		ctx: ExtensionContext,
		callId: string | undefined,
		extra?: { files: readonly string[]; explanation: string | null },
		out?: { verdict?: Verdict },
	): Promise<{ block: true; reason: string } | undefined> {
		if (state.userRules.mode === "off") return undefined;

		const sub = subagentIdentity(ctx);
		const mode = state.userRules.subagentGate;
		if (sub && mode === "off") return undefined;
		const label = sub ? subagentLabel(sub) : null;
		// A subagent with its own UI (not produced by omp today) uses it; otherwise the root UI, else none
		const ui: UiContext | null = !sub || ctx.hasUI ? ctx.ui : host.rootUi();

		const input = call.input;
		const action = describeAction(call.toolName, input);
		// The wrapper (only caller passing `extra`) is labelled by its own name: the wrapped tool has not run yet, so "bash allowed" would be premature.
		const labelTool = extra ? EXEC_GATED_TOOL_NAME : call.toolName;
		const noteAllowed = (label: VerdictLabel): void => {
			if (callId !== undefined) state.noteLabel(callId, label);
		};
		const allowedHow = (v: Verdict): VerdictLabel["how"] => (v.cleared ? "cleared" : v.remembered ? "remembered" : v.verdict === "ask" ? "user" : v.source === "classifier" ? "classifier" : "rule");

		// Live status (root session + UI only): one widget row above the editor while a model call runs.
		// Text is phase + tool name + model id only; never command or path text (PP-6).
		const statusUi = !sub && ctx.hasUI && typeof ctx.ui.setWidget === "function" ? ctx.ui : null;
		let statusShown = false;
		const onPhase = statusUi
			? (phase: "classifier" | "fallback", modelId: string): void => {
					statusShown = true;
					const text = phase === "classifier" ? `classifying ${call.toolName} via ${modelId}…` : `fallback classifier ${modelId} on ${call.toolName}…`;
					showStatusRow(statusUi, text, true);
				}
			: undefined;

		// Adjudication pipeline (zero UI) -> presentation (source x degraded template)
		const env: AdjudicateEnv = {
			...pipelineEnv(ctx),
			// a subagent's asks are resolved by the bridge (root UI / second model), never degraded in the pipeline
			hasUI: sub ? true : !!ctx.hasUI,
			...(onPhase ? { onPhase } : {}),
		};
		let verdict: Verdict;
		try {
			verdict = await adjudicate(state, call, env, extra);
		} finally {
			if (statusShown) statusUi?.setWidget(STATUS_WIDGET_KEY, undefined);
		}
		if (out) out.verdict = verdict;
		if (!sub) {
			state.verdictCounts[verdict.verdict]++;
			refreshStatus(ctx);
		}
		const warn = (msg: string): void => (ui ?? ctx.ui).notify(label && !msg.startsWith("🛡️") ? `[${label}] ${msg}` : msg, "warning");
		const auditWarning = state.audit?.drainWarning(); // #54: fail-soft one-shot warning
		if (auditWarning) warn(`pi-verdict: ${auditWarning}`);
		// #62: an interactive ask's record is finalized here — exactly one append after the
		// confirm, carrying the user's answer; a presentVerdict throw still lands the record
		// (without the answer) and the error propagates unchanged. `undefined` = allowed.
		const finalize = (extra: Partial<AuditRecord>): void => {
			if (!verdict.pendingAudit) return;
			state.audit?.append({ ...verdict.pendingAudit, ...extra });
			verdict.pendingAudit = undefined;
			const lateWarning = state.audit?.drainWarning();
			if (lateWarning) warn(`pi-verdict: ${lateWarning}`);
		};
		type Presented = { block: true; reason: string } | undefined | "aborted";
		const present = async (signal?: AbortSignal): Promise<Presented> => {
			try {
				return await presentVerdict(verdict, call, action, ui ?? ctx.ui, { label, signal, ctx, callId });
			} catch (err) {
				if (verdict.pendingAudit) state.audit?.append(verdict.pendingAudit);
				throw err;
			}
		};
		const answerAudit = (presented: { block: true; reason: string } | undefined): Partial<AuditRecord> => ({
			userAnswer: presented === undefined ? "allowed" : "declined",
			answeredAt: new Date().toISOString(),
		});

		// Root session (and pi): unchanged behavior; no signal is passed, so "aborted" cannot occur
		if (!sub) {
			// the awaiting row names the tool only (never command or path text, PP-6)
			const awaiting = verdict.verdict === "ask" && statusUi !== null;
			if (awaiting) showStatusRow(statusUi, `awaiting your approval · ${call.toolName}`, false);
			let r: Presented;
			try {
				r = await present();
			} finally {
				if (awaiting) statusUi.setWidget(STATUS_WIDGET_KEY, undefined);
			}
			const presented = r === "aborted" ? { block: true as const, reason: blockedReason("user-declined", "user declined") } : r;
			finalize(answerAudit(presented));
			if (presented === undefined) noteAllowed(verdictLabelFor(labelTool, allowedHow(verdict), verdict.reason));
			return presented;
		}

		if (verdict.verdict !== "ask") {
			const r = await present();
			if (r === undefined) noteAllowed(verdictLabelFor(labelTool, allowedHow(verdict), verdict.reason));
			return r === "aborted" ? undefined : r;
		}

		// Subagent ask resolved with no human answer: second model (only an explicit allow permits)
		const finishWithoutHuman = async (resolution: "timeout" | "auto"): Promise<{ block: true; reason: string } | undefined> => {
			const res = await resolveAskWithoutHuman(state, env, verdict, action);
			finalize({ subagent: { ...sub, resolution }, ...(res.fb ? { fallback: res.fb } : {}) });
			const notify = (ui ?? ctx.ui).notify.bind(ui ?? ctx.ui);
			if (res.verdict === "allow") {
				if (isDebug() || state.userRules.notifyAllows) notify(`🛡️ [${label}] allow (second model, no human): ${res.reason}\n  ${action}`, "info");
				noteAllowed(verdictLabelFor(labelTool, "second-model", res.reason));
				return undefined;
			}
			// no path plaintext in notifications (PP-6): protected-path asks omit the action line
			notify(`🛡️ [${label}] Auto Mode blocked (subagent ask, no human): ${res.reason}${verdict.source === "protected-path" ? "" : `\n  ${action}`}`, "warning");
			return { block: true, reason: blockedReason("subagent-auto", res.reason) };
		};

		if (mode === "normal" && ui !== null) {
			const deadline = AbortSignal.timeout(state.userRules.subagentAskTimeoutMs);
			const signal = ctx.signal ? AbortSignal.any([deadline, ctx.signal]) : deadline;
			const r = await present(signal);
			if (r !== "aborted") {
				finalize({ ...answerAudit(r), subagent: { ...sub, resolution: "human" } });
				if (r === undefined) noteAllowed(verdictLabelFor(labelTool, "user", verdict.reason));
				return r;
			}
			if (ctx.signal?.aborted) {
				finalize({ subagent: { ...sub, resolution: "timeout" } });
				return { block: true, reason: blockedReason("subagent-cancelled", "subagent run was cancelled while awaiting approval") };
			}
			return finishWithoutHuman("timeout");
		}
		return finishWithoutHuman("auto");
	}

	return { gateCall };
}
