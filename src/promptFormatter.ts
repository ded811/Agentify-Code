import { WorkspaceContext } from './contextGatherer';

// Maps file extension to markdown code fence language tag
const EXT_LANG: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', cjs: 'javascript', py: 'python', rs: 'rust',
    go: 'go', java: 'java', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
    html: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', md: 'markdown', sh: 'bash', bash: 'bash',
    ps1: 'powershell', sql: 'sql', graphql: 'graphql', proto: 'protobuf',
    xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte'
};

function langFor(filePath: string): string {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    return EXT_LANG[ext] ?? '';
}

// This is the core system instruction — it tells the AI exactly how to format
// responses so the parser can reliably extract actions.
const SYSTEM_INSTRUCTIONS = `You are a senior software engineer acting as a coding agent for this workspace. The user is using a bridge tool that parses your responses and presents each suggested action for their approval before anything is executed or written to disk.

## HOW TO RESPOND

Wrap your ENTIRE response in a single triple-tilde code fence like this:
~~~
your full response here
~~~
This is critical — it prevents the chat interface from rendering the action blocks as formatted markdown and gives the user a single copy button to grab the raw text. Do not use backtick fences for the outer wrapper, only tildes.

Freely mix explanation with actions. Always explain briefly what you are doing and why before each action block.

## ACTION FORMATS

**Run a shell command** (user must press Enter in terminal to confirm):
### RUN
\`\`\`bash
<command>
\`\`\`

**Create a new file or fully rewrite an existing one:**
### FILE: <relative/path/to/file>
\`\`\`<language>
<complete file contents — never truncate>
\`\`\`

**Edit part of an existing file** (preferred for small targeted changes):
### EDIT: <relative/path/to/file>
FIND:
\`\`\`
<exact verbatim text from the file — must match character-for-character>
\`\`\`
REPLACE:
\`\`\`
<replacement text>
\`\`\`

## RULES
- Prefer EDIT over FILE when changing < 50% of a file
- Use FILE for new files or large rewrites
- FIND text must be exact — copy it verbatim from the file contents provided
- Commands are shown to the user before running — they press Enter to execute
- You have full file contents below; use them
- Be complete — never leave TODOs or placeholder implementations
- The user is on ${'{platform}'} using ${'{shell}'}`;

export { SYSTEM_INSTRUCTIONS as DEFAULT_SYSTEM_INSTRUCTIONS };

export function formatPrompt(ctx: WorkspaceContext, userRequest: string, customSystemPrompt?: string, maxOpenTabs = 6, maxOtherLines = 200): string {
    const base = customSystemPrompt ?? SYSTEM_INSTRUCTIONS;
    const instructions = base
        .replace('{platform}', ctx.platform)
        .replace('{shell}', ctx.shell);

    const parts: string[] = [instructions, '\n---\n'];

    // ── Workspace metadata ──────────────────────────────────────────────────
    parts.push('## Workspace');
    parts.push(`- **Project:** ${ctx.workspaceName}`);
    parts.push(`- **Root:** \`${ctx.workspaceRoot}\``);
    parts.push(`- **Platform:** ${ctx.platform} / ${ctx.shell}`);
    if (ctx.gitBranch) parts.push(`- **Branch:** \`${ctx.gitBranch}\``);

    if (ctx.gitStatus) {
        parts.push('\n**Git status:**');
        parts.push('```');
        parts.push(ctx.gitStatus);
        parts.push('```');
    }

    if (ctx.recentChanges) {
        parts.push('\n**Recent commits:**');
        parts.push('```');
        parts.push(ctx.recentChanges);
        parts.push('```');
    }

    // ── Current errors ──────────────────────────────────────────────────────
    if (ctx.diagnostics) {
        parts.push('\n## Current Errors (from editor)');
        parts.push('```');
        parts.push(ctx.diagnostics);
        parts.push('```');
    }

    // ── File tree ───────────────────────────────────────────────────────────
    if (ctx.fileTree) {
        parts.push('\n## File Tree');
        parts.push('```');
        parts.push(ctx.fileTree);
        parts.push('```');
    }

    // ── Git diff (compact mode) ─────────────────────────────────────────────
    if (ctx.gitDiff) {
        parts.push('\n## Git Diff (current uncommitted changes)');
        parts.push('```diff');
        parts.push(ctx.gitDiff.slice(0, 8000) + (ctx.gitDiff.length > 8000 ? '\n... [diff truncated]' : ''));
        parts.push('```');
    }

    // ── Project manifest ────────────────────────────────────────────────────
    if (ctx.projectManifest) {
        const f = ctx.projectManifest;
        parts.push(`\n## ${f.path}`);
        parts.push(`\`\`\`${langFor(f.path)}`);
        parts.push(f.content);
        parts.push('```');
    }

    // ── Config files ────────────────────────────────────────────────────────
    for (const f of ctx.configFiles) {
        parts.push(`\n## ${f.path}`);
        parts.push(`\`\`\`${langFor(f.path)}`);
        parts.push(f.content);
        parts.push('```');
    }

    // ── Active file (highest priority) ──────────────────────────────────────
    if (ctx.activeFile) {
        const f = ctx.activeFile;
        const note = f.truncated ? ` *(showing first ${MAX_ACTIVE_LINES} of ${f.totalLines} lines)*` : '';
        parts.push(`\n## Currently Open: ${f.path}${note}`);
        parts.push(`\`\`\`${langFor(f.path)}`);
        parts.push(f.content);
        parts.push('```');
    }

    // ── Selection (highest specificity) ────────────────────────────────────
    if (ctx.selection && ctx.selectionFile) {
        parts.push(`\n## Selected Code — ${ctx.selectionFile}${ctx.selectionRange ? ` (${ctx.selectionRange})` : ''}`);
        parts.push(`\`\`\`${langFor(ctx.selectionFile)}`);
        parts.push(ctx.selection);
        parts.push('```');
    }

    // ── Other open files ────────────────────────────────────────────────────
    if (ctx.openFiles.length > 0) {
        const files = ctx.openFiles.slice(0, maxOpenTabs);
        parts.push(`\n## Other Open Files (${files.length} of ${ctx.openFiles.length} tabs)`);
        for (const f of files) {
            const note = f.truncated ? ` *(first ${maxOtherLines} of ${f.totalLines} lines)*` : '';
            parts.push(`\n### ${f.path}${note}`);
            parts.push(`\`\`\`${langFor(f.path)}`);
            parts.push(f.content);
            parts.push('```');
        }
    }

    // ── User request ────────────────────────────────────────────────────────
    parts.push('\n---\n');
    parts.push('## Your Task');
    parts.push(userRequest.trim() || '*(No specific request — review the context and suggest what should be improved, fixed, or done next.)*');

    return parts.join('\n');
}

const MAX_ACTIVE_LINES = 600;
