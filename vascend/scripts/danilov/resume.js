#!/usr/bin/env node
// resume.js — riprende un REGNO DanilovGoal APERTO (almeno un castello non
// conforme) lasciato da una sessione precedente per lo STESSO progetto (cwd).
// I piani sono per-session-id (~/.claude/projects/<cwd-encoded>/DanilovGoal/):
// un task lungo che prosegue in una nuova sessione perderebbe il filo.
// resume.js scandisce il goalDir del progetto, raggruppa i file per sessione
// (master <sid>.md + castelli <sid>.castle-<slug>.md + sotto-piani ricorsivi)
// e — con --attach — copia l'INTERO regno sulla sessione corrente, cosi'
// plan/mark/validate/status/castle continuano sugli stessi castelli.
//
// Uso:
//   node resume.js                 elenca il regno aperto piu' recente (NON scrive)
//   node resume.js --list          elenca TUTTI i regni aperti del progetto
//   node resume.js --attach        riattacca il piu' recente alla sessione corrente
//   node resume.js --attach <file> riattacca il regno di quel file (master o castello)
//   --force                        sovrascrivi anche se la sessione corrente ha gia' un regno aperto
//   --json                         output JSON (per hook/automazioni)
//
// Lo stato resta in ~/.claude (via session.js); il codice e' nel plugin.
'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict, popcount } = require('./core.js');
const { goalDir, currentSessionId } = require('./session.js');

const args = process.argv.slice(2);
const attach = args.includes('--attach');
const list = args.includes('--list');
const force = args.includes('--force');
const asJson = args.includes('--json');
const explicit = args.find(a => !a.startsWith('--'));

const cwd = process.cwd();
const dir = goalDir(cwd);
const curSid = String(currentSessionId() || 'no-session');

// Classifica un nome file del goalDir. Radici: master <sid>.md o castello
// <sid>.castle-<slug>.md. I sub hanno suffissi .sub<N> (ricorsivi).
// Gli APPUNTI (*.notes.md) non sono piani: esclusi (resterebbero classificati
// come regni fantasma).
function classify(n) {
  if (!/\.md$/i.test(n) || /\.notes\.md$/i.test(n)) return null;
  const base = n.replace(/\.md$/i, '');
  const subM = base.match(/^(.*?)((?:\.sub\d+)+)$/);
  const rootBase = subM ? subM[1] : base;
  const castleM = rootBase.match(/^(.*)\.castle-([a-z0-9-]+)$/);
  return {
    name: n,
    sid: castleM ? castleM[1] : rootBase,
    kind: subM ? 'sub' : (castleM ? 'castle' : 'master'),
    slug: castleM ? castleM[2] : null,
  };
}

