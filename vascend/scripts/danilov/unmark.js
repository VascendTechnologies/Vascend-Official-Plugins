#!/usr/bin/env node
// Annulla una marcatura del DanilovGoal: spegne un bit acceso per sbaglio.
// NON cancella righe (romperebbe la catena HMAC): appende una riga UNDO
// FIRMATA che in deriveState spegne il bit. L'annullamento resta tracciato e
// a prova di manomissione, come ogni altra riga di Trace.
//
// Uso:  node unmark.js [file.md] <bit>
//       (senza file -> goal di sessione; col file -> es. un sotto-piano)
// Exit: 0 annullato, 1 errore d'uso/file/tamper, 3 se il bit era gia' spento.

'use strict';

const fs = require('fs');
const path = require('path');
const { deriveState, hex, taskLabel } = require('./core.js');
const { goalFile, parentOf, writeGoalAtomic, acquireGoalLock, releaseGoalLock } = require('./session.js');
const { signRow } = require('./crypto.js');

const argv = process.argv.slice(2);
let file, bitArg;
if (argv.length && /^\d+$/.test(argv[0])) { file = goalFile(process.cwd()); [bitArg] = argv; }
else { [file, bitArg] = argv; }

if (!file || bitArg == null) {
  console.error('Uso: node unmark.js [file.md] <bit>   (annulla una marcatura: spegne il bit con una riga UNDO firmata)');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}\n  (controlla il cwd: il goal si risolve da process.cwd())`);
  process.exit(1);
}

const bit = parseInt(bitArg, 10);
if (!Number.isInteger(bit) || bit < 0 || bit > 29) {
  console.error(`bit non valido: ${bitArg} (atteso 0..29)`);
  process.exit(1);
}
const mask = (1 << bit) >>> 0;

// Stesso lock anti-race di mark.js (rilascio su exit, copre gli early-exit).
const lockDir = acquireGoalLock(file);
process.on('exit', () => releaseGoalLock(lockDir));

const text = fs.readFileSync(file, 'utf8');
const { state: pre, lastSig, tampered } = deriveState(text);

if (tampered) {
  console.error('Trace MANOMESSA (firma invalida): righe scritte fuori dagli script. Rigenera il goal con plan.js.');
  process.exit(1);
}
// Nulla da annullare se il bit e' gia' spento.
if ((pre & mask) === 0) {
  console.log(`${taskLabel(bit)} ${hex(mask)} non era acceso | state ${hex(pre)} (nessuna modifica)`);
  process.exit(3);
}

const post = (pre & ~mask) >>> 0;
const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
const maskS = hex(mask), preS = hex(pre), postS = hex(post);
const sig = signRow(lastSig, String(bit), maskS, preS, postS, 'UNDO');
const row = `| ${ts} | ${bit} | ${maskS} | ${preS} | ${postS} | UNDO | ${sig} |`;

// Append-only: inserisce dopo l'ultima riga di tabella (la Trace).
const lines = text.split('\n');
let lastTableIdx = -1;
for (let i = 0; i < lines.length; i++) if (/^\s*\|/.test(lines[i])) lastTableIdx = i;
if (lastTableIdx === -1) {
  console.error('Tabella Trace non trovata: manca la sezione 2 con intestazione tabella.');
  process.exit(1);
}
lines.splice(lastTableIdx + 1, 0, row);
writeGoalAtomic(file, lines.join('\n'));

console.log(`annullato ${taskLabel(bit)} ${hex(mask)} | state ${hex(pre)} -> ${hex(post)} | UNDO`);

// Roll-up inverso: spegnere un micro mentre il bit del PADRE resta acceso
// crea l'incoerenza "padre acceso, figlio non conforme" (validate --deep la
// segnala). Avvisa subito e suggerisci l'unmark sul padre.
try {
  const pm = String(file).match(/\.sub(\d+)\.md$/i);
  const parent = parentOf(file);
  if (pm && parent && fs.existsSync(parent)) {
    const macroBit = parseInt(pm[1], 10);
    const pv = deriveState(fs.readFileSync(parent, 'utf8'));
    if ((pv.state & ((1 << macroBit) >>> 0)) !== 0) {
      console.log(`warn: il padre ha ${taskLabel(macroBit)} ancora ACCESO ma questo sub non e' piu' conforme.`);
      console.log(`  riallinea: node ${path.join(__dirname, 'unmark.js').replace(/\\/g, '/')} ${parent.replace(/\\/g, '/')} ${macroBit}`);
    }
  }
} catch {}
process.exit(0);
