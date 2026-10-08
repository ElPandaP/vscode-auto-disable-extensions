import type { ExtensionManifest, FolderFiles, InstalledExtension } from '../src/types';
import { buildLanguageIndex } from '../src/detect/languages';
import { detect } from '../src/detect/detector';
import { dependedOn } from '../src/resolve/planner';
import type { ClassifyContext } from '../src/resolve/classify';

/** Language contributions resembling VS Code's built-in extensions. */
export const BUILTIN_LANGUAGES: ExtensionManifest = {
	contributes: {
		languages: [
			{ id: 'rust', extensions: ['.rs'] },
			{ id: 'typescript', extensions: ['.ts', '.cts', '.mts'] },
			{ id: 'typescriptreact', extensions: ['.tsx'] },
			{ id: 'javascript', extensions: ['.js', '.cjs', '.mjs'] },
			{ id: 'csharp', extensions: ['.cs'] },
			{ id: 'json', extensions: ['.json'] },
			{ id: 'jsonc', filenames: ['tsconfig.json'] },
			{ id: 'markdown', extensions: ['.md'] },
			{ id: 'toml', extensions: ['.toml'] },
			{ id: 'css', extensions: ['.css'] },
			{ id: 'dockerfile', filenames: ['Dockerfile'], filenamePatterns: ['*.Dockerfile'] },
			{ id: 'ignore', filenames: ['.gitignore'] },
			{ id: 'python', extensions: ['.py'] },
		],
	},
};

export function ext(id: string, manifest: ExtensionManifest, extra: Partial<InstalledExtension> = {}): InstalledExtension {
	return { id, manifest, isBuiltin: false, isApplicationScoped: false, ...extra };
}

/** A slice of a typical user's installed extensions, with their real manifest shapes. */
export const INSTALLED: InstalledExtension[] = [
	ext('rust-lang.rust-analyzer', {
		activationEvents: ['onLanguage:rust', 'workspaceContains:Cargo.toml', 'workspaceContains:*/Cargo.toml'],
		contributes: { languages: [{ id: 'rust', extensions: ['.rs'] }, { id: 'ra_syntax_tree', extensions: ['.rast'] }] },
	}),
	ext('ms-dotnettools.csharp', {
		activationEvents: ['workspaceContains:**/*.{csproj,csx,cake}'],
		extensionDependencies: ['ms-dotnettools.vscode-dotnet-runtime'],
		contributes: { languages: [{ id: 'csharp' }] },
	}),
	ext('ms-dotnettools.vscode-dotnet-runtime', { activationEvents: ['onStartupFinished'] }),
	ext('dbaeumer.vscode-eslint', {
		activationEvents: ['onStartupFinished'],
		contributes: { languages: [{ id: 'ignore', filenames: ['.eslintignore'] }, { id: 'jsonc', filenames: ['.eslintrc.json'] }] },
	}),
	ext('esbenp.prettier-vscode', { activationEvents: ['onStartupFinished'] }),
	ext('eamodio.gitlens', { activationEvents: ['onStartupFinished'] }),
	ext('pkief.material-icon-theme', { activationEvents: ['onStartupFinished'], contributes: { iconThemes: [{}] } }),
	ext('formulahendry.code-runner', {
		activationEvents: ['onStartupFinished'],
		contributes: { languages: [{ id: 'code-runner-output' }] },
	}),
	ext('bradlc.vscode-tailwindcss', { activationEvents: ['onStartupFinished'], contributes: { languages: [{ id: 'tailwindcss' }] } }),
	ext('vstirbu.vscode-mermaid-preview', { contributes: { languages: [{ id: 'mermaid', extensions: ['.mmd'] }] } }),
	ext('shopify.ruby-extensions-pack', { extensionPack: ['shopify.ruby-lsp'] }),
	ext('ms-azuretools.vscode-containers', {
		contributes: {
			languages: [{ id: 'dockercompose', filenamePatterns: ['compose.yaml'] }],
			debuggers: [{ languages: ['dockerfile', 'csharp', 'razor'] }],
		},
	}),
	ext('elpandap.auto-disable-extensions', {}, { isApplicationScoped: true }),
];

export function index(installed = INSTALLED) {
	return buildLanguageIndex([BUILTIN_LANGUAGES, ...installed.map(e => e.manifest)]);
}

export function ctx(installed = INSTALLED, overrides: Partial<ClassifyContext> = {}): ClassifyContext {
	return { index: index(installed), dependedOn: dependedOn(installed), hints: {}, userRules: {}, ...overrides };
}

export function detection(files: string[] | FolderFiles[], deps: string[] = [], fenced: string[] = []) {
	const folders = typeof files[0] === 'string' || files.length === 0
		? [{ name: 'repo', files: files as string[] }]
		: files as FolderFiles[];
	return detect(folders, deps, index(), fenced);
}
