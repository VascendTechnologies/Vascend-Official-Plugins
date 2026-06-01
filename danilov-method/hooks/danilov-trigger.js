#!/usr/bin/env node
// UserPromptSubmit Hook: attivazione del metodo Danilov.
//  - `/danilov on` (o `/danilov` senza argomento)  -> MODALITA' STICKY: da quel
//    momento OGNI prompt e' un obiettivo Danilov, senza riscrivere il comando.
//  - `/danilov off` / `/danilov-clear` / "annulla danilov" -> spegne tutto.
//  - `/danilov <obiettivo>`  -> obiettivo one-shot (non sticky).
//  - keyword del metodo      -> attiva su quel prompt.
// In tutti i casi attivi: alza il flag di sessione (~/.claude/.danilov-state/
// <sid>.json, con `sticky` se in modalita') e crea/azzera lo scheletro del goal
// (~/.claude/projects/<cwd-encoded>/DanilovGoal/<sid>.md). Lo stato resta in
// ~/.claude; il codice e' nel plugin. Pass-through silenzioso fuori dai casi.

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

// Card di surfacing della memoria del progetto (+ risveglio motore se wake).
function memorySurface(cwd, wake) {
  const memScript = path.join(DANILOV, 'memory.js');
  const rows = [];
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
  try {
    const ho = execFileSync('node', [memScript, 'health'], { encoding: 'utf8', timeout: 4000 });
    const hj = JSON.parse(ho.trim().split('\n').pop());
    rows.push(ui.kv('Motore', hj && hj.up
      ? `${ui.dot(true)} UP ${ui.G.dot} delega automatica`
      : `${ui.dot(false)} DOWN ${ui.G.dot} ricerca locale (memory.js engine up)`));
  } catch {}
  rows.push(ui.kv('Cerca', 'memory.js search --query "<tema>"'));
  rows.push(ui.kv('Tools', 'memory.js tools'));
  if (wake && process.env.DANILOV_AUTO_ENGINE !== '0') {
    try { spawn('node', [memScript, 'engine', 'up', '--cwd', cwd], { detached: true, stdio: 'ignore' }).unref(); } catch {}
  }
  return '\n' + ui.card(null, rows);
}

