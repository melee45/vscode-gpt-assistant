import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import askGPT from './gpt';

// --- Load/save conversation ---
async function loadConversation(storageUri: vscode.Uri): Promise<{ role: string; content: string }[]> {
  try {
    const filePath = path.join(storageUri.fsPath, 'conversation.json');
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [{ role: "system", content: "You are a helpful coding assistant." }];
  }
}

async function saveConversation(storageUri: vscode.Uri, conversation: { role: string; content: string }[]) {
  const filePath = path.join(storageUri.fsPath, 'conversation.json');
  await fs.mkdir(storageUri.fsPath, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf8');
}

// --- CodeLens Provider ---
export class GPTCodeLensProvider implements vscode.CodeLensProvider {
  private codeLenses: vscode.CodeLens[] = [];
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private suggestions: Map<string, string> = new Map();
  private dismissedDocuments: Set<string> = new Set();

  constructor() {
    vscode.workspace.onDidChangeConfiguration(() => {
      this._onDidChangeCodeLenses.fire();
    });
  }

  public async fetchSuggestionForDocument(document: vscode.TextDocument) {
    const prompt = `Suggest a useful improvement or completion for the following code:\n\n${document.getText().slice(0, 1000)}`;

    const messages = [
      { role: "system", content: "You are a helpful coding assistant." },
      { role: "user", content: prompt }
    ];

    try {
      const suggestion = await askGPT(messages);
      this.suggestions.set(document.uri.toString(), suggestion.trim());
    } catch {
      this.suggestions.set(document.uri.toString(), "Error fetching suggestion");
    }

    this._onDidChangeCodeLenses.fire();
  }

  public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    this.codeLenses = [];

    if (this.dismissedDocuments.has(document.uri.toString())) return [];

    const range = document.lineAt(0).range;
    const suggestion = this.suggestions.get(document.uri.toString());

    let title = suggestion ?? 'Loading GPT suggestion...';

    const command: vscode.Command = {
      command: 'gpt-assistant.insertSuggestion',
      title,
      arguments: [suggestion ?? '', 0]
    };

    const codeLens = new vscode.CodeLens(range, command);
    (codeLens as any).tooltip = suggestion ?? 'Loading...';

    this.codeLenses.push(codeLens);
    return this.codeLenses;
  }

  public dismissSuggestionsForDocument(uri: vscode.Uri) {
    this.dismissedDocuments.add(uri.toString());
    this._onDidChangeCodeLenses.fire();
  }

  public clearDismissalForDocument(uri: vscode.Uri) {
    this.dismissedDocuments.delete(uri.toString());
    this._onDidChangeCodeLenses.fire();
  }
}

