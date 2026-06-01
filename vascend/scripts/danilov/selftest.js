#!/usr/bin/env node
// Self-test del castello DanilovGoal, da eseguire IN PRIMO PIANO.
// Esercita il percorso firmato reale (mark.js -> Trace HMAC -> validate.js) e
// le proprieta' del core su file .md ISOLATI in una cartella temporanea: non
// tocca mai il goal della sessione. Stampa PASS/FAIL per scenario; exit 0 se
// tutto verde, 1 al primo fallimento. E' la prova di regressione del metodo.
//
// Uso:  node selftest.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./core.js');
const { signRow } = require('./crypto.js');

const HERE = __dirname;
const MARK = path.join(HERE, 'mark.js');
const VALIDATE = path.join(HERE, 'validate.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danilov-selftest-'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass += 1; console.log(`  PASS  ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${extra ? ' -> ' + extra : ''}`); }
}

// Costruisce un piano valido (stessa forma di plan.js) in un file isolato.
function makePlan(file, tasks) {
  const TOT = tasks.length;
  const MASK = ((1 << TOT) >>> 0) - 1;
  const rows = tasks
    .map((t, i) => `| ${i} | ${core.hex((1 << i) >>> 0)} | ${t} |`)
    .join('\n');
  const md = `# DanilovGoal: selftest
## 1. Pianificazione

| bit | mask | task |
| --- | ---- | ---- |
${rows}

MASK_TARGET = ${core.hex(MASK)}
TOT_BIT: ${TOT}

## 2. Trace
| ts | bit | mask | pre | post | esito | sig |
|----|-----|------|-----|------|-------|-----|

## 3. Validazione
(da validate.js)

## 4. Riepilogo visivo
(placeholder)
`;
  fs.writeFileSync(file, md, 'utf8');
  return { TOT, MASK };
}

// Esegue mark.js / validate.js raccogliendo {code, out}.
function run(script, args) {
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}
const mark = (file, bit, esito) => run(MARK, [file, String(bit), ...(esito ? [esito] : [])]);
const validate = (file) => run(VALIDATE, [file]);

