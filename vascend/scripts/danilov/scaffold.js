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

module.exports = { buildPlanMd };