// --- Extension Activate ---
export async function activate(context: vscode.ExtensionContext) {
  console.log('GPT Assistant is now active!');
  const outputChannel = vscode.window.createOutputChannel('GPT Assistant');
  const storageUri = context.globalStorageUri;
  let conversation = await loadConversation(storageUri);

  const codeLensProvider = new GPTCodeLensProvider();

  // Ask Command
  const askDisposable = vscode.commands.registerCommand('gpt-assistant.ask', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return vscode.window.showInformationMessage('Open a file to use GPT Assistant.');

    const code = editor.selection.isEmpty
      ? editor.document.getText()
      : editor.document.getText(editor.selection);

    const prompt = await vscode.window.showInputBox({ placeHolder: 'Ask GPT something about your code...' });
    if (!prompt) return vscode.window.showInformationMessage('No prompt provided.');

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Asking GPT...",
      cancellable: false
    }, async () => {
      try {
        if (code) conversation.push({ role: "user", content: `Code:\n${code}` });
        conversation.push({ role: "user", content: prompt });

        const answer = await askGPT(conversation);
        conversation.push({ role: "assistant", content: answer });
        await saveConversation(storageUri, conversation);

        outputChannel.appendLine(`\n> Prompt: ${prompt}`);
        outputChannel.appendLine(`GPT Response:\n${answer}`);
        outputChannel.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Error: ${err}`);
      }
    });
  });

  // Insert Suggestion
  const insertDisposable = vscode.commands.registerCommand('gpt-assistant.insertSuggestion', async (suggestion: string, line: number) => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    await editor.edit(editBuilder => {
      editBuilder.insert(new vscode.Position(line, 0), suggestion + '\n');
    });
    vscode.window.showInformationMessage('Suggestion inserted!');
  });

  // Dismiss Suggestion
  const dismissDisposable = vscode.commands.registerCommand('gpt-assistant.dismissSuggestion', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    codeLensProvider.dismissSuggestionsForDocument(editor.document.uri);
    vscode.window.showInformationMessage('Suggestions dismissed for this document.');
  });

  // Refresh Suggestion
  const refreshDisposable = vscode.commands.registerCommand('gpt-assistant.refreshSuggestion', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    codeLensProvider.clearDismissalForDocument(editor.document.uri);
    await codeLensProvider.fetchSuggestionForDocument(editor.document);
    vscode.window.showInformationMessage('Suggestions refreshed.');
  });

  // Typing trigger
  let typingTimer: NodeJS.Timeout | undefined = undefined;
  const textChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document !== vscode.window.activeTextEditor?.document) return;

    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const pos = editor.selection.active;
      const snippet = editor.document.getText(new vscode.Range(
        new vscode.Position(Math.max(0, pos.line - 10), 0),
        pos
      ));

      try {
        const prompt = `Suggest a code completion or improvement for:\n\n${snippet}`;
        const suggestion = await askGPT([{ role: 'system', content: 'You are a helpful coding assistant.' }, { role: 'user', content: prompt }]);
        showSuggestionInline(suggestion.trim(), editor, pos);
      } catch (err) {
        vscode.window.showErrorMessage(`GPT Error: ${err}`);
      }
    }, 1000);
  });

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { scheme: 'file', language: '*' },
    {
      async provideCompletionItems(document, position) {
        const snippet = document.getText(new vscode.Range(
          new vscode.Position(Math.max(0, position.line - 10), 0),
          position
        ));
        const prompt = `Complete or suggest improvement for:\n\n${snippet}`;
        const suggestion = await askGPT([{ role: "system", content: "You are a helpful coding assistant." }, { role: "user", content: prompt }]);

        const item = new vscode.CompletionItem(suggestion.trim(), vscode.CompletionItemKind.Snippet);
        item.range = new vscode.Range(position.translate(0, -snippet.length), position);
        return [item];
      }
    },
    '.'
  );

  // Register providers
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: '*' }, codeLensProvider),
    askDisposable,
    insertDisposable,
    dismissDisposable,
    refreshDisposable,
    textChangeListener,
    completionProvider
  );
  let chatPanel: vscode.WebviewPanel | undefined;

context.subscriptions.push(
  vscode.commands.registerCommand('gpt-assistant.openChat', () => {
    if (chatPanel) {
      chatPanel.reveal(vscode.ViewColumn.Two);
      return;
    }

    chatPanel = vscode.window.createWebviewPanel(
      'gptChat',
      'GPT Chat',
      { viewColumn: vscode.ViewColumn.Two, preserveFocus: false },
      {
        enableScripts: true,
      }
    );

    chatPanel.webview.html = getWebviewContent();

    // Message handler from webview
    chatPanel.webview.onDidReceiveMessage(async message => {
      switch (message.command) {
        case 'sendMessage':
          {
            const userMsg = message.text as string;
            // You can store and maintain conversation context here if you want
            try {
              const response = await askGPT([
                { role: 'system', content: 'You are a helpful coding assistant.' },
                { role: 'user', content: userMsg }
              ]);
              chatPanel?.webview.postMessage({ command: 'showResponse', text: response });
            } catch (err) {
              chatPanel?.webview.postMessage({ command: 'showResponse', text: `Error: ${err}` });
            }
          }
          break;
      }
    });

    chatPanel.onDidDispose(() => {
      chatPanel = undefined;
    });
  })
);

// Simple HTML UI for chat panel
function getWebviewContent() {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <style>
      body {
        font-family: sans-serif;
        padding: 10px;
      }
      #messages {
        height: 300px;
        overflow-y: auto;
        border: 1px solid #ddd;
        padding: 5px;
        margin-bottom: 10px;
      }
      .message {
        margin-bottom: 8px;
      }
      .user {
        color: blue;
      }
      .assistant {
        color: green;
      }
      #input {
        width: 80%;
      }
      #send {
        width: 15%;
      }
    </style>
  </head>
  <body>
    <div id="messages"></div>
    <input id="input" type="text" placeholder="Type your message..." />
    <button id="send">Send</button>

    <script>
      const vscode = acquireVsCodeApi();

      const messagesDiv = document.getElementById('messages');
      const input = document.getElementById('input');
      const sendBtn = document.getElementById('send');

      function appendMessage(text, sender) {
        const div = document.createElement('div');
        div.textContent = (sender === 'user' ? 'You: ' : 'GPT: ') + text;
        div.className = 'message ' + sender;
        messagesDiv.appendChild(div);
        messagesDiv.scrollTop = messagesDiv.scrollHeight;
      }

      sendBtn.addEventListener('click', () => {
        const text = input.value.trim();
        if (!text) return;
        appendMessage(text, 'user');
        vscode.postMessage({ command: 'sendMessage', text });
        input.value = '';
      });

      window.addEventListener('message', event => {
        const message = event.data;
        switch (message.command) {
          case 'showResponse':
            appendMessage(message.text, 'assistant');
            break;
        }
      });

      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          sendBtn.click();
          e.preventDefault();
        }
      });
    </script>
  </body>
  </html>
  `;
}

}

export function deactivate() {}

// --- Inline Suggestion UI ---
function showSuggestionInline(suggestion: string, editor: vscode.TextEditor, position: vscode.Position) {
  const decorationType = vscode.window.createTextEditorDecorationType({
    after: {
      contentText: `💡 ${suggestion.slice(0, 60)}... [Insert] [Dismiss]`,
      backgroundColor: 'rgba(100, 100, 255, 0.1)',
      margin: '0 0 0 5px',
      color: '#007ACC',
      fontWeight: 'bold',
      textDecoration: 'underline',
      fontStyle: 'normal',
    }
  });

  editor.setDecorations(decorationType, [new vscode.Range(position, position)]);

  vscode.window.showInformationMessage('GPT Suggestion available', 'Insert', 'Dismiss').then(action => {
    if (action === 'Insert') {
      editor.edit(editBuilder => {
        editBuilder.insert(position, suggestion);
      });
    }
    decorationType.dispose();
  });

  setTimeout(() => decorationType.dispose(), 10000);
}