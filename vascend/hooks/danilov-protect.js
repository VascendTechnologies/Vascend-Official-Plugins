#!/usr/bin/env node
// PreToolUse Hook (Edit|Write|MultiEdit): protegge i file DanilovGoal/.
// L'agente NON puo' modificare a mano il goal (riscrivere Trace/Validazione per
// "barare"): ogni Edit/Write/MultiEdit verso ~/.claude/DanilovGoal/ viene NEGATO.
// Le scritture legittime passano per gli script (plan.js, mark.js) che usano fs
// via Bash e non transitano da questo hook.

'use strict';

const path = require('path');
// Script dentro il plugin (__dirname = <plugin>/hooks). POSIX-style per il messaggio.
const SCRIPTS = path.join(__dirname, '..', 'scripts', 'danilov').replace(/\\/g, '/');

let data = '';
const timeout = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (data += c));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const input = JSON.parse(data || '{}');
    const ti = input.tool_input || {};
    // Edit/Write/MultiEdit usano file_path; raccogli anche path multipli.
    const targets = [];
    if (ti.file_path) targets.push(ti.file_path);
    if (Array.isArray(ti.edits)) for (const e of ti.edits) if (e && e.file_path) targets.push(e.file_path);

    // Qualsiasi file dentro una cartella "DanilovGoal" (ovunque: ora i goal
    // vivono in ~/.claude/projects/<cwd>/DanilovGoal/). ESENTI: gli APPUNTI
    // (*.notes.md) — dossier libero per-stanza — e le SKILL CUSTOM (dentro una
    // dir "*.cskills/") — generate/affinate liberamente dal modello e iniettate
    // al volo dall'hook. Non concorrono al verdetto (piano e Trace restano
    // firmati e blindati).
    const hit = targets.some(t => {
      try {
        const norm = path.resolve(t).toLowerCase().replace(/\\/g, '/');
        const exempt = /\.notes\.md$/.test(norm) || /\/[^/]+\.cskills\//.test(norm);
        return /(^|\/)danilovgoal\//.test(norm) && !exempt;
      } catch { return false; }
    });

    if (hit) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            'I file DanilovGoal/ non si modificano a mano (anti-manomissione). ' +
            'Usa gli script: node ' + SCRIPTS + '/plan.js per il piano, ' +
            'mark.js <bit> OK per marcare i task, validate.js per il verdetto.',
        },
      }));
    }
  } catch {}
  process.exit(0);
});
