/**
 * Maps file names to language ids (`main.rs` → `rust`) with the languages that VS Code and the
 * installed extensions contribute, i.e. the same table VS Code uses.
 */

import picomatch from 'picomatch';
import type { ExtensionManifest } from '../types';

/**
 * Maps files to language ids using the `contributes.languages` of every known extension
 * (built-ins included), the same data VS Code uses to pick a language for a file.
 */
export interface LanguageIndex {
	byExtension: Map<string, Set<string>>;
	byFilename: Map<string, Set<string>>;
	patterns: { test: (path: string) => boolean; matchPath: boolean; language: string }[];
	/** Languages that can be associated with real files (output-panel-only languages are not). */
	fileBacked: Set<string>;
}

function add(map: Map<string, Set<string>>, key: string, language: string): void {
	let set = map.get(key);
	if (!set) {
		set = new Set();
		map.set(key, set);
	}
	set.add(language);
}

export function buildLanguageIndex(manifests: ExtensionManifest[]): LanguageIndex {
	const index: LanguageIndex = { byExtension: new Map(), byFilename: new Map(), patterns: [], fileBacked: new Set() };
	for (const manifest of manifests) {
		for (const lang of manifest.contributes?.languages ?? []) {
			if (!lang?.id) {
				continue;
			}
			for (const ext of lang.extensions ?? []) {
				add(index.byExtension, ext.toLowerCase(), lang.id);
				index.fileBacked.add(lang.id);
			}
			for (const filename of lang.filenames ?? []) {
				add(index.byFilename, filename.toLowerCase(), lang.id);
				index.fileBacked.add(lang.id);
			}
			for (const pattern of lang.filenamePatterns ?? []) {
				index.patterns.push({
					test: picomatch(pattern, { dot: true, nocase: true }),
					matchPath: pattern.includes('/'),
					language: lang.id,
				});
				index.fileBacked.add(lang.id);
			}
		}
	}
	return index;
}

/** Language ids of a single file path (POSIX, relative). */
export function languagesOfFile(path: string, index: LanguageIndex): string[] {
	const slash = path.lastIndexOf('/');
	const base = (slash >= 0 ? path.slice(slash + 1) : path).toLowerCase();
	const found = new Set<string>();

	for (const lang of index.byFilename.get(base) ?? []) {
		found.add(lang);
	}
	// Try every suffix so ".d.ts" and ".ts" both get a chance.
	for (let dot = base.indexOf('.'); dot >= 0; dot = base.indexOf('.', dot + 1)) {
		for (const lang of index.byExtension.get(base.slice(dot)) ?? []) {
			found.add(lang);
		}
	}
	for (const pattern of index.patterns) {
		if (pattern.test(pattern.matchPath ? path : base)) {
			found.add(pattern.language);
		}
	}
	return [...found];
}

export function languagesOfFiles(paths: Iterable<string>, index: LanguageIndex): Set<string> {
	const found = new Set<string>();
	for (const path of paths) {
		for (const lang of languagesOfFile(path, index)) {
			found.add(lang);
		}
	}
	return found;
}
