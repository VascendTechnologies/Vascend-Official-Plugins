#!/usr/bin/env node
// UserPromptSubmit Hook: attivazione del metodo Danilov (comando /vascend).
//  - `/vascend on` (o `/vascend` senza argomento)  -> MODALITA' STICKY: da quel
//    momento OGNI prompt e' un obiettivo Danilov, senza riscrivere il comando.
//    TOGGLE ISTANTANEO (come /effort): il prompt viene BLOCCATO qui (decision:block),
//    la modalita' si attiva subito in chat e il modello non viene invocato.
//  - `/vascend off` / `/vascend-clear` / "annulla vascend" -> spegne tutto (idem, block).
//  - `/vascend <obiettivo>`  -> obiettivo one-shot (non sticky).
//  (riconosce anche i vecchi alias /danilov* per transizione.)
//  - keyword del metodo      -> attiva su quel prompt.
// In tutti i casi attivi: alza il flag di sessione (~/.claude/.danilov-state/
// <sid>.json, con `sticky` se in modalita') e crea/azzera lo scheletro del goal
// (~/.claude/projects/<cwd-encoded>/DanilovGoal/<sid>.md). Lo stato resta in
// ~/.claude; il codice e' nel plugin. Pass-through silenzioso fuori dai casi.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Stato runtime (flag di sessione, goal): resta in ~/.claude, per-utente.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
// Codice: dentro il plugin. __dirname = <plugin>/hooks -> ../scripts/danilov.
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const scriptsPath = DANILOV.replace(/\\/g, '/'); // path POSIX-style per i messaggi all'agente
const { goalDir, goalFile, currentSessionId } = require(path.join(DANILOV, 'session.js'));
const ui = require(path.join(DANILOV, 'ui.js'));
const { computeVerdict } = require(path.join(DANILOV, 'core.js'));

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

// Card di surfacing della memoria LOCALE del progetto (file .vascend a relazioni).
function memorySurface(cwd) {
  const memScript = path.join(DANILOV, 'memory.js');
  const rows = [];
  try {
    const o = execFileSync('node', [memScript, 'plans', '--cwd', cwd], { encoding: 'utf8', timeout: 3000 });
    const j = JSON.parse(o.trim().split('\n').pop());
    if (j && j.ok && j.count > 0) {
      const tot = j.plans.reduce((s, p) => s + (p.events || 0), 0);
      const top = j.plans.slice(0, 3).map(p => `${p.plan} (${p.events})`).join(', ');
      rows.push(ui.kv('Memoria', `${tot} event${tot === 1 ? 'o' : 'i'} ${ui.G.dot} ${j.count} pian${j.count === 1 ? 'o' : 'i'} ${ui.G.dot} locale .vascend`));
      rows.push(ui.kv('', `ultimi: ${top}`));
    } else {
      rows.push(ui.kv('Memoria', 'nessuna ancora · popolata a fine turno (.vascend locale)'));
    }
  } catch {}
  rows.push(ui.kv('Cerca', 'memory.js search --query "<tema>"'));
  rows.push(ui.kv('Grafo', 'memory.js query <filtri> · memory.js graph (node-link JSON)'));
  return '\n' + ui.card(null, rows);
}

