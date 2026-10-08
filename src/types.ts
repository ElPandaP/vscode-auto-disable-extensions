/** Shared data shapes. Everything here is plain data so the core logic can be unit-tested without VS Code. */

/** Subset of an extension's package.json that is read here. */
export interface ExtensionManifest {
	name?: string;
	publisher?: string;
	version?: string;
	displayName?: string;
	categories?: string[];
	main?: string;
	browser?: string;
	activationEvents?: string[];
	extensionDependencies?: string[];
	extensionPack?: string[];
	contributes?: {
		languages?: { id: string; extensions?: string[]; filenames?: string[]; filenamePatterns?: string[] }[];
		grammars?: { language?: string }[];
		debuggers?: { languages?: string[] }[];
		snippets?: { language?: string }[];
		themes?: unknown[];
		iconThemes?: unknown[];
		productIconThemes?: unknown[];
	};
}

/** An extension installed in the current profile (or a built-in one). */
export interface InstalledExtension {
	/** Lower-case `publisher.name`. */
	id: string;
	manifest: ExtensionManifest;
	isBuiltin: boolean;
	/** "Apply Extension to all Profiles": the user wants it everywhere; never managed. */
	isApplicationScoped: boolean;
}

/** One workspace folder's file list, as POSIX paths relative to the folder root. */
export interface FolderFiles {
	name: string;
	files: string[];
}

export interface Detection {
	folders: FolderFiles[];
	/** Language ids with at least one matching file. */
	languages: string[];
	/** Namespaced dependencies, e.g. `npm:react`, `cargo:tauri`, `pip:django`. */
	deps: string[];
	/** Human-readable technology names for the UI. */
	techs: string[];
}

/** When an extension is needed. Used by project hints and user rules. */
export interface Rule {
	languages?: string[];
	files?: string[];
	deps?: string[];
	/** Needed in every workspace. */
	transversal?: boolean;
	/** `replace` (default) discards what was inferred from the manifest; `add` merges with it. */
	mode?: 'replace' | 'add';
}

export type UserRule = 'always' | 'never' | Rule;

export type BindingKind = 'tech' | 'transversal' | 'pack' | 'dependencyOnly' | 'never';

export interface Binding {
	kind: BindingKind;
	languages: string[];
	files: string[];
	deps: string[];
	/** Where the decision came from, for the details view. */
	source: 'manifest' | 'hint' | 'user';
}

export interface PlannedExtension {
	id: string;
	reason: string;
}

export interface Plan {
	extensions: PlannedExtension[];
	/** Stable key of the extension set (ids only). */
	hash: string;
	/** Extensions left out, with why. */
	excluded: { id: string; reason: string }[];
}
