/**
 * Reads dependencies from project manifests (package.json, Cargo.toml, pyproject.toml,
 * requirements*.txt, *.csproj, go.mod) as namespaced ids such as `npm:react` or `cargo:tauri`.
 */

import { parse as parseToml } from 'smol-toml';

/** Project manifests whose dependencies are read. Matched against the file's base name. */
export const MANIFEST_PATTERNS: { test: (base: string) => boolean; parse: (text: string) => string[] }[] = [
	{ test: base => base === 'package.json', parse: parsePackageJson },
	{ test: base => base === 'cargo.toml', parse: parseCargoToml },
	{ test: base => base === 'pyproject.toml', parse: parsePyproject },
	{ test: base => /^requirements.*\.txt$/.test(base), parse: parseRequirements },
	{ test: base => base.endsWith('.csproj') || base.endsWith('.fsproj'), parse: parseMsbuildProject },
	{ test: base => base === 'go.mod', parse: parseGoMod },
];

export function isManifest(path: string): boolean {
	const base = baseName(path);
	return MANIFEST_PATTERNS.some(m => m.test(base));
}

/** Namespaced dependencies declared by a manifest; unreadable files yield nothing. */
export function dependenciesOf(path: string, text: string): string[] {
	const base = baseName(path);
	const manifest = MANIFEST_PATTERNS.find(m => m.test(base));
	if (!manifest) {
		return [];
	}
	try {
		return manifest.parse(text);
	} catch {
		return [];
	}
}

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1).toLowerCase();
}

function keysOf(value: unknown): string[] {
	return value && typeof value === 'object' ? Object.keys(value) : [];
}

export function parsePackageJson(text: string): string[] {
	const json = JSON.parse(text);
	const names = new Set<string>();
	for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		for (const name of keysOf(json[field])) {
			names.add(`npm:${name}`);
		}
	}
	return [...names];
}

export function parseCargoToml(text: string): string[] {
	const toml = parseToml(text) as Record<string, any>;
	const names = new Set<string>();
	const collect = (table: Record<string, any> | undefined) => {
		for (const field of ['dependencies', 'dev-dependencies', 'build-dependencies']) {
			for (const name of keysOf(table?.[field])) {
				names.add(`cargo:${name}`);
			}
		}
	};
	collect(toml);
	collect(toml.workspace);
	for (const target of Object.values(toml.target ?? {})) {
		collect(target as Record<string, any>);
	}
	return [...names];
}

/** Name part of a PEP 508 requirement such as `Django>=4.2 ; python_version > "3.8"`. */
function pep508Name(requirement: string): string | undefined {
	return /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(requirement)?.[1]?.toLowerCase();
}

export function parsePyproject(text: string): string[] {
	const toml = parseToml(text) as Record<string, any>;
	const names = new Set<string>();
	for (const req of toml.project?.dependencies ?? []) {
		const name = pep508Name(String(req));
		if (name) {
			names.add(`pip:${name}`);
		}
	}
	for (const name of keysOf(toml.tool?.poetry?.dependencies)) {
		if (name !== 'python') {
			names.add(`pip:${name.toLowerCase()}`);
		}
	}
	return [...names];
}

export function parseRequirements(text: string): string[] {
	const names = new Set<string>();
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.replace(/#.*/, '').trim();
		if (!trimmed || trimmed.startsWith('-')) {
			continue;
		}
		const name = pep508Name(trimmed);
		if (name) {
			names.add(`pip:${name}`);
		}
	}
	return [...names];
}

export function parseMsbuildProject(text: string): string[] {
	const names = new Set<string>();
	for (const match of text.matchAll(/<PackageReference\s+[^>]*Include\s*=\s*"([^"]+)"/gi)) {
		names.add(`nuget:${match[1]!.toLowerCase()}`);
	}
	return [...names];
}

export function parseGoMod(text: string): string[] {
	const names = new Set<string>();
	let inBlock = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/\/\/.*/, '').trim();
		if (inBlock) {
			if (line === ')') {
				inBlock = false;
			} else if (line) {
				names.add(`go:${line.split(/\s+/)[0]}`);
			}
		} else if (line === 'require (') {
			inBlock = true;
		} else if (line.startsWith('require ')) {
			names.add(`go:${line.split(/\s+/)[1]}`);
		}
	}
	return [...names];
}
