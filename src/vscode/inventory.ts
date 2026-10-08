/**
 * Lists the extensions installed in the current profile from VS Code's `extensions.json` (the API
 * only shows the ones running in the window).
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ExtensionManifest, InstalledExtension } from '../types';
import type { HostPaths } from './paths';

interface ExtensionsJsonEntry {
	identifier?: { id?: string };
	location?: { path?: string; fsPath?: string } | string;
	relativeLocation?: string;
	metadata?: { isApplicationScoped?: boolean; source?: string };
}

/**
 * Extensions of the current profile. A profile has its own `extensions.json` unless it shares the
 * Default profile's extensions; all profiles keep the extensions themselves in `extensionsDir`.
 */
export async function readInstalledExtensions(paths: HostPaths): Promise<InstalledExtension[]> {
	let entries: ExtensionsJsonEntry[] | undefined;
	for (const file of [paths.profileExtensionsJson, paths.defaultExtensionsJson]) {
		if (file) {
			entries = await readFile(file, 'utf8').then(text => JSON.parse(text) as ExtensionsJsonEntry[], () => undefined);
			if (entries) {
				break;
			}
		}
	}
	const result = await Promise.all((entries ?? []).map(async entry => {
		const id = entry.identifier?.id?.toLowerCase();
		const folder = entry.relativeLocation ? join(paths.extensionsDir, entry.relativeLocation) : locationPath(entry.location);
		if (!id || !folder) {
			return undefined;
		}
		try {
			const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8')) as ExtensionManifest;
			const ext: InstalledExtension = {
				id,
				manifest,
				isBuiltin: false,
				isApplicationScoped: !!entry.metadata?.isApplicationScoped,
			};
			return ext;
		} catch {
			return undefined;
		}
	}));
	return result.filter((e): e is InstalledExtension => !!e);
}

function locationPath(location: ExtensionsJsonEntry['location']): string | undefined {
	if (typeof location === 'string') {
		return location;
	}
	const p = location?.fsPath ?? location?.path;
	// URI paths on Windows look like "/C:/Users/...".
	return p?.replace(/^\/([A-Za-z]:)/, '$1');
}
