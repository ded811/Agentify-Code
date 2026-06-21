import * as vscode from 'vscode';
import { gatherContext, ContextSettings, DEFAULT_CONTEXT_SETTINGS } from './contextGatherer';
import { formatPrompt, DEFAULT_SYSTEM_INSTRUCTIONS } from './promptFormatter';
import { parseResponse, ParsedAction } from './responseParser';
import { executeAction, generatePatch } from './actionExecutor';

const STORAGE_KEY   = 'agentifyCode.systemPrompt';
const SETTINGS_KEY  = 'agentifyCode.contextSettings';

export class BridgeViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agentify-code.view';
    private _view?: vscode.WebviewView;

    constructor(private readonly _ctx: vscode.ExtensionContext) {}

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._ctx.extensionUri]
        };
        webviewView.webview.html = getHtml();

        // Push saved state once the webview renders
        const savedPrompt   = this._ctx.globalState.get<string>(STORAGE_KEY) ?? DEFAULT_SYSTEM_INSTRUCTIONS;
        const savedSettings = this._ctx.globalState.get<ContextSettings>(SETTINGS_KEY) ?? DEFAULT_CONTEXT_SETTINGS;
        setTimeout(() => {
            this._post({ command: 'loadSystemPrompt', prompt: savedPrompt });
            this._post({ command: 'loadSettings', settings: savedSettings });
        }, 150);

        webviewView.webview.onDidReceiveMessage(async (msg: any) => {
            switch (msg.command) {
                case 'gatherContext': {
                    this._post({ command: 'status', text: 'Scanning workspace...' });
                    try {
                        const systemPrompt  = this._ctx.globalState.get<string>(STORAGE_KEY);
                        const ctxSettings   = this._ctx.globalState.get<ContextSettings>(SETTINGS_KEY) ?? DEFAULT_CONTEXT_SETTINGS;
                        const ctx = await gatherContext(msg.compact ?? false, msg.allFiles ?? false, ctxSettings);
                        const prompt = formatPrompt(ctx, msg.userRequest ?? '', systemPrompt, ctxSettings.maxOpenTabs, ctxSettings.maxOtherFilesLines);
                        this._post({ command: 'promptReady', prompt });
                    } catch (e: any) {
                        this._post({ command: 'error', text: e?.message ?? String(e) });
                    }
                    break;
                }
                case 'copyPrompt': {
                    await vscode.env.clipboard.writeText(msg.prompt);
                    this._post({ command: 'copied' });
                    break;
                }
                case 'saveSystemPrompt': {
                    await this._ctx.globalState.update(STORAGE_KEY, msg.prompt);
                    this._post({ command: 'systemPromptSaved' });
                    break;
                }
                case 'resetSystemPrompt': {
                    await this._ctx.globalState.update(STORAGE_KEY, undefined);
                    this._post({ command: 'loadSystemPrompt', prompt: DEFAULT_SYSTEM_INSTRUCTIONS });
                    break;
                }
                case 'saveSettings': {
                    const s: ContextSettings = {
                        maxOpenTabs: Math.max(1, Math.min(20, Number(msg.maxOpenTabs) || DEFAULT_CONTEXT_SETTINGS.maxOpenTabs)),
                        maxOtherFilesLines: Math.max(50, Math.min(2000, Number(msg.maxOtherFilesLines) || DEFAULT_CONTEXT_SETTINGS.maxOtherFilesLines))
                    };
                    await this._ctx.globalState.update(SETTINGS_KEY, s);
                    this._post({ command: 'settingsSaved' });
                    break;
                }
                case 'parseResponse': {
                    try {
                        const actions = parseResponse(msg.response);
                        this._post({ command: 'actionsReady', actions });
                    } catch (e: any) {
                        this._post({ command: 'error', text: e?.message ?? String(e) });
                    }
                    break;
                }
                case 'executeAction': {
                    const result = await executeAction(msg.action as ParsedAction);
                    this._post({ command: 'actionResult', id: msg.action.id, ...result });
                    break;
                }
                case 'patchAction': {
                    try {
                        const patchPath = await generatePatch(msg.action as ParsedAction);
                        this._post({ command: 'patchResult', id: msg.action.id, patchPath });
                    } catch (e: any) {
                        this._post({ command: 'actionResult', id: msg.action.id, success: false, error: e?.message ?? String(e) });
                    }
                    break;
                }
            }
        });
    }

    public focus() {
        this._view?.show(true);
    }

    private _post(msg: object) {
        this._view?.webview.postMessage(msg);
    }
}

function getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>Agentify Code</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 14px 16px 24px;
    line-height: 1.5;
  }

  h1 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* ── Gear / settings panel ─────────────────────────────────── */
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
  }
  .header-row h1 { margin-bottom: 0; }

  .btn-gear {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--vscode-descriptionForeground);
    font-size: 16px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 3px;
    transition: color 0.15s;
  }
  .btn-gear:hover { color: var(--vscode-foreground); }
  .btn-gear.active { color: var(--vscode-textLink-foreground, #4da5ff); }

  #settings-panel {
    display: none;
    background: var(--vscode-sideBar-background, rgba(0,0,0,0.12));
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
    border-radius: 4px;
    padding: 12px;
    margin-bottom: 16px;
  }
  #settings-panel.open { display: block; }

  .settings-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .settings-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
  }
  .settings-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 7px;
    line-height: 1.5;
  }
  .settings-hint code {
    background: rgba(127,127,127,0.15);
    border-radius: 2px;
    padding: 1px 4px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .save-status {
    font-size: 11px;
    color: #4ec94e;
    min-height: 16px;
    margin-top: 6px;
  }

  .settings-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-bottom: 4px;
  }

  .settings-field {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .settings-field-label {
    font-size: 11px;
    color: var(--vscode-foreground);
    white-space: nowrap;
  }

  .settings-field-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .settings-field input[type=number] {
    width: 70px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(127,127,127,0.3));
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 12px;
    font-family: var(--vscode-font-family);
    outline: none;
  }

  .settings-field input[type=number]:focus {
    border-color: var(--vscode-focusBorder);
  }

  .section { margin-bottom: 18px; }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .step-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 17px; height: 17px;
    border-radius: 50%;
    background: var(--vscode-badge-background);
    color: var(--vscode-badge-foreground);
    font-size: 9px;
    font-weight: 700;
  }

  textarea {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, rgba(127,127,127,0.3));
    border-radius: 3px;
    padding: 7px 9px;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    resize: vertical;
    outline: none;
    line-height: 1.5;
  }
  textarea:focus { border-color: var(--vscode-focusBorder); }
  textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

  textarea.mono {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 11px;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 11px;
    border: none;
    border-radius: 3px;
    font-size: 12px;
    cursor: pointer;
    font-family: var(--vscode-font-family);
  }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-primary {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  .btn-primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }

  .btn-secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .btn-secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }

  .btn-sm {
    font-size: 11px;
    padding: 3px 9px;
  }

  .btn-approve { background: #2d6a2d; color: #d4f5d4; }
  .btn-approve:hover:not(:disabled) { background: #3a8a3a; }

  .btn-patch  { background: #1a4870; color: #a8d4ff; }
  .btn-patch:hover:not(:disabled)  { background: #235b8f; }

  .btn-reject {
    background: transparent;
    color: var(--vscode-errorForeground, #f48771);
    border: 1px solid currentColor;
  }
  .btn-reject:hover:not(:disabled) { background: rgba(244,135,113,0.1); }

  .row { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; }

  .status { font-size: 11px; color: var(--vscode-descriptionForeground); min-height: 16px; }
  .status.error   { color: var(--vscode-errorForeground, #f48771); }
  .status.success { color: #4ec94e; }

  .divider {
    border: none;
    border-top: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.2));
    margin: 16px 0;
  }

  /* Context mode radios */
  .mode-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 8px 0;
    font-size: 12px;
  }
  .mode-option {
    display: flex;
    align-items: baseline;
    gap: 6px;
    cursor: pointer;
  }
  .mode-option input[type=radio] { cursor: pointer; flex-shrink: 0; margin-top: 1px; }
  .mode-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  /* Prompt editor area */
  #prompt-section { display: none; }

  .prompt-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 5px;
  }
  .prompt-stats { font-size: 11px; color: var(--vscode-descriptionForeground); }

  /* Info banner */
  .banner {
    background: var(--vscode-editorInfo-background, rgba(0,100,200,0.12));
    border: 1px solid var(--vscode-editorInfo-border, rgba(0,100,200,0.25));
    border-radius: 3px;
    padding: 7px 10px;
    font-size: 11px;
    display: none;
    margin-top: 8px;
    line-height: 1.6;
  }
  .banner.show { display: block; }
  .banner strong { color: var(--vscode-textLink-foreground, #4da5ff); }

  /* Action cards */
  #actions-list { display: flex; flex-direction: column; gap: 9px; margin-top: 8px; }

  .action-card {
    border: 1px solid var(--vscode-panel-border, rgba(127,127,127,0.25));
    border-radius: 4px;
    overflow: hidden;
  }
  .action-card.approved { border-color: #3a7a3a; }
  .action-card.rejected { opacity: 0.4; }
  .action-card.done     { border-color: #4ec94e; }
  .action-card.patched  { border-color: #4da5ff; }
  .action-card.failed   { border-color: var(--vscode-errorForeground, #f48771); }

  .card-header {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    background: rgba(128,128,128,0.08);
  }

  .type-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 2px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .type-badge.command { background: #5c3800; color: #ffd080; }
  .type-badge.file    { background: #003d5c; color: #80d4ff; }
  .type-badge.edit    { background: #350060; color: #d8a0ff; }

  .card-title {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-state { font-size: 11px; flex-shrink: 0; }

  .card-body {
    padding: 8px 10px;
    border-top: 1px solid rgba(128,128,128,0.15);
  }

  pre.code-preview {
    font-size: 11px;
    font-family: var(--vscode-editor-font-family, monospace);
    background: rgba(0,0,0,0.18);
    border-radius: 3px;
    padding: 7px 9px;
    max-height: 160px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-word;
    margin-bottom: 8px;
    color: var(--vscode-foreground);
    line-height: 1.45;
  }

  .card-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

  .empty-state {
    text-align: center;
    padding: 18px;
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
  }
</style>
</head>
<body>

<div class="header-row">
  <h1>⬡ Agentify Code</h1>
  <button class="btn-gear" id="btn-gear" title="Edit system prompt">⚙</button>
</div>

<!-- ── SETTINGS PANEL ── -->
<div id="settings-panel">

  <!-- Context limits -->
  <div class="settings-header">
    <span class="settings-title">Context Settings</span>
    <button class="btn btn-primary btn-sm" id="btn-save-settings">Save</button>
  </div>
  <div class="settings-row">
    <div class="settings-field">
      <label class="settings-field-label" for="input-max-tabs">Open tabs to include</label>
      <input type="number" id="input-max-tabs" min="1" max="20" value="6">
      <span class="settings-field-hint">tabs</span>
    </div>
    <div class="settings-field">
      <label class="settings-field-label" for="input-max-lines">Lines per tab</label>
      <input type="number" id="input-max-lines" min="50" max="2000" value="200">
      <span class="settings-field-hint">lines</span>
    </div>
  </div>
  <div class="save-status" id="settings-save-status"></div>

  <hr class="divider" style="margin: 12px 0">

  <!-- System prompt -->
  <div class="settings-header">
    <span class="settings-title">System Prompt</span>
    <div class="row">
      <button class="btn btn-secondary btn-sm" id="btn-reset-prompt">↺ Reset</button>
      <button class="btn btn-primary btn-sm" id="btn-save-prompt">Save</button>
    </div>
  </div>
  <p class="settings-hint">
    Prepended to every prompt. Add project context, coding standards, anything the AI should always know.
    Use <code>{platform}</code> and <code>{shell}</code> as placeholders.
  </p>
  <textarea class="mono" id="system-prompt-editor" rows="14"></textarea>
  <div class="save-status" id="save-status"></div>

</div>

<!-- ── STEP 1 ── -->
<div class="section">
  <div class="section-label"><span class="step-badge">1</span> Your Request</div>

  <textarea id="request-input" rows="3"
    placeholder="What do you want help with? e.g. 'Fix the auth bug on line 42', 'Add unit tests for UserService', 'Refactor the API module'"></textarea>

  <div class="mode-group">
    <label class="mode-option">
      <input type="radio" name="ctx-mode" value="normal" checked>
      <span>Normal</span>
      <span class="mode-hint">— open tabs (up to limit)</span>
    </label>
    <label class="mode-option">
      <input type="radio" name="ctx-mode" value="compact">
      <span>Compact</span>
      <span class="mode-hint">— file tree + git diff + active file only</span>
    </label>
    <label class="mode-option">
      <input type="radio" name="ctx-mode" value="allfiles">
      <span>All Files</span>
      <span class="mode-hint">— every text file in the workspace</span>
    </label>
  </div>

  <div class="row">
    <button class="btn btn-primary" id="btn-build">⊞ Build Prompt</button>
    <span class="status" id="build-status"></span>
  </div>
</div>

<!-- Prompt editor (shown after build) -->
<div id="prompt-section" class="section">
  <div class="section-label">Prompt — edit before copying</div>
  <div class="prompt-toolbar">
    <span class="prompt-stats" id="prompt-stats"></span>
    <div class="row">
      <button class="btn btn-secondary btn-sm" id="btn-rebuild">↺ Rebuild</button>
      <button class="btn btn-primary" id="btn-copy">⎘ Copy to Clipboard</button>
    </div>
  </div>
  <textarea class="mono" id="prompt-editor" rows="14"></textarea>
  <div class="banner" id="copied-banner">
    ✓ Copied! <strong>Paste into Copilot</strong> (or any AI). Get the response, then paste it below.
  </div>
</div>

<hr class="divider">

<!-- ── STEP 2 ── -->
<div class="section">
  <div class="section-label"><span class="step-badge">2</span> Paste AI Response</div>
  <textarea id="response-input" rows="10"
    placeholder="Paste the full AI response here..."></textarea>
  <div class="row" style="margin-top:8px">
    <button class="btn btn-primary" id="btn-parse">⊞ Parse Actions</button>
    <span class="status" id="parse-status"></span>
  </div>
</div>

<hr class="divider">

<!-- ── STEP 3 ── -->
<div class="section">
  <div class="section-label"><span class="step-badge">3</span> Approve Actions</div>
  <div id="actions-list">
    <div class="empty-state" id="empty-state">Parse a response above to see suggested actions here.</div>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();

  const requestInput       = document.getElementById('request-input');
  const responseInput      = document.getElementById('response-input');
  const btnBuild           = document.getElementById('btn-build');
  const btnRebuild         = document.getElementById('btn-rebuild');
  const btnCopy            = document.getElementById('btn-copy');
  const btnParse           = document.getElementById('btn-parse');
  const buildStatus        = document.getElementById('build-status');
  const parseStatus        = document.getElementById('parse-status');
  const promptSection      = document.getElementById('prompt-section');
  const promptEditor       = document.getElementById('prompt-editor');
  const promptStats        = document.getElementById('prompt-stats');
  const copiedBanner       = document.getElementById('copied-banner');
  const actionsList        = document.getElementById('actions-list');
  const emptyState         = document.getElementById('empty-state');
  const btnGear            = document.getElementById('btn-gear');
  const settingsPanel      = document.getElementById('settings-panel');
  const systemPromptEditor = document.getElementById('system-prompt-editor');
  const btnSavePrompt      = document.getElementById('btn-save-prompt');
  const btnResetPrompt     = document.getElementById('btn-reset-prompt');
  const saveStatus         = document.getElementById('save-status');
  const inputMaxTabs       = document.getElementById('input-max-tabs');
  const inputMaxLines      = document.getElementById('input-max-lines');
  const btnSaveSettings    = document.getElementById('btn-save-settings');
  const settingsSaveStatus = document.getElementById('settings-save-status');

  // ── Gear / settings ───────────────────────────────────────────────────────
  btnGear.addEventListener('click', () => {
    const isOpen = settingsPanel.classList.toggle('open');
    btnGear.classList.toggle('active', isOpen);
  });

  btnSavePrompt.addEventListener('click', () => {
    vscode.postMessage({ command: 'saveSystemPrompt', prompt: systemPromptEditor.value });
  });

  btnResetPrompt.addEventListener('click', () => {
    vscode.postMessage({ command: 'resetSystemPrompt' });
  });

  btnSaveSettings.addEventListener('click', () => {
    vscode.postMessage({
      command: 'saveSettings',
      maxOpenTabs: inputMaxTabs.value,
      maxOtherFilesLines: inputMaxLines.value
    });
  });

  let pendingActions = {};

  // ── Build prompt ──────────────────────────────────────────────────────────
  function buildPrompt() {
    setStatus(buildStatus, 'Scanning workspace...', '');
    btnBuild.disabled = true;
    copiedBanner.classList.remove('show');
    const mode = document.querySelector('input[name="ctx-mode"]:checked').value;
    vscode.postMessage({
      command: 'gatherContext',
      userRequest: requestInput.value,
      compact: mode === 'compact',
      allFiles: mode === 'allfiles'
    });
  }

  btnBuild.addEventListener('click', buildPrompt);
  btnRebuild.addEventListener('click', buildPrompt);

  // ── Copy prompt ───────────────────────────────────────────────────────────
  btnCopy.addEventListener('click', () => {
    vscode.postMessage({ command: 'copyPrompt', prompt: promptEditor.value });
  });

  // Update stats as user edits the prompt
  promptEditor.addEventListener('input', updateStats);

  function updateStats() {
    const chars = promptEditor.value.length;
    const tokens = Math.round(chars / 4);
    promptStats.textContent = \`~\${tokens.toLocaleString()} tokens · \${chars.toLocaleString()} chars\`;
  }

  // ── Parse response ────────────────────────────────────────────────────────
  btnParse.addEventListener('click', () => {
    const text = responseInput.value.trim();
    if (!text) { setStatus(parseStatus, 'Paste a response first.', 'error'); return; }
    setStatus(parseStatus, 'Parsing...', '');
    vscode.postMessage({ command: 'parseResponse', response: text });
  });

  // ── Messages from extension ───────────────────────────────────────────────
  window.addEventListener('message', e => {
    const msg = e.data;
    switch (msg.command) {

      case 'status':
        setStatus(buildStatus, msg.text, '');
        break;

      case 'promptReady': {
        btnBuild.disabled = false;
        promptEditor.value = msg.prompt;
        promptSection.style.display = 'block';
        updateStats();
        setStatus(buildStatus, '', '');
        break;
      }

      case 'loadSystemPrompt':
        systemPromptEditor.value = msg.prompt;
        break;

      case 'loadSettings':
        inputMaxTabs.value  = msg.settings.maxOpenTabs;
        inputMaxLines.value = msg.settings.maxOtherFilesLines;
        break;

      case 'systemPromptSaved':
        saveStatus.textContent = '✓ Saved';
        setTimeout(() => { saveStatus.textContent = ''; }, 2500);
        break;

      case 'settingsSaved':
        settingsSaveStatus.textContent = '✓ Saved';
        setTimeout(() => { settingsSaveStatus.textContent = ''; }, 2500);
        break;

      case 'copied':
        copiedBanner.classList.add('show');
        break;

      case 'actionsReady': {
        renderActions(msg.actions);
        const n = msg.actions.length;
        if (n === 0) {
          setStatus(parseStatus,
            'No actions found. Make sure the AI used the correct format (### RUN, ### FILE:, ### EDIT:).',
            'error');
        } else {
          setStatus(parseStatus, \`Found \${n} action\${n !== 1 ? 's' : ''} — approve or reject each one below.\`, 'success');
        }
        break;
      }

      case 'actionResult': {
        if (msg.success) {
          updateCard(msg.id, 'done', null);
        } else {
          updateCard(msg.id, 'failed', msg.error);
        }
        break;
      }

      case 'patchResult': {
        updateCard(msg.id, 'patched', null, msg.patchPath);
        break;
      }

      case 'error':
        btnBuild.disabled = false;
        setStatus(buildStatus, msg.text, 'error');
        break;
    }
  });

  // ── Render action cards ───────────────────────────────────────────────────
  function renderActions(actions) {
    pendingActions = {};
    if (actions.length === 0) {
      actionsList.innerHTML = '';
      actionsList.appendChild(emptyState);
      emptyState.style.display = 'block';
      return;
    }
    emptyState.style.display = 'none';
    actionsList.innerHTML = '';
    for (const a of actions) {
      pendingActions[a.id] = a;
      actionsList.appendChild(buildCard(a));
    }
  }

  function buildCard(action) {
    const card = document.createElement('div');
    card.className = 'action-card';
    card.dataset.id = action.id;

    const typeName  = action.type === 'command' ? 'RUN' : action.type === 'file' ? 'FILE' : 'EDIT';
    const isFileOp  = action.type === 'file' || action.type === 'edit';

    let preview = '';
    if (action.type === 'command') {
      preview = action.command;
    } else if (action.type === 'file') {
      const lines = action.content.split('\\n');
      preview = lines.slice(0, 25).join('\\n') + (lines.length > 25 ? \`\\n\\n… (\${lines.length} lines total)\` : '');
    } else {
      preview = \`FIND:\\n\${action.find.slice(0, 250)}\\n\\nREPLACE:\\n\${action.replace.slice(0, 250)}\`;
    }

    const title = escHtml(action.description || action.filePath || action.command || '');

    const patchBtn = isFileOp
      ? \`<button class="btn btn-patch btn-sm" onclick="patchAction('\${action.id}')">⇲ Save as Patch</button>\`
      : '';

    card.innerHTML = \`
      <div class="card-header">
        <span class="type-badge \${action.type}">\${typeName}</span>
        <span class="card-title" title="\${title}">\${title}</span>
        <span class="card-state" id="state-\${action.id}"></span>
      </div>
      <div class="card-body">
        <pre class="code-preview">\${escHtml(preview)}</pre>
        <div class="card-actions" id="btns-\${action.id}">
          <button class="btn btn-approve btn-sm" onclick="approveAction('\${action.id}')">✓ Apply</button>
          \${patchBtn}
          <button class="btn btn-reject btn-sm"  onclick="rejectAction('\${action.id}')">✗ Skip</button>
        </div>
      </div>
    \`;
    return card;
  }

  window.approveAction = function(id) {
    setBtns(id, false);
    setState(id, '⏳', '');
    vscode.postMessage({ command: 'executeAction', action: pendingActions[id] });
  };

  window.patchAction = function(id) {
    setBtns(id, false);
    setState(id, '⏳ saving patch…', '');
    vscode.postMessage({ command: 'patchAction', action: pendingActions[id] });
  };

  window.rejectAction = function(id) {
    document.querySelector('[data-id="' + id + '"]').className = 'action-card rejected';
    setState(id, '✗ skipped', 'var(--vscode-descriptionForeground)');
    setBtns(id, false);
  };

  function updateCard(id, state, error, patchPath) {
    const card = document.querySelector('[data-id="' + id + '"]');
    if (!card) return;
    card.className = 'action-card ' + state;
    setBtns(id, false);

    if (state === 'done') {
      setState(id, '✓ applied', '#4ec94e');
    } else if (state === 'patched') {
      setState(id, '✓ patch saved', '#4da5ff');
      const btnsEl = document.getElementById('btns-' + id);
      if (btnsEl && patchPath) {
        btnsEl.innerHTML = \`<span style="font-size:11px;color:var(--vscode-descriptionForeground)">\${escHtml(patchPath)}</span>\`;
      }
    } else if (state === 'failed') {
      setState(id, '✗ failed', 'var(--vscode-errorForeground,#f48771)');
      const btnsEl = document.getElementById('btns-' + id);
      if (btnsEl) {
        btnsEl.innerHTML = \`<span style="font-size:11px;color:var(--vscode-errorForeground,#f48771)">\${escHtml(error || 'Unknown error')}</span>\`;
      }
    }
  }

  function setState(id, text, color) {
    const el = document.getElementById('state-' + id);
    if (el) { el.textContent = text; if (color) el.style.color = color; }
  }

  function setBtns(id, enabled) {
    const el = document.getElementById('btns-' + id);
    if (!el) return;
    el.querySelectorAll('button').forEach(b => b.disabled = !enabled);
    if (!enabled) el.innerHTML = '';
  }

  function setStatus(el, text, type) {
    el.textContent = text;
    el.className = 'status' + (type ? ' ' + type : '');
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
</script>
</body>
</html>`;
}
