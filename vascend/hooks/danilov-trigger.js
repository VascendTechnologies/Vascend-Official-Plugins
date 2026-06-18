#!/usr/bin/env node
// UserPromptSubmit Hook: attivazione del metodo Danilov (comando /vascend).
//  - `/vascend on` (o `/vascend` senza argomento)  -> MODALITA' STICKY: da quel
//    momento OGNI prompt e' un obiettivo Danilov, senza riscrivere il comando.
//    All'attivazione INNESCA LA COMBO: inietta la skill danilov-prompt + il primer
//    del metodo (additionalContext) e sopprime il prompt grezzo, cosi' il modello
//    carica il metodo e conferma in una riga (senza pianificare). NON blocca.
//  - `/vascend off` / `/vascend-clear` / "annulla vascend" -> spegne tutto (block).
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
const { goalDir, goalFile, listSessionPlans, writeGoalAtomic, currentSessionId, resolveSkill } = require(path.join(DANILOV, 'session.js'));
const ui = require(path.join(DANILOV, 'ui.js'));
const { kingdomVerdict, nextRoom, rotSummary } = require(path.join(DANILOV, 'kingdom.js'));
const { taskFiles } = require(path.join(DANILOV, 'core.js'));

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
    const o = execFileSync('node', [memScript, 'search', '--query', q, '--cwd', cwd, '--k', '8'],
      { encoding: 'utf8', timeout: 4000 });
    const j = JSON.parse(o.trim().split('\n').pop());
    if (!(j && j.ok && Array.isArray(j.results) && j.results.length)) return null;
    // Dedup per TESTO (lo store accumulava la stessa riga sotto piani diversi ->
    // top-k di righe identiche) e priorita' alla CONOSCENZA: e' l'unica che vale
    // davvero rileggere prima di pianificare.
    const seen = new Set();
    const uniq = [];
    for (const r of j.results) {
      const key = String(r.raw || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); uniq.push(r);
    }
    uniq.sort((a, b) => (b.kind === 'knowledge') - (a.kind === 'knowledge'));
    const top = uniq.slice(0, 5);
    if (!top.length) return null;
    const rows = [];
    rows.push(ui.kv('Rilevanti', `${top.length} memorie sul tema (su ${j.total_pool || top.length})`));
    for (const r of top) {
      const mark = r.kind === 'knowledge' ? '* ' : '';
      rows.push(ui.li(`${mark}${String(r.raw).slice(0, 72)} ${ui.G.dot} ${r.plan}`));
    }
    rows.push(ui.kv('', 'LEGGILE prima di pianificare: gia\' deciso/imparato qui.'));
    return '\n' + ui.card('memorie rilevanti', rows);
  } catch {}
  return null;
}

// Skill abbinate alla PROSSIMA stanza al buio del regno: il task le dichiara con
// `@skill:<slug>[,<slug>]` nel piano e l'hook, a ogni prompt, ricorda al modello
// di caricarle col tool Skill PRIMA di lavorare quella stanza. L'hook NON puo'
// invocare la skill (solo il modello lo fa via tool): la "attiva" iniettando la
// direttiva, come gia' fa per la skill danilov-prompt. null se nessuna skill.
function skillsToActivate(cwd, sessionId) {
  try {
    const nr = nextRoom(cwd, sessionId);
    if (!nr || !Array.isArray(nr.skills) || !nr.skills.length) return null;
    // Risolvi ogni @skill: CUSTOM (file di sessione -> contenuto iniettato al
    // volo) vs REGISTRY (skill di Claude Code -> caricala col tool Skill).
    const resolved = nr.skills.map(s => resolveSkill(s, cwd, sessionId));
    const custom = resolved.filter(r => r.kind === 'custom');
    const registry = resolved.filter(r => r.kind === 'registry');
    const rows = [];
    const cleanDesc = String(nr.desc || '').replace(/@skill:[^\s|]+/g, '').replace(/\s{2,}/g, ' ').slice(0, 56).trim();
    rows.push(ui.kv('Stanza', `${nr.task} ${ui.G.dot} ${cleanDesc}`));
    if (registry.length) {
      rows.push(ui.kv('Skill', registry.map(r => r.name).join(', ')));
      rows.push(ui.kv('', 'CARICALE col tool Skill PRIMA di lavorare la stanza (una per chiamata).'));
    }
    if (custom.length) {
      rows.push(ui.kv('Custom', custom.map(r => r.name).join(', ') + ' (skill di sessione, contenuto sotto)'));
    }
    let out = '\n' + ui.card('skill da attivare', rows);
    // Le skill CUSTOM sono iniettate SUL MOMENTO: il loro contenuto (notazione
    // Danilov) entra nel contesto qui, senza passare dal registro/tool Skill.
    for (const c of custom) {
      out += `\n\n[Vascend] skill custom "${c.name}" per la stanza ${nr.task} (applicala ora):\n` +
        '----- BEGIN SKILL ' + c.name + ' -----\n' + String(c.content || '').trim() + '\n----- END SKILL ' + c.name + ' -----';
    }
    return out;
  } catch { return null; }
}

