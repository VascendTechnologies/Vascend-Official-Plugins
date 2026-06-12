#!/usr/bin/env node
// Retention del goalDir: i regni delle sessioni passate restano sul disco per
// sempre (stesso pattern del bloat di memoria fixato in v1.8.2). Questo script
// rimuove i regni CHIUSI — interamente conformi, o skeleton mai pianificati —
// piu' vecchi di N giorni. I regni APERTI non si toccano mai (sono il lavoro
// da riprendere), e nemmeno il regno della sessione corrente.
//
// Uso:  node prune.js [--days N] [--dry] [--json]
//   --days N   eta' minima (default 14; env DANILOV_GOAL_RETENTION_DAYS; 0 = disattivato)
//   --dry      mostra cosa verrebbe rimosso, non scrive
// Invocato best-effort da vascend-resume.js a ogni SessionStart (silenzioso).
'use strict';

const fs = require('fs');
const path = require('path');
const { computeVerdict } = require('./core.js');
const { goalDir, currentSessionId } = require('./session.js');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const asJson = args.includes('--json');
const dArg = args.indexOf('--days');
const envDays = parseInt(process.env.DANILOV_GOAL_RETENTION_DAYS, 10);
const days = dArg >= 0 ? parseInt(args[dArg + 1], 10) : (Number.isInteger(envDays) ? envDays : 14);

function out(o, msg) {
  if (asJson) process.stdout.write(JSON.stringify(o) + '\n');
  else console.log(msg);
}

if (!Number.isInteger(days) || days <= 0) {
  out({ ok: true, disabled: true, removed: 0 }, 'retention disattivata (--days 0).');
  process.exit(0);
}

const dir = goalDir(process.cwd());
const curSid = String(currentSessionId() || 'no-session');
const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

// Raggruppa i file del goalDir per sessione (stessa grammatica di resume.js):
// radici <sid>.md | <sid>.castle-<slug>.md, sub .sub<N> ricorsivi, appunti
// .notes.md aggregati al gruppo ma mai classificati come piani.
let names = [];
try { names = fs.readdirSync(dir); } catch {
  out({ ok: true, removed: 0 }, 'nessun goalDir per questo progetto.');
  process.exit(0);
}
const groups = new Map(); // sid -> {files:[], roots:[{file,v}], mtime}
for (const n of names) {
  if (!/\.md$/i.test(n)) continue;
  const isNotes = /\.notes\.md$/i.test(n);
  const base = n.replace(/\.notes\.md$/i, '.md').replace(/\.md$/i, '');
  const rootBase = (base.match(/^(.*?)(?:\.sub\d+)*$/) || [])[1] || base;
  const castleM = rootBase.match(/^(.*)\.castle-[a-z0-9-]+$/);
  const sid = castleM ? castleM[1] : rootBase;
  const fp = path.join(dir, n);
  const g = groups.get(sid) || { files: [], roots: [], mtime: 0 };
  g.files.push(fp);
  try { g.mtime = Math.max(g.mtime, fs.statSync(fp).mtimeMs); } catch {}
  if (!isNotes && base === rootBase) {
    try { g.roots.push({ file: fp, v: computeVerdict(fs.readFileSync(fp, 'utf8')) }); } catch {}
  }
  groups.set(sid, g);
}

let removed = 0, kept = 0;
const removedSids = [];
for (const [sid, g] of groups) {
  if (sid === curSid) { kept++; continue; }                 // mai la sessione corrente
  const open = g.roots.some(r => r.v.target != null && !r.v.conforme);
  if (open) { kept++; continue; }                           // regni aperti: intoccabili
  if (g.mtime > cutoff) { kept++; continue; }               // troppo recenti
  for (const f of g.files) {
    if (!dry) { try { fs.rmSync(f, { force: true }); } catch {} }
    removed++;
  }
  removedSids.push(sid);
}

out(
  { ok: true, days, dry, removedFiles: removed, removedKingdoms: removedSids.length, kept },
  `${dry ? '[DRY] ' : ''}retention ${days}g: ${removedSids.length} regni chiusi rimossi (${removed} file), ${kept} mantenuti.`
);
