#!/usr/bin/env node
// Interruttore deterministico della modalita' Danilov per la sessione corrente.
// Scrive/azzera il flag ~/.claude/.danilov-state/<sid>.json. Pensato per essere
// invocato DAL COMANDO /danilov (dove l'argomento on|off e' certo), non dagli
// hook (che ricevono il prompt espanso e non possono distinguere on/off in modo
// affidabile).
//
// Uso:  node mode.js on        -> modalita' STICKY: ogni prompt diventa Danilov
//       node mode.js off       -> spegne tutto (flag + goal di sessione)
//       node mode.js status    -> stampa lo stato corrente
'use strict';

const fs = require('fs');
const path = require('path');
const { CLAUDE_DIR, currentSessionId, goalFile } = require('./session.js');

const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
const sid = String(currentSessionId() || 'default');
const flagFile = path.join(STATE_DIR, `${sid}.json`);
const cmd = String(process.argv[2] || 'status').toLowerCase();

function readFlag() {
  try { return JSON.parse(fs.readFileSync(flagFile, 'utf8')); } catch { return null; }
}

if (cmd === 'on') {
  const ts = new Date().toISOString();
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(flagFile, JSON.stringify({ active: true, sticky: true, cwd: process.cwd(), ts }), 'utf8');
  } catch (e) { console.error('errore scrittura flag: ' + e.message); process.exit(1); }
  console.log('Danilov STICKY ON · ogni prompt e\' un obiettivo Danilov (off: /danilov off)');
  process.exit(0);
}

if (cmd === 'off') {
  try { fs.rmSync(flagFile, { force: true }); } catch {}
  try { fs.rmSync(goalFile(process.cwd(), sid), { force: true }); } catch {}
  console.log('Danilov OFF · modalita\' disattivata per questa sessione');
  process.exit(0);
}

// status
const f = readFlag();
if (f && f.active) console.log(`Danilov ${f.sticky ? 'STICKY ON' : 'ON (one-shot)'} · sid ${sid}`);
else console.log(`Danilov OFF · sid ${sid}`);
process.exit(0);