// Card CONTEXT-ROT in fase di pianificazione/esecuzione: preview deterministica
// (units dall'ultimo compact + peso @w delle stanze al buio vs budget) con
// consiglio di SUDDIVISIONE (complessi -> subplan + @compact; semplici batch).
// null quando non c'e' lavoro al buio (regno chiuso) -> niente rumore.
function rotCard(cwd, sessionId) {
  try {
    const r = rotSummary(cwd, sessionId);
    if (!r || r.darkRooms === 0) return null;
    const rows = [];
    rows.push(ui.kv('Rot', `${r.est.pct}% ${ui.G.dot} ${r.est.band} ora -> ${r.est.projectedPct}% ${r.est.projectedBand} a fine regno (units ${r.units}/${r.est.budget})`));
    if (r.heavy.length) {
      rows.push(ui.kv('Pesanti', r.heavy.slice(0, 6).map(h => `${h.task}${h.slug ? '@' + h.slug : ''} (w${h.weight})`).join(', ')));
    }
    let advice;
    if (r.est.projectedBand === 'rosso') advice = 'SUDDIVIDI i complessi (subplan) e marca @compact dopo i pesanti per resettare la rot; batcha i semplici.';
    else if (r.est.projectedBand === 'giallo') advice = 'Valuta @compact dopo le stanze pesanti; raggruppa i semplici.';
    else advice = 'Margine ampio: procedi.';
    rows.push(ui.kv('Consiglio', advice));
    return '\n' + ui.card('context rot', rows);
  } catch { return null; }
}

// PREFETCH FILE: i file taggati `@file:` sulla prossima stanza vengono LETTI e
// iniettati qui (gia' in contesto), cosi' l'agente non spende un giro di tool a
// rileggerli — lo aveva gia' pianificato in fase di progettazione del regno.
// Cap per-file (DANILOV_PREFETCH_MAXBYTES, default 8000) e numero file
// (DANILOV_PREFETCH_MAXFILES, default 6); nota se troncato o non leggibile.
function filesToPrefetch(cwd, sessionId) {
  try {
    const nr = nextRoom(cwd, sessionId);
    if (!nr) return null;
    const files = taskFiles(nr.desc);
    if (!files.length) return null;
    const maxFiles = parseInt(process.env.DANILOV_PREFETCH_MAXFILES, 10) || 6;
    const perFile = parseInt(process.env.DANILOV_PREFETCH_MAXBYTES, 10) || 8000;
    const rows = [ui.kv('Stanza', `${nr.task}`)];
    const blocks = [];
    let shown = 0;
    for (const rel of files) {
      if (shown >= maxFiles) { rows.push(ui.kv('', `... e altri ${files.length - shown} file non caricati (cap ${maxFiles})`)); break; }
      shown++;
      const abs = path.resolve(cwd, rel);
      let content = null, err = null;
      try { content = fs.readFileSync(abs, 'utf8'); } catch (e) { err = (e && e.code) || 'errore'; }
      if (err) { rows.push(ui.li(`${rel} ${ui.G.dot} NON letto (${err})`)); continue; }
      let body = content, trunc = '';
      if (body.length > perFile) { body = body.slice(0, perFile); trunc = ` (troncato a ${perFile} di ${content.length} byte)`; }
      rows.push(ui.li(`${rel} (${content.length} byte)${trunc}`));
      blocks.push(`----- BEGIN FILE ${rel} -----\n${body}\n----- END FILE ${rel} -----`);
    }
    let out = '\n' + ui.card('file pre-caricati', rows);
    if (blocks.length) {
      out += `\n\n[Vascend] file pre-caricati per la stanza ${nr.task} (gia' in contesto, NON rileggerli col tool):\n` + blocks.join('\n\n');
    }
    return out;
  } catch { return null; }
}