const titleOf = (text) => (text.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';

// Tutti i REGNI del progetto, raggruppati per sid:
// {sid, files:[{name,file,kind,slug,v?}], roots, openRoots, lit, rooms, mtime}
function kingdoms() {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const by = new Map();
  for (const n of names) {
    const c = classify(n);
    if (!c) continue;
    const fp = path.join(dir, n);
    let text; try { text = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    const v = computeVerdict(text);
    let mtime = 0; try { mtime = fs.statSync(fp).mtimeMs; } catch {}
    const g = by.get(c.sid) || { sid: c.sid, files: [], roots: [], lit: 0, rooms: 0, mtime: 0 };
    const entry = { ...c, file: fp, v, title: titleOf(text) };
    g.files.push(entry);
    if (c.kind !== 'sub') g.roots.push(entry);
    g.lit += popcount(v.state);
    g.rooms += v.totBit || 0;
    g.mtime = Math.max(g.mtime, mtime);
    by.set(c.sid, g);
  }
  const out = [];
  for (const g of by.values()) {
    // aperto = almeno una RADICE con piano e non conforme.
    g.openRoots = g.roots.filter(r => r.v.target != null && !r.v.conforme);
    if (!g.openRoots.length) continue;
    out.push(g);
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

function describe(g) {
  const first = g.openRoots[0];
  const missing = g.openRoots.map(r => {
    const dark = (r.v.missingTasks || []).map(t => t.task).join(',');
    const label = r.kind === 'castle' ? `castello ${r.slug}` : 'master';
    return `${label} [${r.v.popcount}]${dark ? ` al buio: ${dark}` : ''}`;
  });
  return {
    file: first ? first.file : g.files[0].file,
    sid: g.sid,
    title: first ? first.title : '(senza titolo)',
    castles: g.roots.length,
    popcount: `${g.lit}/${g.rooms}`,
    missing,
    subs: g.files.filter(f => f.kind === 'sub').length,
    current: g.sid === curSid,
  };
}

const open = kingdoms();

// --- Nessun regno aperto ---
if (!open.length) {
  if (asJson) { process.stdout.write(JSON.stringify({ ok: true, open: [], chosen: null }) + '\n'); }
  else console.log('nessun goal Vascend aperto per questo progetto.');
  process.exit(0);
}

// --- Solo elenco ---
if (list && !attach) {
  if (asJson) { process.stdout.write(JSON.stringify({ ok: true, open: open.map(describe) }) + '\n'); process.exit(0); }
  console.log(`regni aperti per ${cwd}:`);
  for (const g of open) {
    const d = describe(g);
    console.log(`  ${d.current ? '*' : '-'} ${d.title}  [${d.popcount}]  ${d.sid}  (${d.castles} castelli${d.subs ? `, ${d.subs} sub` : ''})`);
    for (const m of d.missing) console.log(`      ${m}`);
  }
  process.exit(0);
}

// Regno aperto della sessione CORRENTE (se c'e') vs aperti di ALTRE sessioni.
const currentOpen = open.find(g => g.sid === curSid) || null;
const otherOpen = open.filter(g => g.sid !== curSid);

// Scelta del regno da riattaccare: esplicito (qualsiasi suo file), oppure il
// piu' recente di un'ALTRA sessione (e' cio' che ha senso "riprendere").
let chosen;
if (explicit) {
  const fp = path.resolve(explicit);
  const base = path.basename(fp);
  chosen = open.find(g => g.files.some(f => path.resolve(f.file) === fp || f.name === base));
  if (!chosen) { console.error(`file non trovato tra i regni aperti: ${explicit}`); process.exit(1); }
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
    console.log(`regno: "${d.title}"  [${d.popcount}]  sessione ${d.sid}  (${d.castles} castelli)`);
    for (const m of d.missing) console.log(`  ${m}`);
    console.log(d.current ? '  e\' gia\' di questa sessione: continua con mark.js/validate.js.'
      : `  per riprenderlo qui: node ${path.join(__dirname, 'resume.js').replace(/\\/g, '/')} --attach ${path.basename(d.file)}`);
    process.exit(0);
  }
  // La sessione corrente ha gia' un regno aperto -> continua quello, non riattaccare.
  if (currentOpen) {
    const d = describe(currentOpen);
    console.log(`questa sessione ha gia' un goal aperto: "${d.title}"  [${d.popcount}]`);
    for (const m of d.missing) console.log(`  ${m}`);
    console.log('  continua con mark.js / validate.js.');
    process.exit(0);
  }
  if (!resumable) { console.log('nessun goal di altre sessioni da riprendere.'); process.exit(0); }
  const d = describe(resumable);
  console.log(`goal aperto di un'altra sessione: "${d.title}"  [${d.popcount}]`);
  console.log(`  sessione: ${d.sid}  ·  ${d.castles} castelli${d.subs ? `  ·  ${d.subs} sotto-piani` : ''}`);
  for (const m of d.missing) console.log(`  ${m}`);
  console.log(`  per riprenderlo qui: node ${path.join(__dirname, 'resume.js').replace(/\\/g, '/')} --attach`);
  process.exit(0);
}

// --- Attach: copia l'INTERO regno scelto sulla sessione corrente -------------
if (chosen.sid === curSid) {
  console.log('il goal scelto e\' gia\' della sessione corrente: niente da riattaccare.');
  process.exit(0);
}
// Non clobberare un regno aperto della sessione corrente senza --force.
if (currentOpen && !force) {
  console.error('la sessione corrente ha gia\' un goal aperto: usa --force per sovrascriverlo.');
  process.exit(1);
}

try {
  fs.mkdirSync(dir, { recursive: true });
  let copied = 0;
  for (const f of chosen.files) {
    // rinomina il prefisso di sessione: <oldSid>... -> <curSid>...
    const newName = curSid + f.name.slice(chosen.sid.length);
    const dest = path.join(dir, newName);
    fs.copyFileSync(f.file, dest);
    // l'header informativo "Master: <file>" dei sub punta ancora al vecchio
    // sid: riallinealo al nuovo (non e' firmato, la Trace non si tocca).
    if (f.kind === 'sub') {
      try {
        const txt = fs.readFileSync(dest, 'utf8');
        const fixed = txt.replace(/^(Master:\s*)(.+)$/m, (_, p, name) => p + curSid + String(name).trim().slice(chosen.sid.length));
        if (fixed !== txt) fs.writeFileSync(dest, fixed, 'utf8');
      } catch {}
    }
    copied += 1;
    // gli APPUNTI (<base>.notes.md) seguono il loro piano
    const nf = f.file.replace(/\.md$/i, '.notes.md');
    if (fs.existsSync(nf)) {
      fs.copyFileSync(nf, path.join(dir, newName.replace(/\.md$/i, '.notes.md')));
      copied += 1;
    }
  }
  const d = describe(chosen);
  console.log(`riattaccato: "${d.title}"  [${d.popcount}]  (${copied} file: ${d.castles} castelli${d.subs ? ` + ${d.subs} sotto-piani` : ''})`);
  console.log(`  ora e\' il regno di questa sessione (${curSid}). Continua con mark.js / validate.js / castle.js.`);
  for (const m of d.missing) console.log(`  ${m}`);
} catch (e) {
  console.error('errore nel riattacco: ' + e.message);
  process.exit(1);
}
process.exit(0);
