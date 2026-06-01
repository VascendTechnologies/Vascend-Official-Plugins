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

module.exports = { computeVerdict, deriveState, declared, missingSections, hex, popcount, taskLabel, bitsToTasks, SECTIONS };