// Toggle istantaneo, sul modello di /effort: blocca il prompt PRIMA che arrivi
// al modello e mostra una conferma pulita all'utente. decision:block + exit 0 ->
// il modello NON viene mai invocato; `reason` e' mostrato all'utente (non aggiunto
// al contesto). suppressOriginalPrompt nasconde il "/vascend on" dal messaggio.
function blockPrompt(reason) {
  try { process.stdout.write(JSON.stringify({ decision: 'block', reason, suppressOriginalPrompt: true })); } catch {}
  process.exit(0);
}

// CARICA la skill danilov-prompt DAL hook: ne legge il SKILL.md e lo inietta nel
// contesto. Cosi' il metodo e' attivo SENZA che il modello debba chiamare il
// tool Skill (forzato, non suggerito). Vuoto se il file non e' leggibile (non
// blocca mai l'attivazione). Iniettato una volta per sessione (vedi instructed).
function loadSkillContent() {
  try {
    const f = path.join(__dirname, '..', 'skills', 'danilov-prompt', 'SKILL.md');
    const md = fs.readFileSync(f, 'utf8').trim();
    if (!md) return '';
    return '\n\n[Vascend] skill `danilov-prompt` CARICATA dall\'hook (applicala ora, non serve il tool Skill):\n' +
      '----- BEGIN SKILL danilov-prompt -----\n' + md + '\n----- END SKILL danilov-prompt -----';
  } catch { return ''; }
}

const INSTRUCTIONS =
  '[Vascend] Modalita\' Vascend attiva (metodo Danilov). La skill `danilov-prompt` ' +
  'e\' caricata QUI SOTTO dall\'hook (gia\' attiva, non chiamare il tool Skill): ' +
  'applicala in modalita\' DanilovGoal: INDICE/DEFINIZIONI/RELAZIONI, ' +
  'bit one-hot. Il goal e\' nello storage di sessione del progetto (gia\' ' +
  'creato): scrivi il piano con `node ' + scriptsPath + '/plan.js`, marca ogni ' +
  'task con `node ' + scriptsPath + '/mark.js <bit> OK` (anteprima `--dry`, ' +
  'annulla `node ' + scriptsPath + '/unmark.js <bit>`), chiudi con `node ' +
  scriptsPath + '/validate.js`. Il turno non si chiude senza goal conforme. In ' +
  'DanilovGoal pensi in relazioni, non in frasi: ogni evento e\' una riga ' +
  '`<azione> <target>>obiettivo | nota`. Il pensiero esteso lo affidi al file. ' +
  'Se sopra compaiono "memorie rilevanti", LEGGILE e tienine conto nel piano ' +
  '(cosa e\' gia\' stato deciso/imparato/rotto sul tema) PRIMA di scrivere plan.js; ' +
  'registra le nuove decisioni e lezioni con azioni decide/learn/bug/rootcause. ' +
  'Obiettivo con piu\' workstream? CASTELLI MULTIPLI: `castle.js new <slug> "<titolo>" "T01: ..." ' +
  '[--after <slug>]` (illimitati), micro-task ricorsivi con `subplan.js [padre.md] <bit> ...`, ' +
  'verdetto del regno con `validate.js --kingdom`, prossima stanza con `castle.js next`. ' +
  'Marca un task `@compact` nel piano = dopo quello step compatta il contesto. ' +
  'Abbina skill a un task con `@skill:<slug>[,<slug>]` nella sua descrizione (es. ' +
  '"T03: estrai PDF @skill:pdf-ocr"): la prossima stanza con skill te le ricorda ' +
  'l\'hook (card "skill da attivare") e mark.js -> caricale col tool Skill prima di lavorarla. ' +
  'Obiettivo BUSINESS? Regno in fasi: castello analisi -> struttura (--after) -> esecuzione; ' +
  'APPUNTI ricchi per stanza nel dossier `<piano>.notes.md` (Write/Edit liberi, il protect li esenta); ' +
  'board visiva: `castle.js kanban --write` -> VASCEND_KANBAN.md.';

