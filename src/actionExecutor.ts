import * as vscode from 'vscode';
import * as path from 'path';
import { ParsedAction } from './responseParser';

function workspaceRoot(): string {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) throw new Error('No workspace folder open');
    return root;
}

function resolveUri(filePath: string): vscode.Uri {
    const root = workspaceRoot();
    const abs = path.isAbsolute(filePath) ? filePath : path.join(root, filePath);
    return vscode.Uri.file(abs);
}

async function ensureParentDir(uri: vscode.Uri): Promise<void> {
    const parent = vscode.Uri.file(path.dirname(uri.fsPath));
    try { await vscode.workspace.fs.createDirectory(parent); } catch { /* already exists */ }
}

// Commands: type the command into a terminal but DON'T execute —
// user must press Enter. This is the safest possible command flow.
async function runCommand(command: string): Promise<void> {
    const terminal = vscode.window.createTerminal({
        name: 'Copilot Bridge',
        hideFromUser: false
    });
    terminal.show(true);
    // false = don't send Enter — user reviews and confirms by pressing Enter
    terminal.sendText(command, false);
}

async function writeFile(filePath: string, content: string): Promise<void> {
    const uri = resolveUri(filePath);
    await ensureParentDir(uri);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
}

async function editFile(filePath: string, find: string, replace: string): Promise<void> {
    const uri = resolveUri(filePath);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const original = Buffer.from(bytes).toString('utf8');

    if (!original.includes(find)) {
        throw new Error(
            `Search text not found in ${filePath}.\n\n` +
            `The file may have been edited since the prompt was generated. ` +
            `Re-copy the prompt to refresh context and try again.`
        );
    }

    // Only replace the first occurrence — safest for targeted edits
    const updated = original.replace(find, replace);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(updated, 'utf8'));

    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
}

export interface ExecuteResult {
    success: boolean;
    error?: string;
}

export async function executeAction(action: ParsedAction): Promise<ExecuteResult> {
    try {
        switch (action.type) {
            case 'command':
                await runCommand(action.command);
                break;
            case 'file':
                await writeFile(action.filePath, action.content);
                break;
            case 'edit':
                await editFile(action.filePath, action.find, action.replace);
                break;
        }
        return { success: true };
    } catch (err: any) {
        return { success: false, error: err?.message ?? String(err) };
    }
}

// Generates a unified diff .patch file the user can apply with: git apply <file>
export async function generatePatch(action: ParsedAction): Promise<string> {
    if (action.type === 'command') {
        throw new Error('Cannot generate a patch for a shell command.');
    }

    const root = workspaceRoot();
    let originalContent = '';
    let newContent = '';
    let relPath = action.filePath.replace(/\\/g, '/');

    if (action.type === 'file') {
        // New file or full rewrite
        try {
            const uri = resolveUri(action.filePath);
            const bytes = await vscode.workspace.fs.readFile(uri);
            originalContent = Buffer.from(bytes).toString('utf8');
        } catch {
            // New file — original is empty
        }
        newContent = action.content;
    } else {
        // Edit action
        const uri = resolveUri(action.filePath);
        const bytes = await vscode.workspace.fs.readFile(uri);
        originalContent = Buffer.from(bytes).toString('utf8');
        if (!originalContent.includes(action.find)) {
            throw new Error(`Search text not found in ${action.filePath}. The file may have changed.`);
        }
        newContent = originalContent.replace(action.find, action.replace);
    }

    const patch = buildUnifiedDiff(`a/${relPath}`, `b/${relPath}`, originalContent, newContent);

    // Save the patch file next to the target
    const patchName = path.basename(relPath).replace(/\.[^.]+$/, '') + '.patch';
    const patchPath = path.join(root, patchName);
    const patchUri = vscode.Uri.file(patchPath);
    await vscode.workspace.fs.writeFile(patchUri, Buffer.from(patch, 'utf8'));

    // Open it so the user can inspect it
    const doc = await vscode.workspace.openTextDocument(patchUri);
    await vscode.window.showTextDocument(doc, { preview: false });

    return patchPath;
}

function buildUnifiedDiff(aPath: string, bPath: string, original: string, updated: string): string {
    const aLines = original.split('\n');
    const bLines = updated.split('\n');

    const header = `--- ${aPath}\n+++ ${bPath}\n`;
    const chunks: string[] = [];

    // Simple line-by-line diff — produces a valid patch for git apply
    let i = 0, j = 0;
    while (i < aLines.length || j < bLines.length) {
        if (aLines[i] === bLines[j]) {
            i++; j++;
            continue;
        }
        // Find the extent of the change
        const aStart = i, bStart = j;
        while (i < aLines.length && (j >= bLines.length || aLines[i] !== bLines[j])) i++;
        while (j < bLines.length && (i >= aLines.length || aLines[i] !== bLines[j])) j++;

        const contextBefore = Math.max(0, aStart - 3);
        const contextAfter  = Math.min(aLines.length, i + 3);
        const bContextAfter = Math.min(bLines.length, j + 3);

        const aCount = (contextAfter - contextBefore);
        const bCount = (bContextAfter - contextBefore + (j - bStart) - (i - aStart));

        let chunk = `@@ -${contextBefore + 1},${aCount} +${contextBefore + 1},${bCount} @@\n`;

        for (let k = contextBefore; k < aStart; k++) chunk += ` ${aLines[k]}\n`;
        for (let k = aStart; k < i; k++)            chunk += `-${aLines[k]}\n`;
        for (let k = bStart; k < j; k++)            chunk += `+${bLines[k]}\n`;
        for (let k = i; k < contextAfter; k++)      chunk += ` ${aLines[k]}\n`;

        chunks.push(chunk);
    }

    if (chunks.length === 0) return header + '(no changes)\n';
    return header + chunks.join('');
}
