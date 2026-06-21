import * as vscode from 'vscode';
import * as path from 'path';

const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
    '__pycache__', '.venv', 'venv', 'env', 'target', '.cache',
    'coverage', '.nyc_output', 'vendor', '.turbo', '.svelte-kit'
]);

const TEXT_EXTENSIONS = new Set([
    'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
    'py', 'rs', 'go', 'java', 'cs', 'cpp', 'c', 'h', 'hpp',
    'html', 'htm', 'css', 'scss', 'less', 'sass',
    'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml',
    'md', 'mdx', 'txt', 'sh', 'bash', 'zsh', 'ps1',
    'sql', 'graphql', 'gql', 'proto',
    'vue', 'svelte', 'astro',
    'env', 'gitignore', 'editorconfig', 'prettierrc', 'eslintrc', 'babelrc'
]);

const KNOWN_TEXT_FILENAMES = new Set([
    'makefile', 'dockerfile', 'license', 'readme', 'changelog',
    'procfile', 'vagrantfile', 'gemfile', 'rakefile'
]);

const MAX_ACTIVE_FILE_LINES = 600;
const MAX_FILE_BYTES = 60_000;

export interface FileInfo {
    path: string;
    content: string;
    truncated: boolean;
    totalLines: number;
}

export interface WorkspaceContext {
    workspaceName: string;
    workspaceRoot: string;
    platform: string;
    shell: string;
    fileTree: string;
    activeFile: FileInfo | null;
    openFiles: FileInfo[];
    allWorkspaceFiles: FileInfo[];
    selection: string | null;
    selectionFile: string | null;
    selectionRange: string | null;
    gitBranch: string | null;
    gitStatus: string | null;
    recentChanges: string | null;
    gitDiff: string | null;
    projectManifest: FileInfo | null;
    configFiles: FileInfo[];
    diagnostics: string | null;
}

function truncate(content: string, maxLines: number): { content: string; truncated: boolean; totalLines: number } {
    const lines = content.split('\n');
    const totalLines = lines.length;
    if (totalLines <= maxLines) {
        return { content, truncated: false, totalLines };
    }
    return {
        content: lines.slice(0, maxLines).join('\n') + `\n\n... [${totalLines - maxLines} more lines not shown]`,
        truncated: true,
        totalLines
    };
}

async function buildFileTree(rootUri: vscode.Uri, depth = 0, prefix = ''): Promise<string> {
    if (depth > 4) return '';
    const lines: string[] = [];

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(rootUri);
    } catch {
        return '';
    }

    entries.sort((a, b) => {
        const aIsDir = a[1] === vscode.FileType.Directory;
        const bIsDir = b[1] === vscode.FileType.Directory;
        if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
        return a[0].localeCompare(b[0]);
    });

    for (const [name, type] of entries) {
        if (name.startsWith('.') && name !== '.env.example') continue;
        if (type === vscode.FileType.Directory) {
            if (IGNORE_DIRS.has(name)) continue;
            lines.push(`${prefix}${name}/`);
            const sub = await buildFileTree(vscode.Uri.joinPath(rootUri, name), depth + 1, prefix + '  ');
            if (sub) lines.push(sub);
        } else {
            lines.push(`${prefix}${name}`);
        }
    }

    return lines.join('\n');
}

async function readFile(uri: vscode.Uri, rootPath: string, maxLines: number): Promise<FileInfo | null> {
    const relPath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_FILE_BYTES) {
            return { path: relPath, content: `[File too large to include: ${Math.round(stat.size / 1024)}KB]`, truncated: true, totalLines: 0 };
        }
        const bytes = await vscode.workspace.fs.readFile(uri);
        const raw = Buffer.from(bytes).toString('utf8');
        const { content, truncated, totalLines } = truncate(raw, maxLines);
        return { path: relPath, content, truncated, totalLines };
    } catch {
        return null;
    }
}

