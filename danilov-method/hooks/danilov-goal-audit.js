#!/usr/bin/env node
// Stop Hook: enforcement deterministico del metodo Danilov.
// Usa lo stesso core (scripts/danilov/core.js) del validatore CLI: hook e CLI
// non possono divergere sul verdetto. Il DanilovGoal vive nello storage di
// sessione del progetto (~/.claude/projects/<cwd-encoded>/DanilovGoal/<sid>.md),
// risolto via session.js (env-first), per-sessione e per-progetto.
//  - flag attivo + goal non conforme -> blocca lo Stop e rimanda a completarlo.
//  - flag attivo + goal conforme       -> rimuove il flag, termina.
//  - anti-stallo: dopo MAX_STALL turni senza stanze nuove rilascia (warning).
//  - senza flag: audit-only (warning se il goal recente e' incoerente).

const fs = require('fs');
const path = require('path');
const os = require('os');

// Codice: dentro il plugin (__dirname = <plugin>/hooks). Lo stato runtime
// (.danilov-state, projects/.../DanilovGoal) resta in ~/.claude via session.js.
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const { computeVerdict } = require(path.join(DANILOV, 'core.js'));
const { goalFile, currentSessionId } = require(path.join(DANILOV, 'session.js'));
const ui = require(path.join(DANILOV, 'ui.js'));

const STATE_DIR = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  '.danilov-state'
);
// Stallo: turni consecutivi senza accendere stanze nuove prima di rilasciare.
const MAX_STALL = 3;

// Verdetto del goal della sessione (o null se non esiste ancora).
function goalVerdict(cwd, sessionId) {
  const gf = goalFile(cwd, sessionId);
  if (!fs.existsSync(gf)) return null;
  return { gf, verdict: computeVerdict(fs.readFileSync(gf, 'utf8')) };
}

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

    const g = goalVerdict(cwd, sid);

    // --- Senza flag: audit-only (avvisa solo se il goal recente e' incoerente) ---
    if (!flag || !flag.active) {
      if (g && g.verdict.inconsistencies.length) {
        try {
          if (Date.now() - fs.statSync(g.gf).mtimeMs < 10 * 60 * 1000) {
            console.log(ui.card('castello · audit', [
              ui.kv('Stato', `${ui.G.warn} incoerenze rilevate`),
              ...g.verdict.inconsistencies.map(p => ui.li(p)),
            ]));
          }
        } catch {}
      }
      process.exit(0);
    }

    // --- Flag attivo: ENFORCEMENT (pattern /goal a tema castello) ---
    const v = g ? g.verdict : null;
    const compactPath = path.join(cwd, '.danilov-compact.md');

    // Castello ILLUMINATO -> prima del rilascio, chiedi il checkpoint compact.
    if (v && v.conforme) {
      // STICKY: l'obiettivo e' chiuso ma la modalita' resta accesa per il
      // prossimo prompt. Niente compact forzato (e' per fine-lavoro): azzera il
      // tracking conservando active+sticky e lascia terminare.
      if (flag.sticky) {
        try { fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd: flag.cwd, ts: Date.now() }), 'utf8'); } catch {}
        process.exit(0);
      }
      if (!flag.compactAsked) {
        try { fs.writeFileSync(flagFile, JSON.stringify({ ...flag, compactAsked: true }), 'utf8'); } catch {}
        const reason = ui.card(`castello ${ui.G.dot} illuminato ${ui.G.dot} ${v.popcount}`, [
          ui.kv('Stato', `${ui.G.check} tutte le stanze accese`),
          ui.kv('Prima', 'fissa il checkpoint (come /danilov-compact)'),
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

    // Castello NON illuminato -> continua finche' completo (come /goal), ma
    // fermati se in STALLO (nessuna stanza nuova accesa per MAX_STALL turni).
    const curState = v ? v.state : 0;
    const prevState = flag.lastState || 0;
    const stalls = curState > prevState ? 0 : (flag.stalls || 0) + 1;

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
    try { fs.writeFileSync(flagFile, JSON.stringify({ ...flag, lastState: curState, stalls }), 'utf8'); } catch {}

    let reason;
    if (!g) {
      reason = ui.card('castello · da costruire', [
        ui.kv('Stato', `${ui.dot(false)} inesistente`),
        ui.kv('Crea', 'plan.js "<titolo>" "T01: …" "T02: …" …'),
        ui.kv('Accendi', 'mark.js <bit> OK per ogni stanza'),
        ui.kv('Chiudi', 'validate.js — non terminare prima'),
      ]);
    } else {
      const rows = [ui.kv('Stato', `${ui.dot(false)} non illuminato`)];
      if (v.failTasks && v.failTasks.length) {
        rows.push(ui.kv('Da rifare', v.failTasks.map(t => `${t.task} (${v.hex(t.mask)})`).join(', ')));
      }
      if (v.missingTasks.length) {
        rows.push(ui.kv('Al buio', v.missingTasks.map(t => `${t.task} (${v.hex(t.mask)})`).join(', ')));
      }
      if (v.inconsistencies.length) rows.push(ui.kv('Incoerenze', v.inconsistencies.join('; ')));
      rows.push(ui.kv('Azione', 'entra nelle stanze buie, mark.js <bit> OK, poi validate.js — non terminare'));
      reason = ui.card(`castello ${ui.G.dot} ${v.popcount}`, rows);
    }

    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
  } catch {}
});
