// Gate di sessione del metodo Danilov.
// Dice se la sessione corrente ha la modalita' DanilovGoal attiva (flag alzato
// da danilov-trigger.js). Gli hook rumorosi (format/typecheck/console-warn/
// compact/doc-warning/...) lo usano per restare SILENZIOSI durante un
// DanilovGoal: l'output del metodo deve essere pulito (solo partito + verdetto).
// Fuori da Danilov, ritorna sempre false -> hook invariati.
//
// Naming dei piani della sessione (il REGNO):
//   <sid>.md                       master (castello di default, legacy)
//   <sid>.castle-<slug>.md         castello nominato (illimitati)
//   <base>.sub<bit>.md             figlio di QUALSIASI piano (ricorsivo:
//                                  <sid>.castle-api.sub3.sub0.md e' un nipote)
// La gerarchia e' implicita nel nome: scoprirla e' una scansione di directory.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');

// Id della sessione/conversazione corrente. CHIAVE: per evitare che hook
// (payload session_id) e script CLI (env) divergano — e quindi guardino file
// diversi, rompendo il multi-sessione — TUTTI preferiscono l'env
// CLAUDE_CODE_SESSION_ID (per-processo, identico per hook/statusline/script
// della stessa sessione, ereditato dai subagenti). `explicit` (data.session_id)
// resta fallback se l'env manca.
function currentSessionId(explicit) {
  return process.env.CLAUDE_CODE_SESSION_ID || explicit || process.env.CLAUDE_SESSION_ID || null;
}

// Encoding del cwd identico a quello usato da Claude Code per ~/.claude/projects.
function encodeCwd(cwd) {
  return String(cwd || process.cwd()).replace(/[^a-zA-Z0-9]/g, '-');
}

// Casa del goal: DENTRO lo storage di sessione del progetto
// (~/.claude/projects/<cwd-encoded>/DanilovGoal/), co-locato con i transcript
// che il resume richiama. Vantaggi: isolato per progetto, stabile per i
// subagenti (stesso cwd+env), legato alla sessione persistente, e FUORI da
// ~/.claude/DanilovGoal (niente collisioni con altre chat o test).
function goalDir(cwd) {
  return path.join(CLAUDE_DIR, 'projects', encodeCwd(cwd), 'DanilovGoal');
}
function goalFile(cwd, sessionId) {
  const sid = currentSessionId(sessionId);
  return path.join(goalDir(cwd), `${sid || 'no-session'}.md`);
}

const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Slug di castello: minuscolo, [a-z0-9-], niente '.' (il punto e' il
// separatore strutturale del naming .sub<N>/.castle-: ammetterlo creerebbe
// ambiguita' nella scoperta per scansione).
function castleSlug(raw) {
  const s = String(raw || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || null;
}
function castleFile(cwd, sessionId, slug) {
  const sid = currentSessionId(sessionId) || 'no-session';
  return path.join(goalDir(cwd), `${sid}.castle-${slug}.md`);
}

// Castelli nominati della sessione: [{slug, file}], ordinati per slug.
// Il master (castello di default) NON e' incluso: e' goalFile().
function listCastles(cwd, sessionId) {
  const sid = currentSessionId(sessionId) || 'no-session';
  const re = new RegExp(`^${escRe(sid)}\\.castle-([a-z0-9-]+)\\.md$`);
  let names = [];
  try { names = fs.readdirSync(goalDir(cwd)); } catch { return []; }
  return names
    .map(n => { const m = re.exec(n); return m ? { slug: m[1], file: path.join(goalDir(cwd), n) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

// Figlio di un PIANO QUALSIASI (master, castello o sub): <base>.sub<bit>.md.
// Ricorsivo per costruzione: il figlio di un sub e' <base>.sub<a>.sub<b>.md.
function childGoalFile(parentFile, bit) {
  return String(parentFile).replace(/\.md$/i, `.sub${bit}.md`);
}

// Figli DIRETTI di un piano: [{bit, file}], ordinati per bit. I nipoti
// (.sub<a>.sub<b>.md) non matchano la regex del livello: esclusi.
function listChildGoals(parentFile) {
  const dir = path.dirname(parentFile);
  const base = path.basename(parentFile).replace(/\.md$/i, '');
  const re = new RegExp(`^${escRe(base)}\\.sub(\\d+)\\.md$`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .map(n => { const m = re.exec(n); return m ? { bit: parseInt(m[1], 10), file: path.join(dir, n) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.bit - b.bit);
}

// Discendenti (tutta la profondita') di un piano: [{bit, file, depth}].
function listDescendants(parentFile, depth) {
  const d = depth || 1;
  const out = [];
  for (const c of listChildGoals(parentFile)) {
    out.push({ ...c, depth: d });
    out.push(...listDescendants(c.file, d + 1));
  }
  return out;
}

// TUTTI i piani della sessione (il regno): master, castelli e discendenti.
// [{kind: 'master'|'castle'|'sub', slug, file, parent, bit, depth}].
function listSessionPlans(cwd, sessionId) {
  const out = [];
  const master = goalFile(cwd, sessionId);
  if (fs.existsSync(master)) {
    out.push({ kind: 'master', slug: null, file: master, parent: null, bit: null, depth: 0 });
    for (const d of listDescendants(master)) out.push({ kind: 'sub', slug: null, file: d.file, parent: parentOf(d.file), bit: d.bit, depth: d.depth });
  }
  for (const c of listCastles(cwd, sessionId)) {
    out.push({ kind: 'castle', slug: c.slug, file: c.file, parent: null, bit: null, depth: 0 });
    for (const d of listDescendants(c.file)) out.push({ kind: 'sub', slug: c.slug, file: d.file, parent: parentOf(d.file), bit: d.bit, depth: d.depth });
  }
  return out;
}

// Padre di un sub per naming inverso: toglie l'ultimo ".sub<N>". null se radice.
function parentOf(file) {
  const m = String(file).match(/^(.*)\.sub\d+\.md$/i);
  return m ? m[1] + '.md' : null;
}

// --- Legacy (compat con chiamanti esistenti): figli del MASTER -----------------
// Sotto-piano (sub-goal) di un macro-bit del master: <sid>.sub<macroBit>.md.
function subGoalFile(cwd, sessionId, macroBit) {
  return childGoalFile(goalFile(cwd, sessionId), macroBit);
}
// Elenca i sotto-piani DIRETTI del master di sessione: [{macroBit, file}].
function listSubGoals(cwd, sessionId) {
  return listChildGoals(goalFile(cwd, sessionId)).map(c => ({ macroBit: c.bit, file: c.file }));
}

// sessionId: di solito input.session_id; fallback env.
function isDanilovActive(sessionId) {
  const sid = currentSessionId(sessionId);
  if (!sid) return false;
  try {
    const f = path.join(STATE_DIR, `${String(sid)}.json`);
    if (!fs.existsSync(f)) return false;
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return j && j.active === true;
  } catch {
    return false;
  }
}

module.exports = {
  isDanilovActive, goalDir, goalFile, subGoalFile, listSubGoals,
  castleSlug, castleFile, listCastles,
  childGoalFile, listChildGoals, listDescendants, listSessionPlans, parentOf,
  encodeCwd, currentSessionId, CLAUDE_DIR,
};
