/**
 * Locates VS Code's data folders and the extension list of the profile this window runs in.
 */

import { dirname, join } from 'node:path';

/** VS Code data locations, derived from where the running extension and its storage live. */
export interface HostPaths {
	userDataDir: string;
	/** Folder holding every profile's extensions. */
	extensionsDir: string;
	/** `extensions.json` of the Default profile. */
	defaultExtensionsJson: string;
	/** `extensions.json` of the current profile, when it is not Default (it may not exist). */
	profileExtensionsJson?: string;
}

/** Upper-cases a Windows drive letter (`Uri.fsPath` lower-cases it), so paths compare and print consistently. */
export function normalizeDrive(p: string): string {
	return p.replace(/^([a-z]):/, (_, d: string) => `${d.toUpperCase()}:`);
}

/**
 * `globalStorageUri` lives in the current profile: `<userDataDir>/User/globalStorage/<id>` for
 * Default, `<userDataDir>/User/profiles/<profile>/globalStorage/<id>` otherwise.
 */
const GLOBAL_STORAGE = /^(.*)[\\/]User[\\/](?:profiles[\\/]([^\\/]+)[\\/])?globalStorage[\\/]/;

export function userDataDirFromGlobalStorage(globalStoragePath: string): string {
	const match = GLOBAL_STORAGE.exec(globalStoragePath);
	if (!match) {
		throw new Error(`Unexpected globalStorage location: ${globalStoragePath}`);
	}
	return normalizeDrive(match[1]!);
}

export function resolvePaths(opts: { globalStoragePath: string; extensionPath: string }): HostPaths {
	const userDataDir = userDataDirFromGlobalStorage(opts.globalStoragePath);
	const profileId = GLOBAL_STORAGE.exec(opts.globalStoragePath)![2];
	const extensionsDir = normalizeDrive(dirname(opts.extensionPath));
	return {
		userDataDir,
		extensionsDir,
		defaultExtensionsJson: join(extensionsDir, 'extensions.json'),
		profileExtensionsJson: profileId ? join(userDataDir, 'User', 'profiles', profileId, 'extensions.json') : undefined,
	};
}
