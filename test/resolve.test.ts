import { describe, expect, test } from 'bun:test';
import { classify, inferFromManifest } from '../src/resolve/classify';
import { matchReason, plan } from '../src/resolve/planner';
import { PROJECT_HINTS, normalizeUserRules } from '../src/resolve/hints';
import { describeBinding, extensionReport } from '../src/resolve/report';
import { ctx, detection, ext, index, INSTALLED } from './fixtures';

const byId = (id: string) => INSTALLED.find(e => e.id === id)!;

describe('classify from manifests', () => {
	test('language extensions are tech-bound', () => {
		const b = classify(byId('rust-lang.rust-analyzer'), ctx());
		expect(b.kind).toBe('tech');
		expect(b.languages).toContain('rust');
		expect(b.files).toContain('Cargo.toml');
	});

	test('generic and output-only languages are ignored', () => {
		expect(inferFromManifest(byId('dbaeumer.vscode-eslint').manifest, index()).languages).toEqual([]);
		expect(classify(byId('formulahendry.code-runner'), ctx()).kind).toBe('transversal');
	});

	test('eager tools and themes are transversal', () => {
		expect(classify(byId('eamodio.gitlens'), ctx()).kind).toBe('transversal');
		expect(classify(byId('pkief.material-icon-theme'), ctx()).kind).toBe('transversal');
	});

	test('packs are never installed as such', () => {
		expect(classify(byId('shopify.ruby-extensions-pack'), ctx()).kind).toBe('pack');
	});

	test('runtime-only dependencies are pulled in only when needed', () => {
		expect(classify(byId('ms-dotnettools.vscode-dotnet-runtime'), ctx()).kind).toBe('dependencyOnly');
	});
});

describe('hints and user rules', () => {
	test('project hints fix eager extensions', () => {
		const b = classify(byId('bradlc.vscode-tailwindcss'), ctx(undefined, { hints: PROJECT_HINTS }));
		expect(b.source).toBe('hint');
		expect(b.deps).toContain('npm:tailwindcss');
	});

	test('add-mode hint keeps what the manifest declares', () => {
		const hints = { 'vstirbu.vscode-mermaid-preview': { languages: ['markdown'], mode: 'add' as const } };
		const b = classify(byId('vstirbu.vscode-mermaid-preview'), ctx(undefined, { hints }));
		expect(b.languages).toEqual(['markdown', 'mermaid']);
	});

	test('ESLint and Prettier only where the project uses them', () => {
		const c = ctx(undefined, { hints: PROJECT_HINTS });
		const ids = (files: string[], deps: string[] = []) => plan(INSTALLED, detection(files, deps), c).extensions.map(e => e.id);
		expect(ids(['package.json', 'src/a.ts'])).not.toContain('dbaeumer.vscode-eslint');
		expect(ids(['package.json', 'src/a.ts'])).not.toContain('esbenp.prettier-vscode');
		expect(ids(['package.json', 'eslint.config.mjs', 'src/a.ts'])).toContain('dbaeumer.vscode-eslint');
		expect(ids(['package.json', 'src/a.ts'], ['npm:eslint'])).toContain('dbaeumer.vscode-eslint');
		expect(ids(['web/.prettierrc.json', 'web/a.ts'])).toContain('esbenp.prettier-vscode');
	});

	test('user rules win over hints', () => {
		const rules = normalizeUserRules({ 'BRADLC.vscode-tailwindcss': 'never', 'rust-lang.rust-analyzer': 'always', junk: 3 });
		expect(Object.keys(rules)).toEqual(['bradlc.vscode-tailwindcss', 'rust-lang.rust-analyzer']);
		const c = ctx(undefined, { hints: PROJECT_HINTS, userRules: rules });
		expect(classify(byId('bradlc.vscode-tailwindcss'), c).kind).toBe('never');
		expect(classify(byId('rust-lang.rust-analyzer'), c).kind).toBe('transversal');
	});

	test('hints file only contains known fields', () => {
		for (const rule of Object.values(PROJECT_HINTS)) {
			for (const key of Object.keys(rule)) {
				expect(['languages', 'files', 'deps', 'transversal', 'mode', '$comment']).toContain(key);
			}
		}
	});
});

