/**
 * Runs the extension in one window: detects the workspace, works out which extensions it needs,
 * decides whether to ask or apply, and writes the result to VS Code's workspace enablement (then
 * reloads the window). Also implements the commands and the status bar menu.
 */

import * as vscode from 'vscode';
import type { Detection, InstalledExtension, Plan } from './types';
import { buildLanguageIndex, type LanguageIndex } from './detect/languages';
import { detect } from './detect/detector';
import { scanWorkspace } from './vscode/scanner';
import { isManifest } from './detect/manifests';
import { nextDisabledList, reenabledByUser, type WorkspaceEnablement } from './vscode/enablement';
import type { HostPaths } from './vscode/paths';
import { readInstalledExtensions } from './vscode/inventory';
import { dependedOn, plan as makePlan, toDisable } from './resolve/planner';
import type { ClassifyContext } from './resolve/classify';
import { extensionReport } from './resolve/report';
import { normalizeUserRules, PROJECT_HINTS } from './resolve/hints';
import { withRule } from './resolve/overrides';
import type { StateStore, WorkspaceState } from './vscode/state';
import { StatusBar, type StatusKind } from './statusBar';

const RETRY_GUARD_MS = 2 * 60_000;
const REDETECT_DEBOUNCE_MS = 2_000;

type Mode = 'ask' | 'auto' | 'off';

function config() {
	const c = vscode.workspace.getConfiguration('autoDisableExtensions');
	return {
		mode: c.get<Mode>('mode', 'ask'),
		userRules: normalizeUserRules(c.get('extensions')),
		scanExclude: c.get<string[]>('scanExclude', []),
	};
}

