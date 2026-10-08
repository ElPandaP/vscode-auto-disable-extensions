/**
 * Renders the Extension Report: a Markdown table of every installed extension with its type, what
 * triggers it and whether the current workspace needs it.
 */

import type { Binding, Detection, InstalledExtension, Plan } from '../types';
import { classify, type ClassifyContext } from './classify';

export interface ReportInput {
	workspace: string;
	installed: InstalledExtension[];
	detection: Detection;
	plan: Plan;
	ctx: ClassifyContext;
}

const KIND_LABEL: Record<Binding['kind'], string> = {
	tech: 'Technology',
	transversal: 'Transversal',
	pack: 'Extension pack',
	dependencyOnly: 'Dependency only',
	never: 'Never',
};

const MAX_LIST = 6;

/** Markdown table cells cannot contain pipes or line breaks. */
function cell(text: string): string {
	return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function list(label: string, items: string[]): string | undefined {
	if (items.length === 0) {
		return undefined;
	}
	const shown = items.slice(0, MAX_LIST).map(i => `\`${i}\``).join(', ');
	return `${label}: ${shown}${items.length > MAX_LIST ? ` (+${items.length - MAX_LIST})` : ''}`;
}

/** How an extension is detected, e.g. "languages: `rust` · files: `Cargo.toml`". */
export function describeBinding(binding: Binding): string {
	if (binding.kind !== 'tech') {
		return '—';
	}
	return [list('languages', binding.languages), list('files', binding.files), list('deps', binding.deps)]
		.filter(Boolean)
		.join(' · ') || '—';
}

/**
 * Every installed extension with its classification, what triggers it, and whether
 * the current workspace needs it. Rows needed here come first.
 */
export function extensionReport(input: ReportInput): string {
	const { plan, detection } = input;
	const chosen = new Map(plan.extensions.map(e => [e.id, e.reason]));
	const excluded = new Map(plan.excluded.map(e => [e.id, e.reason]));

	const rows = input.installed
		.filter(e => !e.isBuiltin)
		.map(ext => {
			const name = ext.manifest.displayName && !ext.manifest.displayName.startsWith('%') ? ext.manifest.displayName : ext.id;
			const extension = `${cell(name)}<br>\`${ext.id}\``;
			if (ext.isApplicationScoped) {
				return { here: true, cells: [extension, 'All profiles', '—', '—', '✅ never managed (applied to all profiles)'] };
			}
			const binding = classify(ext, input.ctx);
			const reason = chosen.get(ext.id);
			const status = reason ? `✅ ${reason}` : `— ${excluded.get(ext.id) ?? 'not needed'}`;
			return { here: !!reason, cells: [extension, KIND_LABEL[binding.kind], describeBinding(binding), binding.source, status].map((c, i) => (i === 0 ? c : cell(c))) };
		})
		.sort((a, b) => Number(b.here) - Number(a.here) || a.cells[0]!.localeCompare(b.cells[0]!));

	const here = rows.filter(r => r.here).length;
	const lines = [
		'# Auto Disable Extensions — Report',
		'',
		`- **Workspace:** ${input.workspace}`,
		`- **Technologies:** ${detection.techs.join(', ') || '—'}`,
		`- **Languages:** ${detection.languages.map(l => `\`${l}\``).join(', ') || '—'}`,
		`- **Extensions:** ${here} of ${rows.length} needed here`,
		'',
		'| Extension | Type | Detected by | Source | In this workspace |',
		'| --- | --- | --- | --- | --- |',
		...rows.map(r => `| ${r.cells.join(' | ')} |`),
		'',
	];
	return lines.join('\n');
}