// Primer di ATTIVAZIONE (`/vascend on`): non un toggle muto, ma l'innesco della
// combo. Si inietta SUBITO la skill + il metodo, il modello conferma in una riga
// e attende l'obiettivo. NON pianifica (non c'e' ancora un obiettivo).
const ON_PRIMER =
  '[Vascend] Modalita\' STICKY ATTIVATA. La skill `danilov-prompt` e\' caricata QUI ' +
  'SOTTO dall\'hook (gia\' attiva, NON chiamare il tool Skill): applicala da ora. Da ' +
  'questo momento OGNI prompt e\' un obiettivo Danilov (pianifica con `node ' + scriptsPath +
  '/plan.js`, marca con `mark.js <bit> OK`, valida con `validate.js`); piu\' workstream = ' +
  'CASTELLI MULTIPLI (`castle.js new ...`). ORA pero\' NON pianificare e NON creare goal: ' +
  'conferma in UNA riga che la modalita\' e\' attiva e il metodo caricato, poi attendi ' +
  'l\'obiettivo. Per spegnere: /vascend off.';

// Promemoria breve per i turni SUCCESSIVI della stessa sessione sticky: il blocco
// INSTRUCTIONS completo (~300 token) si inietta una volta sola, non a ogni prompt.
const REMINDER =
  '[Vascend] Modalita\' Vascend attiva (Danilov sticky): questo prompt e\' un ' +
  'obiettivo. Pianifica con plan.js, marca con mark.js, valida con validate.js. ' +
  'Se sotto compaiono "memorie rilevanti", leggile prima di pianificare.';

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
    // Il metodo e' gia' stato presentato in questa sessione? Se si', i turni
    // successivi ricevono solo il promemoria breve invece del blocco completo.
    const wasInstructed = !!(curFlag && curFlag.instructed);

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

    // INGRESSO via /goal: il comando nativo /goal di Claude Code (fuori dal
    // plugin) avvia un obiettivo. Lo detectiamo dal prompt grezzo (`/goal ...`,
    // con eventuale namespace) e lo trattiamo come un ingresso al metodo: alza
    // sticky vascend + inietta la skill + INSTRUCTIONS (come fa il pattern-comando
    // di vascend-compact, ma per attivare invece che compattare). NON blocca: il
    // testo del goal deve raggiungere il modello e il comando /goal deve girare.
    const isGoalCmd = /^\s*\/goal(?::[a-z-]+)?(?:\s|$)/i.test(prompt);

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

    // --- OFF: spegne enforcement, sticky e l'INTERO REGNO della sessione ---
    // (master + castelli nominati + sub: lasciarli orfani farebbe riaffiorare
    // il regno nel resume e nell'enforcement alla prossima attivazione)
    if (isOff) {
      try { fs.rmSync(flagFile, { force: true }); } catch {}
      try { for (const p of listSessionPlans(cwd, sid)) fs.rmSync(p.file, { force: true }); } catch {}
      blockPrompt('[Vascend] Modalita\' Vascend disattivata per questa sessione (sticky OFF).');
      return;
    }

    // --- ON: accende la modalita' STICKY E innesca la combo di attivazione ---
    // NON blocca (un block impedirebbe al modello di agire): inietta la skill +
    // il primer del metodo come contesto e SOPPRIME il prompt grezzo. Cosi' la
    // modalita' si accende, la skill e' subito caricata e il modello conferma in
    // una riga senza pianificare. Marca `instructed`: i prossimi turni della
    // sessione ricevono solo il promemoria breve (skill gia' in contesto).
    if (isOn) {
      try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, instructed: true, cwd, ts: Date.now() }), 'utf8');
      } catch {}
      const primer = ON_PRIMER + loadSkillContent() + (memorySurface(cwd) || '');
      try {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: primer },
          suppressOriginalPrompt: true,
        }));
      } catch {}
      process.exit(0);
    }

    // --- Questo prompt avvia un obiettivo Danilov? ---
    // obiettivo slash, keyword, o QUALSIASI prompt mentre sticky e' attivo.
    const shouldTrigger = isObjective || isKeyword || isGoalCmd || (stickyOn && isPlain);
    if (!shouldTrigger) process.exit(0);

    // Alza il flag (enforcement), preservando lo sticky se era attivo. Marca
    // `instructed`: da ora il metodo e' stato presentato, i prossimi turni della
    // sessione ricevono solo il promemoria breve.
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: stickyOn || isGoalCmd, instructed: true, cwd, ts: Date.now() }), 'utf8');
    } catch {}

    // Goal skeleton: un nuovo obiettivo resetta; ma un REGNO IN CORSO (almeno
    // un castello con piano e non conforme — non solo il master) NON va
    // azzerato, altrimenti un prompt a meta' obiettivo (es. "continua")
    // cancellerebbe piano+trace tra i turni. Reset solo se il regno manca,
    // e' uno skeleton (niente piano) o e' gia' tutto conforme (obiettivo
    // precedente concluso -> questo e' nuovo).
    try {
      fs.mkdirSync(goalDir(cwd), { recursive: true });
      const gf = goalFile(cwd, sid);
      let inProgress = false;
      try {
        const k = kingdomVerdict(cwd, sid);
        inProgress = k.exists && !k.conforme; // un castello aperto ovunque nel regno
      } catch {}
      const wantReset = (isObjective || isGoalCmd || (stickyOn && isPlain)) && !inProgress;
      if (wantReset || !fs.existsSync(gf)) writeGoalAtomic(gf, SKELETON);
    } catch {}

    // Reiniezione nel loop (C): memorie rilevanti al tema, se ci sono; altrimenti panoramica.
    const memNote = relevantMemories(cwd, prompt) || memorySurface(cwd);
    // Skill abbinate alla prossima stanza: ricorda di caricarle prima di lavorarla.
    const skillNote = skillsToActivate(cwd, sid) || '';
    // Preview context-rot: stima del riempimento + consiglio di suddivisione.
    const rotNote = rotCard(cwd, sid) || '';
    // Prefetch file taggati sulla prossima stanza: contenuto gia' in contesto.
    const fileNote = filesToPrefetch(cwd, sid) || '';
    // Skill danilov-prompt CARICATA dall'hook (contenuto iniettato), solo la
    // prima volta della sessione: dopo e' gia' in contesto.
    const skillContent = wasInstructed ? '' : loadSkillContent();

    // obiettivo slash, keyword o prompt-sticky: le istruzioni del metodo le emette
    // SEMPRE l'hook (il markdown del comando ora e' solo uno stub di fallback, non
    // porta piu' il protocollo). Blocco completo solo la prima volta della
    // sessione; poi il promemoria breve (skill gia' in contesto).
    process.stdout.write((wasInstructed ? REMINDER : INSTRUCTIONS) + memNote + skillNote + rotNote + fileNote + skillContent);
  } catch {}
});