async function getAllTextFiles(rootUri: vscode.Uri, rootPath: string, maxLines: number, depth = 0): Promise<FileInfo[]> {
    if (depth > 5) return [];
    const results: FileInfo[] = [];

    let entries: [string, vscode.FileType][];
    try {
        entries = await vscode.workspace.fs.readDirectory(rootUri);
    } catch {
        return [];
    }

    for (const [name, type] of entries) {
        if (name.startsWith('.')) continue;
        if (type === vscode.FileType.Directory) {
            if (IGNORE_DIRS.has(name)) continue;
            const sub = await getAllTextFiles(vscode.Uri.joinPath(rootUri, name), rootPath, maxLines, depth + 1);
            results.push(...sub);
        } else {
            const ext = name.split('.').pop()?.toLowerCase() ?? '';
            const nameLower = name.toLowerCase();
            if (!TEXT_EXTENSIONS.has(ext) && !KNOWN_TEXT_FILENAMES.has(nameLower)) continue;
            const info = await readFile(vscode.Uri.joinPath(rootUri, name), rootPath, maxLines);
            if (info) results.push(info);
        }
    }

    return results;
}

async function getGitContext(): Promise<{ branch: string | null; status: string | null; recentChanges: string | null }> {
    try {
        const ext = vscode.extensions.getExtension<any>('vscode.git');
        if (!ext) return { branch: null, status: null, recentChanges: null };

        const api = ext.exports.getAPI(1);
        const repo = api.repositories[0];
        if (!repo) return { branch: null, status: null, recentChanges: null };

        const branch = repo.state.HEAD?.name ?? null;

        const allChanges = [
            ...repo.state.indexChanges.map((c: any) => ({ ...c, staged: true })),
            ...repo.state.workingTreeChanges.map((c: any) => ({ ...c, staged: false }))
        ];

        const statusSymbol = (s: number) => [' M', ' A', ' D', ' R', ' C', '??'][s] ?? '??';
        const statusLines = allChanges.slice(0, 30).map((c: any) =>
            `${c.staged ? 'S' : ' '}${statusSymbol(c.status)} ${path.basename(c.uri.fsPath)}`
        );

        const status = statusLines.length > 0
            ? `${statusLines.length} changed file(s):\n${statusLines.join('\n')}`
            : 'working tree clean';

        // Recent commits for context
        let recentChanges: string | null = null;
        try {
            const commits = await repo.log({ maxEntries: 5 });
            if (commits?.length) {
                recentChanges = commits
                    .map((c: any) => `${c.hash?.slice(0, 7) ?? '???????'} ${c.message?.split('\n')[0] ?? ''}`)
                    .join('\n');
            }
        } catch {
            // log() not always available
        }

        return { branch, status, recentChanges };
    } catch {
        return { branch: null, status: null, recentChanges: null };
    }
}

function getDiagnostics(rootPath: string): string | null {
    const all = vscode.languages.getDiagnostics();
    const errors: string[] = [];

    for (const [uri, diags] of all) {
        if (!uri.fsPath.startsWith(rootPath)) continue;
        const relPath = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
        for (const d of diags) {
            if (d.severity === vscode.DiagnosticSeverity.Error) {
                errors.push(`${relPath}:${d.range.start.line + 1} — ${d.message}`);
            }
        }
    }

    if (errors.length === 0) return null;
    return errors.slice(0, 20).join('\n');
}

