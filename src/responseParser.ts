export type ActionType = 'command' | 'file' | 'edit';

export interface CommandAction {
    id: string;
    type: 'command';
    command: string;
    description: string;
}

export interface FileAction {
    id: string;
    type: 'file';
    filePath: string;
    content: string;
    language: string;
    description: string;
    isNew: boolean;
}

export interface EditAction {
    id: string;
    type: 'edit';
    filePath: string;
    find: string;
    replace: string;
    description: string;
}

export type ParsedAction = CommandAction | FileAction | EditAction;

let counter = 0;
function uid(): string {
    return `action-${Date.now()}-${++counter}`;
}

interface RawMatch {
    action: ParsedAction;
    index: number;
}

export function parseResponse(response: string): ParsedAction[] {
    const matches: RawMatch[] = [];

    // ── ### RUN blocks ──────────────────────────────────────────────────────
    // Handles ```bash, ```sh, ```shell, or bare ```
    const runRe = /###\s+RUN[ \t]*\n```(?:bash|sh|shell|cmd|powershell|ps1)?\s*\n([\s\S]*?)```/gi;
    for (const m of response.matchAll(runRe)) {
        const command = m[1].trimEnd();
        if (!command) continue;
        matches.push({
            index: m.index ?? 0,
            action: {
                id: uid(),
                type: 'command',
                command,
                description: firstLine(command)
            }
        });
    }

    // ── ### FILE: path blocks ───────────────────────────────────────────────
    const fileRe = /###\s+FILE:\s*([^\n]+)\n```(\w*)\s*\n([\s\S]*?)```/gi;
    for (const m of response.matchAll(fileRe)) {
        const filePath = m[1].trim();
        const language = m[2].trim();
        const content = m[3];
        if (!filePath) continue;
        matches.push({
            index: m.index ?? 0,
            action: {
                id: uid(),
                type: 'file',
                filePath,
                content,
                language,
                description: filePath,
                isNew: false
            }
        });
    }

    // ── ### EDIT: path blocks ───────────────────────────────────────────────
    // Format:
    // ### EDIT: path
    // FIND:
    // ```
    // ...
    // ```
    // REPLACE:
    // ```
    // ...
    // ```
    const editRe = /###\s+EDIT:\s*([^\n]+)\nFIND:\s*\n```[^\n]*\n([\s\S]*?)```\s*\nREPLACE:\s*\n```[^\n]*\n([\s\S]*?)```/gi;
    for (const m of response.matchAll(editRe)) {
        const filePath = m[1].trim();
        const find = m[2];
        const replace = m[3];
        if (!filePath) continue;
        matches.push({
            index: m.index ?? 0,
            action: {
                id: uid(),
                type: 'edit',
                filePath,
                find,
                replace,
                description: `Edit ${filePath}: replace "${firstLine(find).slice(0, 50)}..."`
            }
        });
    }

    // Sort by order of appearance in the response
    matches.sort((a, b) => a.index - b.index);
    return matches.map(m => m.action);
}

function firstLine(text: string): string {
    return text.split('\n').find(l => l.trim()) ?? text.slice(0, 60);
}
