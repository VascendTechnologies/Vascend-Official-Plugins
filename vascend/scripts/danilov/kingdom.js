// Il REGNO: vista aggregata di TUTTI i castelli della sessione.
// Un regno = master (castello di default) + castelli nominati + i loro
// discendenti (sub ricorsivi). Funzioni pure sui file: nessuna scrittura.
// Fonte unica del verdetto resta core.js; qui si aggrega soltanto.
// Usato da: castle.js (list/map/next), validate.js (--kingdom),
// status.js (--all) e dallo Stop hook (enforcement multi-castello).

'use strict';

const fs = require('fs');
const { computeVerdict, hex, popcount } = require('./core.js');
const { listSessionPlans, listChildGoals } = require('./session.js');

// Header "After: <slug>" di un castello: dipendenza cross-castello (il
// castello non si marca finche' il prerequisito non e' conforme).
function afterOf(text) {
  return (String(text).match(/^After:\s*([a-z0-9-]+)\s*$/m) || [])[1] || null;
}

function titleOf(text) {
  return (String(text).match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';
}

// Tutti i piani della sessione con verdetto: [{...plan, title, after, v}].
function kingdomPlans(cwd, sessionId) {
  const out = [];
  for (const p of listSessionPlans(cwd, sessionId)) {
    let text; try { text = fs.readFileSync(p.file, 'utf8'); } catch { continue; }
    out.push({ ...p, title: titleOf(text), after: afterOf(text), v: computeVerdict(text) });
  }
  return out;
}

// Verdetto aggregato del regno. roots = solo master+castelli (i sub contano
// dentro le radici via roll-up, non si sommano due volte nel conforme).
//   conforme  = esistono radici E ogni radice e' conforme
//   litRooms / totalRooms = somma su TUTTI i piani (radici e sub): e' la
//   metrica di AVANZAMENTO (monotona quando si accendono stanze ovunque),
//   usata dall'anti-stallo dello Stop hook.
function kingdomVerdict(cwd, sessionId) {
  const plans = kingdomPlans(cwd, sessionId);
  const roots = plans.filter(p => p.depth === 0);
  let lit = 0, rooms = 0;
  for (const p of plans) {
    lit += popcount(p.v.state);
    rooms += p.v.totBit || 0;
  }
  const openRoots = roots.filter(p => !p.v.conforme);
  return {
    plans, roots, openRoots,
    exists: roots.length > 0,
    conforme: roots.length > 0 && openRoots.length === 0,
    litRooms: lit, totalRooms: rooms,
    popcount: `${lit}/${rooms}`,
  };
}

// Etichetta umana di una radice: "master" o "castello <slug>".
function rootLabel(p) {
  return p.kind === 'castle' ? `castello ${p.slug}` : 'master';
}

// La PROSSIMA stanza al buio del regno, scesa alla profondita' giusta:
// prima radice aperta (master prima, poi castelli in ordine; un castello con
// After non conforme cede il posto), poi dentro il piano il primo bit spento
// con dep accese — e se quel bit ha un sub non conforme, si ricorre nel sub.
// Ritorna {plan, bit, task, mask, desc, path:[radice,...,piano]} o null.
function nextRoom(cwd, sessionId) {
  const k = kingdomVerdict(cwd, sessionId);
  const bySlug = new Map(k.roots.filter(r => r.kind === 'castle').map(r => [r.slug, r]));
  const ready = k.openRoots.filter(r => {
    if (!r.after) return true;
    const dep = bySlug.get(r.after);
    return !dep || dep.v.conforme; // prerequisito mancante = non gata
  });
  const root = ready[0] || k.openRoots[0];
  if (!root) return null;
  return descend(root, [rootLabel(root)]);
}

function descend(plan, trail) {
  const v = plan.v;
  const open = (v.missingTasks || []).filter(t => depsLit(plan.file, t.bit, v.state));
  const target = open[0] || (v.missingTasks || [])[0];
  if (!target) return null;
  const child = listChildGoals(plan.file).find(c => c.bit === target.bit);
  if (child) {
    let text; try { text = fs.readFileSync(child.file, 'utf8'); } catch { text = ''; }
    const cv = computeVerdict(text);
    if (!cv.conforme) {
      return descend({ file: child.file, v: cv }, [...trail, `${target.task}`]);
    }
    // sub conforme, macro ancora spento -> la prossima mossa E' il roll-up.
  }
  return {
    file: plan.file, bit: target.bit, task: target.task, mask: hex(target.mask),
    desc: planDesc(plan.file, target.bit), trail,
  };
}

// Dep (4a colonna del piano) tutte accese per quel bit?
function depsLit(file, bit, state) {
  const c = planRow(file, bit);
  if (!c || c.length < 6 || !c[4] || c[4] === '-') return true;
  return c[4].split(',').map(x => parseInt(x, 10))
    .filter(n => Number.isInteger(n) && n >= 0)
    .every(d => (state & ((1 << d) >>> 0)) !== 0);
}

function planRow(file, bit) {
  let text; try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const start = text.search(/^##\s*1\.\s*Pianificazione/m);
  const end = text.search(/^##\s*2\.\s*Trace/m);
  const block = text.slice(start < 0 ? 0 : start, end < 0 ? text.length : end);
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if ((c.length === 5 || c.length === 6) && parseInt(c[1], 10) === bit) return c;
  }
  return null;
}

function planDesc(file, bit) { const c = planRow(file, bit); return c ? c[3] : ''; }

module.exports = { kingdomPlans, kingdomVerdict, nextRoom, rootLabel, afterOf, titleOf };