// Reiniezione nel loop (C): memorie RILEVANTI al tema del prompt corrente.
// Cerca nella memoria locale (BM25+cue, conoscenza pesata) e mostra i top
// risultati, da LEGGERE prima di pianificare. Ritorna null se niente di utile.
function relevantMemories(cwd, prompt) {
  const q = String(prompt || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (q.length < 4) return null;
  const memScript = path.join(DANILOV, 'memory.js');
  try {
    const o = execFileSync('node', [memScript, 'search', '--query', q, '--cwd', cwd, '--k', '5'],
      { encoding: 'utf8', timeout: 4000 });
    const j = JSON.parse(o.trim().split('\n').pop());
    if (j && j.ok && Array.isArray(j.results) && j.results.length) {
      const rows = [];
      rows.push(ui.kv('Rilevanti', `${j.results.length} memorie sul tema (su ${j.total_pool || j.results.length})`));
      for (const r of j.results.slice(0, 5)) {
        const mark = r.kind === 'knowledge' ? '* ' : '';
        rows.push(ui.li(`${mark}${String(r.raw).slice(0, 72)} ${ui.G.dot} ${r.plan}`));
      }
      rows.push(ui.kv('', 'LEGGILE prima di pianificare: gia\' deciso/imparato qui.'));
      return '\n' + ui.card('memorie rilevanti', rows);
    }
  } catch {}
  return null;
}

// Toggle istantaneo, sul modello di /effort: blocca il prompt PRIMA che arrivi
// al modello e mostra una conferma pulita all'utente. decision:block + exit 0 ->
// il modello NON viene mai invocato; `reason` e' mostrato all'utente (non aggiunto
// al contesto). suppressOriginalPrompt nasconde il "/vascend on" dal messaggio.
function blockPrompt(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason, suppressOriginalPrompt: true })); } catch {}
  process.exit(0);
}

