#!/usr/bin/env node
// SessionStart Hook: fa emergere un DanilovGoal APERTO lasciato da un'altra
// sessione per lo STESSO progetto (cwd), cosi' un task lungo non si perde
// cambiando sessione. Nudge SOLO se la sessione corrente non ha gia' un goal
// aperto. Delega la verita' a resume.js --json (singola fonte). Best-effort:
// non blocca mai, in caso di errore fa pass-through silenzioso.
//
// Codice nel plugin (__dirname = <plugin>/hooks -> ../scripts/danilov);
// lo stato resta in ~/.claude via session.js.

const path = require('path');
const { execFileSync } = require('child_process');

const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const resumeScript = path.join(DANILOV, 'resume.js');
let ui = null;
try { ui = require(path.join(DANILOV, 'ui.js')); } catch {}

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const cwd = data.cwd || process.cwd();
    const sid = data.session_id || process.env.CLAUDE_CODE_SESSION_ID || '';

    // resume.js risolve la sessione da CLAUDE_CODE_SESSION_ID: passaglielo.
    const env = { ...process.env };
    if (sid) env.CLAUDE_CODE_SESSION_ID = String(sid);

    let j;
    try {
      const out = execFileSync('node', [resumeScript, '--json'], { cwd, env, encoding: 'utf8', timeout: 2500 });
      j = JSON.parse(out.trim().split('\n').pop());
    } catch { process.exit(0); }
    if (!j || !j.ok) process.exit(0);

    // Nudge solo se: la sessione corrente NON ha un goal aperto, ma un'altra si'.
    if (j.currentOpen || !j.resumable) process.exit(0);

    const r = j.resumable;
    const cmd = `node ${resumeScript.replace(/\\/g, '/')} --attach`;
    if (ui && ui.card) {
      const rows = [
        ui.kv('Goal aperto', `${r.title} ${ui.G.dot} ${r.popcount}`),
        ui.kv('Sessione', `${r.sid}${r.subs ? ` ${ui.G.dot} ${r.subs} sotto-piani` : ''}`),
      ];
      if (r.missing && r.missing.length) rows.push(ui.kv('Al buio', r.missing.join(', ')));
      rows.push(ui.kv('Riprendi', cmd));
      rows.push(ui.kv('Ignora', 'parti da zero: e\' solo un promemoria'));
      process.stdout.write('\n' + ui.card(`vascend ${ui.G.dot} goal da riprendere`, rows));
    } else {
      process.stdout.write(`[Vascend] goal aperto da riprendere: "${r.title}" [${r.popcount}] (sessione ${r.sid}) — ${cmd}`);
    }
  } catch {}
});
