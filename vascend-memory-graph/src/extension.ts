// Extension host: registra i comandi, apre la webview del grafo, legge i file
// .vascend e dialoga con la webview tramite messaggi (selezione filtri,
// ricarica). Nessun accesso di rete: tutto locale.

import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  defaultMemoryDir,
  listProjects,
  readRecordsFromFile,
  loadAll,
  filterRecords,
  plansOf,
  actionsOf,
  buildGraph,
  VascendRecord,
  Graph,
} from './vascend';

interface Selection {
  project: string | null;
  plan: string | null;
  action: string | null;
}

interface Payload {
  memoryDir: string;
  fileCount: number;
  projects: { project: string; events: number; plans: number }[];
  plans: string[];
  actions: string[];
  selected: Selection;
  graph: Graph;
  recordCount: number;
}

const EMPTY_SELECTION: Selection = { project: null, plan: null, action: null };

function resolveMemoryDir(): string {
  const cfg = vscode.workspace.getConfiguration('vascendMemoryGraph').get<string>('memoryDir');
  const trimmed = (cfg || '').trim();
  return trimmed.length > 0 ? trimmed : defaultMemoryDir();
}

// Carica i record di base in funzione del progetto selezionato.
function baseRecords(dir: string, project: string | null): VascendRecord[] {
  if (project) {
    return readRecordsFromFile(path.join(dir, `${project}.vascend`));
  }
  return loadAll(dir);
}

function computePayload(dir: string, sel: Selection): Payload {
  const projects = listProjects(dir).map((p) => ({
    project: p.project,
    events: p.events,
    plans: p.plans,
  }));

  // Se il progetto selezionato non esiste piu', azzera la selezione.
  const project = sel.project && projects.some((p) => p.project === sel.project) ? sel.project : null;
  const base = baseRecords(dir, project);

  const plans = plansOf(base);
  const actions = actionsOf(base);
  const plan = sel.plan && plans.includes(sel.plan) ? sel.plan : null;
  const action = sel.action && actions.includes(sel.action) ? sel.action : null;

  const filtered = filterRecords(base, { plan, action });
  const graph = buildGraph(filtered);

  return {
    memoryDir: dir,
    fileCount: projects.length,
    projects,
    plans,
    actions,
    selected: { project, plan, action },
    graph,
    recordCount: filtered.length,
  };
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    `font-src ${webview.cspSource}`,
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Vascend Memory Graph</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

let panel: vscode.WebviewPanel | undefined;
let selection: Selection = { ...EMPTY_SELECTION };

function refreshPanel(): void {
  if (!panel) {
    return;
  }
  const dir = resolveMemoryDir();
  const payload = computePayload(dir, selection);
  selection = payload.selected;
  void panel.webview.postMessage({ type: 'data', payload });
}

function openPanel(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Active);
    refreshPanel();
    return;
  }
  panel = vscode.window.createWebviewPanel(
    'vascendMemoryGraph',
    'Vascend Memory Graph',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
    },
  );
  panel.webview.html = getHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage(
    (msg: { type: string; project?: string | null; plan?: string | null; action?: string | null }) => {
      switch (msg.type) {
        case 'ready':
          refreshPanel();
          break;
        case 'select':
          selection = {
            project: msg.project ?? null,
            plan: msg.plan ?? null,
            action: msg.action ?? null,
          };
          refreshPanel();
          break;
        case 'refresh':
          refreshPanel();
          break;
        default:
          break;
      }
    },
    undefined,
    context.subscriptions,
  );

  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions,
  );
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('vascend-memory-graph.open', () => openPanel(context)),
    vscode.commands.registerCommand('vascend-memory-graph.refresh', () => {
      if (panel) {
        refreshPanel();
      } else {
        openPanel(context);
      }
    }),
  );
}

export function deactivate(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}
