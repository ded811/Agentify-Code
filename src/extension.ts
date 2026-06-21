import * as vscode from 'vscode';
import { BridgeViewProvider } from './panel';

export function activate(context: vscode.ExtensionContext) {
    const provider = new BridgeViewProvider(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(BridgeViewProvider.viewType, provider, {
            webviewOptions: { retainContextWhenHidden: true }
        })
    );

    // Command focuses the sidebar view (works from command palette + editor title button)
    context.subscriptions.push(
        vscode.commands.registerCommand('agentify-code.open', () => {
            vscode.commands.executeCommand('agentify-code.view.focus');
        })
    );
}

export function deactivate() {}
