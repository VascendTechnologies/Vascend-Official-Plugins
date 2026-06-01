#!/usr/bin/env node
// Genera il piano DanilovGoal della sessione (sezione 1 + scheletro Trace).
// L'agente NON edita il .md a mano (un PreToolUse lo nega): scrive il piano
// SOLO tramite questo script. mark.js poi appende le righe di Trace firmate.
//
// Uso:  node plan.js "<titolo>" "T01: descrizione" "T02: ..." ...
// Il numero di task = TOT_BIT; MASK_TARGET = (1<<TOT_BIT)-1.

'use strict';

const fs = require('fs');
const path = require('path');
const { hex } = require('./core.js');
const { goalFile, goalDir, listSubGoals } = require('./session.js');

const argv = process.argv.slice(2);
const title = argv.shift();
const tasks = argv;
if (!title || tasks.length < 1) {
  console.error('Uso: node plan.js "<titolo>" "T01: descr" "T02: descr" ...');
  process.exit(1);
}
if (tasks.length > 30) {
  console.error(`Troppi task (${tasks.length}): massimo 30 bit. Raggruppa.`);
  process.exit(1);
}

const TOT = tasks.length;
const MASK = ((1 << TOT) >>> 0) - 1;
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');

const planRows = tasks
  .map((t, i) => `| ${i} | ${hex((1 << i) >>> 0)} | ${t.replace(/\|/g, '/')} |`)
  .join('\n');

const md = `# DanilovGoal: ${title}
Creato: ${ts}

## 1. Pianificazione

| bit | mask | task |
| --- | ---- | ---- |
${planRows}

MASK_TARGET = ${hex(MASK)}
TOT_BIT: ${TOT}

## 2. Trace
| ts | bit | mask | pre | post | esito | sig |
|----|-----|------|-----|------|-------|-----|

## 3. Validazione
(compilata a fine corsa dal validatore deterministico validate.js)

## 4. Riepilogo visivo
(placeholder: i bit mancanti compaiono qui se validate=FALSE)
`;

fs.mkdirSync(goalDir(process.cwd()), { recursive: true });
const file = goalFile(process.cwd());
fs.writeFileSync(file, md, 'utf8');

// Un nuovo master INVALIDA i sotto-piani della sessione precedente: senza
// pulirli si riaggancerebbero per naming (<sid>.sub<bit>.md) ai nuovi
// macro-bit, falsando roll-up e vista. Rimuovili (sono stato, non codice).
let dropped = 0;
try {
  for (const { file: sf } of listSubGoals(process.cwd())) { fs.rmSync(sf, { force: true }); dropped++; }
} catch {}

console.log(`piano creato: ${TOT} task, MASK_TARGET=${hex(MASK)} -> ${file}${dropped ? ` (rimossi ${dropped} sotto-piani obsoleti)` : ''}`);
console.log('ora marca ogni task: node ' + path.join(__dirname, 'mark.js').replace(/\\/g, '/') + ' <bit> OK');
