#!/usr/bin/env node
// Validatore deterministico DanilovGoal (CLI).
// L'agente NON dichiara il verdetto: lo INNESCA eseguendo questo script.
// Lo script legge il file, ricostruisce lo state dalla Trace e calcola
// validate(state) == (state == MASK_TARGET). L'output e' la verita'.
//
// Uso:  node validate.js [file.md] [--deep]
//   --deep: valida anche i SOTTO-PIANI (sid.sub<bit>.md) e la coerenza del
//           roll-up (un macro-bit acceso DEVE avere il suo sub conforme).
// Exit: 0 se conforme (con --deep: master + tutti i sub + roll-up coerente), 1 altrimenti.

'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, listSubGoals } = require('./session.js');

const argv = process.argv.slice(2);
const deep = argv.includes('--deep');
const file = argv.find(a => !a.startsWith('--')) || goalFile(process.cwd());

if (!file) {
  console.error('Uso: node validate.js [file.md] [--deep]   (default: goal di sessione)');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(2);
}

const v = computeVerdict(fs.readFileSync(file, 'utf8'));

const lines = [];
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

// --- Vista profonda: sotto-piani + coerenza del roll-up -----------------------
let deepOk = true;
if (deep) {
  const subs = listSubGoals(process.cwd());
  lines.push('');
  lines.push(`Sotto-piani: ${subs.length}`);
  for (const { macroBit, file: sf } of subs) {
    const sv = computeVerdict(fs.readFileSync(sf, 'utf8'));
    const macroOn = (v.state & ((1 << macroBit) >>> 0)) !== 0;
    const tag = sv.conforme ? 'TRUE' : 'FALSE';
    lines.push(`  - ${taskLabel(macroBit)} (${hex((1 << macroBit) >>> 0)}) ${path.basename(sf)}: ${sv.popcount} validate=${tag}`);
    // Coerenza del roll-up: macro acceso => sub conforme.
    if (macroOn && !sv.conforme) {
      deepOk = false;
      lines.push(`      ✱ INCOERENZA: macro acceso ma sotto-piano non conforme`);
    }
    if (!macroOn && sv.conforme) {
      lines.push(`      · pronto per roll-up: sub conforme, macro ancora spento (mark.js ${macroBit} OK)`);
    }
    if (!sv.conforme) deepOk = false;
    if (sv.inconsistencies.length) for (const i of sv.inconsistencies) lines.push(`      incoerenza sub: ${i}`);
  }
}

process.stdout.write(lines.join('\n') + '\n');
process.exit((v.conforme && (!deep || deepOk)) ? 0 : 1);
