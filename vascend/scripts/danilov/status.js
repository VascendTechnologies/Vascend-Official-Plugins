#!/usr/bin/env node
// Vista di stato del DanilovGoal di sessione — sorgente per la "todo nativa".
// Legge il goal (piano + Trace firmata), ricava per ogni task se e' acceso
// (done), fallito (fail) o ancora al buio, marca il prossimo da fare (next) e
// stampa la lista. Se un macro-task ha un SOTTO-PIANO (sid.sub<bit>.md), espande
// i suoi micro-task come albero. Pensato per la todo list nativa dell'harness:
//
//   node status.js            -> JSON {ok, plan, state, target, validate, tasks:[...]}
//   node status.js --todo     -> JSON {ok, todos:[{content,status,activeForm}]}
//                                (macro + micro indentati; status ∈ pending|in_progress|completed)
//   node status.js --pretty   -> albero testuale [x]/[ ] (macro -> micro) per la chat
//
// Il verdetto resta di validate.js: questo script NON lo emette, riflette solo
// lo stato corrente. Fonte unica = core.js (stessa matematica del validatore).
'use strict';

const fs = require('fs');
const { computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, subGoalFile } = require('./session.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const file = argv.find(a => !a.startsWith('--')) || goalFile(process.cwd());

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

if (!file || !fs.existsSync(file)) {
  out({ ok: false, error: 'nessun DanilovGoal per questa sessione', file: String(file || '') });
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
// Titolo: master "# DanilovGoal:" o sub "# DanilovGoal[sub]:".
const title = (text.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';

// Task dichiarati: dal blocco "## 1. Pianificazione" fino a "## 2. Trace".
// Righe piano = | bit | mask | task | (3 celle). La Trace ha 7 celle: esclusa.
function planTasks(src) {
  const start = src.search(/^##\s*1\.\s*Pianificazione/m);
  const end = src.search(/^##\s*2\.\s*Trace/m);
  const block = src.slice(start < 0 ? 0 : start, end < 0 ? src.length : end);
  const tasks = [];
  for (const line of block.split('\n')) {
    const cells = line.split('|').map(c => c.trim());
    // 3 colonne (len 5) o 4 con dep (len 6): la Trace ha >=7 celle, esclusa.
    if (cells.length !== 5 && cells.length !== 6) continue;
    const bit = parseInt(cells[1], 10);
    if (!Number.isInteger(bit)) continue;
    const dep = cells.length === 6 && cells[4] && cells[4] !== '-' ? cells[4] : '';
    tasks.push({ bit, mask: (1 << bit) >>> 0, desc: cells[3], dep });
  }
  return tasks.sort((a, b) => a.bit - b.bit);
}

// Note per-bit dalla Trace: riga estesa | ts|bit|mask|pre|post|esito|sig|nota |
// (split length 10). La colonna nota (cells[8]) e' fuori dalla firma; l'ultima
// nota scritta per quel bit vince.
function traceNotes(src) {
  const start = src.search(/^##\s*2\.\s*Trace/m);
  const block = start < 0 ? src : src.slice(start);
  const notes = {};
  for (const line of block.split('\n')) {
    const c = line.split('|').map(s => s.trim());
    if (c.length < 10) continue;
    const bit = parseInt(c[2], 10);
    if (!Number.isInteger(bit)) continue;
    if (c[8]) notes[bit] = c[8];
  }
  return notes;
}

// Righe di stato di un singolo piano (master o sub), senza ricorsione.
function rowsOf(src, verdict) {
  const tasks = planTasks(src);
  const notes = traceNotes(src);
  const nextBit = tasks.find(t => (verdict.state & t.mask) === 0);
  const nextNum = nextBit ? nextBit.bit : -1;
  return tasks.map(t => {
    const done = (verdict.state & t.mask) !== 0;
    const fail = (verdict.failBits & t.mask) !== 0;
    const status = done ? 'completed' : (t.bit === nextNum ? 'in_progress' : 'pending');
    return { bit: t.bit, task: taskLabel(t.bit), mask: hex(t.mask), desc: t.desc, dep: t.dep || '', note: notes[t.bit] || '', done, fail, status };
  });
}

const v = computeVerdict(text);
const rows = rowsOf(text, v);

// Espansione gerarchica: per ogni macro-task con sotto-piano, allega i micro.
for (const r of rows) {
  const sub = subGoalFile(process.cwd(), undefined, r.bit);
  if (!fs.existsSync(sub)) continue;
  const subText = fs.readFileSync(sub, 'utf8');
  const sv = computeVerdict(subText);
  r.sub = {
    title: (subText.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '',
    popcount: sv.popcount,
    validate: sv.validate,
    micro: rowsOf(subText, sv),
  };
}

if (flag('todo')) {
  const todos = [];
  for (const r of rows) {
    todos.push({
      content: `${r.sub ? `${r.desc}  (sub ${r.sub.popcount})` : r.desc}${r.note ? ` — ${r.note}` : ''}`,
      status: r.status,
      activeForm: r.desc.replace(/^(T\d+):\s*/, 'In corso $1: '),
    });
    if (r.sub) for (const m of r.sub.micro) {
      todos.push({
        content: `    ↳ ${m.desc}${m.note ? ` — ${m.note}` : ''}`,
        status: m.status,
        activeForm: `In corso ${m.desc}`,
      });
    }
  }
  out({ ok: true, plan: title, todos });
  process.exit(0);
}

if (flag('pretty')) {
  const mk = r => r.done ? '[x]' : (r.fail ? '[!]' : '[ ]');
  const arr = r => r.status === 'in_progress' ? '  <- prossima' : '';
  const dl = r => r.dep ? ` dep:${r.dep.split(',').map(d => taskLabel(parseInt(d, 10))).join(',')}` : '';
  const lines = [`DanilovGoal: ${title}  (master ${v.popcount})`];
  for (const r of rows) {
    lines.push(`${mk(r)} ${r.task} ${r.mask}  ${r.desc}${dl(r)}${r.note ? ` · ${r.note}` : ''}${arr(r)}`);
    if (r.sub) {
      lines.push(`      sub ${r.sub.popcount} [${r.task}]: ${r.sub.title}`);
      for (const m of r.sub.micro) lines.push(`      ${mk(m)} ${m.task} ${m.mask}  ${m.desc}${dl(m)}${m.note ? ` · ${m.note}` : ''}${arr(m)}`);
    }
  }
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
  tasks: rows,
});
