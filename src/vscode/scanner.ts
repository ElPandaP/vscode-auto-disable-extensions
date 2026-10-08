/**
 * Lists the workspace's files through VS Code and reads the manifests and Markdown files the
 * detectors need. The only part of detection that talks to VS Code.
 */

import * as vscode from 'vscode';
import type { FolderFiles } from '../types';
import { fencedLanguages, isMarkdownFile } from '../detect/markdown';
import { dependenciesOf, isManifest } from '../detect/manifests';

const MAX_FILES_PER_FOLDER = 30_000;
const MAX_MANIFESTS = 300;
const MAX_MANIFEST_BYTES = 1_000_000;
const MAX_MARKDOWN_FILES = 200;
const MAX_MARKDOWN_BYTES = 256_000;

export interface ScanResult {
	folders: FolderFiles[];
	deps: string[];
	/** Languages found inside Markdown code fences (see markdown.ts). */
	fencedLanguages: string[];
	truncated: boolean;
}

export function excludeGlob(folderNames: string[]): string {
	return `**/{${folderNames.join(',')}}/**`;
}

/** Lists files of every workspace folder, reads dependencies from manifests and fences from Markdown. */
export async function scanWorkspace(excludedFolders: string[], token?: vscode.CancellationToken): Promise<ScanResult> {
	const folders: FolderFiles[] = [];
	const manifestUris: vscode.Uri[] = [];
	const markdownUris: vscode.Uri[] = [];
	let truncated = false;

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const uris = await vscode.workspace.findFiles(
			new vscode.RelativePattern(folder, '**/*'),
			excludeGlob(excludedFolders),
			MAX_FILES_PER_FOLDER,
			token,
		);
		truncated ||= uris.length >= MAX_FILES_PER_FOLDER;
		const files: string[] = [];
		for (const uri of uris) {
			const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
			files.push(rel);
			if (isManifest(rel) && manifestUris.length < MAX_MANIFESTS) {
				manifestUris.push(uri);
			} else if (isMarkdownFile(rel) && markdownUris.length < MAX_MARKDOWN_FILES) {
				markdownUris.push(uri);
			}
		}
		folders.push({ name: folder.name, files });
	}

	const deps = new Set<string>();
	await Promise.all(manifestUris.map(async uri => {
		for (const dep of await readDependencies(uri)) {
			deps.add(dep);
		}
	}));
	const fenced = new Set<string>();
	await Promise.all(markdownUris.map(async uri => {
		const text = await readSmallText(uri, MAX_MARKDOWN_BYTES);
		for (const lang of text ? fencedLanguages(text) : []) {
			fenced.add(lang);
		}
	}));
	return { folders, deps: [...deps], fencedLanguages: [...fenced], truncated };
}

async function readSmallText(uri: vscode.Uri, maxBytes: number): Promise<string | undefined> {
	try {
		if ((await vscode.workspace.fs.stat(uri)).size > maxBytes) {
			return undefined;
		}
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return undefined;
	}
}

export async function readDependencies(uri: vscode.Uri): Promise<string[]> {
	const text = await readSmallText(uri, MAX_MANIFEST_BYTES);
	return text === undefined ? [] : dependenciesOf(uri.path, text);
}
