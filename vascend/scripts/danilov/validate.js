#!/usr/bin/env node
// Validatore deterministico DanilovGoal (CLI).
// L'agente NON dichiara il verdetto: lo INNESCA eseguendo questo script.
// Lo script legge il file, ricostruisce lo state dalla Trace e calcola
// validate(state) == (state == MASK_TARGET). L'output e' la verita'.
//
// Uso:  node validate.js [file.md] [--deep] [--kingdom]
//   --deep:    valida anche i SOTTO-PIANI del file (RICORSIVO, ogni livello)
//              e la coerenza del roll-up (un bit acceso con figlio DEVE avere
//              il figlio conforme).
//   --kingdom: valida l'INTERO REGNO della sessione (master + tutti i
//              castelli nominati, ognuno in profondita'). Exit 0 sse ogni
//              castello e' illuminato.
// Exit: 0 se conforme, 1 altrimenti, 2 errore d'uso.

'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, listChildGoals } = require('./session.js');
const { kingdomVerdict, rootLabel } = require('./kingdom.js');

const argv = process.argv.slice(2);
const deep = argv.includes('--deep');
const kingdom = argv.includes('--kingdom');

// --- Vista profonda RICORSIVA di un piano: figli a ogni livello + roll-up ----
// Ritorna ok complessivo; appende righe a lines (indentate per profondita').
function deepCheck(file, v, lines, depth) {
  let ok = true;
  const pad = '  '.repeat(depth);
  for (const { bit, file: sf } of listChildGoals(file)) {
    let sv;
    try { sv = computeVerdict(fs.readFileSync(sf, 'utf8')); } catch { continue; }
    const bitOn = (v.state & ((1 << bit) >>> 0)) !== 0;
    const tag = sv.conforme ? 'TRUE' : 'FALSE';
    lines.push(`${pad}  - ${taskLabel(bit)} (${hex((1 << bit) >>> 0)}) ${path.basename(sf)}: ${sv.popcount} validate=${tag}`);
    // Coerenza del roll-up: bit acceso => figlio conforme.
    if (bitOn && !sv.conforme) {
      ok = false;
      lines.push(`${pad}      ✱ INCOERENZA: bit acceso ma sotto-piano non conforme`);
    }
    if (!bitOn && sv.conforme) {
      lines.push(`${pad}      · pronto per roll-up: sub conforme, bit ancora spento (mark.js ${bit} OK sul padre)`);
    }
    if (!sv.conforme) ok = false;
    if (sv.inconsistencies.length) for (const i of sv.inconsistencies) lines.push(`${pad}      incoerenza sub: ${i}`);
    // Ricorsione: i figli del figlio.
    if (!deepCheck(sf, sv, lines, depth + 1)) ok = false;
  }
  return ok;
}

// Verdetto testuale di un singolo piano.
function planLines(file, v, lines) {
  lines.push(`File:    ${path.relative(process.cwd(), file) || file}`);
  lines.push(`state:   ${hex(v.state)}`);
  lines.push(`target:  ${v.target != null ? hex(v.target) : '(assente)'}`);
  lines.push(`missing: ${v.missing != null ? hex(v.missing) : '(n/d)'}`);
  lines.push(`popcount: ${v.popcount}`);
  lines.push(`Result:  validate(state) = ${v.validate === true ? 'TRUE' : 'FALSE'}`);
  if (v.missingTasks.length) {
    lines.push('Da ricontrollare/rifare (bit accesi in missing):');
    for (const t of v.missingTasks) lines.push(`  - ${t.task} (${hex(t.mask)})`);
  }
  if (v.inconsistencies.length) {
    lines.push('Incoerenze (dichiarato vs calcolato):');
    for (const i of v.inconsistencies) lines.push(`  - ${i}`);
  }
}

// --- Modalita' REGNO: tutti i castelli della sessione, in profondita' --------
if (kingdom) {
  const asJson = argv.includes('--json');
  const k = kingdomVerdict(process.cwd());
  const lines = [];
  if (!k.exists) {
    if (asJson) { process.stdout.write(JSON.stringify({ ok: false, error: 'nessun castello per questa sessione' }) + '\n'); process.exit(2); }
    console.error('nessun castello per questa sessione (plan.js per il master, castle.js new per i nominati).');
    process.exit(2);
  }
  // JSON per automazioni (CI, board, script): verdetto per castello + regno.
  if (asJson) {
    const castles = k.roots.map(r => ({
      kind: r.kind, slug: r.slug, title: r.title, after: r.after || null,
      file: r.file, popcount: r.v.popcount, validate: r.v.validate === true,
      missing: (r.v.missingTasks || []).map(t => t.task),
      deepOk: deepCheck(r.file, r.v, [], 0),
      inconsistencies: r.v.inconsistencies,
    }));
    const conforme = castles.every(c => c.validate && c.deepOk);
    process.stdout.write(JSON.stringify({ ok: true, popcount: k.popcount, castles, validate: conforme }) + '\n');
    process.exit(conforme ? 0 : 1);
  }
  let allOk = true;
  lines.push(`Regno:   ${k.roots.length} castelli  ${k.popcount} stanze`);
  for (const r of k.roots) {
    lines.push('');
    lines.push(`[${rootLabel(r)}] "${r.title}"${r.after ? `  (after: ${r.after})` : ''}`);
    planLines(r.file, r.v, lines);
    if (!r.v.conforme) allOk = false;
    if (!deepCheck(r.file, r.v, lines, 0)) allOk = false;
  }
  lines.push('');
  lines.push(`Result(regno):  validate(regno) = ${allOk ? 'TRUE' : 'FALSE'}`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(allOk ? 0 : 1);
}

// --- Modalita' file singolo (default: master di sessione) --------------------
const file = argv.find(a => !a.startsWith('--')) || goalFile(process.cwd());

if (!file) {
  console.error('Uso: node validate.js [file.md] [--deep] [--kingdom]   (default: goal di sessione)');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(2);
}

const v = computeVerdict(fs.readFileSync(file, 'utf8'));
const lines = [];
planLines(file, v, lines);

let deepOk = true;
if (deep) {
  const subs = listChildGoals(file);
  lines.push('');
  lines.push(`Sotto-piani: ${subs.length}`);
  deepOk = deepCheck(file, v, lines, 0);
}

process.stdout.write(lines.join('\n') + '\n');
process.exit((v.conforme && (!deep || deepOk)) ? 0 : 1);
