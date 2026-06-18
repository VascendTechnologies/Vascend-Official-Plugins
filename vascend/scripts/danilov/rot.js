#!/usr/bin/env node
// PREVIEW del CONTEXT-ROT del regno, da usare IN FASE DI PIANIFICAZIONE.
// Il context-rot e' il degrado di qualita' del modello col riempirsi del
// contesto. Qui se ne stima un PROXY deterministico:
//   units  = lavoro accumulato dall'ultimo compact (mark.js le aggiunge col
//            peso @w del task); il PreCompact hook le azzera (un compact riduce
//            il contesto -> la stima cala).
//   planned = somma dei pesi @w delle stanze ANCORA AL BUIO del regno.
// Contro un budget (env DANILOV_ROT_BUDGET, default 40) -> pct/band correnti e
// proiettati. Consiglia di SUDDIVIDERE i task complessi (subplan) e piazzare
// @compact per resettare la rot, batchando i semplici.
//
// Uso:  node rot.js [--json]
'use strict';

const { rotSummary } = require('./kingdom.js');
const ui = require('./ui.js');

const json = process.argv.includes('--json');
const cwd = process.cwd();

const { units, compacts, plannedWeight, darkRooms, est, heavy } = rotSummary(cwd);

if (json) {
  console.log(JSON.stringify({ ok: true, units, compacts, budget: est.budget, plannedWeight,
    pct: est.pct, band: est.band, projectedPct: est.projectedPct, projectedBand: est.projectedBand,
    darkRooms, heavy: heavy.map(h => ({ task: h.task, slug: h.slug, weight: h.weight })) }));
  process.exit(0);
}

const G = ui.G;
const rows = [];
rows.push(ui.kv('Rot ora', `${est.pct}% ${G.dot} ${est.band} (units ${units}/${est.budget}, compact ${compacts})`));
rows.push(ui.kv('A fine regno', `${est.projectedPct}% ${G.dot} ${est.projectedBand} (+${plannedWeight} pianificate su ${darkRooms} stanze al buio)`));
if (heavy.length) {
  rows.push(ui.kv('Pesanti', heavy.slice(0, 6).map(h => `${h.task}${h.slug ? '@' + h.slug : ''} (w${h.weight})`).join(', ')));
}
// Consiglio in base alla proiezione.
let advice;
if (est.projectedBand === 'rosso') {
  advice = 'SUDDIVIDI i task complessi (subplan.js) e marca @compact dopo i piu\' pesanti per resettare la rot; batcha i semplici.';
} else if (est.projectedBand === 'giallo') {
  advice = 'Valuta @compact dopo le stanze pesanti; tieni i task semplici raggruppati.';
} else {
  advice = 'Margine ampio: procedi; suddividi solo se una stanza cresce oltre il previsto.';
}
rows.push(ui.kv('Consiglio', advice));

process.stdout.write(ui.card('context rot', rows) + '\n');
