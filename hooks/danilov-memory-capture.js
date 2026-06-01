#!/usr/bin/env node
// Stop Hook: cattura automatica della memoria Danilov dalla CHAT di sessione.
// Quando il metodo e' attivo, a fine turno legge il transcript della sessione
// ed estrae le righe-evento "@azione: entita -> obiettivo [nota]" archiviandole
// (dedup) nello store di knowagebase via memory.js harvest. Silenzioso e non
// bloccante: non emette decisioni, non interrompe lo Stop, non fallisce mai.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov'); // codice: dentro il plugin
const { isDanilovActive, currentSessionId, goalFile } = require(path.join(DANILOV, 'session.js'));
const MEMORY = path.join(DANILOV, 'memory.js');

// Ricava lo user-id Animus dal claim `sub` del JWT (DANILOV_ENGINE_TOKEN).
function userIdFromJwt(tok) {
  try {
    const payload = JSON.parse(Buffer.from(String(tok).split('.')[1], 'base64').toString('utf8'));
    return String(payload.sub || '');
  } catch { return ''; }
}

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

    const args = [MEMORY, 'harvest', transcript, '--cwd', cwd, '--session', sid, '--plan', plan];
    const child = execFile('node', args, { timeout: 8000 }, () => {
      // Dopo l'harvest locale: rispecchia la sessione in Animus come un unico
      // documento rigenerato. Serve DANILOV_ENGINE_TOKEN (lo user-id si ricava
      // dal claim `sub`); la CLI nativa gira dentro il container backend.
      // Best-effort: non blocca lo Stop, non fallisce mai.
      const tok = process.env.DANILOV_ENGINE_TOKEN;
      const uid = tok ? userIdFromJwt(tok) : '';
      if (!uid) return process.exit(0);
      const ingArgs = [
        MEMORY, 'engine', 'ingest', '--docker',
        '--user-id', uid, '--session', sid, '--cwd', cwd,
      ];
      const ing = execFile('node', ingArgs, { timeout: 90000 }, () => process.exit(0));
      ing.on('error', () => process.exit(0));
    });
    child.on('error', () => process.exit(0));
  } catch { process.exit(0); }
});
