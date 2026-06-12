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
const { execSync } = require('child_process');
const { deriveState, computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, childGoalFile, notesFile, writeGoalAtomic, acquireGoalLock, releaseGoalLock } = require('./session.js');
const { signRow } = require('./crypto.js');

// Flag: --dry (anteprima), --force (bypassa il gate dipendenze), --note "<t>"
// (annotazione per-bit), --check "<cmd>" (gate: accende solo se exit 0).
const raw = process.argv.slice(2);
let dry = false, force = false, note = null, check = null;
const pos = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--dry') dry = true;
  else if (a === '--force') force = true;
  else if (a === '--note') note = raw[++i] ?? '';
  else if (a.startsWith('--note=')) note = a.slice('--note='.length);
  else if (a === '--check') check = raw[++i] ?? '';
  else if (a.startsWith('--check=')) check = a.slice('--check='.length);
  else pos.push(a);
}
const argv = pos;

// Se il primo arg e' un bit (numero), si usa il file canonico.
let file, bitArg, esitoArg;
if (argv.length && /^\d+$/.test(argv[0])) { file = goalFile(process.cwd()); [bitArg, esitoArg] = argv; }
else { [file, bitArg, esitoArg] = argv; }

// Nota per-bit: annotazione salvata in una colonna extra DOPO `sig` (non entra
// nella firma -> non rompe la catena HMAC). Niente '|' ne' newline.
const noteClean = note == null ? null : String(note).replace(/\|/g, '/').replace(/[\r\n]+/g, ' ').trim();

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

// Lock anti-race (solo marcatura reale): due mark concorrenti sullo stesso
// file (subagenti in parallelo) senza lock perderebbero righe di Trace.
// Rilascio via process.on('exit'): copre anche gli exit anticipati dei gate.
if (!dry) {
  const lockDir = acquireGoalLock(file);
  process.on('exit', () => releaseGoalLock(lockDir));
}

const text = fs.readFileSync(file, 'utf8');
const { state: pre, lastSig, tampered } = deriveState(text);

