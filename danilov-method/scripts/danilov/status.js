#!/usr/bin/env node
// Vista di stato del DanilovGoal di sessione — sorgente per la "todo nativa".
// Legge il goal (piano + Trace firmata), ricava per ogni task se e' acceso
// (done), fallito (fail) o ancora al buio, marca il prossimo da fare (next) e
// stampa la lista. Pensato per popolare la todo list nativa dell'harness:
//
//   node status.js            -> JSON {ok, plan, state, target, validate, tasks:[...]}
//   node status.js --todo     -> JSON {ok, todos:[{content,status,activeForm}]}
//                                (status ∈ pending|in_progress|completed)
//   node status.js --pretty   -> checklist testuale [x]/[ ] per la chat
//
// Il verdetto resta di validate.js: questo script NON lo emette, riflette solo
// lo stato corrente. Fonte unica = core.js (stessa matematica del validatore).
'use strict';

const fs = require('fs');
const { computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile } = require('./session.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
// File: primo positional non-flag, altrimenti il goal di sessione.
const file = argv.find(a => !a.startsWith('--')) || goalFile(process.cwd());

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

if (!file || !fs.existsSync(file)) {
  out({ ok: false, error: 'nessun DanilovGoal per questa sessione', file: String(file || '') });
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');

// Titolo del piano.
const title = (text.match(/^#\s*DanilovGoal:\s*(.+)$/m) || [])[1] || '(senza titolo)';

// Task dichiarati: dal blocco "## 1. Pianificazione" fino a "## 2. Trace".
// Righe piano = | bit | mask | task | (3 celle). La Trace ha 7 celle: esclusa.
function planTasks(src) {
  const start = src.search(/^##\s*1\.\s*Pianificazione/m);
  const end = src.search(/^##\s*2\.\s*Trace/m);
  const block = src.slice(start < 0 ? 0 : start, end < 0 ? src.length : end);
  const tasks = [];
  for (const line of block.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    if (cells.length !== 5) continue;            // non e' una riga a 3 celle
    const bit = parseInt(cells[1], 10);
    if (!Number.isInteger(bit)) continue;        // header/separatore
    tasks.push({ bit, mask: (1 << bit) >>> 0, desc: cells[3] });
  }
  return tasks.sort((a, b) => a.bit - b.bit);
}

const v = computeVerdict(text);
const tasks = planTasks(text);

// Prossima stanza al buio (bit piu' basso non acceso): unica "in_progress".
const nextBit = tasks.find(t => (v.state & t.mask) === 0);
const nextBitNum = nextBit ? nextBit.bit : -1;

const rows = tasks.map(t => {
  const done = (v.state & t.mask) !== 0;
  const fail = (v.failBits & t.mask) !== 0;
  const status = done ? 'completed' : (t.bit === nextBitNum ? 'in_progress' : 'pending');
  return { bit: t.bit, task: taskLabel(t.bit), mask: hex(t.mask), desc: t.desc, done, fail, status };
});

if (flag('todo')) {
  // Formato pronto per la todo nativa (TaskCreate/TodoWrite).
  out({
    ok: true,
    plan: title,
    todos: rows.map(r => ({
      content: r.desc,
      status: r.status,
      activeForm: r.desc.replace(/^(T\d+):\s*/, 'In corso $1: '),
    })),
  });
  process.exit(0);
}

if (flag('pretty')) {
  const mark = r => r.done ? '[x]' : (r.fail ? '[!]' : '[ ]');
  const arrow = r => r.status === 'in_progress' ? '  <- prossima' : '';
  const lines = [`DanilovGoal: ${title}  (${v.popcount})`];
  for (const r of rows) lines.push(`${mark(r)} ${r.task} ${r.mask}  ${r.desc}${arrow(r)}`);
  lines.push(`validate(state) = ${v.validate === true ? 'TRUE' : 'FALSE'}  (lo emette validate.js)`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

out({
  ok: true,
  plan: title,
  state: hex(v.state),
  target: v.target != null ? hex(v.target) : null,
  validate: v.validate,
  popcount: v.popcount,
  nextBit: nextBitNum,
  tasks: rows,
});
