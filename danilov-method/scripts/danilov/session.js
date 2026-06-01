// Gate di sessione del metodo Danilov.
// Dice se la sessione corrente ha la modalita' DanilovGoal attiva (flag alzato
// da danilov-trigger.js). Gli hook rumorosi (format/typecheck/console-warn/
// compact/doc-warning/...) lo usano per restare SILENZIOSI durante un
// DanilovGoal: l'output del metodo deve essere pulito (solo partito + verdetto).
// Fuori da Danilov, ritorna sempre false -> hook invariati.

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

// Sotto-piano (sub-goal) di un macro-bit del master. La relazione master->sub
// e' IMPLICITA nel naming: <sid>.sub<macroBit>.md, accanto al master <sid>.md.
// Cosi' non serve toccare il master (che il protect hook protegge): scoprire i
// sub e' una scansione di directory, non una modifica.
function subGoalFile(cwd, sessionId, macroBit) {
  const sid = currentSessionId(sessionId) || 'no-session';
  return path.join(goalDir(cwd), `${sid}.sub${macroBit}.md`);
}

// Elenca i sotto-piani esistenti del master di sessione: [{macroBit, file}],
// ordinati per macroBit. Vuoto se non ce ne sono o la dir non esiste.
function listSubGoals(cwd, sessionId) {
  const sid = currentSessionId(sessionId) || 'no-session';
  const dir = goalDir(cwd);
  const re = new RegExp(`^${sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.sub(\\d+)\\.md$`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .map(n => { const m = re.exec(n); return m ? { macroBit: parseInt(m[1], 10), file: path.join(dir, n) } : null; })
    .filter(Boolean)
    .sort((a, b) => a.macroBit - b.macroBit);
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

module.exports = { isDanilovActive, goalDir, goalFile, subGoalFile, listSubGoals, encodeCwd, currentSessionId, CLAUDE_DIR };
