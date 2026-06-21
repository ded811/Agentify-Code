# Agentify Code

Turn any AI into a coding agent inside VS Code — no API key required.

Agentify Code builds a rich, structured prompt from your workspace (files, git status, errors, open tabs) and copies it to your clipboard. Paste it into any AI app you already have access to — Microsoft Copilot, ChatGPT, Claude, Gemini, anything. Paste the response back, and the extension parses it into individual actions (file edits, new files, shell commands) that you approve one by one before anything runs.

---

## How It Works

1. **Build Prompt** — the extension scans your workspace and assembles a detailed context prompt automatically
2. **Paste into any AI** — paste into Copilot, ChatGPT, Claude, or any chat interface you use
3. **Paste the response back** — drop the AI's full response into the extension
4. **Approve actions** — each suggested file change or command shows as a card; you approve or skip individually
5. **Execute** — file edits apply instantly; commands are pre-typed in a terminal but don't run until you press Enter

---

## Requirements

- [VS Code](https://code.visualstudio.com/) 1.85 or later
- [Node.js](https://nodejs.org/) (LTS) — only needed to build from source

---

## Installation

### Option A — Install from folder (recommended)

1. Clone or download this repository
2. Open a terminal in the `Agentify Code` folder
3. Run:
   ```
   npm install
   npm run compile
   ```
4. Copy the folder to your VS Code extensions directory:
   - **Windows:** `%USERPROFILE%\.vscode\extensions\agentify-code-0.1.0`
   - **macOS/Linux:** `~/.vscode/extensions/agentify-code-0.1.0`
5. Restart VS Code

### Option B — Run in development mode

1. Clone the repository
2. Open the `Agentify Code` folder in VS Code
3. Run `npm install` in the terminal
4. Press **F5** — a new VS Code window opens with the extension loaded

---

## Usage

### Opening the panel

- Click the **Agentify Code icon** in the Activity Bar (left sidebar)
- Or open the Command Palette (`Ctrl+Shift+P`) and run **Agentify Code: Open**

### Step 1 — Build your prompt

- Type what you want help with in the request box
- Toggle **Compact mode** for large codebases (sends file tree + git diff only, skips open tabs)
- Click **Build Prompt** — your workspace context is scanned and the prompt is copied to clipboard automatically
- The prompt appears in an editable textarea so you can tweak it before copying

### Step 2 — Paste into your AI

- Paste the prompt into any AI app (Microsoft Copilot, ChatGPT, Claude, Gemini, etc.)
- The AI receives your full file contents, project structure, git status, and errors as part of the message — no file uploads needed

### Step 3 — Paste the response back

- Copy the AI's full response
- Paste it into the response box in the panel
- Click **Parse Actions**

### Step 4 — Approve actions

Each detected action appears as a card showing a preview:

| Button | What it does |
|--------|-------------|
| **Apply** | Writes the file change or pre-types the command in a terminal |
| **Save as Patch** | Saves a `.patch` file you can apply with `git apply` |
| **Skip** | Ignores this action |

> Commands are **never executed automatically** — they are typed into a terminal and wait for you to press Enter.

---

## Settings (⚙ Gear Icon)

Click the gear icon in the top-right corner of the panel to configure:

### Context Settings
- **Open tabs to include** — how many open editor tabs to send (default: 6, max: 20)
- **Lines per tab** — max lines to include per file (default: 200, max: 2000). Increase this for larger files.

### System Prompt
- Edit the master prompt that is prepended to every request
- Add project-specific context, coding standards, or anything the AI should always know
- Use `{platform}` and `{shell}` as placeholders — they are filled in automatically
- Click **Save** to persist across sessions, **Reset** to restore the default

---

## What Gets Included in the Prompt

| Content | Normal mode | Compact mode |
|---------|-------------|--------------|
| File tree (names only) | ✓ | ✓ |
| Currently active file (full) | ✓ | ✓ |
| Other open tabs | ✓ up to limit | ✗ |
| package.json / go.mod / etc. | ✓ | ✗ |
| tsconfig / eslint config | ✓ | ✗ |
| Git branch + status | ✓ | ✓ |
| Git diff (changed code) | ✗ | ✓ |
| Editor errors | ✓ | ✗ |
| Selected code | ✓ | ✓ |

**Tip:** Open the files you want the AI to know about as tabs before clicking Build Prompt. The file you have actively focused becomes the primary context.

---

## AI Response Format

For best results, tell your AI to follow this format (the default system prompt already instructs it to do this):

**Run a shell command:**
```
### RUN
```bash
command here
```
```

**Create or rewrite a file:**
```
### FILE: path/to/file.ts
```typescript
file contents here
```
```

**Edit part of a file:**
```
### EDIT: path/to/file.ts
FIND:
```
exact text to find
```
REPLACE:
```
replacement text
```
```

---

## License

MIT
