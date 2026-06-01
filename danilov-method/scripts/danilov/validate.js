#!/usr/bin/env node
// Validatore deterministico DanilovGoal (CLI).
// L'agente NON dichiara il verdetto: lo INNESCA eseguendo questo script.
// Lo script legge il file, ricostruisce lo state dalla Trace e calcola
// validate(state) == (state == MASK_TARGET). L'output e' la verita'.
//
// Uso:  node validate.js <path/DanilovGoal/slug.md>
// Exit: 0 se conforme (validate TRUE e nessuna incoerenza), 1 altrimenti.

'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict, hex } = require('./core.js');
const { goalFile } = require('./session.js');

const file = process.argv[2] || goalFile(process.cwd());
if (!file) {
  console.error('Uso: node validate.js [file.md]   (default: goal di sessione ~/.claude/projects/<cwd>/DanilovGoal/<sid>.md)');
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

process.stdout.write(lines.join('\n') + '\n');
process.exit(v.conforme ? 0 : 1);
