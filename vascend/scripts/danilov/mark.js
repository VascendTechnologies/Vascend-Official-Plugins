#!/usr/bin/env node
// Marcatore deterministico di completamento task DanilovGoal.
// L'agente lo esegue UNA volta per ogni task quando lo completa: appende la
// riga di Trace, accende il bit (one-hot) e stampa la conferma. 1 chiamata =
// 1 bit -> impossibile "saltare" step senza che resti tracciato e visibile.
//
// Uso:  node mark.js [file.md] <bit> [OK|FAIL] [--dry]
//       (esito default = OK)
//   --dry : ANTEPRIMA. Mostra quale goal/cwd/task verrebbe toccato e la
//           transizione di stato, SENZA scrivere. Usalo per confermare prima
//           di marcare — soprattutto se non sei certo del cwd (il goal si
//           risolve da process.cwd(): un cwd sbagliato marca il goal sbagliato).
// Per annullare una marcatura sbagliata: node unmark.js [file.md] <bit>.
// Exit: 0 ok, 1 errore d'uso/file/roll-up, 3 se il bit risultava gia' acceso.

'use strict';

const fs = require('fs');
const path = require('path');
const { deriveState, computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, subGoalFile } = require('./session.js');
const { signRow } = require('./crypto.js');

const raw = process.argv.slice(2);
const dry = raw.includes('--dry');
const argv = raw.filter(a => a !== '--dry');

// Se il primo arg e' un bit (numero), si usa il file canonico.
let file, bitArg, esitoArg;
if (argv.length && /^\d+$/.test(argv[0])) { file = goalFile(process.cwd()); [bitArg, esitoArg] = argv; }
else { [file, bitArg, esitoArg] = argv; }

if (!file || bitArg == null) {
  console.error('Uso: node mark.js [file.md] <bit> [OK|FAIL] [--dry]   (file default: goal di sessione)');
  process.exit(1);
}
if (!fs.existsSync(file)) {
  console.error(`File non trovato: ${file}\n  (controlla il cwd: il goal si risolve da process.cwd())`);
  process.exit(1);
}

const bit = parseInt(bitArg, 10);
// Tetto a 30 stanze (bit 0..29): 1<<29 resta positivo nel 32-bit signed di JS.
if (!Number.isInteger(bit) || bit < 0 || bit > 29) {
  console.error(`bit non valido: ${bitArg} (atteso 0..29)`);
  process.exit(1);
}
const esito = String(esitoArg || 'OK').toUpperCase() === 'FAIL' ? 'FAIL' : 'OK';
const mask = (1 << bit) >>> 0;

const text = fs.readFileSync(file, 'utf8');
const { state: pre, lastSig, tampered } = deriveState(text);

// Contesto: titolo del piano + descrizione del task (per rendere evidente se
// cwd/goal sono quelli giusti). desc presa dal blocco "1. Pianificazione".
const title = (text.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';
function planDesc(b) {
  const start = text.search(/^##\s*1\.\s*Pianificazione/m);
  const end = text.search(/^##\s*2\.\s*Trace/m);
  const block = text.slice(start < 0 ? 0 : start, end < 0 ? text.length : end);
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if (c.length === 5 && parseInt(c[1], 10) === b) return c[3];
  }
  return '';
}
const ctx = `goal: ${path.basename(file)} "${title}" · cwd: ${process.cwd()}`;

// La stanza deve appartenere al piano (MASK_TARGET), se gia' definito.
const mt = (text.match(/MASK_TARGET\s*=\s*(0x[0-9a-fA-F]+)/) || [])[1];
if (mt && (mask & parseInt(mt, 16)) === 0) {
  console.error(`bit ${bit} (${hex(mask)}) fuori dal piano (MASK_TARGET=${mt}): stanza inesistente.`);
  process.exit(1);
}
if (tampered) {
  console.error('Trace MANOMESSA (firma invalida): righe scritte fuori da mark.js. Rigenera con plan.js.');
  process.exit(1);
}

const already = (pre & mask) !== 0;
const post = esito === 'OK' ? (pre | mask) >>> 0 : pre;

// Stato del roll-up (se master + OK + esiste un sotto-piano per questo bit).
const isMaster = path.resolve(file) === path.resolve(goalFile(process.cwd()));
let rollup = null; // {conforme, popcount, missing}
if (esito === 'OK' && isMaster) {
  const sub = subGoalFile(process.cwd(), undefined, bit);
  if (fs.existsSync(sub)) {
    const sv = computeVerdict(fs.readFileSync(sub, 'utf8'));
    rollup = { conforme: sv.conforme, popcount: sv.popcount,
      missing: (sv.missingTasks || []).map(t => `${t.task} (${hex(t.mask)})`) };
  }
}

// --- ANTEPRIMA (--dry): mostra tutto, NON scrive ----------------------------
if (dry) {
  const out = ['[DRY-RUN · nessuna scrittura]', ctx,
    `task: ${taskLabel(bit)} ${hex(mask)}${planDesc(bit) ? '  ' + planDesc(bit) : ''}`,
    `esito: ${esito}`,
    already ? `stato: gia' acceso ${hex(pre)} (marcare di nuovo non avrebbe effetto)`
            : `transizione: state ${hex(pre)} -> ${hex(post)}`];
  if (rollup) out.push(`roll-up: ${rollup.conforme ? `OK (sub ${rollup.popcount})` : `NEGATO (sub ${rollup.popcount}${rollup.missing.length ? ', al buio: ' + rollup.missing.join(', ') : ''})`}`);
  out.push(`conferma: node ${path.join(__dirname, 'mark.js').replace(/\\/g, '/')} ${bit} ${esito}`);
  process.stdout.write(out.join('\n') + '\n');
  process.exit(0);
}

// --- MARCATURA REALE --------------------------------------------------------
console.log(ctx);

if (already) {
  console.log(`gia' marcato ${taskLabel(bit)} ${hex(mask)} | state ${hex(pre)} (nessuna modifica)`);
  process.exit(3);
}
// Roll-up gerarchico: un macro-bit con sotto-piano si accende solo se il sub
// e' conforme. Senza sotto-piano e' atomico (invariato).
if (rollup && !rollup.conforme) {
  console.error(`roll-up negato: il sotto-piano di ${taskLabel(bit)} non e' completo (${rollup.popcount}).`);
  if (rollup.missing.length) console.error('  micro al buio: ' + rollup.missing.join(', '));
  console.error('  completa i micro-task del sub, poi riaccendi il macro.');
  process.exit(1);
}

const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
const maskS = hex(mask), preS = hex(pre), postS = hex(post);
const sig = signRow(lastSig, String(bit), maskS, preS, postS, esito);
const row = `| ${ts} | ${bit} | ${maskS} | ${preS} | ${postS} | ${esito} | ${sig} |`;

const lines = text.split('\n');
let lastTableIdx = -1;
for (let i = 0; i < lines.length; i++) if (/^\s*\|/.test(lines[i])) lastTableIdx = i;
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
