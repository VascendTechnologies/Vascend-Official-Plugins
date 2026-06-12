#!/usr/bin/env node
// Stop Hook: enforcement deterministico del metodo Danilov.
// Usa lo stesso core (scripts/danilov/core.js) del validatore CLI: hook e CLI
// non possono divergere sul verdetto. I piani vivono nello storage di sessione
// del progetto (~/.claude/projects/<cwd-encoded>/DanilovGoal/), risolti via
// session.js (env-first), per-sessione e per-progetto.
//
// Multi-castello: l'enforcement copre il REGNO (kingdom.js) — master di
// default + tutti i castelli nominati, coi loro sotto-piani ricorsivi.
//  - flag attivo + regno non conforme -> blocca lo Stop e indica la prossima stanza.
//  - flag attivo + regno conforme     -> rimuove il flag, termina.
//  - anti-stallo: dopo MAX_STALL turni senza stanze nuove (in TUTTO il regno)
//    rilascia (warning).
//  - senza flag: audit-only (warning se un castello recente e' incoerente).

const fs = require('fs');
const path = require('path');
const os = require('os');

// Codice: dentro il plugin (__dirname = <plugin>/hooks). Lo stato runtime
// (.danilov-state, projects/.../DanilovGoal) resta in ~/.claude via session.js.
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const { currentSessionId } = require(path.join(DANILOV, 'session.js'));
const { kingdomVerdict, nextRoom, rootLabel } = require(path.join(DANILOV, 'kingdom.js'));
const ui = require(path.join(DANILOV, 'ui.js'));

