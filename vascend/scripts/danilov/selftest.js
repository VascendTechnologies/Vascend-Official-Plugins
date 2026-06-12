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
const { execFileSync, spawnSync } = require('child_process');
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

// Esegue mark.js / validate.js raccogliendo {code, out}. opts: {env, cwd}.
function run(script, args, opts) {
  try {
    const out = execFileSync('node', [script, ...args], { encoding: 'utf8', ...(opts || {}) });
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

  // === REGNO MULTI-CASTELLO: sessione ISOLATA (config+sid+cwd in tmp) =========
  // Tutti gli script girano come child con env override: chiave HMAC, goalDir e
  // session-id vivono nella sandbox, mai nella ~/.claude reale.
  const CASTLE = path.join(HERE, 'castle.js');
  const SUBPLAN = path.join(HERE, 'subplan.js');
  const PLAN = path.join(HERE, 'plan.js');
  const cfg = path.join(tmp, 'cfg');
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const SID = 'selftest-sid';
  const env = { ...process.env, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_SESSION_ID: SID };
  const opts = { env, cwd: proj };
  const gdir = path.join(cfg, 'projects', proj.replace(/[^a-zA-Z0-9]/g, '-'), 'DanilovGoal');
  const cfile = (slug) => path.join(gdir, `${SID}.castle-${slug}.md`);
  const R = (script, ...args) => run(script, args.map(String), opts);

  // --- Scenario I: due castelli nominati -> regno aperto, poi illuminato.
  let r = R(CASTLE, 'new', 'alfa', 'castello alfa', 'T01: uno', 'T02: due');
  check('I1 castle new alfa: exit 0', r.code === 0, r.out);
  check('I2 castle alfa: file creato', fs.existsSync(cfile('alfa')));
  R(CASTLE, 'new', 'beta', 'castello beta', 'T01: uno');
  r = R(CASTLE, 'list', '--json');
  let jl = null; try { jl = JSON.parse(r.out.trim().split('\n').pop()); } catch {}
  check('I3 list: 2 castelli, regno FALSE', !!jl && jl.castles.length === 2 && jl.conforme === false && r.code === 1, r.out);
  r = R(VALIDATE, '--kingdom');
  check('I4 validate --kingdom: exit 1 a regno aperto', r.code === 1, String(r.code));
  R(MARK, cfile('alfa'), 0, 'OK'); R(MARK, cfile('alfa'), 1, 'OK'); R(MARK, cfile('beta'), 0, 'OK');
  r = R(VALIDATE, '--kingdom');
  check('I5 validate --kingdom: exit 0 a regno illuminato', r.code === 0, r.out);
  check('I6 --kingdom: Result(regno) TRUE', /validate\(regno\) = TRUE/.test(r.out));

  // --- Scenario J: gerarchia RICORSIVA (castello -> sub -> sub-sub) + roll-up.
  R(CASTLE, 'new', 'gamma', 'castello gamma', 'T01: macro');
  r = R(SUBPLAN, cfile('gamma'), 0, 'sub di gamma', 't01: micro-a', 't02: micro-b');
  check('J1 subplan su castello: exit 0', r.code === 0, r.out);
  const sub0 = cfile('gamma').replace(/\.md$/, '.sub0.md');
  check('J2 sub file creato', fs.existsSync(sub0));
  r = R(SUBPLAN, sub0, 1, 'sub-sub', 't01: nano');
  check('J3 subplan su sub (livello 3): exit 0', r.code === 0, r.out);
  const sub01 = sub0.replace(/\.md$/, '.sub1.md');
  r = R(MARK, cfile('gamma'), 0, 'OK');
  check('J4 roll-up castello negato (sub aperto)', r.code === 1 && /roll-up negato/.test(r.out), r.out);
  r = R(MARK, sub0, 1, 'OK');
  check('J5 roll-up sub negato (sub-sub aperto)', r.code === 1 && /roll-up negato/.test(r.out), r.out);
  R(MARK, sub01, 0, 'OK');
  r = R(MARK, sub0, 1, 'OK');
  check('J6 micro col sub-sub conforme: acceso', r.code === 0, r.out);
  R(MARK, sub0, 0, 'OK');
  r = R(MARK, cfile('gamma'), 0, 'OK');
  check('J7 macro col sub conforme: acceso (roll-up a catena)', r.code === 0, r.out);
  r = R(VALIDATE, cfile('gamma'), '--deep');
  check('J8 validate --deep ricorsivo: exit 0', r.code === 0, r.out);

  // --- Scenario L: gate cross-castello (--after).
  R(CASTLE, 'new', 'delta', 'fondamenta', 'T01: base');
  r = R(CASTLE, 'new', 'epsilon', 'torre', 'T01: cima', '--after', 'delta');
  check('L1 castle --after: exit 0', r.code === 0, r.out);
  r = R(MARK, cfile('epsilon'), 0, 'OK');
  check('L2 after gate: mark negato finche\' delta e\' aperto', r.code === 1 && /gate After negato/.test(r.out), r.out);
  R(MARK, cfile('delta'), 0, 'OK');
  r = R(MARK, cfile('epsilon'), 0, 'OK');
  check('L3 after gate: aperto a prerequisito conforme', r.code === 0, r.out);

  // --- Scenario M: master e castelli coesistono; plan.js non tocca i castelli.
  R(PLAN, 'master di sessione', 'T01: uno');
  check('M1 plan.js: master creato accanto ai castelli', fs.existsSync(path.join(gdir, `${SID}.md`)));
  check('M2 plan.js: castelli intatti', fs.existsSync(cfile('alfa')) && fs.existsSync(cfile('gamma')));
  r = R(SUBPLAN, 0, 'sub legacy del master', 't01: micro');
  check('M3 subplan legacy (solo bit): exit 0', r.code === 0, r.out);
  check('M4 sub del master creato', fs.existsSync(path.join(gdir, `${SID}.sub0.md`)));
  R(PLAN, 'master rigenerato', 'T01: uno');
  check('M5 plan.js rigenerato: sub del master droppato', !fs.existsSync(path.join(gdir, `${SID}.sub0.md`)));
  check('M6 plan.js rigenerato: castelli ancora intatti', fs.existsSync(cfile('beta')) && fs.existsSync(sub01));

  // --- Scenario N: castle next scende alla stanza giusta in profondita'.
  R(CASTLE, 'new', 'zeta', 'profondo', 'T01: macro');
  R(SUBPLAN, cfile('zeta'), 0, 'sub di zeta', 't01: micro');
  r = R(CASTLE, 'next', '--json');
  let jn = null; try { jn = JSON.parse(r.out.trim().split('\n').pop()); } catch {}
  check('N1 next: punta dentro il regno', !!jn && typeof jn.file === 'string', r.out);
  check('N2 next: la stanza e\' nel sub piu\' profondo aperto o nel master', !!jn && /\.md$/.test(jn.file));

  // === ROBUSTEZZA + HOOK (stessa sandbox env) =================================
  const HOOKS = path.join(HERE, '..', '..', 'hooks');
  const runStdin = (script, payload) => {
    const p = spawnSync('node', [script], { ...opts, input: JSON.stringify(payload), encoding: 'utf8' });
    return { code: p.status, out: (p.stdout || '') + (p.stderr || '') };
  };

  // --- Scenario Q: ciclo After rilevato al castle new.
  R(CASTLE, 'new', 'q1', 'base', 'T01: a');
  r = R(CASTLE, 'new', 'q2', 'sopra', 'T01: b', '--after', 'q1');
  check('Q1 catena after lineare: ok', r.code === 0, r.out);
  r = R(CASTLE, 'new', 'q1', 'base ciclica', 'T01: a', '--after', 'q2');
  check('Q2 ciclo after: rifiutato', r.code === 1 && /ciclo/i.test(r.out), r.out);

  // --- Scenario R: hint @compact e hint piano-illuminato da mark.js.
  R(CASTLE, 'new', 'erre', 'con checkpoint', 'T01: lavoro pesante @compact', 'T02: coda');
  r = R(MARK, cfile('erre'), 0, 'OK');
  check('R1 @compact: hint al mark del task marcato', /compact: checkpoint pianificato/i.test(r.out), r.out);
  r = R(MARK, cfile('erre'), 1, 'OK');
  check('R2 piano illuminato: hint di confine', /compact: piano illuminato/i.test(r.out), r.out);

  // --- Scenario S: lock stantio rubato, lock fresco onorato.
  R(MARK, cfile('q1'), 0, 'OK'); // apre il gate After di q2 (q1 conforme)
  const fS = cfile('q2');
  fs.mkdirSync(fS + '.lock');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(fS + '.lock', old, old);
  r = R(MARK, fS, 0, 'OK');
  check('S1 lock stantio (60s): rubato, mark riesce', r.code === 0, r.out);
  check('S2 lock rilasciato dopo il mark', !fs.existsSync(fS + '.lock'));

  // --- Scenario T: PreCompact fissa la foto del regno nel checkpoint.
  r = runStdin(path.join(HOOKS, 'vascend-precompact.js'), { session_id: SID, cwd: proj, trigger: 'auto' });
  const ck = path.join(proj, '.vascend-compact.md');
  check('T1 precompact: checkpoint scritto', fs.existsSync(ck), r.out);
  const ckTxt = fs.existsSync(ck) ? fs.readFileSync(ck, 'utf8') : '';
  check('T2 precompact: blocco regno presente', /vascend:regno:auto/.test(ckTxt) && /@regno:/.test(ckTxt));
  // idempotente: ri-eseguire sostituisce il blocco, non lo duplica.
  runStdin(path.join(HOOKS, 'vascend-precompact.js'), { session_id: SID, cwd: proj, trigger: 'manual' });
  const ckTxt2 = fs.readFileSync(ck, 'utf8');
  check('T3 precompact: blocco sostituito non duplicato', (ckTxt2.match(/vascend:regno:auto/g) || []).length === 2, String((ckTxt2.match(/vascend:regno:auto/g) || []).length));

  // --- Scenario U: SessionStart(source=compact) reinietta il regno aperto.
  r = runStdin(path.join(HOOKS, 'vascend-resume.js'), { session_id: SID, cwd: proj, source: 'compact' });
  check('U1 post-compact: card regno nel contesto', /regno vivo dopo la compattazione/.test(r.out), r.out.slice(0, 200));
  check('U2 post-compact: prossima stanza indicata', /Prossima/.test(r.out));

  // --- Scenario W: dossier appunti strutturato (mermaid + schede per stanza).
  R(CASTLE, 'new', 'doppio', 'enterprise', 'T01: analisi', 'T02: struttura @dep:T01');
  const nfW = cfile('doppio').replace(/\.md$/, '.notes.md');
  check('W1 dossier: creato col castello', fs.existsSync(nfW));
  const nfTxt = fs.existsSync(nfW) ? fs.readFileSync(nfW, 'utf8') : '';
  check('W2 dossier: mermaid del piano', /```mermaid/.test(nfTxt) && /T01 --> T02/.test(nfTxt), nfTxt.slice(0, 120));
  check('W3 dossier: scheda Danilov per stanza', /## T01 — /.test(nfTxt) && /@analisi/.test(nfTxt));
  fs.writeFileSync(nfW, nfTxt + '\nappunto utente\n', 'utf8');
  R(CASTLE, 'new', 'doppio', 'enterprise v2', 'T01: analisi');
  check('W4 dossier: ricreare il castello NON clobbera gli appunti', /appunto utente/.test(fs.readFileSync(nfW, 'utf8')));

  // --- Scenario X: protect hook esenta gli appunti, blinda i piani.
  const PROTECT = path.join(HOOKS, 'danilov-protect.js');
  r = runStdin(PROTECT, { tool_input: { file_path: nfW } });
  check('X1 protect: appunti ESENTI (nessun deny)', !/deny/.test(r.out), r.out.slice(0, 150));
  r = runStdin(PROTECT, { tool_input: { file_path: cfile('doppio') } });
  check('X2 protect: piano ancora blindato', /deny/.test(r.out), r.out.slice(0, 150));

  // --- Scenario Y: gli appunti non sono piani (resume non li vede come regni).
  r = R(path.join(HERE, 'resume.js'), '--list', '--json');
  let jy = null; try { jy = JSON.parse(r.out.trim().split('\n').pop()); } catch {}
  check('Y1 resume: nessun regno fantasma dai .notes.md', !!jy && jy.open.every(g => !/\.notes$/.test(g.sid)), r.out.slice(0, 200));

  // --- Scenario Z: kanban e mermaid del regno.
  r = R(CASTLE, 'kanban');
  check('Z1 kanban: colonne presenti', /## Fatto/.test(r.out) && /## In corso/.test(r.out) && /## Al buio/.test(r.out), r.out.slice(0, 150));
  check('Z2 kanban: mappa mermaid inclusa', /```mermaid/.test(r.out) && /graph TD/.test(r.out));
  r = R(CASTLE, 'kanban', '--write');
  check('Z3 kanban --write: board su file', fs.existsSync(path.join(proj, 'VASCEND_KANBAN.md')), r.out);
  r = R(CASTLE, 'mermaid');
  check('Z4 mermaid: grafo con archi after', /graph TD/.test(r.out) && /-\.->\|after\|/.test(r.out), r.out.slice(0, 200));

  // --- Scenario V: trigger /vascend off spegne l'INTERO regno.
  r = runStdin(path.join(HOOKS, 'danilov-trigger.js'), { session_id: SID, cwd: proj, prompt: '/vascend off' });
  check('V1 trigger off: blocca il prompt', /disattivata/.test(r.out), r.out.slice(0, 200));
  check('V2 trigger off: castelli rimossi', !fs.existsSync(cfile('alfa')) && !fs.existsSync(cfile('zeta')));
  check('V3 trigger off: sub ricorsivi rimossi', !fs.existsSync(sub01));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
