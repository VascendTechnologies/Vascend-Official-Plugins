#!/usr/bin/env node
// Self-test della memoria Danilov (memory.js), da eseguire IN PRIMO PIANO.
// Guida la CLI reale via child_process su uno store ISOLATO (DANILOV_MEM_ROOT
// temporaneo): non tocca lo store di knowagebase. Copre parse/add/dedup,
// harvest da transcript, ranking BM25+cue+RRF, determinismo plan_hash,
// catalogo (list/plans/stats), engine --dry e gli errori previsti.
// Exit 0 se tutto verde, 1 al primo fallimento.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MEMORY = path.join(__dirname, 'memory.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danilov-mem-selftest-'));
const ENV = { ...process.env, DANILOV_MEM_ROOT: path.join(tmp, 'store') };

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' -> ' + extra : ''}`); }
}
function run(args, extraEnv) {
  try {
    const out = execFileSync('node', [MEMORY, ...args], { encoding: 'utf8', env: { ...ENV, ...(extraEnv || {}) } });
    return { code: 0, json: parse(out) };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, json: parse((e.stdout || '') + '') };
  }
}
function parse(s) { try { return JSON.parse(String(s).trim().split('\n').pop()); } catch { return null; } }

try {
  // A. add
  const A = run(['add', '@edit: LotTable.tsx → selezione_multipla [ checkbox ]', '--project', 'demo', '--plan', 'p1', '--session', 's1']);
  check('A1 add ok', A.json && A.json.ok === true);
  check('A2 add parsed action/target', A.json && A.json.record.action === 'edit' && A.json.record.target === 'selezione_multipla');
  check('A3 add added=true', A.json && A.json.added === true);

  // B. dedup
  const B = run(['add', '@edit: LotTable.tsx → selezione_multipla [ checkbox ]', '--project', 'demo', '--plan', 'p1', '--session', 's1']);
  check('B1 dedup added=false', B.json && B.json.added === false);

  // C. riga non-evento
  const C = run(['add', 'completato T01 0x0001', '--project', 'demo']);
  check('C1 non-evento ok=false', C.json && C.json.ok === false);

  // D. harvest da transcript fixture
  const tf = path.join(tmp, 'transcript.jsonl');
  fs.writeFileSync(tf, [
    JSON.stringify({ type: 'user', message: { role: 'user', content: 'ciao' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '@fix: loader.py → split_regex [ escape ]\n@run: pytest → backend_verde [ 6 passed ]' }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } }),
  ].join('\n'), 'utf8');
  const D = run(['harvest', tf, '--project', 'hv', '--plan', 'p1', '--session', 's2']);
  check('D1 harvest candidates>=2', D.json && D.json.candidates >= 2, D.json && String(D.json.candidates));
  check('D2 harvest added=2', D.json && D.json.added === 2, D.json && String(D.json.added));
  const D2 = run(['harvest', tf, '--project', 'hv', '--plan', 'p1', '--session', 's2']);
  check('D3 harvest dedup added=0', D2.json && D2.json.added === 0);

  // E. search ranking + plan_hash + filtro
  run(['add', '@edit: AssetExplorer.tsx → selezione_lotti [ bulk checkbox ]', '--project', 'demo', '--plan', 'p2', '--session', 's3']);
  const E = run(['search', '--query', 'selezione checkbox lotti', '--project', 'demo']);
  check('E1 search ok', E.json && E.json.ok === true);
  check('E2 plan_hash presente', E.json && /^[0-9a-f]{16}$/.test(E.json.plan_hash || ''));
  check('E3 top result piena copertura cue', E.json && E.json.results[0] && E.json.results[0].cue >= E.json.results[1].cue);
  check('E4 explain con cue', E.json && E.json.results[0].explain.matched.length >= 1);
  const Ef = run(['search', '--query', 'regex escape', '--project', 'demo', '--plan', 'p1']);
  check('E5 filtro plan: solo p1', Ef.json && Ef.json.results.every(r => r.plan === 'p1'));

  // F. determinismo + distinzione plan_hash (B1: i filtri devono contare)
  const F1 = run(['search', '--query', 'identica query', '--project', 'demo', '--local']);
  const F2 = run(['search', '--query', 'identica query', '--project', 'demo', '--local']);
  check('F1 plan_hash deterministico', F1.json && F2.json && F1.json.plan_hash === F2.json.plan_hash);
  const Fp1 = run(['search', '--query', 'q', '--project', 'demo', '--plan', 'p1', '--local']);
  const Fp2 = run(['search', '--query', 'q', '--project', 'demo', '--plan', 'p2', '--local']);
  const Fa = run(['search', '--query', 'q', '--project', 'demo', '--action', 'fix', '--local']);
  check('F2 plan_hash distinto per plan diverso', Fp1.json && Fp2.json && Fp1.json.plan_hash !== Fp2.json.plan_hash,
    Fp1.json && `${Fp1.json.plan_hash} vs ${Fp2.json.plan_hash}`);
  check('F3 plan_hash distinto per action diverso', Fp1.json && Fa.json && Fp1.json.plan_hash !== Fa.json.plan_hash);

  // M. integrita' sorgente: nessun byte NUL in memory.js (regressione B3)
  const src = require('fs').readFileSync(MEMORY);
  let nul = 0; for (const x of src) if (x === 0) nul++;
  check('M1 memory.js senza byte NUL', nul === 0, `NUL=${nul}`);

  // G. catalogo
  const G1 = run(['plans', '--project', 'demo']);
  check('G1 plans count>=2', G1.json && G1.json.count >= 2);
  const G2 = run(['stats', '--all']);
  check('G2 stats total>0', G2.json && G2.json.total > 0);
  const G3 = run(['list', '--project', 'demo', '--limit', '1']);
  check('G3 list limit=1', G3.json && G3.json.results.length === 1);
  const G4 = run(['tools']);
  check('G4 tools elenca comandi', G4.json && Array.isArray(G4.json.tools) && G4.json.tools.length >= 8);

  // H. engine DISABILITATO (memoria locale .vascend) + health locale
  const H1 = run(['engine', 'up']);
  check('H1 engine disabilitato ok=false', H1.json && H1.json.ok === false && H1.json.disabled === true, H1.json && String(H1.json.ok));
  const H2 = run(['health']);
  check('H2 health engine=disabled', H2.json && H2.json.ok === true && H2.json.engine === 'disabled', H2.json && String(H2.json.engine));

  // I. comando sconosciuto
  const I1 = run(['frobnicate']);
  check('I1 comando sconosciuto ok=false', I1.json && I1.json.ok === false);
  check('I2 comando sconosciuto exit=1', I1.code === 1, String(I1.code));

  // K. search: SEMPRE locale (nessun motore esterno)
  const K1 = run(['search', '--query', 'selezione', '--project', 'demo']);
  check('K1 search source=local', K1.json && K1.json.source === 'local', K1.json && String(K1.json.source));
  check('K2 search senza engine_up', K1.json && K1.json.engine_up === undefined);

  // N. formato .vascend a relazioni + export grafo + query strutturata
  const store = path.join(ENV.DANILOV_MEM_ROOT, 'demo.vascend');
  const raw = fs.existsSync(store) ? fs.readFileSync(store, 'utf8') : '';
  check('N1 store .vascend esiste', !!raw, store);
  check('N2 .vascend ha archi entity>target', /·\s+\w+\s+\S+>\S+/.test(raw));
  check('N3 .vascend raggruppa per @plan', /@plan\[/.test(raw));
  const N4 = run(['graph', '--project', 'demo']);
  check('N4 graph nodes+edges', N4.json && N4.json.ok && N4.json.nodes.length > 0 && N4.json.edges.length > 0, N4.json && JSON.stringify(N4.json.stats));
  check('N5 graph edge source/target/action', N4.json && N4.json.edges[0].source && N4.json.edges[0].target && !!N4.json.edges[0].action);
  const N6 = run(['query', '--target', 'selezione', '--project', 'demo']);
  check('N6 query per target', N6.json && N6.json.ok && N6.json.total >= 1, N6.json && String(N6.json.total));
  const N7 = run(['add', 'fix parser.py>p7m | asn1crypto', '--project', 'demo', '--plan', 'pv2']);
  check('N7 add formato v2', N7.json && N7.json.ok === true && N7.json.record.action === 'fix' && N7.json.record.target === 'p7m', N7.json && JSON.stringify(N7.json && N7.json.record));

  // O. conoscenza (A): kind + boost nel retrieval
  const O1 = run(['add', 'decide retrieval>boost_conoscenza | le lezioni pesano piu del log di attivita', '--project', 'demo', '--plan', 'pk']);
  check('O1 add knowledge kind', O1.json && O1.json.ok === true && O1.json.record.kind === 'knowledge', O1.json && JSON.stringify(O1.json && O1.json.record && O1.json.record.kind));
  run(['add', 'edit retrieval>log_attivita | tocco un file', '--project', 'demo', '--plan', 'pk']);
  const O2 = run(['search', '--query', 'retrieval conoscenza attivita boost', '--project', 'demo']);
  check('O2 search espone kind', O2.json && O2.json.results[0] && !!O2.json.results[0].kind, O2.json && JSON.stringify(O2.json && O2.json.results[0]));
  const top = O2.json && O2.json.results[0];
  check('O3 knowledge in cima al ranking', top && top.kind === 'knowledge', top && (top.kind + ' ' + top.raw));
  const O4 = run(['query', '--action', 'decide', '--project', 'demo']);
  check('O4 query azione conoscenza + kind', O4.json && O4.json.ok && O4.json.total >= 1 && O4.json.results[0].kind === 'knowledge', O4.json && String(O4.json.total));

  // L. related: memorie inerenti a un file
  run(['add', '@edit: Widget.tsx → render [ x ]', '--project', 'demo', '--plan', 'p9', '--session', 's9']);
  run(['add', '@fix: Widget.tsx → bug [ y ]', '--project', 'demo', '--plan', 'p9', '--session', 's9']);
  const L1 = run(['related', 'C:/a/b/Widget.tsx', '--project', 'demo']);
  check('L1 related trova per basename', L1.json && L1.json.total === 2, L1.json && String(L1.json.total));
  check('L1b related basename pulito', L1.json && L1.json.basename === 'Widget.tsx');
  const L2 = run(['related', 'Widget.tsx', '--project', 'demo', '--limit', '1']);
  check('L2 related limit + campo more', L2.json && L2.json.count === 1 && /--limit 2/.test(L2.json.more || ''), L2.json && L2.json.more);
  const L3 = run(['related', 'inesistente.xyz', '--project', 'demo']);
  check('L3 related nessun match -> total 0', L3.json && L3.json.total === 0);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
