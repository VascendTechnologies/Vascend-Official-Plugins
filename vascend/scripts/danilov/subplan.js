#!/usr/bin/env node
// Crea un SOTTO-PIANO (sub-goal) per un macro-task di un piano QUALSIASI.
// La gerarchia e' RICORSIVA a profondita' libera: il padre puo' essere il
// master (<sid>.md), un castello nominato (<sid>.castle-<slug>.md) o un altro
// sotto-piano. Il bit del padre si accende SOLO quando il suo sotto-piano e'
// conforme (roll-up garantito da mark.js, livello per livello). La relazione
// padre->figlio e' implicita nel naming: <base-padre>.sub<bit>.md.
//
// Uso:
//   node subplan.js <macroBit> "<titolo>" "t01: micro" ...            (padre = master)
//   node subplan.js <padre.md> <macroBit> "<titolo>" "t01: micro" ... (padre esplicito)
//       macroBit = bit del macro-task nel padre (0-based; T01 -> 0).
//
// Come plan.js, NON si edita il file a mano: i micro si accendono con mark.js
// passando il file del sub, e la Trace e' firmata.
'use strict';

const fs = require('fs');
const path = require('path');
const { hex } = require('./core.js');
const { buildPlanMd, buildNotesMd } = require('./scaffold.js');
const { goalFile, childGoalFile, listDescendants, notesFile, writeGoalAtomic, goalDir } = require('./session.js');

const argv = process.argv.slice(2);

// Primo argomento: bit (padre = master) oppure path del piano padre.
let parent;
if (argv.length && /^\d+$/.test(argv[0])) parent = goalFile(process.cwd());
else parent = argv.shift();

const macroBit = parseInt(argv.shift(), 10);
const title = argv.shift();
const tasks = argv;

if (!Number.isInteger(macroBit) || macroBit < 0 || macroBit > 29) {
  console.error('Uso: node subplan.js [padre.md] <macroBit 0..29> "<titolo>" "t01: micro" "t02: micro" ...');
  process.exit(1);
}
if (!title || tasks.length < 1) {
  console.error('Uso: node subplan.js [padre.md] <macroBit> "<titolo>" "t01: micro" "t02: micro" ...');
  process.exit(1);
}
if (tasks.length > 30) {
  console.error(`Troppi micro-task (${tasks.length}): massimo 30 bit. Scomponi in un livello ulteriore (subplan.js sul sub).`);
  process.exit(1);
}

if (!parent || !fs.existsSync(parent)) {
  console.error(`Piano padre inesistente: ${parent || '(master di sessione)'} — crea prima il piano (plan.js o castle.js).`);
  process.exit(1);
}
// Il macro-bit deve appartenere al piano del padre (stanza esistente).
const parentText = fs.readFileSync(parent, 'utf8');
const mt = (parentText.match(/MASK_TARGET\s*=\s*(0x[0-9a-fA-F]+)/) || [])[1];
if (mt && (((1 << macroBit) >>> 0) & parseInt(mt, 16)) === 0) {
  console.error(`macroBit ${macroBit} (${hex((1 << macroBit) >>> 0)}) fuori dal piano padre (MASK_TARGET=${mt}).`);
  process.exit(1);
}

const macroLabel = 'T' + String(macroBit + 1).padStart(2, '0');
const { TOT, MASK, md } = buildPlanMd({
  title, tasks, sub: true,
  headerLines: [`Master: ${path.basename(parent)}`, `MacroBit: ${macroBit}  (${macroLabel})`],
});

fs.mkdirSync(goalDir(process.cwd()), { recursive: true });
const file = childGoalFile(parent, macroBit);

// Ricreare un sub invalida i SUOI discendenti (stato, non codice).
let dropped = 0;
if (fs.existsSync(file)) {
  for (const d of listDescendants(file)) { try { fs.rmSync(d.file, { force: true }); dropped++; } catch {} }
}
writeGoalAtomic(file, md);

const nfSub = notesFile(file);
if (!fs.existsSync(nfSub)) {
  try { fs.writeFileSync(nfSub, buildNotesMd({ title, tasks, planName: path.basename(file) }), 'utf8'); } catch {}
}

const markPath = path.join(__dirname, 'mark.js').replace(/\\/g, '/');
const fileP = file.replace(/\\/g, '/');
console.log(`sotto-piano di ${macroLabel} (macroBit ${macroBit}) in ${path.basename(parent)}: ${TOT} micro-task, MASK_TARGET=${hex(MASK)} -> ${file}${dropped ? ` (rimossi ${dropped} discendenti obsoleti)` : ''}`);
console.log(`marca i micro:  node ${markPath} ${fileP} <bit> OK`);
console.log(`a sub completo: node ${markPath} ${parent.replace(/\\/g, '/')} ${macroBit} OK   (sul padre; mark.js verifica il roll-up)`);