const INSTRUCTIONS =
  '[Danilov] Metodo Danilov attivo. Carica la skill `danilov-prompt` (tool ' +
  'Skill) e applicala in modalita\' DanilovGoal: INDICE/DEFINIZIONI/RELAZIONI, ' +
  'bit one-hot. Il goal e\' nello storage di sessione del progetto (gia\' ' +
  'creato): scrivi il piano con `node ' + scriptsPath + '/plan.js`, marca ogni ' +
  'task con `node ' + scriptsPath + '/mark.js <bit> OK` (anteprima `--dry`, ' +
  'annulla `node ' + scriptsPath + '/unmark.js <bit>`), chiudi con `node ' +
  scriptsPath + '/validate.js`. Il turno non si chiude senza goal conforme. In ' +
  'DanilovGoal pensi in relazioni, non in frasi: ogni evento e\' una riga ' +
  '`<azione> <target>>obiettivo | nota`. Il pensiero esteso lo affidi al file.';

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

    // Quando si invoca lo slash command /danilov, l'hook riceve l'ESPANSIONE
    // del comando (il suo markdown), non "/danilov on". Il comando si gestisce
    // da se' (on/off via mode.js, obiettivo via plan.js): l'hook NON deve
    // interferire (niente flag/goal spuri). Riconosci l'espansione e fai
    // pass-through. (/danilov-clear e /danilov-compact hanno blob diversi e
    // proseguono normalmente.)
    if (/^#\s*Comando\s+\/danilov\b/m.test(prompt) || /##\s*on\s*\/\s*off\s*\/\s*obiettivo/i.test(prompt)) {
      process.exit(0);
    }

    // Flag corrente: serve a sapere se la modalita' STICKY e' gia' attiva.
    let curFlag = null;
    try { if (fs.existsSync(flagFile)) curFlag = JSON.parse(fs.readFileSync(flagFile, 'utf8')); } catch {}
    const stickyOn = !!(curFlag && curFlag.sticky);

    // Comando slash e suo argomento (on|off|<obiettivo>).
    const slash = prompt.match(/^\s*\/danilov\b[ \t]*(.*)$/i);
    const slashArg = slash ? slash[1].trim().toLowerCase() : null;

    // OFF prima di tutto: /danilov-clear, /danilov off, "annulla|disattiva|stop danilov".
    const isOff =
      /^\s*\/danilov[-\s]+clear\b/i.test(prompt) ||
      /\b(annulla|disattiva|stop)\s+danilov\b/i.test(prompt) ||
      (!!slash && /^off\b/.test(slashArg));
    // ON: /danilov on  oppure  /danilov senza argomento -> interruttore sticky.
    const isOn = !isOff && !!slash && (slashArg === '' || /^on\b/.test(slashArg));
    // Obiettivo one-shot: /danilov <testo> (diverso da on/off).
    const isObjective = !isOff && !isOn && !!slash;

    const TRIGGERS = [
      /\bdanilov\s*goal\b/i,
      /\bdanilovgoal\b/i,
      /\bmetodo\s+danilov\b/i,
      /\bprompt\s+(numeric|struttur)/i,
      /\bINDICE\s*\/\s*DEFINIZIONI\s*\/\s*RELAZIONI\b/i,
      /\btracciat[oa]\s+a\s+bit\b/i,
      /\bbit\s+one[- ]?hot\b/i,
    ];
    const isKeyword = !slash && TRIGGERS.some(re => re.test(prompt));
    const isPlain = !slash && !isKeyword; // prompt "normale"

    // --- OFF: spegne enforcement, sticky e goal della sessione ---
    if (isOff) {
      try { fs.rmSync(flagFile, { force: true }); } catch {}
      try { fs.rmSync(goalFile(cwd, sid), { force: true }); } catch {}
      process.stdout.write('[Danilov] Modalita\' DanilovGoal disattivata (sticky OFF) per questa sessione.');
      return;
    }

    // --- ON: accende la modalita' STICKY; NON pianifica adesso ---
    if (isOn) {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd, ts: Date.now() }), 'utf8');
      } catch {}
      const note = memorySurface(cwd, process.env.DANILOV_AUTO_ENGINE !== '0');
      process.stdout.write(('[Danilov] Modalita\' DanilovGoal STICKY ATTIVA: da ora OGNI prompt e\' un ' +
        'obiettivo Danilov (pianifica, marca, valida) senza riscrivere il comando. ' +
        'Per spegnere: /danilov off.' + (note || '')).trim());
      return;
    }

    // --- Questo prompt avvia un obiettivo Danilov? ---
    // obiettivo slash, keyword, o QUALSIASI prompt mentre sticky e' attivo.
    const shouldTrigger = isObjective || isKeyword || (stickyOn && isPlain);
    if (!shouldTrigger) process.exit(0);

    // Alza il flag (enforcement), preservando lo sticky se era attivo.
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: stickyOn, cwd, ts: Date.now() }), 'utf8');
    } catch {}

    // Goal skeleton: nuovo obiettivo (slash-obiettivo o prompt sticky) -> reset;
    // keyword -> crea solo se manca (non distrugge un goal in corso).
    const resetGoal = isObjective || (stickyOn && isPlain);
    try {
      fs.mkdirSync(goalDir(cwd), { recursive: true });
      const gf = goalFile(cwd, sid);
      if (resetGoal || !fs.existsSync(gf)) fs.writeFileSync(gf, SKELETON, 'utf8');
    } catch {}

    const memNote = memorySurface(cwd, isObjective && process.env.DANILOV_AUTO_ENGINE !== '0');

    // /danilov <obiettivo>: il comando slash emette gia' le istruzioni di piano.
    if (isObjective) { if (memNote) process.stdout.write(memNote.trim()); process.exit(0); }

    // keyword o prompt-sticky: nessun comando slash -> le istruzioni le emette l'hook.
    process.stdout.write(INSTRUCTIONS + memNote);
  } catch {}
});
