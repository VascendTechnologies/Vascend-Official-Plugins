// UI condivisa dei messaggi Danilov in chat (hook + CLI).
// Stile "rule + griglia": un'intestazione con riga di separazione e label
// allineate. Niente ANSI/colori (il testo dei hook entra nel contesto del
// modello: i codici colore lo sporcano e non rendono ovunque). Solo glyph
// Unicode coerenti con la status bar (gsd-statusline.js). Larghezza fissa,
// robusto con contenuti di lunghezza variabile. Funzioni pure -> stringhe.
'use strict';

const W = 46;                      // larghezza del rule
const LABEL = 9;                   // colonna delle etichette nella griglia
const G = {
  brand: '◆',                 // ◆ marchio (come ◆danilov in status bar)
  up: '●',                    // ● motore su
  down: '○',                  // ○ motore giu'
  arrow: '▸',                 // ▸ prossima azione
  check: '✓',                 // ✓ fatto
  warn: '⚠',                  // ⚠ attenzione
  fire: '✱',                  // ✹ errore/manomissione
  dot: '·',                   // · separatore
  bullet: '•',                // • elenco
  dash: '─',                  // ─ riga
};

const vlen = (s) => [...String(s)].length;

// Riga piena.
function rule() { return G.dash.repeat(W); }

// Intestazione: "──── ◆ DANILOV · <titolo> ─────────…" alla larghezza fissa.
function header(title) {
  let left = `${G.dash.repeat(4)} ${G.brand} DANILOV`;
  if (title) left += ` ${G.dot} ${title}`;
  left += ' ';
  const pad = Math.max(0, W - vlen(left));
  return left + G.dash.repeat(pad);
}

// Riga chiave/valore allineata. label vuota = riga di continuazione.
function kv(label, value) {
  const l = String(label || '');
  // garantisci almeno uno spazio di separazione anche con label lunga >= LABEL.
  const padded = l.length >= LABEL ? l + ' ' : l.padEnd(LABEL);
  return `  ${padded}${value}`;
}

// Voce di elenco.
function li(text) { return `  ${G.bullet} ${text}`; }

// Badge inline: [ TESTO ].
function badge(text) { return `[ ${text} ]`; }

// Pallino di stato motore.
function dot(up) { return up ? G.up : G.down; }

// Compone una card completa: header(titolo) + righe + rule di chiusura.
function card(title, lines) {
  return [header(title), ...(lines || []).filter(l => l != null), rule()].join('\n');
}

module.exports = { W, LABEL, G, vlen, rule, header, kv, li, badge, dot, card };