const STATE_DIR = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  '.danilov-state'
);
// Stallo: turni consecutivi senza accendere stanze nuove prima di rilasciare
// l'enforcement (anti-loop). Configurabile via env DANILOV_MAX_STALL:
//   N>=1     -> rilascia dopo N turni di stallo
//   0        -> non rilascia MAI (task lungo persistente: l'agente resta agganciato)
//   assente  -> default 3
const MAX_STALL = (() => {
  const raw = process.env.DANILOV_MAX_STALL;
  if (raw === '0') return Infinity;
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n >= 1 ? n : 3;
})();

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const sid = String(currentSessionId(data.session_id) || 'default');
    const cwd = data.cwd || process.cwd();
    const stopActive = data.stop_hook_active === true;
    const flagFile = path.join(STATE_DIR, `${sid}.json`);

    let flag = null;
    try {
      if (fs.existsSync(flagFile)) flag = JSON.parse(fs.readFileSync(flagFile, 'utf8'));
    } catch {}

    // Il regno della sessione: master + castelli nominati + discendenti.
    const k = kingdomVerdict(cwd, sid);

    // --- Senza flag: audit-only (avvisa solo se un castello recente e' incoerente) ---
    if (!flag || !flag.active) {
      const bad = k.roots.filter(r => r.v.inconsistencies.length);
      if (bad.length) {
        try {
          const recent = bad.filter(r => Date.now() - fs.statSync(r.file).mtimeMs < 10 * 60 * 1000);
          if (recent.length) {
            console.log(ui.card('castello · audit', [
              ui.kv('Stato', `${ui.G.warn} incoerenze rilevate`),
              ...recent.flatMap(r => r.v.inconsistencies.map(p => ui.li(`[${rootLabel(r)}] ${p}`))),
            ]));
          }
        } catch {}
      }
      process.exit(0);
    }

    // --- Flag attivo: ENFORCEMENT sul regno (pattern /goal a tema castello) ---
    const compactPath = path.join(cwd, '.vascend-compact.md');

    // Regno ILLUMINATO -> prima del rilascio, chiedi il checkpoint compact.
    if (k.exists && k.conforme) {
      // STICKY: l'obiettivo e' chiuso ma la modalita' resta accesa per il
      // prossimo prompt. Niente compact forzato (e' per fine-lavoro): azzera il
      // tracking conservando active+sticky e lascia terminare.
      if (flag.sticky) {
        try { fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd: flag.cwd, ts: Date.now() }), 'utf8'); } catch {}
        process.exit(0);
      }
      if (!flag.compactAsked) {
        try { fs.writeFileSync(flagFile, JSON.stringify({ ...flag, compactAsked: true }), 'utf8'); } catch {}
        const reason = ui.card(`regno ${ui.G.dot} illuminato ${ui.G.dot} ${k.popcount}`, [
          ui.kv('Stato', `${ui.G.check} ${k.roots.length} castelli, tutte le stanze accese`),
          ui.kv('Prima', 'fissa il checkpoint (come /vascend-compact)'),
          ui.kv('Come', 'sommario formato Danilov (INDICE/DEFINIZIONI/RELAZIONI, @fatto/@stato/@aperto)'),
          ui.kv('Dove', `${compactPath} (tool Write)`),
          ui.kv('Poi', 'termina'),
        ]);
        process.stdout.write(JSON.stringify({ decision: 'block', reason }));
        process.exit(0);
      }
      // compact gia' richiesto -> lascia terminare e pulisci il flag.
      try { fs.rmSync(flagFile, { force: true }); } catch {}
      process.exit(0);
    }

    // Regno NON illuminato -> continua finche' completo (come /goal), ma
    // fermati se in STALLO. Metrica di avanzamento = stanze accese in TUTTO il
    // regno (litRooms): monotona anche quando si lavora in un sub o in un
    // castello diverso dal master.
    const curLit = k.litRooms || 0;
    const prevLit = Number.isInteger(flag.lastLit) ? flag.lastLit : 0;
    const stalls = curLit > prevLit ? 0 : (flag.stalls || 0) + 1;

    if (stopActive && stalls >= MAX_STALL) {
      // In STICKY non spegniamo la modalita': rilasciamo solo questo obiettivo
      // (reset del tracking), pronto per il prossimo prompt. One-shot: rmSync.
      if (flag.sticky) {
        try { fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd: flag.cwd, ts: Date.now() }), 'utf8'); } catch {}
      } else {
        try { fs.rmSync(flagFile, { force: true }); } catch {}
      }
      console.log(ui.card('castello · in stallo', [
        ui.kv('Stato', `${ui.G.warn} nessuna stanza nuova per ${MAX_STALL} turni`),
        ui.kv('Azione', flag.sticky ? 'rilascio l\'obiettivo (sticky resta) — intervieni a mano' : 'rilascio l\'enforcement — intervieni a mano'),
      ]));
      process.exit(0);
    }
    try { fs.writeFileSync(flagFile, JSON.stringify({ ...flag, lastLit: curLit, stalls }), 'utf8'); } catch {}

    let reason;
    if (!k.exists) {
      reason = ui.card('castello · da costruire', [
        ui.kv('Stato', `${ui.dot(false)} inesistente`),
        ui.kv('Crea', 'plan.js "<titolo>" "T01: …" … (o castle.js new <slug> per piu\' castelli)'),
        ui.kv('Accendi', 'mark.js <bit> OK per ogni stanza'),
        ui.kv('Chiudi', 'validate.js — non terminare prima'),
      ]);
    } else {
      const rows = [ui.kv('Stato', `${ui.dot(false)} ${k.openRoots.length}/${k.roots.length} castelli al buio`)];
      for (const r of k.openRoots.slice(0, 4)) {
        const fails = (r.v.failTasks || []).map(t => `${t.task}!`);
        const dark = (r.v.missingTasks || []).map(t => t.task);
        const label = (r.kind === 'castle' ? r.slug : 'master').slice(0, 9);
        rows.push(ui.kv(label, `${r.v.popcount} ${ui.G.dot} ${[...fails, ...dark].slice(0, 6).join(', ')}${dark.length > 6 ? ', …' : ''}`));
      }
      if (k.openRoots.length > 4) rows.push(ui.li(`… e altri ${k.openRoots.length - 4} castelli`));
      const inc = k.roots.flatMap(r => r.v.inconsistencies);
      if (inc.length) rows.push(ui.kv('Incoerenze', inc.join('; ')));
      const next = nextRoom(cwd, sid);
      if (next) rows.push(ui.kv('Prossima', `${next.task} ${next.mask} in ${next.trail.join(' > ')} ${ui.G.dot} mark.js ${next.bit} OK`));
      if (stalls > 0 && MAX_STALL !== Infinity) rows.push(ui.kv('Stallo', `${stalls}/${MAX_STALL} turni senza stanze nuove`));
      rows.push(ui.kv('Azione', 'esegui la stanza, mark.js <bit> OK, poi validate.js --kingdom — non terminare'));
      reason = ui.card(`regno ${ui.G.dot} ${k.popcount}`, rows);
    }

    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {}
});
