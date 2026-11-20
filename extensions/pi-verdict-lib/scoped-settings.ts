// ============================================================================
// Scoped settings (CF-4, CF-5): the session > local > global > default ladder, the untrusted-local skip,
// scoped reads and writes, and the `verdict_settings get` entry — one module instead of four re-derivations.
// Imported values are read only inside functions: pi-verdict.ts imports this file (import cycle).
// ============================================================================

import {
	agentDirPath,
	isListKey,
	projectConfigHash,
	projectConfigTarget,
	projectRootOf,
	readConfigObject,
	readTrustStore,
	recordTrust,
	trustStateOf,
	userConfigPath,
	writeConfigKey,
	writeSessionOverrides,
} from "../pi-verdict";
import type { EditableListKey, MenuScope, RuleAdditions, RulesLoadReport, SessionKey, SessionMapKey, SessionState, SessionTrust, SettingSource, SettingsToolKey } from "../pi-verdict";

export type Scope = MenuScope;

/** Precedence of a setting's source: session > local > global > default. */
export const SOURCE_RANK: Readonly<Record<SettingSource, number>> = { default: 0, global: 1, local: 2, session: 3 };

export interface ScopedSettingsHost {
	state: SessionState;
	cwd: string;
	sessionId: string;
	/** The session-scoped trust grant (the closure's `sessionTrustedRoot`). */
	trust: { get(): SessionTrust | null; set(t: SessionTrust): void };
}

export interface WriteResult {
	/** Hard failure (file write failed / no project location): nothing was reloaded. */
	error: string | null;
	/** The session file was not persisted (the value still applies in memory). */
	persistError: string | null;
	/** The trust re-record failed (recordTrust error string). */
	trustError: string | null;
	/** Reload report; null only when `error !== null`. */
	report: RulesLoadReport | null;
}

export interface ScopedSettings {
	/** The project config file for this cwd (null: no project location). */
	readonly localFile: string | null;
	/** Is the project config applied by the loader? false when there is no project file. */
	localTrusted(): boolean;
	/** The object stored at a scope: session overrides, or the parsed global / local config ({} when unreadable). */
	stored(scope: Scope): Record<string, unknown>;
	/** This session's additions to one editable list. */
	sessionAdditions(key: EditableListKey): string[];
	/** Scopes `inherit` at `scope` falls through to, nearest first; an untrusted local file is skipped. */
	lowerScopes(scope: Scope): Scope[];
	/** The nearest lower scope storing `key` (with `parse`: a non-null parse of it). */
	inherited<T = unknown>(scope: Scope, key: string, parse?: (raw: unknown) => T | null): { source: Scope; value: T } | null;
	/** The scope whose stored `key` applies: session > trusted local > global; null = default. */
	winner(key: string, parse?: (raw: unknown) => unknown | null): Scope | null;
	/** Persist `value` (`undefined` drops the key) at `scope`, then reload rules. */
	write(scope: Scope, key: string, value: unknown): WriteResult;
	/** Replace this session's additions to one list (`undefined`/empty drops it), then reload rules. */
	writeSessionAdditions(key: EditableListKey, list: string[] | undefined): WriteResult;
	/** The `verdict_settings get` entry of one key (denyPaths redacted: PP-6, ST-4). */
	describe(key: SettingsToolKey): Record<string, unknown>;
}

const plainObject = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Trust the project `root` as its config reads now (`hash`): remembered for this session and persisted with the hash, so a later edit asks again (F3). Returns the persist error, if any. */
export function rememberTrust(host: ScopedSettingsHost, root: string, hash: string | null): string | null {
	if (hash === null) return null;
	host.trust.set({ root, sha256: hash });
	return recordTrust(root, "trusted", hash);
}

