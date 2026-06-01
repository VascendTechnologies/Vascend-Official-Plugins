#!/usr/bin/env node
// Crea un SOTTO-PIANO (sub-goal) per un macro-task del master.
// Un piano gerarchico ha due livelli: il master (macro-task = i suoi bit) e, per
// ogni macro-task, un sotto-piano con i propri micro-task (bit propri). Il
// macro-bit del master si accende SOLO quando il suo sotto-piano e' conforme
// (roll-up garantito da mark.js). La relazione master->sub e' implicita nel
// naming: <sid>.sub<macroBit>.md accanto al master <sid>.md.
//
// Uso:  node subplan.js <macroBit> "<titolo>" "t01: micro" "t02: micro" ...
//       macroBit = bit del macro-task nel master (0-based; T01 -> 0).
//
// Come plan.js, NON si edita il file a mano: i micro si accendono con mark.js
// passando il file del sub, e la Trace e' firmata.
'use strict';

const fs = require('fs');
const path = require('path');
const { hex } = require('./core.js');
const { goalFile, subGoalFile, goalDir } = require('./session.js');

const argv = process.argv.slice(2);
const macroBit = parseInt(argv.shift(), 10);
const title = argv.shift();
const tasks = argv;

if (!Number.isInteger(macroBit) || macroBit < 0 || macroBit > 29) {
  console.error('Uso: node subplan.js <macroBit 0..29> "<titolo>" "t01: micro" "t02: micro" ...');
  process.exit(1);
}
if (!title || tasks.length < 1) {
  console.error('Uso: node subplan.js <macroBit> "<titolo>" "t01: micro" "t02: micro" ...');
  process.exit(1);
}
if (tasks.length > 30) {
  console.error(`Troppi micro-task (${tasks.length}): massimo 30 bit. Raggruppa.`);
  process.exit(1);
}

const master = goalFile(process.cwd());
if (!fs.existsSync(master)) {
  console.error('Master DanilovGoal inesistente: crea prima il piano con plan.js.');
  process.exit(1);
}
// Il macro-bit deve appartenere al piano del master (stanza esistente).
const masterText = fs.readFileSync(master, 'utf8');
const mt = (masterText.match(/MASK_TARGET\s*=\s*(0x[0-9a-fA-F]+)/) || [])[1];
if (mt && (((1 << macroBit) >>> 0) & parseInt(mt, 16)) === 0) {
  console.error(`macroBit ${macroBit} (${hex((1 << macroBit) >>> 0)}) fuori dal piano master (MASK_TARGET=${mt}).`);
  process.exit(1);
}

const TOT = tasks.length;
const MASK = ((1 << TOT) >>> 0) - 1;
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
const macroLabel = 'T' + String(macroBit + 1).padStart(2, '0');
const planRows = tasks
  .map((t, i) => `| ${i} | ${hex((1 << i) >>> 0)} | ${t.replace(/\|/g, '/')} |`)
  .join('\n');

const md = `# DanilovGoal[sub]: ${title}
Master: ${path.basename(master)}
MacroBit: ${macroBit}  (${macroLabel})
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
(placeholder: i micro-task mancanti compaiono qui se validate=FALSE)
`;

fs.mkdirSync(goalDir(process.cwd()), { recursive: true });
const file = subGoalFile(process.cwd(), undefined, macroBit);
fs.writeFileSync(file, md, 'utf8');

const markPath = path.join(__dirname, 'mark.js').replace(/\\/g, '/');
const fileP = file.replace(/\\/g, '/');
console.log(`sotto-piano di ${macroLabel} (macroBit ${macroBit}): ${TOT} micro-task, MASK_TARGET=${hex(MASK)} -> ${file}`);
console.log(`marca i micro:  node ${markPath} ${fileP} <bit> OK`);
console.log(`a sub completo: node ${markPath} ${macroBit} OK   (sul master; mark.js verifica il roll-up)`);