const INSTRUCTIONS =
  '[Vascend] Modalita\' Vascend attiva (metodo Danilov). Carica la skill `danilov-prompt` (tool ' +
  'Skill) e applicala in modalita\' DanilovGoal: INDICE/DEFINIZIONI/RELAZIONI, ' +
  'bit one-hot. Il goal e\' nello storage di sessione del progetto (gia\' ' +
  'creato): scrivi il piano con `node ' + scriptsPath + '/plan.js`, marca ogni ' +
  'task con `node ' + scriptsPath + '/mark.js <bit> OK` (anteprima `--dry`, ' +
  'annulla `node ' + scriptsPath + '/unmark.js <bit>`), chiudi con `node ' +
  scriptsPath + '/validate.js`. Il turno non si chiude senza goal conforme. In ' +
  'DanilovGoal pensi in relazioni, non in frasi: ogni evento e\' una riga ' +
  '`<azione> <target>>obiettivo | nota`. Il pensiero esteso lo affidi al file. ' +
  'Se sopra compaiono "memorie rilevanti", LEGGILE e tienine conto nel piano ' +
  '(cosa e\' gia\' stato deciso/imparato/rotto sul tema) PRIMA di scrivere plan.js; ' +
  'registra le nuove decisioni e lezioni con azioni decide/learn/bug/rootcause.';

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

    // Normalmente l'hook riceve il testo GREZZO (`/vascend:vascend on`) PRIMA
    // dell'espansione: e' qui sotto che on/off vengono gestiti (block) e
    // l'obiettivo riconosciuto. Se pero' in qualche configurazione arriva
    // l'ESPANSIONE del comando (il suo markdown), facciamo pass-through: in quel
    // caso e' la markdown stessa a guidare (mode.js per on/off come fallback,
    // plan.js per l'obiettivo). (/vascend-clear e /vascend-compact hanno blob
    // diversi e proseguono normalmente.)
    if (/^#\s*Comando\s+\/(?:danilov|vascend)\b/m.test(prompt) || /##\s*on\s*\/\s*off\s*\/\s*obiettivo/i.test(prompt)) {
      process.exit(0);
    }

    // Flag corrente: serve a sapere se la modalita' STICKY e' gia' attiva.
    let curFlag = null;
    try { if (fs.existsSync(flagFile)) curFlag = JSON.parse(fs.readFileSync(flagFile, 'utf8')); } catch {}
    const stickyOn = !!(curFlag && curFlag.sticky);

    // Comando slash e suo argomento (on|off|<obiettivo>). Il `(?::vascend)?`
    // assorbe il namespace del plugin: il testo grezzo arriva come
    // `/vascend:vascend on`, non `/vascend on`. Senza questo, l'argomento
    // diventava ":vascend on" e on/off venivano scambiati per un obiettivo.
    const slash = prompt.match(/^\s*\/(?:danilov|vascend)(?::vascend)?\b[ \t]*(.*)$/i);
    const slashArg = slash ? slash[1].trim().toLowerCase() : null;

    // OFF prima di tutto: /vascend-clear, /vascend off|clear, "annulla|disattiva|stop vascend".
    // Match ESATTO dell'argomento (non prefisso): cosi' un obiettivo che inizia
    // per "off"/"clear" non viene scambiato per lo spegnimento.
    const isOff =
      /^\s*\/(?:danilov|vascend)(?::vascend)?[-\s]+clear\b/i.test(prompt) ||
      /\b(annulla|disattiva|stop)\s+(?:danilov|vascend)\b/i.test(prompt) ||
      (!!slash && (slashArg === 'off' || slashArg === 'clear'));
    // ON: /vascend on  oppure  /vascend senza argomento -> interruttore sticky.
    // Anche qui match esatto: /vascend on <testo> resta un obiettivo, non un toggle.
    const isOn = !isOff && !!slash && (slashArg === '' || slashArg === 'on');
    // Obiettivo one-shot: /vascend <testo> (diverso da on/off).
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

    // --- OFF: spegne enforcement, sticky e goal della sessione (toggle istantaneo) ---
    if (isOff) {
      try { fs.rmSync(flagFile, { force: true }); } catch {}
      try { fs.rmSync(goalFile(cwd, sid), { force: true }); } catch {}
      blockPrompt('[Vascend] Modalita\' Vascend disattivata per questa sessione (sticky OFF).');
      return;
    }

    // --- ON: accende la modalita' STICKY (toggle istantaneo, come /effort); NON pianifica ---
    // Blocca il prompt: la modalita' si attiva subito in chat, il modello non viene
    // invocato (niente espansione del comando da interpretare).
    if (isOn) {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd, ts: Date.now() }), 'utf8');
      } catch {}
      blockPrompt('[Vascend] Modalita\' Vascend STICKY ATTIVA: da ora OGNI prompt e\' un ' +
        'obiettivo Danilov (pianifica, marca, valida) senza riscrivere il comando. Per spegnere: /vascend off.');
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

    // Goal skeleton: un nuovo obiettivo resetta; ma un goal IN CORSO (piano con
    // MASK_TARGET presente e NON ancora conforme) NON va azzerato, altrimenti un
    // prompt a meta' obiettivo (es. "continua") cancellerebbe piano+trace tra i
    // turni. Reset solo se il goal manca, e' uno skeleton (niente piano) o e'
    // gia' conforme (obiettivo precedente concluso -> questo e' nuovo).
    try {
      fs.mkdirSync(goalDir(cwd), { recursive: true });
      const gf = goalFile(cwd, sid);
      let inProgress = false;
      if (fs.existsSync(gf)) {
        try {
          const v = computeVerdict(fs.readFileSync(gf, 'utf8'));
          inProgress = v.target != null && !v.conforme; // piano presente e non illuminato
        } catch {}
      }
      const wantReset = (isObjective || (stickyOn && isPlain)) && !inProgress;
      if (wantReset || !fs.existsSync(gf)) fs.writeFileSync(gf, SKELETON, 'utf8');
    } catch {}

    // Reiniezione nel loop (C): memorie rilevanti al tema, se ci sono; altrimenti panoramica.
    const memNote = relevantMemories(cwd, prompt) || memorySurface(cwd);

    // /vascend <obiettivo>: il comando slash emette gia' le istruzioni di piano.
    if (isObjective) { if (memNote) process.stdout.write(memNote.trim()); process.exit(0); }

    // keyword o prompt-sticky: nessun comando slash -> le istruzioni le emette l'hook.
    process.stdout.write(INSTRUCTIONS + memNote);
  } catch {}
});
