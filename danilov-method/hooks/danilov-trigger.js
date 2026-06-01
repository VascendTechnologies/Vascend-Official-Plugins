#!/usr/bin/env node
// UserPromptSubmit Hook: attivazione del metodo Danilov.
// Se il prompt usa /danilov o menziona il metodo:
//  - ALZA un flag di sessione (~/.claude/.danilov-state/<session_id>.json);
//  - CREA automaticamente lo scheletro del goal PER-SESSIONE nello storage di
//    progetto (~/.claude/projects/<cwd-encoded>/DanilovGoal/<session_id>.md)
//    cosi' la status line ha subito un riferimento, garantito dall'hook e non
//    dall'agente.
// "annulla danilov" / "/danilov-clear" -> abbassa il flag (escape hatch).
// Pass-through silenzioso quando non c'e' match.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

// Stato runtime (flag di sessione, goal): resta in ~/.claude, per-utente.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
// Codice: dentro il plugin. __dirname = <plugin>/hooks -> ../scripts/danilov.
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const scriptsPath = DANILOV.replace(/\\/g, '/'); // path POSIX-style per i messaggi all'agente
const { goalDir, goalFile, currentSessionId } = require(path.join(DANILOV, 'session.js'));
const ui = require(path.join(DANILOV, 'ui.js'));

const SKELETON = `# DanilovGoal: (in attesa di pianificazione)
## 1. Pianificazione
(in compilazione: usa plan.js per scrivere il piano)
## 2. Trace
| ts | bit | mask | pre | post | esito | sig |
|----|-----|------|-----|------|-------|-----|
## 3. Validazione
(compilata a fine corsa da validate.js)
## 4. Riepilogo visivo
(placeholder)
`;

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (input += chunk));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const prompt = String(data.prompt || '');
    // Stesso id usato da statusline e script (env-first): isola le sessioni.
    const sid = String(currentSessionId(data.session_id) || 'default');
    const cwd = data.cwd || process.cwd();
    const flagFile = path.join(STATE_DIR, `${sid}.json`);

    // clear PRIMA di isSlash: "/danilov-clear" e "/danilov clear" matchano anche /danilov.
    const isDisable =
      /^\s*\/danilov[-\s]+clear\b/i.test(prompt) ||
      /\b(annulla|disattiva|stop)\s+danilov\b/i.test(prompt);
    const isSlash = !isDisable && /^\s*\/danilov\b/i.test(prompt);

    const TRIGGERS = [
      /\bdanilov\s*goal\b/i,
      /\bdanilovgoal\b/i,
      /\bmetodo\s+danilov\b/i,
      /\bprompt\s+(numeric|struttur)/i,
      /\bINDICE\s*\/\s*DEFINIZIONI\s*\/\s*RELAZIONI\b/i,
      /\btracciat[oa]\s+a\s+bit\b/i,
      /\bbit\s+one[- ]?hot\b/i,
    ];
    const isKeyword = TRIGGERS.some(re => re.test(prompt));

    // Escape hatch: spegne l'enforcement e rimuove il goal della sessione.
    if (isDisable) {
      try { fs.rmSync(flagFile, { force: true }); } catch {}
      try { fs.rmSync(goalFile(cwd, sid), { force: true }); } catch {}
      process.stdout.write('[Danilov] Modalita\' DanilovGoal disattivata per questa sessione.');
      return;
    }

    if (!isSlash && !isKeyword) process.exit(0);

    // Alza il flag di enforcement (con cwd/progetto per riferimento).
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(
        flagFile,
        JSON.stringify({ active: true, cwd, ts: Date.now() }),
        'utf8'
      );
    } catch {}

    // Crea lo scheletro del goal della sessione (riferimento immediato per la
    // status line). /danilov esplicito = nuovo obiettivo -> reset scheletro.
    // keyword = crea solo se manca (non distrugge un goal in corso).
    try {
      fs.mkdirSync(goalDir(cwd), { recursive: true });
      const gf = goalFile(cwd, sid);
      if (isSlash || !fs.existsSync(gf)) fs.writeFileSync(gf, SKELETON, 'utf8');
    } catch {}

    // --- Memoria del progetto: surfacing + motore sempre attivo ---
    const memScript = path.join(DANILOV, 'memory.js');
    const rows = [];
    // Memoria del progetto.
    try {
      const o = execFileSync('node', [memScript, 'plans', '--cwd', cwd], { encoding: 'utf8', timeout: 3000 });
      const j = JSON.parse(o.trim().split('\n').pop());
      if (j && j.ok && j.count > 0) {
        const tot = j.plans.reduce((s, p) => s + (p.events || 0), 0);
        const top = j.plans.slice(0, 3).map(p => `${p.plan} (${p.events})`).join(', ');
        rows.push(ui.kv('Memoria', `${tot} event${tot === 1 ? 'o' : 'i'} ${ui.G.dot} ${j.count} pian${j.count === 1 ? 'o' : 'i'}`));
        rows.push(ui.kv('', `ultimi: ${top}`));
      } else {
        rows.push(ui.kv('Memoria', 'nessuna ancora · popolata a fine turno'));
      }
    } catch {}
    // Stato del motore: UP -> la search delega; DOWN -> locale, non usato nel piano.
    try {
      const ho = execFileSync('node', [memScript, 'health'], { encoding: 'utf8', timeout: 4000 });
      const hj = JSON.parse(ho.trim().split('\n').pop());
      rows.push(ui.kv('Motore', hj && hj.up
        ? `${ui.dot(true)} UP ${ui.G.dot} delega automatica`
        : `${ui.dot(false)} DOWN ${ui.G.dot} ricerca locale (memory.js engine up)`));
    } catch {}
    rows.push(ui.kv('Cerca', 'memory.js search --query "<tema>"'));
    rows.push(ui.kv('Tools', 'memory.js tools'));
    const memNote = '\n' + ui.card(null, rows);

    // Motore sempre attivo: sveglia i container knowagebase in background (best-effort).
    if (isSlash && process.env.DANILOV_AUTO_ENGINE !== '0') {
      try { spawn('node', [memScript, 'engine', 'up', '--cwd', cwd], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    }

    // Lo slash command emette gia' le istruzioni: aggiungo solo il surfacing memoria.
    if (isSlash) { if (memNote) process.stdout.write(memNote.trim()); process.exit(0); }

    process.stdout.write(
      '[Danilov] Metodo Danilov attivo per questa sessione. ' +
        'Carica la skill `danilov-prompt` (tool Skill) e applicala in ' +
        'modalita\' DanilovGoal: INDICE/DEFINIZIONI/RELAZIONI, bit one-hot. ' +
        'Il goal e\' nello storage di sessione del progetto (gia\' creato): ' +
        'scrivi il piano con plan.js, marca ogni task con ' +
        '`node ' + scriptsPath + '/mark.js <bit> OK`, chiudi con ' +
        '`node ' + scriptsPath + '/validate.js`. Il turno non si chiude ' +
        'senza goal conforme. In DanilovGoal pensi in @ e relazioni, non in ' +
        'frasi: ogni evento e\' una relazione "@<azione>: <file> → ' +
        '<obiettivo> [ <nota> ]" (read/find/plan/edit/new/fix/error/run/test). ' +
        'Anche le transizioni escono cosi\'. Voce = tool + output script + ' +
        'righe-evento @. Il pensiero esteso lo affidi al file. ' +
        '(Per annullare: "annulla danilov".)' + memNote
    );
  } catch {}
});