const MANIFEST_NAMES = ['package.json', 'requirements.txt', 'Cargo.toml', 'go.mod', 'pyproject.toml', 'pom.xml', 'build.gradle'];
const CONFIG_NAMES = ['tsconfig.json', '.eslintrc.json', 'eslint.config.js', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.ts', 'webpack.config.js', '.env.example'];

async function getGitDiff(): Promise<string | null> {
    try {
        const ext = vscode.extensions.getExtension<any>('vscode.git');
        if (!ext) return null;
        const api = ext.exports.getAPI(1);
        const repo = api.repositories[0];
        if (!repo) return null;

        // getDiff returns the unstaged diff for working tree changes
        const changes = [...repo.state.indexChanges, ...repo.state.workingTreeChanges];
        if (changes.length === 0) return null;

        const diffParts: string[] = [];
        for (const change of changes.slice(0, 15)) {
            try {
                const diff = await repo.diffWithHEAD(change.uri.fsPath);
                if (diff) diffParts.push(diff);
            } catch { /* file may be new/untracked */ }
        }
        return diffParts.length > 0 ? diffParts.join('\n') : null;
    } catch {
        return null;
    }
}

export interface ContextSettings {
    maxOtherFilesLines: number;
    maxOpenTabs: number;
}

export const DEFAULT_CONTEXT_SETTINGS: ContextSettings = {
    maxOtherFilesLines: 200,
    maxOpenTabs: 6
};

export async function gatherContext(compact = false, allFiles = false, settings: ContextSettings = DEFAULT_CONTEXT_SETTINGS): Promise<WorkspaceContext> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
        throw new Error('No workspace folder open. Please open a folder first.');
    }

    const root = folders[0];
    const rootPath = root.uri.fsPath;
    const platform = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';
    const shell = process.platform === 'win32' ? 'PowerShell' : 'bash';

    const [fileTree, gitCtx] = await Promise.all([
        buildFileTree(root.uri),
        getGitContext()
    ]);

    // Active editor
    const editor = vscode.window.activeTextEditor;
    let activeFile: FileInfo | null = null;
    let selection: string | null = null;
    let selectionFile: string | null = null;
    let selectionRange: string | null = null;

    if (editor) {
        activeFile = await readFile(editor.document.uri, rootPath, MAX_ACTIVE_FILE_LINES);
        if (!editor.selection.isEmpty) {
            selection = editor.document.getText(editor.selection);
            selectionFile = activeFile?.path ?? null;
            const { start, end } = editor.selection;
            selectionRange = `lines ${start.line + 1}–${end.line + 1}`;
        }
    }

    let openFiles: FileInfo[] = [];
    let allWorkspaceFiles: FileInfo[] = [];
    let projectManifest: FileInfo | null = null;
    const configFiles: FileInfo[] = [];
    let gitDiff: string | null = null;

    if (compact) {
        gitDiff = await getGitDiff();
    } else if (allFiles) {
        // Walk every text file in the workspace, skip the active file (shown separately)
        const all = await getAllTextFiles(root.uri, rootPath, settings.maxOtherFilesLines);
        const activePath = activeFile?.path;
        allWorkspaceFiles = activePath ? all.filter(f => f.path !== activePath) : all;

        // Still include manifests and config in all-files mode
        for (const name of MANIFEST_NAMES) {
            const info = await readFile(vscode.Uri.joinPath(root.uri, name), rootPath, 300);
            if (info && !info.content.startsWith('[')) { projectManifest = info; break; }
        }
        for (const name of CONFIG_NAMES) {
            const info = await readFile(vscode.Uri.joinPath(root.uri, name), rootPath, 100);
            if (info && !info.content.startsWith('[')) configFiles.push(info);
        }
    } else {
        // Normal: open tabs only
        const seen = new Set<string>(editor ? [editor.document.uri.toString()] : []);
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (!(tab.input instanceof vscode.TabInputText)) continue;
                const uri = (tab.input as vscode.TabInputText).uri;
                if (uri.scheme !== 'file') continue;
                if (seen.has(uri.toString())) continue;
                seen.add(uri.toString());
                const info = await readFile(uri, rootPath, settings.maxOtherFilesLines);
                if (info) openFiles.push(info);
            }
        }

        for (const name of MANIFEST_NAMES) {
            const info = await readFile(vscode.Uri.joinPath(root.uri, name), rootPath, 300);
            if (info && !info.content.startsWith('[')) { projectManifest = info; break; }
        }
        for (const name of CONFIG_NAMES) {
            const info = await readFile(vscode.Uri.joinPath(root.uri, name), rootPath, 100);
            if (info && !info.content.startsWith('[')) configFiles.push(info);
        }
    }

    const diagnostics = getDiagnostics(rootPath);

    return {
        workspaceName: root.name,
        workspaceRoot: rootPath,
        platform,
        shell,
        fileTree,
        activeFile,
        openFiles,
        allWorkspaceFiles,
        selection,
        selectionFile,
        selectionRange,
        gitBranch: gitCtx.branch,
        gitStatus: gitCtx.status,
        recentChanges: gitCtx.recentChanges,
        gitDiff,
        projectManifest,
        configFiles,
        diagnostics
    };
}
