// Core deterministico del metodo DanilovGoal.
// Funzioni pure: dato il testo di un file DanilovGoal/<slug>.md, ricostruiscono
// lo state dalla Trace (evidenza) e calcolano validate() rispetto a MASK_TARGET
// (piano). Il verdetto e' MATEMATICA derivata dai dati, non un'asserzione.
// Usato sia dal validatore CLI (validate.js) sia dallo Stop hook.

'use strict';

const { signRow } = require('./crypto.js');

const SECTIONS = [
  { n: 1, re: /^##\s*1\.\s*Pianificazione/m },
  { n: 2, re: /^##\s*2\.\s*Trace/m },
  { n: 3, re: /^##\s*3\.\s*Validazione/m },
  { n: 4, re: /^##\s*4\.\s*Riepilogo/m },
];

// Bit accesi dalla Trace, riga: | ts | bit | mask | pre | post | esito | sig |
// Ogni riga concorre SOLO se la sua firma HMAC a catena e' valida (prodotta da
// mark.js). Alla prima firma errata la catena e' rotta: tampered=true e le righe
// successive sono ignorate. Cosi' righe scritte a mano non possono accendere bit.
function deriveState(text) {
  let state = 0, okRows = 0, failBits = 0, prevSig = '', tampered = false, validRows = 0;
  for (const row of text.split('\n').filter(l => /^\s*\|/.test(l))) {
    const cells = row.split('|').map(c => c.trim());
    // riga dati = ['', ts, bit, mask, pre, post, esito, sig, '']  -> length 9
    if (cells.length < 9) continue;
    const bit = parseInt(cells[2], 10);
    if (!Number.isInteger(bit)) continue; // header / separatore
    const [, , bRaw, mask, pre, post, esitoRaw, sig] = cells;
    const expected = signRow(prevSig, bRaw, mask, pre, post, esitoRaw);
    if (sig !== expected) { tampered = true; break; } // firma invalida -> stop
    const esito = esitoRaw.toUpperCase();
    // >>>0 per restare unsigned anche con bit alti (fino a 29).
    if (esito === 'OK') { state = (state | (1 << bit)) >>> 0; okRows += 1; }
    else if (esito === 'FAIL') { failBits = (failBits | (1 << bit)) >>> 0; }
    // UNDO: annulla una marcatura precedente spegnendo il bit (e l'eventuale
    // FAIL). Append-only e FIRMATO come ogni altra riga -> la catena resta
    // intatta e l'annullamento e' tracciato (si vede che fu acceso e poi tolto).
    else if (esito === 'UNDO') {
      state = (state & ~(1 << bit)) >>> 0;
      failBits = (failBits & ~(1 << bit)) >>> 0;
    }
    prevSig = sig;
    validRows += 1;
  }
  return { state, okRows, failBits, tampered, lastSig: prevSig, validRows };
}

function declared(text) {
  const m = (re) => (text.match(re) || [])[1];
  return {
    state: m(/state_finale\s*=\s*(0x[0-9a-fA-F]+)/),
    target: m(/MASK_TARGET\s*=\s*(0x[0-9a-fA-F]+)/),
    validate: m(/validate\(\)\s*=\s*(TRUE|FALSE)/i),
  };
}

function missingSections(text) {
  return SECTIONS.filter(s => !s.re.test(text)).map(s => s.n);
}

const hex = (n) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(4, '0');
const popcount = (n) => { let c = 0; n >>>= 0; while (n) { c += n & 1; n >>>= 1; } return c; };
// bit K -> etichetta task T(K+1) zero-padded.
const taskLabel = (bit) => 'T' + String(bit + 1).padStart(2, '0');
// Scompone una maschera nei singoli task accesi: [{bit, mask, task}].
function bitsToTasks(mask) {
  const out = [];
  let m = mask >>> 0;
  for (let bit = 0; m; bit++, m >>>= 1) {
    if (m & 1) out.push({ bit, mask: (1 << bit) >>> 0, task: taskLabel(bit) });
  }
  return out;
}

// Estrae le dipendenze da una stringa di task del piano.
//   "T03: foo @dep:0,T02"  ->  { desc: "T03: foo", dep: "0,1" }
// bit 0-based; il token Tnn (1-based) diventa nn-1. Nessuna dep -> dep:'-'.
// Pura: usata da plan.js/subplan.js per riempire la 4a colonna del piano. Le
// dipendenze gatano l'ORDINE di marcatura (mark.js), non il verdetto.
function parsePlanTask(s) {
  const str = String(s).replace(/\|/g, '/');
  const m = str.match(/@dep:\s*([0-9tT,\s]+)/);
  if (!m) return { desc: str.trim(), dep: '-' };
  const bits = m[1].split(',').map(x => x.trim()).filter(Boolean).map(tok => {
    const tm = tok.match(/^[tT](\d+)$/);
    if (tm) return parseInt(tm[1], 10) - 1;
    const n = parseInt(tok, 10);
    return Number.isInteger(n) ? n : null;
  }).filter(n => n != null && n >= 0);
  const desc = str.replace(/@dep:\s*[0-9tT,\s]+/, '').replace(/\s{2,}/g, ' ').trim();
  return { desc, dep: bits.length ? bits.join(',') : '-' };
}

// Skill abbinate a un task: token `@skill:<slug>[,<slug>...]` nella descrizione
// del task (uno o piu' token, anche namespaced `plugin:skill`). Resta INLINE nel
// desc come `@compact` — non viene strippato da parsePlanTask, quindi persiste
// nel piano (unico store) e l'hook lo rilegge a ogni turno. Pura: stringa -> slugs
// deduplicati in ordine di apparizione. Nessun token -> [].
function taskSkills(desc) {
  const out = [];
  const seen = new Set();
  const re = /@skill:\s*([A-Za-z0-9_,:\-]+)/g;
  let m;
  while ((m = re.exec(String(desc || ''))) !== null) {
    for (const tok of m[1].split(',')) {
      const slug = tok.trim();
      if (slug && !seen.has(slug)) { seen.add(slug); out.push(slug); }
    }
  }
  return out;
}

// File da PREFETCH abbinati a un task: token `@file:<path>[,<path>]` nel desc
// (inline, come @skill). Quando quella stanza e' la prossima, l'hook ne legge e
// INIETTA il contenuto: cosi' l'agente trova i file gia' in contesto senza
// spendere un giro di tool a rileggerli (li ha gia' pianificati in anticipo).
// Path SENZA spazi (separati da virgola); ammessi / \ . _ - : (drive Windows).
function taskFiles(desc) {
  const out = [];
  const seen = new Set();
  const re = /@file:\s*([^\s|]+)/g;
  let m;
  while ((m = re.exec(String(desc || ''))) !== null) {
    for (const tok of m[1].split(',')) {
      const p = tok.trim();
      if (p && !seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}
function planFiles(text, bit) {
  const start = String(text).search(/^##\s*1\.\s*Pianificazione/m);
  const end = String(text).search(/^##\s*2\.\s*Trace/m);
  const block = String(text).slice(start < 0 ? 0 : start, end < 0 ? String(text).length : end);
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if ((c.length === 5 || c.length === 6) && parseInt(c[1], 10) === bit) return taskFiles(c[3]);
  }
  return [];
}

// Skill dichiarate per un bit, leggendo la sua riga nel blocco "1. Pianificazione".
// Tollera 3 (| bit|mask|task |) o 4 colonne (| bit|mask|task|dep |). [] se assente.
function planSkills(text, bit) {
  const start = String(text).search(/^##\s*1\.\s*Pianificazione/m);
  const end = String(text).search(/^##\s*2\.\s*Trace/m);
  const block = String(text).slice(start < 0 ? 0 : start, end < 0 ? String(text).length : end);
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if ((c.length === 5 || c.length === 6) && parseInt(c[1], 10) === bit) return taskSkills(c[3]);
  }
  return [];
}

// Peso/complessita' di un task: token `@w:<1-5>` nel desc (default 1). E' il
// MODELLO a stimarlo in fase di pianificazione: piu' alto = stanza piu' pesante
// in contesto. Alimenta la stima di context-rot e il consiglio di suddivisione.
function taskWeight(desc) {
  const m = String(desc || '').match(/@w:\s*([1-5])\b/);
  return m ? parseInt(m[1], 10) : 1;
}

// Stima del CONTEXT-ROT (degrado di qualita' col riempirsi del contesto). Non
// sono token reali (non accessibili dallo script): e' un PROXY deterministico —
// `units` accumulate dall'ultimo compact (le aggiunge mark.js col peso del task)
// + `plannedWeight` del lavoro ancora pianificato, contro un `budget` (env
// DANILOV_ROT_BUDGET, default 40). Il compact (PreCompact hook) azzera `units`:
// per questo la stima CALA dopo una compattazione. Ritorna pct/band correnti e
// proiettati (now + planned). Pura.
function estimateRot(opts) {
  const o = opts || {};
  const budget = o.budget > 0 ? o.budget : 40;
  const units = Math.max(0, o.units || 0);
  const planned = Math.max(0, o.plannedWeight || 0);
  const band = (p) => (p < 50 ? 'verde' : p <= 80 ? 'giallo' : 'rosso');
  const pct = Math.min(100, Math.round((units / budget) * 100));
  const projPct = Math.min(100, Math.round(((units + planned) / budget) * 100));
  return { budget, units, plannedWeight: planned, pct, band: band(pct), projectedPct: projPct, projectedBand: band(projPct) };
}

// Verdetto deterministico completo.
function computeVerdict(text) {
  const secMissing = missingSections(text);
  const { state, okRows, failBits, tampered } = deriveState(text);
  const decl = declared(text);

  const target = decl.target != null ? parseInt(decl.target, 16) : null;
  const totBit = target != null ? popcount(target) : null;

  // missing = stanze del PIANO ancora buie (non XOR: lo XOR includerebbe per
  // errore eventuali bit accesi fuori piano). extra = stanze accese fuori piano.
  const missing = target != null ? (target & ~state) >>> 0 : null;
  const extra = target != null ? (state & ~target) >>> 0 : null;
  // Castello illuminato sse tutte le stanze del piano accese E nessuna extra.
  const validate = target != null ? (missing === 0 && extra === 0) : null;
  // Un bit FALLITO ma poi acceso non e' piu' un fallimento.
  const liveFail = (failBits & ~state) >>> 0;

  // Cross-check: cio' che il file DICHIARA combacia con la matematica?
  const inconsistencies = [];
  if (secMissing.length) inconsistencies.push(`sezioni mancanti: ${secMissing.join(', ')}`);
  if (decl.state != null && parseInt(decl.state, 16) !== state) {
    inconsistencies.push(`state_finale dichiarato ${decl.state} != Trace ${hex(state)}`);
  }
  if (decl.validate != null && validate != null) {
    const real = validate ? 'TRUE' : 'FALSE';
    if (decl.validate.toUpperCase() !== real) {
      inconsistencies.push(`validate dichiarato ${decl.validate.toUpperCase()} != calcolato ${real}`);
    }
  }
  if (extra) {
    inconsistencies.push('stanze accese fuori dal piano: ' + bitsToTasks(extra).map(t => `${t.task} (${hex(t.mask)})`).join(', '));
  }
  if (target == null) inconsistencies.push('MASK_TARGET assente: impossibile calcolare il verdetto');
  if (tampered) inconsistencies.push('MANOMISSIONE: Trace con riga non firmata da mark.js (firma HMAC invalida)');

  return {
    state, target, totBit, okRows, tampered, extra,
    validate, missing,
    // stanze del piano ancora buie: da illuminare
    missingTasks: missing != null ? bitsToTasks(missing) : [],
    // task realmente FALLITI (e non poi ri-completati) — base del rosso in status bar
    failBits: liveFail, failCount: popcount(liveFail), failTasks: bitsToTasks(liveFail),
    declaredValidate: decl.validate ? decl.validate.toUpperCase() : null,
    popcount: target != null ? `${popcount(state)}/${totBit}` : `${popcount(state)}/?`,
    secMissing,
    inconsistencies,
    // conforme = piano completo E nessuna incoerenza tra dichiarato e calcolato
    conforme: validate === true && inconsistencies.length === 0,
    hex,
  };
}

module.exports = { computeVerdict, deriveState, declared, missingSections, hex, popcount, taskLabel, bitsToTasks, parsePlanTask, taskSkills, planSkills, taskFiles, planFiles, taskWeight, estimateRot, SECTIONS };
