#!/usr/bin/env node
// SessionStart Hook, due mestieri:
//  - source=compact: il contesto e' APPENA stato compattato -> reinietta la
//    card del regno vivo (stdout diventa additionalContext) cosi' il goal non
//    si perde nel summary. E' la meta' "ripristina" di vascend-precompact.js
//    (che al PreCompact aveva fissato la foto in .vascend-compact.md).
//  - altri source: fa emergere un DanilovGoal APERTO lasciato da un'altra
//    sessione per lo STESSO progetto (cwd). Nudge SOLO se la sessione corrente
//    non ha gia' un goal aperto. Delega la verita' a resume.js --json.
// Best-effort: non blocca mai, in caso di errore pass-through silenzioso.
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

    // --- POST-COMPATTAZIONE: reinietta il regno vivo nel contesto fresco ---
    if (data.source === 'compact') {
      try {
        const { kingdomVerdict, nextRoom } = require(path.join(DANILOV, 'kingdom.js'));
        const k = kingdomVerdict(cwd, sid);
        if (k.exists && !k.conforme && ui && ui.card) {
          const rows = [ui.kv('Regno', `${k.openRoots.length}/${k.roots.length} castelli al buio ${ui.G.dot} ${k.popcount} stanze`)];
          for (const r of k.openRoots.slice(0, 4)) {
            const dark = (r.v.missingTasks || []).map(t => t.task).slice(0, 6).join(', ');
            rows.push(ui.kv((r.kind === 'castle' ? r.slug : 'master').slice(0, 9), `${r.v.popcount}${dark ? ` ${ui.G.dot} ${dark}` : ''}`));
          }
          const next = nextRoom(cwd, sid);
          if (next) rows.push(ui.kv('Prossima', `${next.task} ${next.mask} in ${next.trail.join(' > ')}`));
          rows.push(ui.kv('Checkpoint', '.vascend-compact.md (foto PreCompact): rileggilo prima di continuare'));
          rows.push(ui.kv('Regola', 'il goal continua: mark.js per le stanze, validate.js --kingdom per chiudere'));
          process.stdout.write('\n' + ui.card(`vascend ${ui.G.dot} regno vivo dopo la compattazione`, rows));
        }
      } catch {}
      process.exit(0); // post-compact: niente nudge cross-sessione
    }

    // resume.js risolve la sessione da CLAUDE_CODE_SESSION_ID: passaglielo.
    const env = { ...process.env };
    if (sid) env.CLAUDE_CODE_SESSION_ID = String(sid);

    // Retention best-effort: i regni CHIUSI piu' vecchi di N giorni se ne
    // vanno (prune.js non tocca mai regni aperti ne' la sessione corrente).
    // Silenzioso: il goalDir non cresce all'infinito, il contesto resta pulito.
    try {
      execFileSync('node', [path.join(DANILOV, 'prune.js'), '--json'], { cwd, env, encoding: 'utf8', timeout: 2500 });
    } catch {}

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