// Contesto: titolo del piano + descrizione del task (per rendere evidente se
// cwd/goal sono quelli giusti). desc presa dal blocco "1. Pianificazione".
const title = (text.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';
// Riga del piano per un bit: tollera 3 colonne (| bit|mask|task |, len 5) o 4
// (| bit|mask|task|dep |, len 6). Ritorna l'array di celle, o null.
function planRow(b) {
  const start = text.search(/^##\s*1\.\s*Pianificazione/m);
  const end = text.search(/^##\s*2\.\s*Trace/m);
  const block = text.slice(start < 0 ? 0 : start, end < 0 ? text.length : end);
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if ((c.length === 5 || c.length === 6) && parseInt(c[1], 10) === b) return c;
  }
  return null;
}
function planDesc(b) { const c = planRow(b); return c ? c[3] : ''; }
// Dipendenze del bit (4a colonna): array di bit, o [] se assenti/'-'.
function planDeps(b) {
  const c = planRow(b);
  if (!c || c.length < 6 || !c[4] || c[4] === '-') return [];
  return c[4].split(',').map(x => parseInt(x, 10)).filter(n => Number.isInteger(n) && n >= 0);
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

// Dipendenze (DAG): per un OK, le dep dichiarate nel piano devono essere gia'
// accese (presenti in pre). Gatano l'ordine, non il verdetto.
const deps = esito === 'OK' ? planDeps(bit) : [];
const depMissing = deps.filter(d => (pre & ((1 << d) >>> 0)) === 0);

// Stato del roll-up: vale per QUALSIASI piano (master, castello o sub) che
// abbia un figlio per questo bit (<base>.sub<bit>.md). Ricorsivo per
// induzione: il figlio a sua volta ha potuto accendersi solo coi SUOI figli
// conformi -> la luce sale dal livello piu' profondo.
let rollup = null; // {conforme, popcount, missing}
if (esito === 'OK') {
  const sub = childGoalFile(file, bit);
  if (fs.existsSync(sub)) {
    const sv = computeVerdict(fs.readFileSync(sub, 'utf8'));
    rollup = { conforme: sv.conforme, popcount: sv.popcount,
      missing: (sv.missingTasks || []).map(t => `${t.task} (${hex(t.mask)})`) };
  }
}

// Gate cross-castello (After): se la RADICE di questo piano e' un castello con
// "After: <slug>", nessun OK finche' il castello prerequisito non e' conforme
// (salvo --force). La radice si ricava togliendo i suffissi .sub<N>.
function rootOf(f) {
  let r = path.resolve(f);
  for (;;) { const m = r.match(/^(.*)\.sub\d+\.md$/i); if (!m) return r; r = m[1] + '.md'; }
}
let afterGate = null; // {slug, conforme, popcount, missing:bool}
if (esito === 'OK') {
  try {
    const root = rootOf(file);
    if (/\.castle-[a-z0-9-]+\.md$/i.test(root)) {
      const rootText = path.resolve(root) === path.resolve(file) ? text : fs.readFileSync(root, 'utf8');
      const slug = (rootText.match(/^After:\s*([a-z0-9-]+)\s*$/m) || [])[1];
      if (slug) {
        const prereq = root.replace(/\.castle-[a-z0-9-]+\.md$/i, `.castle-${slug}.md`);
        if (fs.existsSync(prereq)) {
          const pv = computeVerdict(fs.readFileSync(prereq, 'utf8'));
          afterGate = { slug, conforme: pv.conforme, popcount: pv.popcount, missing: false };
        } else {
          afterGate = { slug, conforme: true, popcount: '?', missing: true }; // demolito -> non gata
        }
      }
    }
  } catch {}
}

// --- ANTEPRIMA (--dry): mostra tutto, NON scrive ----------------------------
if (dry) {
  const out = ['[DRY-RUN · nessuna scrittura]', ctx,
    `task: ${taskLabel(bit)} ${hex(mask)}${planDesc(bit) ? '  ' + planDesc(bit) : ''}`,
    `esito: ${esito}`,
    already ? `stato: gia' acceso ${hex(pre)} (marcare di nuovo non avrebbe effetto)`
            : `transizione: state ${hex(pre)} -> ${hex(post)}`];
  if (deps.length) out.push(`dep: ${deps.map(d => taskLabel(d)).join(', ')}${depMissing.length ? ` -> AL BUIO: ${depMissing.map(d => taskLabel(d)).join(', ')} (mark negato senza --force)` : ' (tutte accese)'}`);
  if (noteClean) out.push(`nota: ${noteClean}`);
  if (check != null) out.push(`gate: "${check}" (verra' eseguito al mark reale; bit acceso solo se exit 0)`);
  if (afterGate && !afterGate.missing) out.push(`after: castello "${afterGate.slug}" ${afterGate.conforme ? 'conforme (gate aperto)' : `NON conforme (${afterGate.popcount}) -> mark negato senza --force`}`);
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
// Gate cross-castello: il castello (o un suo sub) non accende stanze finche'
// il castello prerequisito (After) non e' conforme. --force per scavalcare.
if (afterGate && !afterGate.missing && !afterGate.conforme && !force) {
  console.error(`gate After negato: il castello prerequisito "${afterGate.slug}" non e' conforme (${afterGate.popcount}).`);
  console.error('  illuminalo prima, oppure forza con --force.');
  process.exit(1);
}

// Roll-up gerarchico: un macro-bit con sotto-piano si accende solo se il sub
// e' conforme. Senza sotto-piano e' atomico (invariato).
if (rollup && !rollup.conforme) {
  console.error(`roll-up negato: il sotto-piano di ${taskLabel(bit)} non e' completo (${rollup.popcount}).`);
  if (rollup.missing.length) console.error('  micro al buio: ' + rollup.missing.join(', '));
  console.error('  completa i micro-task del sub, poi riaccendi il macro.');
  process.exit(1);
}

// Gate dipendenze: un OK richiede che le dep dichiarate siano gia' accese
// (salvo --force). Cosi' l'ordine del DAG e' garantito dallo script.
if (depMissing.length && !force) {
  console.error(`dipendenze non soddisfatte per ${taskLabel(bit)}: ${depMissing.map(d => `${taskLabel(d)} (${hex((1 << d) >>> 0)})`).join(', ')} ancora al buio.`);
  console.error('  accendile prima, oppure forza con --force.');
  process.exit(1);
}

// Gate di verifica: con --check il bit si accende SOLO se il comando passa
// (exit 0). Vale per OK (un FAIL registra comunque il fallimento). Eseguito nel
// cwd: cosi' "fatto" e' verificato da un test/comando reale, non asserito.
if (check != null && esito === 'OK') {
  // Timeout: un gate appeso (test interattivo, rete) non deve bloccare il
  // mark per sempre. Configurabile via DANILOV_CHECK_TIMEOUT (ms).
  const checkTimeout = parseInt(process.env.DANILOV_CHECK_TIMEOUT, 10) || 120000;
  try {
    execSync(check, { stdio: 'pipe', cwd: process.cwd(), timeout: checkTimeout });
    console.log(`gate OK: "${check}"`);
  } catch (e) {
    const tail = ((e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : '')).trim();
    const why = e.signal === 'SIGTERM' ? `timeout ${checkTimeout}ms` : `exit ${e.status == null ? '?' : e.status}`;
    console.error(`gate FALLITO per ${taskLabel(bit)}: "${check}" (${why}) -> bit NON acceso.`);
    if (tail) console.error('  ' + tail.split('\n').slice(-5).join('\n  '));
    process.exit(1);
  }
}

const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
const maskS = hex(mask), preS = hex(pre), postS = hex(post);
const sig = signRow(lastSig, String(bit), maskS, preS, postS, esito);
// La colonna nota (se presente) va DOPO sig: non e' nei campi firmati, quindi
// deriveState la ignora e la catena resta intatta.
const row = noteClean
  ? `| ${ts} | ${bit} | ${maskS} | ${preS} | ${postS} | ${esito} | ${sig} | ${noteClean} |`
  : `| ${ts} | ${bit} | ${maskS} | ${preS} | ${postS} | ${esito} | ${sig} |`;

const lines = text.split('\n');
let lastTableIdx = -1;
for (let i = 0; i < lines.length; i++) if (/^\s*\|/.test(lines[i])) lastTableIdx = i;
if (lastTableIdx === -1) {
  console.error('Tabella Trace non trovata: manca la sezione 2 con intestazione tabella.');
  process.exit(1);
}
lines.splice(lastTableIdx + 1, 0, row);
writeGoalAtomic(file, lines.join('\n'));

const verb = esito === 'OK' ? 'completato' : 'FALLITO';
const tail = esito === 'OK' ? '' : ' (bit non acceso)';
console.log(`${verb} ${taskLabel(bit)} ${hex(mask)} | state ${hex(pre)} -> ${hex(post)}${tail} | ${esito}${noteClean ? ` | nota: ${noteClean}` : ''}`);

// Appunti del piano: dossier libero per stanza (Write/Edit ammessi: il
// protect hook esenta *.notes.md). La colonna --note resta per la sintesi;
// qui vive il dettaglio (analisi, brainstorming, esiti, link).
console.log(`appunti: ${notesFile(file).replace(/\\/g, '/')}${fs.existsSync(notesFile(file)) ? '' : ' (da creare, Write libero)'}`);

// Checkpoint di contesto PIANIFICATI (DANILOV_COMPACT_HINT=0 per zittire):
//  - un task marcato @compact nel piano = "dopo questo step, compatta";
//  - un piano appena ILLUMINATO e' il confine naturale di un'unita' di lavoro.
// L'hint e' deterministico (esce dallo script, non dall'agente); la foto del
// regno la scatta il PreCompact hook al momento della compattazione vera.
if (esito === 'OK' && process.env.DANILOV_COMPACT_HINT !== '0') {
  const planned = /@compact\b/i.test(planDesc(bit) || '');
  const lit = mt != null && post === (parseInt(mt, 16) >>> 0);
  if (planned || lit) {
    const why = planned ? `checkpoint pianificato su ${taskLabel(bit)} (@compact)` : 'piano illuminato: confine di unita\' di lavoro';
    console.log(`compact: ${why} -> punto ideale per compattare il contesto (/vascend-compact, poi /compact)`);
  }
}
process.exit(0);