describe('plan', () => {
	const c = ctx(undefined, { hints: PROJECT_HINTS });

	test('Rust repo', () => {
		const p = plan(INSTALLED, detection(['Cargo.toml', 'src/main.rs']), c);
		const ids = p.extensions.map(e => e.id);
		expect(ids).toContain('rust-lang.rust-analyzer');
		expect(ids).toContain('eamodio.gitlens');
		expect(ids).not.toContain('ms-dotnettools.csharp');
		expect(ids).not.toContain('ms-dotnettools.vscode-dotnet-runtime');
		expect(ids).not.toContain('elpandap.auto-disable-extensions');
	});

	test('C# repo pulls its runtime dependency', () => {
		const p = plan(INSTALLED, detection(['App/App.csproj', 'App/Program.cs']), c);
		const runtime = p.extensions.find(e => e.id === 'ms-dotnettools.vscode-dotnet-runtime');
		expect(runtime?.reason).toBe('required by ms-dotnettools.csharp');
	});

	test('Mermaid only with diagrams, in .mmd files or Markdown fences', () => {
		const ids = (files: string[], fenced: string[] = []) => plan(INSTALLED, detection(files, [], fenced), c).extensions.map(e => e.id);
		expect(ids(['Cargo.toml', 'README.md'])).not.toContain('vstirbu.vscode-mermaid-preview');
		expect(ids(['Cargo.toml', 'README.md'], ['mermaid'])).toContain('vstirbu.vscode-mermaid-preview');
		expect(ids(['docs/flow.mmd'])).toContain('vstirbu.vscode-mermaid-preview');
	});

	test('Tailwind only with the dependency', () => {
		expect(plan(INSTALLED, detection(['package.json', 'src/a.ts']), c).extensions.map(e => e.id)).not.toContain('bradlc.vscode-tailwindcss');
		expect(plan(INSTALLED, detection(['package.json', 'src/a.ts'], ['npm:tailwindcss']), c).extensions.map(e => e.id)).toContain('bradlc.vscode-tailwindcss');
	});

	test('workspace overrides', () => {
		const p = plan(INSTALLED, detection(['Cargo.toml']), c, { include: ['ms-dotnettools.csharp'], exclude: ['eamodio.gitlens'] });
		const ids = p.extensions.map(e => e.id);
		expect(ids).toContain('ms-dotnettools.csharp');
		expect(ids).toContain('ms-dotnettools.vscode-dotnet-runtime');
		expect(ids).not.toContain('eamodio.gitlens');
	});

	test('hash depends on the set, not the order', () => {
		const a = plan(INSTALLED, detection(['Cargo.toml']), c);
		const b = plan([...INSTALLED].reverse(), detection(['src/main.rs']), c);
		expect(a.hash).toBe(b.hash);
	});

	test('file globs match nested paths', () => {
		const d = detection([{ name: 'a', files: ['x/compose.yaml'] }]);
		expect(matchReason({ kind: 'tech', languages: [], files: ['**/compose*.{yml,yaml}'], deps: [], source: 'hint' }, d)).toBe('file x/compose.yaml');
	});
});

describe('extension report', () => {
	test('lists every extension with type, triggers and status, needed ones first', () => {
		const d = detection(['Cargo.toml', 'src/main.rs']);
		const c = ctx();
		const p = plan(INSTALLED, d, c);
		const md = extensionReport({ workspace: 'rusty', installed: INSTALLED, detection: d, plan: p, ctx: c });
		const rows = md.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| Extension') && !l.startsWith('| ---'));
		expect(rows.length).toBe(INSTALLED.filter(e => !e.isBuiltin).length);

		const row = (id: string) => rows.find(r => r.includes(`\`${id}\``))!;
		expect(row('rust-lang.rust-analyzer')).toContain('| Technology |');
		expect(row('rust-lang.rust-analyzer')).toContain('`rust`');
		expect(row('rust-lang.rust-analyzer')).toContain('✅');
		expect(row('eamodio.gitlens')).toContain('| Transversal |');
		expect(row('eamodio.gitlens')).toContain('✅ always');
		expect(row('shopify.ruby-extensions-pack')).toContain('| Extension pack |');

		const firstExcluded = rows.findIndex(r => !r.includes('✅'));
		expect(rows.slice(firstExcluded).every(r => !r.includes('✅'))).toBe(true);
	});

	test('pipes in triggers do not break the table', () => {
		expect(describeBinding({ kind: 'tech', languages: [], files: ['{a|b}.json'], deps: [], source: 'hint' })).toBe('files: `{a|b}.json`');
		const md = extensionReport({
			workspace: 'w', installed: [ext('x.y', { displayName: 'A | B', activationEvents: ['workspaceContains:{a|b}.json'] })],
			detection: detection([]), plan: plan([], detection([]), ctx()), ctx: ctx(),
		});
		expect(md).toContain('A \\| B');
		expect(md).toContain('{a\\|b}.json');
	});
});
