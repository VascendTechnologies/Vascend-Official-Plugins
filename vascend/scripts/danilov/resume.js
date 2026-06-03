#!/usr/bin/env node
// resume.js — riprende un DanilovGoal APERTO (non conforme) lasciato da una
// sessione precedente per lo STESSO progetto (cwd). I goal sono per-session-id
// (~/.claude/projects/<cwd-encoded>/DanilovGoal/<sid>.md): un task lungo che
// prosegue in una nuova sessione perderebbe il filo. resume.js scandisce il
// goalDir del progetto, trova il master non-conforme piu' recente e — con
// --attach — lo copia (coi suoi sotto-piani) sulla sessione corrente, cosi'
// plan/mark/validate/status continuano sullo stesso castello.
//
// Uso:
//   node resume.js                 elenca il goal aperto piu' recente (NON scrive)
//   node resume.js --list          elenca TUTTI i goal aperti del progetto
//   node resume.js --attach        riattacca il piu' recente alla sessione corrente
//   node resume.js --attach <file> riattacca quel master specifico
//   --force                        sovrascrivi anche se la sessione corrente ha gia' un goal aperto
//   --json                         output JSON (per hook/automazioni)
//
// Lo stato resta in ~/.claude (via session.js); il codice e' nel plugin.
'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict } = require('./core.js');
const { goalDir, goalFile, currentSessionId } = require('./session.js');

const args = process.argv.slice(2);
const attach = args.includes('--attach');
const list = args.includes('--list');
const force = args.includes('--force');
const asJson = args.includes('--json');
const explicit = args.find(a => !a.startsWith('--'));

const cwd = process.cwd();
const dir = goalDir(cwd);
const curSid = String(currentSessionId() || 'no-session');
const curFile = goalFile(cwd);

