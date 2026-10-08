import { describe, expect, test } from 'bun:test';
import { languagesOfFile } from '../src/detect/languages';
import {
	dependenciesOf, isManifest, parseCargoToml, parseGoMod, parseMsbuildProject, parsePackageJson, parsePyproject, parseRequirements,
} from '../src/detect/manifests';
import { fencedLanguages, isMarkdownFile } from '../src/detect/markdown';
import { technologyNames } from '../src/detect/techs';
import { detection, index } from './fixtures';

describe('languages', () => {
	const idx = index();

	test('maps by extension, filename and pattern', () => {
		expect(languagesOfFile('src/main.rs', idx)).toEqual(['rust']);
		expect(languagesOfFile('docker/Dockerfile', idx)).toEqual(['dockerfile']);
		expect(languagesOfFile('build/app.Dockerfile', idx)).toContain('dockerfile');
		expect(languagesOfFile('a/b/tsconfig.json', idx).sort()).toEqual(['json', 'jsonc']);
	});

	test('tries every suffix of multi-dot names', () => {
		expect(languagesOfFile('types/index.d.ts', idx)).toEqual(['typescript']);
	});

	test('output-only languages are not file-backed', () => {
		expect(idx.fileBacked.has('code-runner-output')).toBe(false);
		expect(idx.fileBacked.has('rust')).toBe(true);
	});
});

describe('manifests', () => {
	test('recognizes manifest files', () => {
		expect(isManifest('frontend/package.json')).toBe(true);
		expect(isManifest('backend/Cargo.toml')).toBe(true);
		expect(isManifest('api/Api.csproj')).toBe(true);
		expect(isManifest('requirements-dev.txt')).toBe(true);
		expect(isManifest('src/main.rs')).toBe(false);
	});

	test('package.json', () => {
		const deps = parsePackageJson(JSON.stringify({ dependencies: { react: '^18' }, devDependencies: { vite: '^5', '@types/node': '*' } }));
		expect(deps.sort()).toEqual(['npm:@types/node', 'npm:react', 'npm:vite']);
	});

	test('Cargo.toml including workspace and target tables', () => {
		const deps = parseCargoToml([
			'[dependencies]', 'serde = "1"', 'tauri = { version = "2" }',
			'[dev-dependencies]', 'insta = "1"',
			'[workspace.dependencies]', 'tokio = "1"',
			'[target.\'cfg(windows)\'.dependencies]', 'winapi = "0.3"',
		].join('\n'));
		expect(deps.sort()).toEqual(['cargo:insta', 'cargo:serde', 'cargo:tauri', 'cargo:tokio', 'cargo:winapi']);
	});

	test('python manifests', () => {
		expect(parseRequirements('Django>=4.2\n# comment\n-r base.txt\nrequests[socks]==2.0 ; python_version>"3"').sort())
			.toEqual(['pip:django', 'pip:requests']);
		expect(parsePyproject('[project]\ndependencies = ["FastAPI>=0.1", "uvicorn"]\n[tool.poetry.dependencies]\npython = "^3.11"\nDjango = "*"').sort())
			.toEqual(['pip:django', 'pip:fastapi', 'pip:uvicorn']);
	});

	test('csproj and go.mod', () => {
		expect(parseMsbuildProject('<ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13" /></ItemGroup>')).toEqual(['nuget:newtonsoft.json']);
		expect(parseGoMod('module x\n\nrequire github.com/a/b v1\nrequire (\n\tgithub.com/c/d v2 // indirect\n)\n').sort())
			.toEqual(['go:github.com/a/b', 'go:github.com/c/d']);
	});

	test('broken manifests yield nothing', () => {
		expect(dependenciesOf('package.json', '{ nope')).toEqual([]);
		expect(dependenciesOf('Cargo.toml', '[[[')).toEqual([]);
	});
});

describe('detect', () => {
	test('monorepo with Rust backend and React/Vite frontend', () => {
		const d = detection(
			['backend/Cargo.toml', 'backend/src/main.rs', 'frontend/package.json', 'frontend/src/App.tsx', 'frontend/vite.config.ts', 'docs/readme.md'],
			['cargo:serde', 'npm:react', 'npm:vite'],
		);
		expect(d.languages).toContain('rust');
		expect(d.languages).toContain('typescriptreact');
		expect(d.techs).toEqual(['Rust', 'TypeScript', 'React', 'Vite']);
	});

	test('TypeScript hides JavaScript in display names', () => {
		expect(technologyNames(['javascript', 'typescript'], [])).toEqual(['TypeScript']);
		expect(technologyNames(['javascript'], [])).toEqual(['JavaScript']);
	});

	test('infrastructure is listed after languages', () => {
		expect(technologyNames(['dockerfile', 'rust'], ['cargo:axum'])).toEqual(['Rust', 'Axum', 'Docker']);
	});
});

describe('markdown fences', () => {
	test('reports diagram languages only', () => {
		const text = ['# Doc', '```ts', 'const a = 1;', '```', '', '  ```Mermaid', 'graph TD; A-->B', '```', '~~~mermaid title', '~~~'].join('\n');
		expect(fencedLanguages(text)).toEqual(['mermaid']);
		expect(fencedLanguages('Use `mermaid` inline or ```ts\n```')).toEqual([]);
		expect(fencedLanguages('    ```mermaid (indented code)')).toEqual([]);
	});

	test('markdown files', () => {
		expect(isMarkdownFile('docs/README.MD')).toBe(true);
		expect(isMarkdownFile('a.mdx')).toBe(true);
		expect(isMarkdownFile('md.json')).toBe(false);
	});
});
