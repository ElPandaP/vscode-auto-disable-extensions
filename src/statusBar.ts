/**
 * The ⚡ status bar item: shows the detected technologies and whether the workspace's extensions are
 * up to date. Clicking it opens the menu.
 */

import * as vscode from 'vscode';

export type StatusKind = 'active' | 'pending' | 'notApplied' | 'ignored' | 'unsupported';

export interface StatusInfo {
	kind: StatusKind;
	techs: string[];
	/** Extensions this extension disabled in the workspace. */
	disabled: number;
}

const ICONS: Record<StatusKind, string> = {
	active: '$(zap)',
	pending: '$(zap)',
	notApplied: '$(zap)',
	ignored: '$(debug-pause)',
	unsupported: '$(warning)',
};

const SUFFIX: Record<StatusKind, string> = {
	active: '',
	pending: ' $(sync)',
	notApplied: ' (not applied)',
	ignored: '',
	unsupported: '',
};

const NOTES: Record<StatusKind, string> = {
	active: 'Extensions are up to date for this workspace.',
	pending: 'The workspace changed. Click to update its extensions (the window reloads).',
	notApplied: 'Click to disable the extensions this workspace does not need (the window reloads).',
	ignored: 'Auto Disable Extensions is paused for this workspace.',
	unsupported: 'This VS Code version does not allow changing extensions this way. Detection still works.',
};

export class StatusBar implements vscode.Disposable {
	private readonly item = vscode.window.createStatusBarItem('autoDisableExtensions.status', vscode.StatusBarAlignment.Left, 50);

	constructor() {
		this.item.name = 'Auto Disable Extensions';
		this.item.command = 'autoDisableExtensions.menu';
	}

	show(info: StatusInfo): void {
		const techs = info.techs.length > 0 ? info.techs.join(' · ') : 'Auto Disable Extensions';
		this.item.text = `${ICONS[info.kind]} ${techs}${SUFFIX[info.kind]}`;

		const tip = new vscode.MarkdownString(undefined, true);
		tip.appendMarkdown(`**Auto Disable Extensions**\n\n`);
		tip.appendMarkdown(`Detected: ${info.techs.length > 0 ? info.techs.join(', ') : 'nothing specific'}\n\n`);
		if (info.disabled > 0) {
			tip.appendMarkdown(`${info.disabled} extension(s) auto-disabled in this workspace.\n\n`);
		}
		tip.appendMarkdown(NOTES[info.kind]);
		if (info.disabled > 0) {
			tip.appendMarkdown('\n\nThey show as "Disabled (Workspace)" in the Extensions view. '
				+ 'Enabling one there is remembered for this workspace.');
		}
		this.item.tooltip = tip;
		this.item.show();
	}

	hide(): void {
		this.item.hide();
	}

	dispose(): void {
		this.item.dispose();
	}
}