try {
  // --- Scenario A: piano fresco -> validate FALSE, state 0, tutte le stanze al buio.
  const fA = path.join(tmp, 'a.md');
  const { MASK: maskA } = makePlan(fA, ['T01: uno', 'T02: due', 'T03: tre']);
  const vA = core.computeVerdict(fs.readFileSync(fA, 'utf8'));
  check('A1 plano fresco: state 0', vA.state === 0, core.hex(vA.state));
  check('A2 plano fresco: missing == target', vA.missing === maskA, core.hex(vA.missing));
  check('A3 plano fresco: validate FALSE', vA.validate === false);
  check('A4 plano fresco: validate.js exit 1', validate(fA).code === 1);

  // --- Scenario B: accendo tutte le stanze in ordine -> validate TRUE pulito.
  mark(fA, 0); mark(fA, 1); mark(fA, 2);
  const rB = validate(fA);
  const vB = core.computeVerdict(fs.readFileSync(fA, 'utf8'));
  check('B1 tutte accese: state == target', vB.state === maskA, core.hex(vB.state));
  check('B2 tutte accese: validate TRUE', vB.validate === true);
  check('B3 tutte accese: conforme (no incoerenze)', vB.conforme === true, vB.inconsistencies.join(';'));
  check('B4 tutte accese: validate.js exit 0', rB.code === 0);

  // --- Scenario C: idempotenza -> ri-marcare un bit acceso esce 3, niente doppione.
  const before = fs.readFileSync(fA, 'utf8');
  const rC = mark(fA, 0);
  check('C1 idempotenza: exit 3', rC.code === 3, String(rC.code));
  check('C2 idempotenza: file invariato', fs.readFileSync(fA, 'utf8') === before);

  // --- Scenario D: FAIL poi OK sullo stesso bit -> nessun residuo rosso, bit acceso.
  const fD = path.join(tmp, 'd.md');
  makePlan(fD, ['T01: uno', 'T02: due']);
  mark(fD, 0, 'FAIL');
  const vD1 = core.computeVerdict(fs.readFileSync(fD, 'utf8'));
  check('D1 dopo FAIL: bit non acceso', (vD1.state & 1) === 0);
  check('D2 dopo FAIL: failCount 1', vD1.failCount === 1, String(vD1.failCount));
  mark(fD, 0, 'OK');
  const vD2 = core.computeVerdict(fs.readFileSync(fD, 'utf8'));
  check('D3 dopo OK: bit acceso', (vD2.state & 1) === 1);
  check('D4 dopo OK: failCount 0 (nessun rosso residuo)', vD2.failCount === 0, String(vD2.failCount));

  // --- Scenario E: stanza fuori dal piano -> mark.js la rifiuta (exit 1, niente riga).
  const fE = path.join(tmp, 'e.md');
  makePlan(fE, ['T01: uno', 'T02: due']); // bit validi 0..1
  const rE = mark(fE, 5, 'OK');
  check('E1 fuori piano: mark.js exit 1', rE.code === 1, String(rE.code));
  check('E2 fuori piano: messaggio "fuori dal piano"', /fuori dal piano/i.test(rE.out));
  check('E3 fuori piano: state resta 0', core.computeVerdict(fs.readFileSync(fE, 'utf8')).state === 0);

  // --- Scenario F: manomissione -> riga scritta a mano (firma falsa) => tampered.
  const fF = path.join(tmp, 'f.md');
  makePlan(fF, ['T01: uno', 'T02: due']);
  mark(fF, 0); // riga firmata vera
  const txtF = fs.readFileSync(fF, 'utf8');
  // riga fasulla per bit 1 con firma inventata, inserita nella Trace.
  const faked = '| 2026-01-01 00:00:00 | 1 | 0x0002 | 0x0001 | 0x0003 | OK | deadbeefdeadbeef |';
  const linesF = txtF.split('\n');
  let lastTbl = -1;
  for (let i = 0; i < linesF.length; i++) if (/^\s*\|/.test(linesF[i])) lastTbl = i;
  linesF.splice(lastTbl + 1, 0, faked);
  fs.writeFileSync(fF, linesF.join('\n'), 'utf8');
  const vF = core.computeVerdict(fs.readFileSync(fF, 'utf8'));
  check('F1 manomissione: tampered TRUE', vF.tampered === true);
  check('F2 manomissione: bit fasullo NON acceso (catena rotta)', (vF.state & 2) === 0);
  check('F3 manomissione: validate.js exit 1', validate(fF).code === 1);
  const rFm = mark(fF, 1);
  check('F4 manomissione: mark.js rifiuta su catena rotta (exit 1)', rFm.code === 1, String(rFm.code));

  // --- Scenario G: extra (stanza accesa fuori piano) a livello core.
  // mark.js lo impedisce; ma se una riga firmata valida accendesse un bit oltre
  // il target, computeVerdict deve segnalarlo come incoerenza e validate FALSE.
  const fG = path.join(tmp, 'g.md');
  makePlan(fG, ['T01: uno']); // target = 0x0001, bit valido solo 0
  // firmo a mano una riga VALIDA per bit 0 e una per bit 3 (fuori target) usando crypto.
  const r0 = ['2026-01-01 00:00:01', '0', '0x0001', '0x0000', '0x0001', 'OK'];
  const sig0 = signRow('', '0', '0x0001', '0x0000', '0x0001', 'OK');
  const r3pre = '0x0001';
  const sig3 = signRow(sig0, '3', '0x0008', r3pre, '0x0009', 'OK');
  const txtG = fs.readFileSync(fG, 'utf8').split('\n');
  let lastG = -1;
  for (let i = 0; i < txtG.length; i++) if (/^\s*\|/.test(txtG[i])) lastG = i;
  txtG.splice(lastG + 1,
    0,
    `| ${r0[0]} | ${r0[1]} | ${r0[2]} | ${r0[3]} | ${r0[4]} | ${r0[5]} | ${sig0} |`,
    `| 2026-01-01 00:00:02 | 3 | 0x0008 | ${r3pre} | 0x0009 | OK | ${sig3} |`);
  fs.writeFileSync(fG, txtG.join('\n'), 'utf8');
  const vG = core.computeVerdict(fs.readFileSync(fG, 'utf8'));
  check('G1 extra: not tampered (firme valide)', vG.tampered === false);
  check('G2 extra: extra == bit3', vG.extra === 0x0008, core.hex(vG.extra));
  check('G3 extra: missing == 0 (target gia coperto)', vG.missing === 0, core.hex(vG.missing));
  check('G4 extra: validate FALSE (stanza fuori pianta)', vG.validate === false);
  check('G5 extra: incoerenza segnalata', vG.inconsistencies.some(s => /fuori dal piano/i.test(s)));

  // --- Scenario H: tetto bit alto (regge oltre 16?). Verifica plan a TOP task.
  const TOP = 20;
  const fH = path.join(tmp, 'h.md');
  const { MASK: maskH } = makePlan(fH, Array.from({ length: TOP }, (_, i) => `T${i + 1}: task`));
  for (let b = 0; b < TOP; b++) mark(fH, b);
  const vH = core.computeVerdict(fs.readFileSync(fH, 'utf8'));
  check(`H1 tetto ${TOP}bit: state == target`, (vH.state >>> 0) === maskH, core.hex(vH.state) + ' vs ' + core.hex(maskH));
  check(`H2 tetto ${TOP}bit: validate TRUE`, vH.validate === true);
  check(`H3 tetto ${TOP}bit: popcount ${TOP}/${TOP}`, vH.popcount === `${TOP}/${TOP}`, vH.popcount);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
