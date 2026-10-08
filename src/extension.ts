/**
 * Entry point. VS Code calls `activate` once per window: it wires the pieces together and registers
 * the commands. All behaviour lives in the Controller.
 */

import { join } from 'node:path';
import * as vscode from 'vscode';
import { Controller } from './controller';
import { WorkspaceEnablement } from './vscode/enablement';
import { resolvePaths } from './vscode/paths';
import { StateStore } from './vscode/state';

let controller: Controller | undefined;

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Auto Disable Extensions', { log: true });
	context.subscriptions.push(output);
	const selfId = context.extension.id.toLowerCase();

	const paths = resolvePaths({
		globalStoragePath: context.globalStorageUri.fsPath,
		extensionPath: context.extensionPath,
	});
	output.info(`user data: ${paths.userDataDir} | extensions: ${paths.extensionsDir}`);

	// Shared by all windows: this extension's globalStorage folder.
	const store = new StateStore(join(context.globalStorageUri.fsPath, 'state.json'));
	controller = new Controller(paths, WorkspaceEnablement.from(context.workspaceState), store, selfId, output);
	context.subscriptions.push(controller);

	const commands: Record<string, () => unknown> = {
		'autoDisableExtensions.menu': () => controller?.menu(),
		'autoDisableExtensions.apply': () => controller?.apply(),
		'autoDisableExtensions.redetect': () => controller?.redetect(),
		'autoDisableExtensions.showReport': () => controller?.showReport(),
		'autoDisableExtensions.revert': () => controller?.revert(),
	};
	for (const [id, run] of Object.entries(commands)) {
		context.subscriptions.push(vscode.commands.registerCommand(id, run));
	}

	controller.start().catch(err => output.error(`startup failed: ${err instanceof Error ? err.stack : String(err)}`));
}

export function deactivate(): void {
	controller = undefined;
}
