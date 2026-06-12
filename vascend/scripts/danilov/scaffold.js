// Scheletro condiviso dei file piano DanilovGoal (4 sezioni + tabella Trace).
// Unica fabbrica del markdown: plan.js (master), castle.js (castelli nominati)
// e subplan.js (sotto-piani ricorsivi) la usano tutti -> nessun drift di forma
// tra i tre. Pura: ritorna {md, TOT, MASK}, non scrive su disco.

'use strict';

const { hex, parsePlanTask } = require('./core.js');

// opts: { title, tasks:[...], sub?:bool, headerLines?:[...righe dopo il titolo] }
function buildPlanMd(opts) {
  const tasks = opts.tasks || [];
  const TOT = tasks.length;
  const MASK = ((1 << TOT) >>> 0) - 1;
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const parsed = tasks.map(parsePlanTask);
  const planRows = parsed
    .map((p, i) => `| ${i} | ${hex((1 << i) >>> 0)} | ${p.desc} | ${p.dep} |`)
    .join('\n');
  const head = [
    `# DanilovGoal${opts.sub ? '[sub]' : ''}: ${opts.title}`,
    ...(opts.headerLines || []),
    `Creato: ${ts}`,
  ].join('\n');

  const md = `${head}

## 1. Pianificazione

| bit | mask | task | dep |
| --- | ---- | ---- | --- |
${planRows}

MASK_TARGET = ${hex(MASK)}
TOT_BIT: ${TOT}

## 2. Trace
| ts | bit | mask | pre | post | esito | sig | nota |
|----|-----|------|-----|------|-------|-----|------|

## 3. Validazione
(compilata a fine corsa dal validatore deterministico validate.js)

## 4. Riepilogo visivo
(placeholder: i task mancanti compaiono qui se validate=FALSE)
`;
  return { md, TOT, MASK };
}

// Scheletro del DOSSIER appunti (<piano>.notes.md): note STRUTTURATE al posto
// della prosa — un grafo mermaid del piano (nodi=stanze, archi=dep, da tenere
// aggiornato man mano) e una scheda Danilov per stanza (@analisi/@decisioni/
// @esito). Il file e' LIBERO (il protect hook esenta *.notes.md): l'agente lo
// scrive e riscrive con Write/Edit; questo e' solo il punto di partenza.
function buildNotesMd(opts) {
  const tasks = (opts.tasks || []).map(parsePlanTask);
  const nodes = tasks.map((p, i) => {
    const label = String(p.desc).replace(/^[tT]\d+:\s*/, '').replace(/["[\]{}()|]/g, ' ').slice(0, 40).trim();
    return `  T${String(i + 1).padStart(2, '0')}["${label}"]`;
  });
  const edges = [];
  tasks.forEach((p, i) => {
    if (p.dep === '-') return;
    for (const d of p.dep.split(',')) {
      const db = parseInt(d, 10);
      if (Number.isInteger(db)) edges.push(`  T${String(db + 1).padStart(2, '0')} --> T${String(i + 1).padStart(2, '0')}`);
    }
  });
  const cards = tasks.map((p, i) =>
    [`## T${String(i + 1).padStart(2, '0')} — ${p.desc}`,
     '@analisi:   -', '@decisioni: -', '@esito:     -', ''].join('\n'));

  return `# Dossier: ${opts.title}
Piano: ${opts.planName}
(appunti LIBERI: Write/Edit ammessi — struttura in notazione Danilov + mermaid,
non prosa; il verdetto resta nella Trace firmata del piano)

## Mappa del piano (tienila aggiornata)

\`\`\`mermaid
graph TD
${[...nodes, ...edges].join('\n')}
\`\`\`

${cards.join('\n')}`;
}

module.exports = { buildPlanMd, buildNotesMd };
