#!/usr/bin/env node
// Marcatore deterministico di completamento task DanilovGoal.
// L'agente lo esegue UNA volta per ogni task quando lo completa: appende la
// riga di Trace, accende il bit (one-hot) e stampa la conferma. 1 chiamata =
// 1 bit -> impossibile "saltare" step senza che resti tracciato e visibile.
//
// Uso:  node mark.js <DanilovGoal/slug.md> <bit> [OK|FAIL]
//       (esito default = OK)
// Exit: 0 ok, 1 errore d'uso / file, 3 se il bit risultava gia' acceso.

'use strict';

const fs = require('fs');
const path = require('path');
const { deriveState, computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, subGoalFile } = require('./session.js');
const { signRow } = require('./crypto.js');

// Se il primo arg e' un bit (numero), si usa il file canonico.
const argv = process.argv.slice(2);
let file, bitArg, esitoArg;
if (argv.length && /^\d+$/.test(argv[0])) {
  file = goalFile(process.cwd());
  [bitArg, esitoArg] = argv;
} else {
  [file, bitArg, esitoArg] = argv;
}
if (!file || bitArg == null) {
  console.error('Uso: node mark.js [file.md] <bit> [OK|FAIL]   (file default: goal di sessione ~/.claude/projects/<cwd>/DanilovGoal/<sid>.md)');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}`);
  process.exit(1);
}

const bit = parseInt(bitArg, 10);
// Tetto a 30 stanze (bit 0..29): 1<<29 resta positivo nel 32-bit signed di JS,
// niente sorprese di segno nelle maschere. >>>0 ovunque per restare unsigned.
if (!Number.isInteger(bit) || bit < 0 || bit > 29) {
  console.error(`bit non valido: ${bitArg} (atteso 0..29)`);
  process.exit(1);
}
const esito = String(esitoArg || 'OK').toUpperCase() === 'FAIL' ? 'FAIL' : 'OK';
const mask = (1 << bit) >>> 0;

const text = fs.readFileSync(file, 'utf8');
const { state: pre, lastSig, tampered } = deriveState(text);

// La stanza deve appartenere al piano (MASK_TARGET), se gia' definito.
const mt = (text.match(/MASK_TARGET\s*=\s*(0x[0-9a-fA-F]+)/) || [])[1];
if (mt) {
  const target = parseInt(mt, 16);
  if ((mask & target) === 0) {
    console.error(`bit ${bit} (${hex(mask)}) fuori dal piano (MASK_TARGET=${mt}): stanza inesistente nel castello.`);
    process.exit(1);
  }
}

// Se la Trace e' gia' compromessa, non aggiungo righe a una catena rotta.
if (tampered) {
  console.error('Trace MANOMESSA (firma invalida): righe scritte fuori da mark.js. Rigenera il goal con plan.js.');
  process.exit(1);
}

// Idempotenza: se il bit e' gia' acceso, non duplicare la riga.
if (pre & mask) {
  console.log(`gia' marcato ${taskLabel(bit)} ${hex(mask)} | state ${hex(pre)} (nessuna modifica)`);
  process.exit(3);
}

// Roll-up gerarchico: se questo file e' il MASTER e il macro-bit ha un
// sotto-piano (scoperto per naming), il macro-task si accende SOLO quando il
// sub-goal e' conforme (tutti i micro accesi, nessuna incoerenza). Senza
// sotto-piano il macro-task e' atomico (comportamento invariato). Solo per OK.
if (esito === 'OK' && path.resolve(file) === path.resolve(goalFile(process.cwd()))) {
  const sub = subGoalFile(process.cwd(), undefined, bit);
  if (fs.existsSync(sub)) {
    const sv = computeVerdict(fs.readFileSync(sub, 'utf8'));
    if (!sv.conforme) {
      console.error(`roll-up negato: il sotto-piano di ${taskLabel(bit)} non e' completo (${sv.popcount}).`);
      if (sv.missingTasks && sv.missingTasks.length)
        console.error('  micro al buio: ' + sv.missingTasks.map(t => `${t.task} (${hex(t.mask)})`).join(', '));
      if (sv.inconsistencies && sv.inconsistencies.length)
        console.error('  incoerenze sub: ' + sv.inconsistencies.join('; '));
      console.error('  completa i micro-task del sub, poi riaccendi il macro.');
      process.exit(1);
    }
  }
}

const post = esito === 'OK' ? (pre | mask) >>> 0 : pre;
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
const maskS = hex(mask), preS = hex(pre), postS = hex(post);
// Firma a catena: lega questa riga alla precedente. Solo mark.js puo' produrla.
const sig = signRow(lastSig, String(bit), maskS, preS, postS, esito);
const row = `| ${ts} | ${bit} | ${maskS} | ${preS} | ${postS} | ${esito} | ${sig} |`;

// Inserisce la riga subito dopo l'ultima riga di tabella (la Trace e' l'unica
// tabella markdown del file). Append-only: nessuna riga esistente toccata.
const lines = text.split('\n');
let lastTableIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (/^\s*\|/.test(lines[i])) lastTableIdx = i;
}
if (lastTableIdx === -1) {
  console.error('Tabella Trace non trovata: manca la sezione 2 con intestazione tabella.');
  process.exit(1);
}
lines.splice(lastTableIdx + 1, 0, row);
fs.writeFileSync(file, lines.join('\n'), 'utf8');

const verb = esito === 'OK' ? 'completato' : 'FALLITO';
const tail = esito === 'OK' ? '' : ' (bit non acceso)';
console.log(`${verb} ${taskLabel(bit)} ${hex(mask)} | state ${hex(pre)} -> ${hex(post)}${tail} | ${esito}`);
process.exit(0);