// master = <sid>.md ; NON i sotto-piani <sid>.sub<N>.md
const isMasterName = (n) => /\.md$/.test(n) && !/\.sub\d+\.md$/.test(n);
const sidOfName = (n) => n.replace(/\.md$/, '');
const titleOf = (text) => (text.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';

// Sotto-piani di un dato sid: [{name, bit, file}].
function subGoalsOfSid(sid) {
  const re = new RegExp(`^${sid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.sub(\\d+)\\.md$`);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .map(n => { const m = re.exec(n); return m ? { name: n, bit: parseInt(m[1], 10), file: path.join(dir, n) } : null; })
    .filter(Boolean);
}

// Tutti i master APERTI (con piano e non conformi), piu' recenti prima.
function openMasters() {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!isMasterName(n)) continue;
    const fp = path.join(dir, n);
    let text; try { text = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    const v = computeVerdict(text);
    if (v.target == null || v.conforme) continue; // senza piano o gia' chiuso -> non "aperto"
    let mtime = 0; try { mtime = fs.statSync(fp).mtimeMs; } catch {}
    out.push({ file: fp, name: n, sid: sidOfName(n), title: titleOf(text), v, mtime });
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function describe(g) {
  const missing = (g.v.missingTasks || []).map(t => `${t.task} (${g.v.hex(t.mask)})`);
  return {
    file: g.file, sid: g.sid, title: g.title,
    popcount: g.v.popcount,
    missing,
    subs: subGoalsOfSid(g.sid).length,
    current: g.sid === curSid,
  };
}

const open = openMasters();

// --- Nessun goal aperto ---
if (!open.length) {
  if (asJson) { process.stdout.write(JSON.stringify({ ok: true, open: [], chosen: null }) + '\n'); }
  else console.log('nessun goal Vascend aperto per questo progetto.');
  process.exit(0);
}

// --- Solo elenco ---
if (list && !attach) {
  if (asJson) { process.stdout.write(JSON.stringify({ ok: true, open: open.map(describe) }) + '\n'); process.exit(0); }
  console.log(`goal aperti per ${cwd}:`);
  for (const g of open) {
    const d = describe(g);
    console.log(`  ${d.current ? '*' : '-'} ${d.title}  [${d.popcount}]  ${d.sid}${d.subs ? `  (${d.subs} sub)` : ''}`);
    if (d.missing.length) console.log(`      al buio: ${d.missing.join(', ')}`);
  }
  process.exit(0);
}

// Goal aperto della sessione CORRENTE (se c'e') vs aperti di ALTRE sessioni.
const currentOpen = open.find(g => g.sid === curSid) || null;
const otherOpen = open.filter(g => g.sid !== curSid);

// Scelta del master da riattaccare: esplicito, oppure il piu' recente di
// un'ALTRA sessione (e' cio' che ha senso "riprendere").
let chosen;
if (explicit) {
  const fp = path.resolve(explicit);
  chosen = open.find(g => path.resolve(g.file) === fp);
  if (!chosen) { console.error(`master non trovato tra i goal aperti: ${explicit}`); process.exit(1); }
} else {
  chosen = otherOpen[0] || open[0];
}

// --- Anteprima (default, no --attach) ---
if (!attach) {
  const resumable = otherOpen[0] || null;
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: true,
      currentOpen: currentOpen ? describe(currentOpen) : null,
      resumable: resumable ? describe(resumable) : null,
      open: open.map(describe),
    }) + '\n');
    process.exit(0);
  }
  if (explicit) {
    const d = describe(chosen);
    console.log(`master: "${d.title}"  [${d.popcount}]  sessione ${d.sid}`);
    if (d.missing.length) console.log(`  al buio: ${d.missing.join(', ')}`);
    console.log(d.current ? '  e\' gia\' di questa sessione: continua con mark.js/validate.js.'
      : `  per riprenderlo qui: node ${path.join(__dirname, 'resume.js').replace(/\\/g, '/')} --attach ${path.basename(d.file)}`);
    process.exit(0);
  }
  // La sessione corrente ha gia' un goal aperto -> continua quello, non riattaccare.
  if (currentOpen) {
    const d = describe(currentOpen);
    console.log(`questa sessione ha gia' un goal aperto: "${d.title}"  [${d.popcount}]`);
    if (d.missing.length) console.log(`  al buio: ${d.missing.join(', ')}`);
    console.log('  continua con mark.js / validate.js.');
    process.exit(0);
  }
  if (!resumable) { console.log('nessun goal di altre sessioni da riprendere.'); process.exit(0); }
  const d = describe(resumable);
  console.log(`goal aperto di un'altra sessione: "${d.title}"  [${d.popcount}]`);
  console.log(`  sessione: ${d.sid}${d.subs ? `  ·  ${d.subs} sotto-piani` : ''}`);
  if (d.missing.length) console.log(`  al buio: ${d.missing.join(', ')}`);
  console.log(`  per riprenderlo qui: node ${path.join(__dirname, 'resume.js').replace(/\\/g, '/')} --attach`);
  process.exit(0);
}

// --- Attach: copia il master scelto (coi sotto-piani) sulla sessione corrente ---
if (chosen.sid === curSid) {
  console.log('il goal scelto e\' gia\' della sessione corrente: niente da riattaccare.');
  process.exit(0);
}
// Non clobberare un goal aperto della sessione corrente senza --force.
if (fs.existsSync(curFile) && !force) {
  const cv = computeVerdict(fs.readFileSync(curFile, 'utf8'));
  if (cv.target != null && !cv.conforme) {
    console.error('la sessione corrente ha gia\' un goal aperto: usa --force per sovrascriverlo.');
    process.exit(1);
  }
}

try {
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(chosen.file, curFile);
  let subs = 0;
  for (const s of subGoalsOfSid(chosen.sid)) {
    fs.copyFileSync(s.file, path.join(dir, `${curSid}.sub${s.bit}.md`));
    subs += 1;
  }
  const d = describe(chosen);
  console.log(`riattaccato: "${d.title}"  [${d.popcount}]${subs ? `  + ${subs} sotto-piani` : ''}`);
  console.log(`  ora e\' il goal di questa sessione (${curSid}). Continua con mark.js / validate.js.`);
  if (d.missing.length) console.log(`  al buio: ${d.missing.join(', ')}`);
} catch (e) {
  console.error('errore nel riattacco: ' + e.message);
  process.exit(1);
}
process.exit(0);