export function createScopedSettings(host: ScopedSettingsHost): ScopedSettings {
	const { state } = host;
	const localFile = projectConfigTarget(host.cwd, agentDirPath());
	const localTrusted = (): boolean => localFile !== null && trustStateOf(projectRootOf(localFile), projectConfigHash(localFile), readTrustStore(), host.trust.get()) === "trusted";

	const stored = (scope: Scope): Record<string, unknown> => {
		if (scope === "session") return state.sessionOverrides;
		const loaded = scope === "global" ? readConfigObject(userConfigPath(), "user") : localFile === null ? null : readConfigObject(localFile, "local");
		return loaded === null || "error" in loaded ? {} : loaded.raw;
	};

	const sessionAdditions = (key: EditableListKey): string[] => {
		const existing = state.sessionOverrides.ruleAdditions;
		if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return [];
		const list = (existing as RuleAdditions)[key];
		return Array.isArray(list) ? list : [];
	};

	const lowerScopes = (scope: Scope): Scope[] =>
		(scope === "session" ? (["local", "global"] as Scope[]) : scope === "local" ? (["global"] as Scope[]) : []).filter((s) => s !== "local" || localTrusted());

	const inherited = <T = unknown>(scope: Scope, key: string, parse?: (raw: unknown) => T | null): { source: Scope; value: T } | null => {
		for (const source of lowerScopes(scope)) {
			const raw = stored(source)[key];
			if (parse) {
				const value = parse(raw);
				if (value !== null) return { source, value };
			} else if (raw !== undefined) return { source, value: raw as T };
		}
		return null;
	};

	const winner = (key: string, parse?: (raw: unknown) => unknown | null): Scope | null => {
		for (const s of ["session", "local", "global"] as const) {
			if (s === "local" && !localTrusted()) continue;
			const raw = stored(s)[key];
			if (parse ? parse(raw) !== null : raw !== undefined) return s;
		}
		return null;
	};

	const reload = (): RulesLoadReport => state.reloadRules(host.cwd, host.trust.get());

	const write = (scope: Scope, key: string, value: unknown): WriteResult => {
		if (scope === "session") {
			if (value === undefined) delete state.sessionOverrides[key as SessionKey | SessionMapKey];
			else state.sessionOverrides[key as SessionKey | SessionMapKey] = value;
			const persistError = writeSessionOverrides(host.sessionId, state.sessionOverrides);
			return { error: null, persistError, trustError: null, report: reload() };
		}
		const target = scope === "global" ? { file: userConfigPath(), kind: "user" as const } : localFile === null ? null : { file: localFile, kind: "local" as const };
		if (target === null) return { error: "no project config location here", persistError: null, trustError: null, report: null };
		const wasTrusted = target.kind === "local" && localTrusted();
		const error = writeConfigKey(target.file, target.kind, key, value);
		if (error) return { error, persistError: null, trustError: null, report: null };
		// the user's own edit keeps a trusted project trusted: re-record the hash of what was just written
		const trustError = wasTrusted ? rememberTrust(host, projectRootOf(target.file), projectConfigHash(target.file)) : null;
		return { error: null, persistError: null, trustError, report: reload() };
	};

	const writeSessionAdditions = (key: EditableListKey, list: string[] | undefined): WriteResult => {
		const existing = state.sessionOverrides.ruleAdditions;
		const cur: RuleAdditions = plainObject(existing) !== null ? { ...(existing as RuleAdditions) } : {};
		if (list === undefined || list.length === 0) delete cur[key];
		else cur[key] = list;
		if (Object.keys(cur).length === 0) delete state.sessionOverrides.ruleAdditions;
		else state.sessionOverrides.ruleAdditions = cur;
		const persistError = writeSessionOverrides(host.sessionId, state.sessionOverrides);
		return { error: null, persistError, trustError: null, report: reload() };
	};

	/** Per-id origin of the effective dangerRules / pathRules entries (F-b). */
	const idSources = (key: "dangerRules" | "pathRules"): Record<string, string> => {
		const ids = key === "dangerRules" ? state.userRules.dangerRules.map((r) => r.id) : Object.keys(state.userRules.pathRules);
		const custom = new Set(key === "dangerRules" ? state.userRules.dangerRules.filter((r) => !r.builtin).map((r) => r.id) : []);
		const has = (scope: Scope, id: string): boolean => plainObject(stored(scope)[key])?.[id] !== undefined;
		const local = localTrusted();
		return Object.fromEntries(ids.map((id) => [id, has("session", id) ? "session" : local && has("local", id) ? "local" : has("global", id) ? "global" : custom.has(id) ? "contribution" : "default"]));
	};

	const describe = (key: SettingsToolKey): Record<string, unknown> => {
		const rules = state.userRules as unknown as Record<string, unknown>;
		const redact = (v: unknown) => (key === "denyPaths" && v !== undefined ? (Array.isArray(v) ? { redacted: true, count: v.length } : { redacted: true }) : v);
		let effective: unknown;
		if (key === "allow" || key === "deny") effective = state.userRules[key].map((r) => r.source);
		else if (key === "rules") effective = state.userRules.classifierRules;
		else if (key === "dangerRules") effective = Object.fromEntries(state.userRules.dangerRules.map((r) => [r.id, { action: r.action, reason: r.reason, pattern: r.pattern.source, flags: r.pattern.flags, builtin: r.builtin }]));
		else effective = rules[key];
		const g = redact(stored("global")[key]);
		const l = redact(stored("local")[key]);
		let s: unknown;
		if (isListKey(key)) {
			const add = sessionAdditions(key);
			s = add.length > 0 ? redact(add) : undefined;
		} else s = state.sessionOverrides[key as SessionKey | SessionMapKey];
		const entry: Record<string, unknown> = { key, effective: redact(effective), source: s !== undefined ? "session" : (winner(key) ?? "default") };
		if (g !== undefined) entry.global = g;
		if (l !== undefined) entry.local = l;
		if (s !== undefined) entry.session = s;
		if (key === "dangerRules" || key === "pathRules") entry.sources = idSources(key);
		return entry;
	};

	return { localFile, localTrusted, stored, sessionAdditions, lowerScopes, inherited, winner, write, writeSessionAdditions, describe };
}