/** Key identifying the workspace: its folder or `.code-workspace` URI. */
export function workspaceKey(): string | undefined {
	const file = vscode.workspace.workspaceFile;
	if (file) {
		return file.scheme === 'file' ? file.toString() : undefined;
	}
	const folders = vscode.workspace.workspaceFolders ?? [];
	return folders.length === 1 && folders[0]!.uri.scheme === 'file' ? folders[0]!.uri.toString() : undefined;
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export class Controller implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly status = new StatusBar();
	private key: string | undefined;
	private inventory: InstalledExtension[] = [];
	private index: LanguageIndex = buildLanguageIndex([]);
	private detection: Detection | undefined;
	private plan: Plan | undefined;
	private ctx: ClassifyContext | undefined;
	private redetectTimer: NodeJS.Timeout | undefined;

	constructor(
		private readonly paths: HostPaths,
		private readonly enablement: WorkspaceEnablement | undefined,
		private readonly store: StateStore,
		private readonly selfId: string,
		private readonly output: vscode.LogOutputChannel,
	) {
		this.disposables.push(this.status);
	}

	// ---------------------------------------------------------------- startup

	async start(): Promise<void> {
		this.key = workspaceKey();
		if (!this.key) {
			return;
		}
		if (!this.enablement) {
			this.output.warn('this VS Code version does not allow changing extension enablement; detection only');
		}
		await this.refresh();
		await this.syncUserToggles();
		this.watchWorkspace();
		this.watchExtensionChanges();
		await this.decideOnOpen();
	}

	// ---------------------------------------------------------------- detection

	private async refresh(): Promise<void> {
		const cfg = config();
		const globallyDisabled = new Set(await this.enablement?.globallyDisabled().catch(() => []) ?? []);
		// Extensions the user disabled everywhere are off anyway; they are not managed.
		this.inventory = (await readInstalledExtensions(this.paths).catch(() => [])).filter(e => !globallyDisabled.has(e.id));

		const builtin = vscode.extensions.all.filter(e => e.packageJSON?.isBuiltin || e.id.startsWith('vscode.'));
		this.index = buildLanguageIndex([...builtin.map(e => e.packageJSON), ...this.inventory.map(e => e.manifest)]);

		const scan = await scanWorkspace(cfg.scanExclude);
		if (scan.truncated) {
			this.output.warn('workspace has too many files; detection used a partial file list');
		}
		this.detection = detect(scan.folders, scan.deps, this.index, scan.fencedLanguages);

		const ws = this.key ? await this.store.workspace(this.key) : {};
		this.ctx = {
			index: this.index,
			dependedOn: dependedOn(this.inventory),
			hints: PROJECT_HINTS,
			userRules: cfg.userRules,
		};
		this.plan = makePlan(this.inventory, this.detection, this.ctx, ws);
		this.output.info(`detected: ${this.detection.techs.join(', ') || '-'} | languages: ${this.detection.languages.join(', ')} | needs ${this.plan.extensions.length}, disables ${this.wanted().length}`);
		await this.updateStatus();
	}

	private hasSignal(): boolean {
		return !!this.detection && (this.detection.languages.length > 0 || this.detection.deps.length > 0);
	}

	/** Ids the plan wants disabled here. */
	private wanted(): string[] {
		return this.plan ? toDisable(this.inventory, this.plan).filter(id => id !== this.selfId) : [];
	}

	/** Auto-disabled ids that still run: written, but the window has not reloaded yet. */
	private notYetReloaded(owned: string[]): string[] {
		const running = new Set(vscode.extensions.all.map(e => e.id.toLowerCase()));
		return owned.filter(id => running.has(id));
	}

	/** Whether applying would change anything. */
	private async needsChange(): Promise<boolean> {
		if (!this.key || !this.plan || !this.hasSignal()) {
			return false;
		}
		const ws = await this.store.workspace(this.key);
		if (ws.ignored) {
			return false;
		}
		const current = await this.enablement?.workspaceDisabled() ?? [];
		const { owned } = nextDisabledList(current, ws.disabledByUs ?? [], this.wanted());
		return !sameSet(owned, ws.disabledByUs ?? []) || this.notYetReloaded(owned).length > 0;
	}

	private async updateStatus(): Promise<void> {
		if (!this.key || !this.detection || !this.plan) {
			this.status.hide();
			return;
		}
		const ws = await this.store.workspace(this.key);
		let kind: StatusKind;
		if (!this.enablement) {
			kind = 'unsupported';
		} else if (ws.ignored) {
			kind = 'ignored';
		} else if (await this.needsChange()) {
			kind = (ws.disabledByUs?.length ?? 0) > 0 ? 'pending' : 'notApplied';
		} else {
			kind = 'active';
		}
		this.status.show({
			kind,
			techs: this.detection.techs,
			disabled: ws.disabledByUs?.length ?? 0,
		});
	}

	private watchWorkspace(): void {
		// Only files that can change the result: new languages appear as new files, deps in manifests.
		const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, false, false);
		const exclude = new Set(config().scanExclude);
		const onEvent = (uri: vscode.Uri, isChange: boolean) => {
			const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			if (rel.split('/').some(part => exclude.has(part))) {
				return;
			}
			if (isChange && !isManifest(rel)) {
				return;
			}
			clearTimeout(this.redetectTimer);
			this.redetectTimer = setTimeout(() => this.refresh().catch(err => this.output.error(String(err))), REDETECT_DEBOUNCE_MS);
		};
		this.disposables.push(
			watcher,
			watcher.onDidCreate(uri => onEvent(uri, false)),
			watcher.onDidDelete(uri => onEvent(uri, false)),
			watcher.onDidChange(uri => onEvent(uri, true)),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('autoDisableExtensions')) {
					this.refresh().catch(err => this.output.error(String(err)));
				}
			}),
		);
	}

	/** Installs, uninstalls and the user's own enable/disable clicks all show up here. */
	private watchExtensionChanges(): void {
		this.disposables.push(vscode.extensions.onDidChange(() => {
			this.syncUserToggles()
				.then(() => this.refresh())
				.catch(err => this.output.error(String(err)));
		}));
	}

	/**
	 * "Enable (Workspace)" on an auto-disabled extension means "I want it here": remember it as
	 * an include rule, or the next apply would disable it again.
	 */
	private async syncUserToggles(): Promise<void> {
		if (!this.key || !this.enablement) {
			return;
		}
		const key = this.key;
		const ws = await this.store.workspace(key);
		const reenabled = reenabledByUser(await this.enablement.workspaceDisabled(), ws.disabledByUs ?? []);
		if (reenabled.length === 0) {
			return;
		}
		this.output.info(`re-enabled by the user here: ${reenabled.join(', ')}`);
		await this.store.updateWorkspace(key, w => {
			Object.assign(w, withRule(w, 'include', reenabled));
			w.disabledByUs = (w.disabledByUs ?? []).filter(id => !reenabled.includes(id));
		});
		vscode.window.setStatusBarMessage(`$(zap) ${reenabled.join(', ')} will stay enabled in this workspace`, 6000);
		await this.refresh();
	}

	// ---------------------------------------------------------------- decisions

	private async decideOnOpen(): Promise<void> {
		if (!this.key || !this.plan || !this.enablement || !(await this.needsChange())) {
			return;
		}
		const ws = await this.store.workspace(this.key);
		if (ws.lastAttempt?.hash === this.plan.hash && Date.now() - ws.lastAttempt.at < RETRY_GUARD_MS) {
			this.output.warn('applied moments ago but the result does not match; not retrying');
			return;
		}
		const mode = config().mode;
		if (mode === 'auto') {
			await this.apply();
		} else if (mode === 'ask') {
			await this.promptApply();
		}
	}

	private async promptApply(): Promise<void> {
		if (!this.plan || !this.detection || !this.key) {
			return;
		}
		const wanted = this.wanted();
		const ws = await this.store.workspace(this.key);
		const enabling = (ws.disabledByUs ?? []).filter(id => !wanted.includes(id));
		const disabling = wanted.filter(id => !(ws.disabledByUs ?? []).includes(id));
		const changes = [
			disabling.length > 0 ? `disable ${disabling.length} extension(s) it does not need` : '',
			enabling.length > 0 ? `enable ${enabling.length} it needs now` : '',
		].filter(Boolean).join(' and ') || 'finish applying its extensions';
		const message = `Detected ${this.detection.techs.join(' + ') || 'this project'}: ${changes} for this workspace? The window reloads.`;
		this.output.info(`prompt: ${message}`);
		// Three short labels: VS Code truncates buttons when a toast has more. Closing it means "not now".
		const choice = await vscode.window.showInformationMessage(message, 'Apply', 'Always Apply', 'Never Here');
		this.output.info(`prompt answer: ${choice ?? '(dismissed)'}`);
		switch (choice) {
			case 'Always Apply':
				await vscode.workspace.getConfiguration('autoDisableExtensions').update('mode', 'auto', vscode.ConfigurationTarget.Global);
			// fall through
			case 'Apply':
				await this.apply();
				break;
			case 'Never Here':
				await this.store.updateWorkspace(this.key, w => (w.ignored = true));
				await this.updateStatus();
				break;
		}
	}

	// ---------------------------------------------------------------- actions

	private unsupported(): boolean {
		if (this.enablement) {
			return false;
		}
		void vscode.window.showErrorMessage('Auto Disable Extensions cannot change extensions in this VS Code version. Detection and the report still work.');
		return true;
	}

	/** Writes this workspace's disabled list and reloads the window when it changed. */
	private async writeAndReload(wanted: string[], extra: (w: WorkspaceState) => void): Promise<void> {
		if (!this.key || !this.enablement) {
			return;
		}
		const key = this.key;
		const ws = await this.store.workspace(key);
		const change = nextDisabledList(await this.enablement.workspaceDisabled(), ws.disabledByUs ?? [], wanted);
		await this.enablement.setWorkspaceDisabled(change.list);
		await this.store.updateWorkspace(key, w => {
			w.disabledByUs = change.owned;
			extra(w);
		});
		const stillRunning = this.notYetReloaded(change.owned);
		const reEnabled = (ws.disabledByUs ?? []).filter(id => !change.owned.includes(id));
		this.output.info(`auto-disabled here: [${change.owned.join(', ')}]`);
		if (stillRunning.length > 0 || reEnabled.length > 0) {
			this.output.info('reloading the window');
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		} else {
			await this.updateStatus();
		}
	}

	async apply(): Promise<void> {
		if (!this.key || !this.plan || this.unsupported()) {
			return;
		}
		const hash = this.plan.hash;
		await this.writeAndReload(this.wanted(), w => {
			w.ignored = false;
			w.lastAttempt = { hash, at: Date.now() };
		});
	}

	/** Re-enables everything auto-disabled here and pauses for this workspace. */
	async revert(): Promise<void> {
		if (!this.key || this.unsupported()) {
			return;
		}
		await this.writeAndReload([], w => (w.ignored = true));
		void vscode.window.showInformationMessage('Auto Disable Extensions is paused for this workspace; all your extensions are enabled.');
	}

	async resetWorkspace(): Promise<void> {
		if (!this.key) {
			return;
		}
		await this.store.updateWorkspace(this.key, w => {
			delete w.ignored;
			delete w.include;
			delete w.exclude;
			delete w.lastAttempt;
		});
		await this.refresh();
		await this.decideOnOpen();
	}

	async redetect(): Promise<void> {
		await this.refresh();
		if (await this.needsChange()) {
			await this.promptApply();
		} else {
			void vscode.window.showInformationMessage(`Auto Disable Extensions: ${this.detection?.techs.join(', ') || 'nothing specific'} detected. Extensions are up to date.`);
		}
	}

	async pickExtensionRule(kind: 'include' | 'exclude'): Promise<void> {
		if (!this.key || !this.plan) {
			return;
		}
		const planned = new Set(this.plan.extensions.map(e => e.id));
		const candidates = this.inventory
			.filter(e => !e.isApplicationScoped && e.id !== this.selfId && (kind === 'include' ? !planned.has(e.id) : planned.has(e.id)))
			.map(e => ({ label: e.manifest.displayName ?? e.id, description: e.id, id: e.id }));
		const picked = await vscode.window.showQuickPick(candidates, {
			canPickMany: true,
			placeHolder: kind === 'include' ? 'Extensions to keep enabled in this workspace' : 'Extensions to disable in this workspace',
		});
		if (!picked?.length) {
			return;
		}
		const ids = picked.map(p => p.id);
		await this.store.updateWorkspace(this.key, w => Object.assign(w, withRule(w, kind, ids)));
		await this.refresh();
		await this.apply();
	}

	/** Opens a Markdown table of every extension: type, triggers, and whether this workspace needs it. */
	async showReport(): Promise<void> {
		if (!this.key || !this.detection || !this.plan || !this.ctx) {
			void vscode.window.showInformationMessage('Auto Disable Extensions: open a folder to see which extensions it needs.');
			return;
		}
		const content = extensionReport({
			workspace: vscode.workspace.name ?? this.key,
			installed: this.inventory,
			detection: this.detection,
			plan: this.plan,
			ctx: this.ctx,
		});
		const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
		await vscode.commands.executeCommand('markdown.showPreview', doc.uri);
	}

	async menu(): Promise<void> {
		const ws = this.key ? await this.store.workspace(this.key) : {};
		const items: (vscode.QuickPickItem & { run: () => unknown })[] = [];
		if (await this.needsChange()) {
			items.push({ label: '$(zap) Apply (reloads the window)', run: () => this.apply() });
		}
		items.push(
			{ label: '$(table) Extension Report', run: () => this.showReport() },
			{ label: '$(refresh) Re-detect Technologies', run: () => this.redetect() },
		);
		items.push(
			{ label: '$(add) Keep an Extension Enabled Here…', run: () => this.pickExtensionRule('include') },
			{ label: '$(remove) Disable an Extension Here…', run: () => this.pickExtensionRule('exclude') },
		);
		if ((ws.disabledByUs?.length ?? 0) > 0) {
			items.push({ label: '$(discard) Enable All Extensions Here', run: () => this.revert() });
		}
		items.push(
			{ label: '$(debug-restart) Reset This Workspace', run: () => this.resetWorkspace() },
			{ label: '$(gear) Settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'autoDisableExtensions') },
		);
		const picked = await vscode.window.showQuickPick(items, { placeHolder: `Auto Disable Extensions — ${this.detection?.techs.join(', ') || 'no technologies detected'}` });
		await picked?.run();
	}

	dispose(): void {
		clearTimeout(this.redetectTimer);
		this.disposables.forEach(d => d.dispose());
	}
}
