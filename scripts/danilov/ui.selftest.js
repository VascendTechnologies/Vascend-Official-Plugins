#!/usr/bin/env node
// Self-test della UI dei messaggi Danilov, da eseguire IN PRIMO PIANO.
// (1) asserzioni sul modulo ui.js (larghezza, allineamento, glyph, no ANSI);
// (2) run-through dei 3 hook (trigger, memory-file, audit) verificando che
// emettano una card ben formata e coerente. Usa store/sessione ISOLATI e
// pulisce gli artefatti di test. Exit 0 se verde, 1 al primo fallimento.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const DANILOV = path.join(CLAUDE_DIR, 'scripts', 'danilov');
const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
const HOOKS = path.join(CLAUDE_DIR, 'hooks');
const ui = require(path.join(DANILOV, 'ui.js'));
const session = require(path.join(DANILOV, 'session.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'danilov-ui-selftest-'));
const STORE = path.join(tmp, 'store');
const CWD = 'C:/xampp/htdocs/automatismo_pvp';
const SLUG = 'automatismo-pvp';
const cleanup = [];

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? ' -> ' + extra : ''}`); }
}
const noAnsi = (s) => !/\x1b\[/.test(String(s));
function isCard(out) {
  const lines = String(out).trim().split('\n');
  if (lines.length < 2) return false;
  const head = lines[0], tail = lines[lines.length - 1];
  return head.includes(`${ui.G.brand} DANILOV`) && head.startsWith(ui.G.dash.repeat(4)) &&
         tail === ui.rule() && noAnsi(out);
}

try {
  // --- (1) modulo ui.js ---
  check('U1 rule width', ui.vlen(ui.rule()) === ui.W);
  check('U2 header senza titolo: width esatta', ui.vlen(ui.header(null)) === ui.W, String(ui.vlen(ui.header(null))));
  check('U3 header con titolo: width esatta', ui.vlen(ui.header('castello · 3/7')) === ui.W);
  check('U4 header marchio', ui.header(null).includes(`${ui.G.brand} DANILOV`));
  check('U5 kv label corta allineata', ui.kv('Stato', 'x') === `  ${'Stato'.padEnd(ui.LABEL)}x`);
  check('U6 kv label lunga: spazio garantito', /Da rifare \S/.test(ui.kv('Da rifare', 'x')), ui.kv('Da rifare', 'x'));
  check('U7 li bullet', ui.li('y').startsWith(`  ${ui.G.bullet} `));
  check('U8 dot up/down', ui.dot(true) === ui.G.up && ui.dot(false) === ui.G.down);
  check('U9 card: header+rule', isCard(ui.card('t', [ui.kv('a', 'b')])));
  check('U10 no ANSI', noAnsi(ui.card('t', [ui.kv('a', 'b'), ui.li('c')])));

  // helper per lanciare un hook con stdin/env e raccogliere stdout.
  const ENV = { ...process.env, DANILOV_MEM_ROOT: STORE, DANILOV_AUTO_ENGINE: '0', DANILOV_ENGINE_URL: 'http://127.0.0.1:59999' };
  function runHook(file, payload, sid) {
    try {
      return execFileSync('node', [path.join(HOOKS, file)], {
        input: JSON.stringify(payload), encoding: 'utf8',
        env: { ...ENV, CLAUDE_CODE_SESSION_ID: sid },
      });
    } catch (e) { return (e.stdout || '') + ''; }
  }
  const mem = path.join(DANILOV, 'memory.js');
  function add(raw, plan, sid) {
    execFileSync('node', [mem, 'add', raw, '--project', SLUG, '--plan', plan, '--session', sid],
      { env: ENV, encoding: 'utf8' });
  }

  // --- (2a) trigger: card unica ---
  {
    const sid = `uitest-trig-${Date.now()}`;
    // NB: NON usare session.goalFile(CWD, sid): e' env-first su CLAUDE_CODE_SESSION_ID
    // e nel processo padre risolverebbe al goal REALE (rischio cancellazione).
    cleanup.push(path.join(STATE_DIR, `${sid}.json`), path.join(session.goalDir(CWD), `${sid}.md`));
    add('@edit: a.ts → b [ c ]', 'piano demo', 'x');
    const out = runHook('danilov-trigger.js', { prompt: '/danilov x', session_id: sid, cwd: CWD }, sid);
    check('H1 trigger emette card', isCard(out), JSON.stringify(out.slice(0, 40)));
    check('H2 trigger ha riga Motore', /Motore\s+○ DOWN/.test(out));
  }

  // --- (2b) memory-file: card del file ---
  {
    const sid = `uitest-file-${Date.now()}`;
    cleanup.push(path.join(STATE_DIR, `memfiles-${sid}.json`));
    add('@fix: widget.tsx → bug [ x ]', 'p1', 'x');
    const out = runHook('danilov-memory-file.js',
      { tool_name: 'Read', tool_input: { file_path: 'C:/a/widget.tsx' }, cwd: CWD, session_id: sid }, sid);
    check('H3 memory-file emette card', isCard(out), JSON.stringify(out.slice(0, 40)));
    check('H4 memory-file titola il file', out.includes('widget.tsx'));
  }

  // --- (2c) audit: reason "da costruire" e' una card ---
  {
    const sid = `uitest-audit-${Date.now()}`;
    const flag = path.join(STATE_DIR, `${sid}.json`);
    cleanup.push(flag, path.join(session.goalDir(CWD), `${sid}.md`));
    try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(flag, JSON.stringify({ active: true, cwd: CWD, ts: Date.now() })); } catch {}
    // nessun goal per questo sid -> ramo "da costruire"
    const out = runHook('danilov-goal-audit.js', { session_id: sid, cwd: CWD, stop_hook_active: false }, sid);
    let reason = '';
    try { reason = JSON.parse(out.trim().split('\n').pop()).reason || ''; } catch {}
    check('H5 audit blocca con card', isCard(reason), JSON.stringify(reason.slice(0, 40)));
    check('H6 audit titolo da costruire', /castello . da costruire/.test(reason));
  }
} finally {
  for (const f of cleanup) { try { fs.rmSync(f, { force: true }); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n  ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
