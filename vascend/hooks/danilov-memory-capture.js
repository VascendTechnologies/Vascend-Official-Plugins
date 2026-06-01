#!/usr/bin/env node
// Stop Hook: cattura automatica della memoria Danilov dalla CHAT di sessione.
// Quando il metodo e' attivo, a fine turno legge il transcript della sessione
// ed estrae le righe-evento (relazioni) archiviandole (dedup) nei file .vascend
// LOCALI via memory.js harvest. Nessun motore esterno (Animus disabilitato).
// Silenzioso e non bloccante: non emette decisioni, non interrompe lo Stop.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov'); // codice: dentro il plugin
const { isDanilovActive, currentSessionId, goalFile } = require(path.join(DANILOV, 'session.js'));
const MEMORY = path.join(DANILOV, 'memory.js');

let input = '';
const timeout = setTimeout(() => process.exit(0), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const sid = String(currentSessionId(data.session_id) || '');
    const cwd = data.cwd || process.cwd();
    const transcript = data.transcript_path;
    // Cattura SOLO durante un DanilovGoal attivo e se il transcript esiste.
    if (!sid || !isDanilovActive(sid) || !transcript || !fs.existsSync(transcript)) process.exit(0);

    // Titolo del piano corrente (per il tag), best-effort.
    let plan = '(senza piano)';
    try {
      const gf = goalFile(cwd, sid);
      if (gf && fs.existsSync(gf)) {
        const m = fs.readFileSync(gf, 'utf8').match(/^#\s*DanilovGoal:\s*(.+)$/m);
        if (m) plan = m[1].trim();
      }
    } catch {}

    // Harvest LOCALE nei file .vascend. Nessun mirror esterno (Animus disabilitato).
    const args = [MEMORY, 'harvest', transcript, '--cwd', cwd, '--session', sid, '--plan', plan];
    const child = execFile('node', args, { timeout: 8000 }, () => process.exit(0));
    child.on('error', () => process.exit(0));
  } catch { process.exit(0); }
});
