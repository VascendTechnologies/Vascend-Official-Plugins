#!/usr/bin/env node
// Genera il piano DanilovGoal della sessione (sezione 1 + scheletro Trace).
// L'agente NON edita il .md a mano (un PreToolUse lo nega): scrive il piano
// SOLO tramite questo script. mark.js poi appende le righe di Trace firmate.
//
// Uso:  node plan.js "<titolo>" "T01: descrizione" "T02: ..." ...
// Il numero di task = TOT_BIT; MASK_TARGET = (1<<TOT_BIT)-1.
//
// Questo e' il castello di DEFAULT (master <sid>.md). Per piu' castelli nella
// stessa sessione usa castle.js (castelli nominati, illimitati); per i
// micro-task di un macro usa subplan.js (ricorsivo a profondita' libera).

'use strict';

const fs = require('fs');
const path = require('path');
const { hex } = require('./core.js');
const { buildPlanMd } = require('./scaffold.js');
const { goalFile, goalDir, listDescendants, CLAUDE_DIR, currentSessionId } = require('./session.js');

const argv = process.argv.slice(2);
const title = argv.shift();
const tasks = argv;
if (!title || tasks.length < 1) {
  console.error('Uso: node plan.js "<titolo>" "T01: descr" "T02: descr" ...');
  process.exit(1);
}
if (tasks.length > 30) {
  console.error(`Troppi task (${tasks.length}): massimo 30 bit. Raggruppa, scomponi in sotto-piani (subplan.js) o in piu' castelli (castle.js).`);
  process.exit(1);
}

const { TOT, MASK, md } = buildPlanMd({ title, tasks });

fs.mkdirSync(goalDir(process.cwd()), { recursive: true });
const file = goalFile(process.cwd());

// Un nuovo master INVALIDA i sotto-piani del master precedente (a OGNI
// profondita'): senza pulirli si riaggancerebbero per naming ai nuovi
// macro-bit, falsando roll-up e vista. I castelli nominati (castle.js) sono
// piani INDIPENDENTI: restano intatti.
let dropped = 0;
try {
  for (const { file: sf } of listDescendants(file)) { fs.rmSync(sf, { force: true }); dropped++; }
} catch {}

fs.writeFileSync(file, md, 'utf8');

// Creare un piano = essere in modalita' goal enforced. Alza il flag della
// sessione PRESERVANDO lo sticky (impostato da mode.js o dall'hook): cosi'
// l'enforcement parte sia in one-shot sia in sticky, senza che il toggle on/off
// dipenda dal parsing del prompt negli hook.
try {
  const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
  const sid = String(currentSessionId() || 'default');
  const ff = path.join(STATE_DIR, `${sid}.json`);
  let prev = null; try { prev = JSON.parse(fs.readFileSync(ff, 'utf8')); } catch {}
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(ff, JSON.stringify({ active: true, sticky: !!(prev && prev.sticky), cwd: process.cwd(), ts: new Date().toISOString() }), 'utf8');
} catch {}

console.log(`piano creato: ${TOT} task, MASK_TARGET=${hex(MASK)} -> ${file}${dropped ? ` (rimossi ${dropped} sotto-piani obsoleti)` : ''}`);
console.log('ora marca ogni task: node ' + path.join(__dirname, 'mark.js').replace(/\\/g, '/') + ' <bit> OK');
