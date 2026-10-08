/**
 * Decides when one installed extension is needed: always (transversal), only for some languages,
 * files or dependencies (tech), only as another extension's dependency, never, or not at all
 * because it is a pack. Priority: user rule > project hint > the extension's own manifest.
 */

import type { Binding, ExtensionManifest, InstalledExtension, Rule, UserRule } from '../types';
import type { LanguageIndex } from '../detect/languages';

/**
 * Languages present in almost every repository. An extension that only targets these says nothing
 * about the project type, so they are ignored when inferring from manifests (hints may still use them).
 */
export const GENERIC_LANGUAGES = new Set([
	'json', 'jsonc', 'jsonl', 'json5', 'markdown', 'yaml', 'plaintext', 'ignore', 'ini', 'properties',
	'log', 'code-text-binary', 'dotenv', 'editorconfig', 'git-commit', 'git-rebase', 'diff',
	'search-result', 'snippets', 'csv', 'tsv',
]);

export interface ClassifyContext {
	index: LanguageIndex;
	/** Ids (lower-case) listed in some other installed extension's `extensionDependencies`. */
	dependedOn: Set<string>;
	hints: Record<string, Rule>;
	userRules: Record<string, UserRule>;
}

/** Languages and file patterns an extension declares, before any hint or user rule. */
export function inferFromManifest(manifest: ExtensionManifest, index: LanguageIndex): { languages: string[]; files: string[] } {
	const languages = new Set<string>();
	const files = new Set<string>();
	for (const event of manifest.activationEvents ?? []) {
		if (event.startsWith('onLanguage:')) {
			languages.add(event.slice('onLanguage:'.length));
		} else if (event.startsWith('workspaceContains:')) {
			files.add(event.slice('workspaceContains:'.length));
		}
	}
	const c = manifest.contributes;
	c?.languages?.forEach(l => l?.id && languages.add(l.id));
	c?.grammars?.forEach(g => g?.language && languages.add(g.language));
	c?.debuggers?.forEach(d => d?.languages?.forEach(l => languages.add(l)));
	c?.snippets?.forEach(s => s?.language && languages.add(s.language));

	return {
		// Output-panel languages (no file mapping anywhere) and generic ones carry no signal.
		languages: [...languages].filter(l => index.fileBacked.has(l) && !GENERIC_LANGUAGES.has(l)).sort(),
		files: [...files].sort(),
	};
}

function ruleBinding(rule: Rule, inferred: { languages: string[]; files: string[] }, source: Binding['source']): Binding {
	if (rule.transversal) {
		return { kind: 'transversal', languages: [], files: [], deps: [], source };
	}
	const merge = rule.mode === 'add';
	const union = (a: string[], b: string[] | undefined) => [...new Set([...(merge ? a : []), ...(b ?? [])])].sort();
	return {
		kind: 'tech',
		languages: union(inferred.languages, rule.languages),
		files: union(inferred.files, rule.files),
		deps: [...new Set(rule.deps ?? [])].sort(),
		source,
	};
}

/** Decides when an installed extension is needed. Priority: user rule > project hint > manifest. */
export function classify(ext: InstalledExtension, ctx: ClassifyContext): Binding {
	const empty = { languages: [], files: [], deps: [] };
	const user = ctx.userRules[ext.id];
	if (user === 'never') {
		return { kind: 'never', ...empty, source: 'user' };
	}
	if (user === 'always') {
		return { kind: 'transversal', ...empty, source: 'user' };
	}

	const inferred = inferFromManifest(ext.manifest, ctx.index);
	if (user) {
		return ruleBinding(user, inferred, 'user');
	}
	const hint = ctx.hints[ext.id];
	if (hint) {
		return ruleBinding(hint, inferred, 'hint');
	}

	if ((ext.manifest.extensionPack?.length ?? 0) > 0) {
		// A pack has no code of its own; its members are handled one by one.
		return { kind: 'pack', ...empty, source: 'manifest' };
	}
	if (inferred.languages.length > 0 || inferred.files.length > 0) {
		return { kind: 'tech', ...inferred, deps: [], source: 'manifest' };
	}
	if (ctx.dependedOn.has(ext.id)) {
		return { kind: 'dependencyOnly', ...empty, source: 'manifest' };
	}
	// Themes, keymaps, Git/AI tools, command-only extensions: when unsure, keep it everywhere.
	return { kind: 'transversal', ...empty, source: 'manifest' };
}
