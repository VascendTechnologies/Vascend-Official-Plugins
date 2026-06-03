// Genera graph-preview.html: una pagina standalone che esegue ESATTAMENTE
// media/main.js (lo stesso codice della webview dell'estensione) con i dati
// .vascend reali, applicando il tema dark di VSCode. Serve per catturare uno
// screenshot fedele del grafo fuori da VSCode (che non espone screenshot della
// webview). I dati arrivano da out/vascend.js (il core compilato dell'estensione).
'use strict';
const fs = require('fs');
const path = require('path');
const v = require(path.join(__dirname, '..', 'out', 'vascend.js'));

const dir = v.defaultMemoryDir();
const all = v.loadAll(dir);
const projects = v.listProjects(dir).map((p) => ({ project: p.project, events: p.events, plans: p.plans }));
const payload = {
  memoryDir: dir,
  fileCount: projects.length,
  projects,
  plans: v.plansOf(all),
  actions: v.actionsOf(all),
  selected: { project: null, plan: null, action: null },
  graph: v.buildGraph(all),
  recordCount: all.length,
};

// Tema dark di VSCode (Dark+), i valori reali delle CSS var lette da main.js/style.css.
const DARK_VARS = `:root{
  --vscode-foreground:#cccccc;
  --vscode-editor-background:#1e1e1e;
  --vscode-font-family:-apple-system,"Segoe UI",Roboto,sans-serif;
  --vscode-font-size:13px;
  --vscode-panel-border:#2b2b2b;
  --vscode-sideBar-background:#252526;
  --vscode-dropdown-foreground:#f0f0f0;
  --vscode-dropdown-background:#3c3c3c;
  --vscode-dropdown-border:#3c3c3c;
  --vscode-button-foreground:#ffffff;
  --vscode-button-background:#0e639c;
  --vscode-button-hoverBackground:#1177bb;
  --vscode-button-border:transparent;
  --vscode-charts-blue:#4fc1ff;
  --vscode-editorHoverWidget-background:#252526;
  --vscode-editorHoverWidget-foreground:#cccccc;
  --vscode-editorHoverWidget-border:#454545;
}`;

// Stesso markup del body prodotto da extension.ts getHtml(): la UI la costruisce main.js.
const BODY = '<div id="app"></div>';

// JSON inline, con < neutralizzato per non chiudere lo <script> accidentalmente.
const dataJson = JSON.stringify(payload).replace(/</g, '\\u003c');

const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>${DARK_VARS}</style>
<link href="../media/style.css" rel="stylesheet" />
<title>Vascend Memory Graph - preview</title>
</head>
<body>
${BODY}
<script>window.acquireVsCodeApi = function(){return {postMessage:function(){},getState:function(){},setState:function(){}};};</script>
<script src="../media/main.js"></script>
<script>
  window.__VASCEND_PAYLOAD__ = ${dataJson};
  window.postMessage({ type: 'data', payload: window.__VASCEND_PAYLOAD__ }, '*');
</script>
</body>
</html>`;

const outFile = path.join(__dirname, 'graph-preview.html');
fs.writeFileSync(outFile, html, 'utf8');
console.log(JSON.stringify({ out: outFile, stats: payload.graph.stats, records: payload.recordCount, projects: projects.length, plans: payload.plans.length }));
