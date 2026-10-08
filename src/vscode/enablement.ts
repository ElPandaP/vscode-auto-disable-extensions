/**
 * Reads and writes VS Code's own "Disable (Workspace)" list, and computes the next list without
 * touching the entries the user added.
 */

import type * as vscode from 'vscode';

/** Storage key VS Code uses for "Disable (Workspace)" (workspace scope) and "Disable" (profile scope). */
export const DISABLED_KEY = 'extensionsIdentifiers/disabled';

export interface ExtensionIdentifier {
	id: string;
	uuid?: string;
}

/** The extension host's storage channel behind `ExtensionContext.workspaceState` (internal). */
interface StorageChannel {
	initializeExtensionStorage(shared: boolean, key: string, fallback: unknown): Promise<unknown>;
	setValue(shared: boolean, key: string, value: unknown): Promise<void>;
}

function isStorageChannel(value: unknown): value is StorageChannel {
	const s = value as Partial<StorageChannel> | undefined;
	return typeof s?.initializeExtensionStorage === 'function' && typeof s.setValue === 'function';
}

function identifiers(value: unknown): ExtensionIdentifier[] {
	return Array.isArray(value) ? value.filter((e): e is ExtensionIdentifier => typeof e?.id === 'string') : [];
}

/**
 * Reads and writes the lists behind VS Code's own "Disable" / "Disable (Workspace)".
 *
 * VS Code has no API for this. Each extension's `workspaceState` memento talks to the window through
 * a storage channel that takes the storage key as a parameter (normally the extension's id) and does
 * not check it, so it can address VS Code's enablement keys too. Writes go through the window, so
 * they are not lost to any cache, but the window only re-reads workspace enablement when it loads:
 * changes take effect after "Reload Window". This relies on internals and may break with a VS Code
 * update; `from` then returns undefined.
 */
export class WorkspaceEnablement {
	private constructor(private readonly channel: StorageChannel) {}

	static from(workspaceState: vscode.Memento): WorkspaceEnablement | undefined {
		const channel = (workspaceState as unknown as { _storage?: unknown })._storage;
		return isStorageChannel(channel) ? new WorkspaceEnablement(channel) : undefined;
	}

	/** Extensions disabled for this workspace ("Disable (Workspace)"). */
	async workspaceDisabled(): Promise<ExtensionIdentifier[]> {
		return identifiers(await this.channel.initializeExtensionStorage(false, DISABLED_KEY, null));
	}

	/** Lower-case ids disabled in the current profile ("Disable"). */
	async globallyDisabled(): Promise<string[]> {
		return identifiers(await this.channel.initializeExtensionStorage(true, DISABLED_KEY, null)).map(e => e.id.toLowerCase());
	}

	async setWorkspaceDisabled(list: ExtensionIdentifier[]): Promise<void> {
		// `undefined` removes the key, as VS Code itself does for an empty list.
		await this.channel.setValue(false, DISABLED_KEY, list.length > 0 ? list : undefined);
	}
}

export interface DisabledListChange {
	/** The workspace list to write. */
	list: ExtensionIdentifier[];
	/** Ids this extension disabled (and owns) after the change. */
	owned: string[];
}

/**
 * Next workspace disabled list. Entries the user added are kept as they are; only our own are added
 * and removed. Ids the user already disabled are not taken over.
 */
export function nextDisabledList(current: ExtensionIdentifier[], owned: string[], wanted: string[]): DisabledListChange {
	const ownedSet = new Set(owned);
	const users = current.filter(e => !ownedSet.has(e.id.toLowerCase()));
	const usersIds = new Set(users.map(e => e.id.toLowerCase()));
	const mine = [...new Set(wanted)].filter(id => !usersIds.has(id)).sort();
	return { list: [...users, ...mine.map(id => ({ id }))], owned: mine };
}

/** Owned ids missing from the list: the user re-enabled them ("Enable (Workspace)"). */
export function reenabledByUser(current: ExtensionIdentifier[], owned: string[]): string[] {
	const ids = new Set(current.map(e => e.id.toLowerCase()));
	return owned.filter(id => !ids.has(id));
}
