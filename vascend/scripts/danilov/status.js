#!/usr/bin/env node
// Vista di stato del DanilovGoal — sorgente per la "todo nativa".
// Legge un piano (piano + Trace firmata), ricava per ogni task se e' acceso
// (done), fallito (fail) o ancora al buio, marca il prossimo da fare (next) e
// stampa la lista. Se un task ha un SOTTO-PIANO (<base>.sub<bit>.md), espande
// i suoi micro-task come albero — RICORSIVO a ogni profondita'. Con --all la
// vista copre l'intero REGNO (master + castelli nominati).
//
//   node status.js            -> JSON {ok, plan, state, target, validate, tasks:[...]}
//   node status.js --todo     -> JSON {ok, todos:[{content,status,activeForm}]}
//                                (macro + micro indentati; status ∈ pending|in_progress|completed)
//   node status.js --pretty   -> albero testuale [x]/[ ] (macro -> micro) per la chat
//   node status.js --all      -> come sopra ma su TUTTI i castelli della sessione
//
// Il verdetto resta di validate.js: questo script NON lo emette, riflette solo
// lo stato corrente. Fonte unica = core.js (stessa matematica del validatore).
'use strict';

const fs = require('fs');
const { computeVerdict, hex, taskLabel } = require('./core.js');
const { goalFile, listChildGoals } = require('./session.js');
const { kingdomVerdict, rootLabel } = require('./kingdom.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const all = flag('all');

function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

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

const titleOf = (src) => (src.match(/^#\s*DanilovGoal(?:\[sub\])?:\s*(.+)$/m) || [])[1] || '(senza titolo)';

// Righe di stato di un singolo piano, senza ricorsione.
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

// Espansione gerarchica RICORSIVA: per ogni task con sotto-piano, allega i
// micro (che a loro volta possono avere figli: profondita' libera).
function expandPlan(file) {
  const text = fs.readFileSync(file, 'utf8');
  const v = computeVerdict(text);
  const rows = rowsOf(text, v);
  const children = new Map(listChildGoals(file).map(c => [c.bit, c.file]));
  for (const r of rows) {
    const cf = children.get(r.bit);
    if (!cf || !fs.existsSync(cf)) continue;
    const child = expandPlan(cf);
    r.sub = { title: child.title, popcount: child.v.popcount, validate: child.v.validate, micro: child.rows };
  }
  return { file, title: titleOf(text), v, rows };
}

// Todo flat di un piano espanso, con indentazione per profondita'.
function todosOf(rows, depth, acc) {
  for (const r of rows) {
    const ind = '    '.repeat(depth);
    acc.push({
      content: `${ind}${depth ? '↳ ' : ''}${r.sub ? `${r.desc}  (sub ${r.sub.popcount})` : r.desc}${r.note ? ` — ${r.note}` : ''}`,
      status: r.status,
      activeForm: depth ? `In corso ${r.desc}` : r.desc.replace(/^(T\d+):\s*/, 'In corso $1: '),
    });
    if (r.sub) todosOf(r.sub.micro, depth + 1, acc);
  }
  return acc;
}

// Pretty di un piano espanso, ricorsivo.
function prettyOf(rows, depth, acc) {
  const mk = r => r.done ? '[x]' : (r.fail ? '[!]' : '[ ]');
  const arr = r => r.status === 'in_progress' ? '  <- prossima' : '';
  const dl = r => r.dep ? ` dep:${r.dep.split(',').map(d => taskLabel(parseInt(d, 10))).join(',')}` : '';
  const ind = '      '.repeat(depth);
  for (const r of rows) {
    acc.push(`${ind}${mk(r)} ${r.task} ${r.mask}  ${r.desc}${dl(r)}${r.note ? ` · ${r.note}` : ''}${arr(r)}`);
    if (r.sub) {
      acc.push(`${ind}      sub ${r.sub.popcount} [${r.task}]: ${r.sub.title}`);
      prettyOf(r.sub.micro, depth + 1, acc);
    }
  }
  return acc;
}

// --- Vista REGNO (--all): tutti i castelli della sessione --------------------
if (all) {
  const k = kingdomVerdict(process.cwd());
  if (!k.exists) {
    out({ ok: false, error: 'nessun castello per questa sessione' });
    process.exit(1);
  }
  const castles = k.roots.map(r => ({ root: r, x: expandPlan(r.file) }));

  if (flag('todo')) {
    const todos = [];
    for (const { root, x } of castles) {
      todos.push({ content: `[${rootLabel(root)}] ${x.title}  (${x.v.popcount})`, status: x.v.conforme ? 'completed' : 'in_progress', activeForm: `In corso ${x.title}` });
      todosOf(x.rows, 1, todos);
    }
    out({ ok: true, plan: `regno ${k.popcount}`, todos });
    process.exit(0);
  }
  if (flag('pretty')) {
    const lines = [`Regno: ${k.roots.length} castelli  (${k.popcount})`];
    for (const { root, x } of castles) {
      lines.push(`${x.v.conforme ? '[x]' : '[ ]'} ${rootLabel(root)}: ${x.title}  (${x.v.popcount})${root.after ? `  after:${root.after}` : ''}`);
      prettyOf(x.rows, 1, lines);
    }
    lines.push(`validate(regno) = ${k.conforme ? 'TRUE' : 'FALSE'}  (lo emette validate.js --kingdom)`);
    process.stdout.write(lines.join('\n') + '\n');
    process.exit(0);
  }
  out({
    ok: true,
    popcount: k.popcount,
    validate: k.conforme,
    castles: castles.map(({ root, x }) => ({
      kind: root.kind, slug: root.slug, title: x.title, after: root.after || null,
      state: hex(x.v.state), target: x.v.target != null ? hex(x.v.target) : null,
      validate: x.v.validate, popcount: x.v.popcount, tasks: x.rows,
    })),
  });
  process.exit(0);
}

// --- Vista piano singolo (default: master di sessione) -----------------------
const file = argv.find(a => !a.startsWith('--')) || goalFile(process.cwd());

if (!file || !fs.existsSync(file)) {
  out({ ok: false, error: 'nessun DanilovGoal per questa sessione', file: String(file || '') });
  process.exit(1);
}

const x = expandPlan(file);
const v = x.v;
const rows = x.rows;

if (flag('todo')) {
  out({ ok: true, plan: x.title, todos: todosOf(rows, 0, []) });
  process.exit(0);
}

if (flag('pretty')) {
  const lines = [`DanilovGoal: ${x.title}  (master ${v.popcount})`];
  prettyOf(rows, 0, lines);
  lines.push(`validate(state) = ${v.validate === true ? 'TRUE' : 'FALSE'}  (lo emette validate.js)`);
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(0);
}

out({
  ok: true,
  plan: x.title,
  state: hex(v.state),
  target: v.target != null ? hex(v.target) : null,
  validate: v.validate,
  popcount: v.popcount,
  tasks: rows,
});
