#!/usr/bin/env node
// PostToolUse Hook (Read|Edit|Write|MultiEdit): quando un file viene letto o
// modificato, fa emergere automaticamente le memorie Danilov inerenti a QUEL
// file (ultime 10 righe-evento il cui entita'/raw lo citano). Una volta per
// file per sessione, per non ripetersi: se servono piu' di 10, l'agente le
// richiama con `memory.js related <file> --limit N`. Silenzioso se non ci sono
// memorie o se lo store del progetto non esiste. Non blocca mai.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state'); // stato runtime: ~/.claude
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov'); // codice: dentro il plugin
const LIMIT = 10;

let mem, session, ui;
try {
  mem = require(path.join(DANILOV, 'memory.js'));       // require.main-guarded: niente dispatch
  session = require(path.join(DANILOV, 'session.js'));
  ui = require(path.join(DANILOV, 'ui.js'));
} catch { process.exit(0); }

let input = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const ti = data.tool_input || {};
    const file = ti.file_path || ti.path || ti.notebook_path;
    if (!file) process.exit(0);

    const cwd = data.cwd || process.cwd();
    const slug = mem.projectSlug(cwd);
    if (!fs.existsSync(mem.storeFile(slug))) process.exit(0); // niente store -> niente da dire

    const base = path.basename(String(file));
    const baseLc = base.toLowerCase();
    const recs = mem.readRecords(slug)
      .filter(r => String(r.entity || '').toLowerCase().includes(baseLc) || String(r.raw || '').toLowerCase().includes(baseLc))
      .sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
    if (!recs.length) process.exit(0);

    // Cooldown: una volta per file per sessione.
    const sid = String(session.currentSessionId(data.session_id) || 'default');
    const seenFile = path.join(STATE_DIR, `memfiles-${sid}.json`);
    let seen = {};
    try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')) || {}; } catch {}
    if (seen[baseLc]) process.exit(0);
    seen[baseLc] = Date.now();
    try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(seenFile, JSON.stringify(seen), 'utf8'); } catch {}

    const shown = recs.slice(0, LIMIT);
    const more = recs.length > LIMIT;
    const rows = [];
    rows.push(ui.kv('Eventi', `${recs.length} inerenti${more ? ` ${ui.G.dot} ultimi ${LIMIT}` : ''}`));
    for (const r of shown) rows.push(ui.li(`${String(r.ts).slice(0, 10)} ${ui.G.dot} ${r.raw}`));
    if (more) rows.push(ui.kv('Altre', `memory.js related ${base} --limit ${recs.length}`));
    process.stdout.write(ui.card(`memoria ${ui.G.dot} ${base}`, rows));
  } catch {}
  process.exit(0);
});
