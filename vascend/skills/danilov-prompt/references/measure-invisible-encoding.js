#!/usr/bin/env node
// Misura il costo della codifica invisibile U+200E (LEFT-TO-RIGHT MARK)
// proposta come "compressione" per il metodo Danilov, contro il testo normale.
// Schema valutato: A=1..Z=26 ripetizioni di U+200E, separatore "|".
// Output: caratteri, byte UTF-8, stima token. Riproducibile: `node measure-invisible-encoding.js`.

const LRM = String.fromCharCode(0x200e); // U+200E, 3 byte UTF-8 (E2 80 8E)

// Codifica una parola con lo schema run-length proposto da Lorenzo.
const encodeWord = (word) =>
  [...word.toUpperCase()]
    .filter((c) => c >= 'A' && c <= 'Z')
    .map((c) => LRM.repeat(c.charCodeAt(0) - 64))
    .join('|');

const utf8Bytes = (s) => Buffer.byteLength(s, 'utf8');

// Stima token prudente:
// - ASCII normale: il BPE fonde ~3-4 char/token -> ~0.28 token/char.
// - U+200E: non e' nei merge del vocabolario o200k/cl100k; va in byte-fallback
//   sui suoi 3 byte UTF-8, raramente fusi -> stima conservativa 1 token/occorrenza
//   (limite inferiore; spesso peggio). Il "|" e' 1 token.
const estTokensPlain = (s) => Math.max(1, Math.round(s.length * 0.28));
const estTokensLRM = (s) => {
  const lrm = (s.match(new RegExp(LRM, 'g')) || []).length;
  const seps = (s.match(/\|/g) || []).length;
  return lrm + seps; // >= 1 token per U+200E + 1 per separatore
};

const samples = [
  'CIAO',
  'test',
  'edit',
  'anti_timing',
  'auth.py', // nota: i punti/underscore non sono A-Z, lo schema li perde
];

const row = (label, plain, enc) => {
  const pB = utf8Bytes(plain), eB = utf8Bytes(enc);
  const pT = estTokensPlain(plain), eT = estTokensLRM(enc);
  return {
    parola: label,
    plain_char: plain.length,
    plain_byte: pB,
    plain_token_stima: pT,
    lrm_char: [...enc].length,
    lrm_byte: eB,
    lrm_token_stima: eT,
    fattore_byte: (eB / pB).toFixed(1) + 'x',
    fattore_token: (eT / pT).toFixed(1) + 'x',
  };
};

console.log('=== Codifica invisibile U+200E vs testo normale ===\n');
console.log('Schema: A=1..Z=26 ripetizioni di U+200E, separatore "|"\n');

const results = samples.map((w) => row(w, w, encodeWord(w)));
console.table(results);

// Totale su una riga-evento reale del metodo (solo la parte A-Z e' codificabile).
const line = 'edit auth anti timing bcrypt costante';
const enc = line.split(' ').map(encodeWord).join('|');
console.log('\nRiga-evento campione (solo lettere A-Z, niente punteggiatura/cifre):');
console.log('  testo  :', line.length, 'char,', utf8Bytes(line), 'byte,', estTokensPlain(line), 'token~');
console.log('  U+200E :', [...enc].length, 'char,', utf8Bytes(enc), 'byte,', estTokensLRM(enc), 'token~');
console.log('  blow-up:', (utf8Bytes(enc) / utf8Bytes(line)).toFixed(1) + 'x byte,',
            (estTokensLRM(enc) / estTokensPlain(line)).toFixed(1) + 'x token');

// Limiti dello schema, oggettivi.
console.log('\nLimiti strutturali dello schema run-length:');
console.log('  - copre solo A-Z: niente cifre, punteggiatura, snake_case, hex, path.');
console.log('  - case-insensitive: CIAO == ciao (informazione persa).');
console.log('  - lunghezza ~ somma posizioni alfabeto: parole con lettere "alte" esplodono.');
