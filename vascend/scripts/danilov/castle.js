#!/usr/bin/env node
// CASTELLI MULTIPLI: piu' piani DanilovGoal indipendenti nella stessa sessione.
// Ogni castello e' un piano con nome (<sid>.castle-<slug>.md) con i propri
// macro-task (bit); ogni macro puo' avere sotto-piani di micro-task (subplan.js,
// ricorsivo a profondita' libera). I castelli sono ILLIMITATI: il tetto di 30
// bit vale per singolo piano, la scala viene dalla composizione (n castelli x
// gerarchia). L'insieme dei castelli della sessione e' il REGNO (kingdom.js);
// il verdetto del regno e' conforme sse OGNI castello e' illuminato.
//
// Uso:
//   node castle.js new <slug> "<titolo>" "T01: ..." "T02: ..." [--after <slug>]
//       crea (o ricrea) un castello nominato; --after lo gata a un altro
//       castello: mark.js non accende stanze finche' il prerequisito non e'
//       conforme. Ricreare un castello azzera i SUOI sotto-piani.
//   node castle.js list [--json]     radici del regno (master+castelli) + verdetti
//   node castle.js map  [--json]     mappa completa: castelli -> macro -> micro (ricorsivo)
//   node castle.js next              prossima stanza al buio del regno (scesa in profondita')
//   node castle.js drop <slug>       demolisce un castello (file + discendenti)
//
// Come plan.js: il file NON si edita a mano (hook protect); Trace firmata.
'use strict';

const fs = require('fs');
const path = require('path');
const { hex, taskLabel } = require('./core.js');
const { buildPlanMd, buildNotesMd } = require('./scaffold.js');
const {
  goalDir, castleSlug, castleFile, listCastles, listDescendants,
  notesFile, writeGoalAtomic, CLAUDE_DIR, currentSessionId,
} = require('./session.js');
const { kingdomVerdict, nextRoom, rootLabel, afterOf, planTasksOf } = require('./kingdom.js');

const raw = process.argv.slice(2);
const asJson = raw.includes('--json');
let after = null;
const pos = [];
for (let i = 0; i < raw.length; i++) {
  const a = raw[i];
  if (a === '--json') continue;
  else if (a === '--after') after = raw[++i] ?? null;
  else if (a.startsWith('--after=')) after = a.slice('--after='.length);
  else pos.push(a);
}
const cmd = String(pos.shift() || 'list').toLowerCase();
const cwd = process.cwd();

function die(msg) { console.error(msg); process.exit(1); }

// Alza il flag enforcement della sessione preservando lo sticky (come plan.js).
function raiseFlag() {
  try {
    const STATE_DIR = path.join(CLAUDE_DIR, '.danilov-state');
    const sid = String(currentSessionId() || 'default');
    const ff = path.join(STATE_DIR, `${sid}.json`);
    let prev = null; try { prev = JSON.parse(fs.readFileSync(ff, 'utf8')); } catch {}
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(ff, JSON.stringify({ active: true, sticky: !!(prev && prev.sticky), cwd, ts: new Date().toISOString() }), 'utf8');
  } catch {}
}

// --- new: crea/ricrea un castello nominato ----------------------------------
if (cmd === 'new') {
  const slug = castleSlug(pos.shift());
  const title = pos.shift();
  const tasks = pos;
  if (!slug || !title || tasks.length < 1) {
    die('Uso: node castle.js new <slug> "<titolo>" "T01: descr" "T02: descr" ... [--after <slug>]');
  }
  if (tasks.length > 30) {
    die(`Troppi task (${tasks.length}): massimo 30 bit per castello. Scomponi in sotto-piani (subplan.js) o in un altro castello.`);
  }
  const afterSlug = after != null ? castleSlug(after) : null;
  if (after != null && !afterSlug) die(`--after non valido: ${after}`);
  if (afterSlug === slug) die('--after non puo\' puntare al castello stesso.');
  if (afterSlug && !fs.existsSync(castleFile(cwd, undefined, afterSlug))) {
    die(`castello prerequisito inesistente: ${afterSlug} (crealo prima, o togli --after).`);
  }
  // Anti-ciclo: la catena After deve restare un DAG. a->b->...->a sarebbe un
  // deadlock logico (mark.js negherebbe OGNI stanza di entrambi, per sempre).
  if (afterSlug) {
    const chain = new Map(); // slug -> after
    for (const c of listCastles(cwd)) {
      try { chain.set(c.slug, afterOf(fs.readFileSync(c.file, 'utf8'))); } catch {}
    }
    chain.set(slug, afterSlug); // includendo il castello in creazione
    const seen = new Set([slug]);
    for (let cur = afterSlug; cur != null; cur = chain.get(cur)) {
      if (seen.has(cur)) die(`ciclo nelle dipendenze After: ${[...seen, cur].join(' -> ')} — un castello non puo' aspettare se stesso.`);
      seen.add(cur);
    }
  }

  const file = castleFile(cwd, undefined, slug);
  const headerLines = [`Castle: ${slug}`];
  if (afterSlug) headerLines.push(`After: ${afterSlug}`);
  const { TOT, MASK, md } = buildPlanMd({ title, tasks, headerLines });

  fs.mkdirSync(goalDir(cwd), { recursive: true });
  // Ricreare un castello invalida i SUOI discendenti (stato, non codice).
  let dropped = 0;
  if (fs.existsSync(file)) {
    for (const d of listDescendants(file)) { try { fs.rmSync(d.file, { force: true }); dropped++; } catch {} }
  }
  writeGoalAtomic(file, md);
  const nf = notesFile(file);
  if (!fs.existsSync(nf)) {
    try { fs.writeFileSync(nf, buildNotesMd({ title, tasks, planName: path.basename(file) }), 'utf8'); } catch {}
  }
  raiseFlag();

  console.log(`castello "${slug}" creato: ${TOT} task, MASK_TARGET=${hex(MASK)} -> ${file}${dropped ? ` (rimossi ${dropped} sotto-piani obsoleti)` : ''}`);
  if (afterSlug) console.log(`  gate: si accende solo dopo il castello "${afterSlug}" (mark.js lo verifica)`);
  console.log(`marca le stanze:  node ${path.join(__dirname, 'mark.js').replace(/\\/g, '/')} ${file.replace(/\\/g, '/')} <bit> OK`);
  console.log(`micro-task:       node ${path.join(__dirname, 'subplan.js').replace(/\\/g, '/')} ${file.replace(/\\/g, '/')} <bit> "<titolo>" "t01: ..." ...`);
  process.exit(0);
}

// --- drop: demolisce un castello (+discendenti) ------------------------------
if (cmd === 'drop') {
  const slug = castleSlug(pos.shift());
  if (!slug) die('Uso: node castle.js drop <slug>');
  const file = castleFile(cwd, undefined, slug);
  if (!fs.existsSync(file)) die(`castello inesistente: ${slug}`);
  let n = 0;
  for (const d of listDescendants(file)) { try { fs.rmSync(d.file, { force: true }); n++; } catch {} }
  fs.rmSync(file, { force: true });
  console.log(`castello "${slug}" demolito${n ? ` (+${n} sotto-piani)` : ''}.`);
  process.exit(0);
}

// --- next: prossima stanza al buio del regno ---------------------------------
if (cmd === 'next') {
  const n = nextRoom(cwd);
  if (!n) { console.log('regno illuminato: nessuna stanza al buio.'); process.exit(0); }
  if (asJson) { process.stdout.write(JSON.stringify(n) + '\n'); process.exit(0); }
  console.log(`prossima: ${n.task} ${n.mask}  ${n.desc}`);
  console.log(`  dove:   ${n.trail.join(' > ')}`);
  console.log(`  accendi: node ${path.join(__dirname, 'mark.js').replace(/\\/g, '/')} ${n.file.replace(/\\/g, '/')} ${n.bit} OK`);
  process.exit(0);
}

// --- list / map: vista del regno ---------------------------------------------
const k = kingdomVerdict(cwd);
if (!k.exists) {
  if (asJson) { process.stdout.write(JSON.stringify({ ok: false, error: 'nessun castello per questa sessione' }) + '\n'); }
  else console.log('nessun castello per questa sessione: crea con plan.js (default) o castle.js new <slug>.');
  process.exit(1);
}

if (cmd === 'list') {
  if (asJson) {
    process.stdout.write(JSON.stringify({
      ok: true,
      popcount: k.popcount,
      conforme: k.conforme,
      castles: k.roots.map(r => ({
        kind: r.kind, slug: r.slug, title: r.title, after: r.after || null,
        file: r.file, popcount: r.v.popcount, validate: r.v.validate === true,
      })),
    }) + '\n');
    process.exit(k.conforme ? 0 : 1);
  }
  console.log(`regno: ${k.roots.length} castelli  ${k.popcount} stanze  validate(regno) = ${k.conforme ? 'TRUE' : 'FALSE'}`);
  for (const r of k.roots) {
    const lit = r.v.conforme ? '[x]' : '[ ]';
    console.log(`${lit} ${rootLabel(r)}  "${r.title}"  ${r.v.popcount}${r.after ? `  (after: ${r.after})` : ''}`);
  }
  process.exit(k.conforme ? 0 : 1);
}

if (cmd === 'map') {
  if (asJson) {
    process.stdout.write(JSON.stringify({ ok: true, popcount: k.popcount, conforme: k.conforme, plans: k.plans.map(p => ({ kind: p.kind, slug: p.slug, depth: p.depth, bit: p.bit, file: p.file, title: p.title, popcount: p.v.popcount, validate: p.v.validate === true })) }) + '\n');
    process.exit(k.conforme ? 0 : 1);
  }
  console.log(`regno ${k.popcount}  validate(regno) = ${k.conforme ? 'TRUE' : 'FALSE'}`);
  for (const p of k.plans) {
    const pad = '  '.repeat(p.depth);
    const lit = p.v.conforme ? '[x]' : '[ ]';
    const name = p.depth === 0 ? rootLabel(p) : `sub di ${taskLabel(p.bit)}`;
    console.log(`${pad}${lit} ${name}  "${p.title}"  ${p.v.popcount}${p.depth === 0 && p.after ? `  (after: ${p.after})` : ''}`);
    if (!p.v.conforme && p.v.missingTasks.length) {
      console.log(`${pad}      al buio: ${p.v.missingTasks.map(t => `${t.task} (${hex(t.mask)})`).join(', ')}`);
    }
  }
  process.exit(k.conforme ? 0 : 1);
}

// Grafo mermaid del regno: nodi=piani (radici e sub, con popcount), archi=
// After (tratteggiati) e padre->sub (solidi, etichettati col macro). Verde se
// illuminato. E' la mappa TRACCIABILE del regno: niente prosa, un diagramma.
function kingdomMermaid() {
  const id = new Map();
  k.plans.forEach((p, i) => id.set(p.file, p.depth === 0 ? `r${i}` : `s${i}`));
  const esc = (s) => String(s).replace(/["[\]{}()|<>]/g, ' ').slice(0, 38).trim();
  const lines = ['graph TD',
    '  classDef lit fill:#DCFCE7,stroke:#16A34A,color:#14532D',
    '  classDef dark fill:#F3F4F6,stroke:#9CA3AF,color:#374151'];
  const slugNode = new Map(); // slug -> nodeId (per gli archi After)
  for (const p of k.plans) {
    const n = id.get(p.file);
    const name = p.depth === 0 ? rootLabel(p) : `sub ${taskLabel(p.bit)}`;
    lines.push(`  ${n}["${esc(name)} · ${esc(p.title)} · ${p.v.popcount}"]:::${p.v.conforme ? 'lit' : 'dark'}`);
    if (p.depth === 0 && p.kind === 'castle') slugNode.set(p.slug, n);
    if (p.depth > 0) {
      const parent = k.plans.find(q => p.file === q.file.replace(/\.md$/i, `.sub${p.bit}.md`));
      if (parent) lines.push(`  ${id.get(parent.file)} -->|${taskLabel(p.bit)}| ${n}`);
    }
  }
  for (const p of k.roots) {
    if (p.after && slugNode.has(p.after) && id.get(p.file)) {
      lines.push(`  ${slugNode.get(p.after)} -.->|after| ${id.get(p.file)}`);
    }
  }
  return lines.join('\n');
}

// --- mermaid: la mappa del regno come diagramma (stdout) ---------------------
if (cmd === 'mermaid') {
  process.stdout.write('```mermaid\n' + kingdomMermaid() + '\n```\n');
  process.exit(k.conforme ? 0 : 1);
}

// --- kanban: il regno a colonne (fatto / in corso / al buio / fallito) ------
// Per il tracking professionale di obiettivi business: ogni stanza e' una
// card con la provenienza (castello/sub) e il link agli appunti se esistono.
// --write fissa la board in <cwd>/VASCEND_KANBAN.md (auto-generata,
// rigenerabile: la verita' resta nella Trace firmata).
if (cmd === 'kanban') {
  const cols = { fatto: [], corso: [], buio: [], fallito: [] };
  const notes = [];
  for (const p of k.plans) {
    const where = p.depth === 0 ? rootLabel(p) : `${p.slug || 'master'} › sub T${String(p.bit + 1).padStart(2, '0')}`;
    const tasks = planTasksOf(p.file);
    const firstDark = tasks.find(t => (p.v.state & t.mask) === 0);
    for (const t of tasks) {
      const done = (p.v.state & t.mask) !== 0;
      const fail = (p.v.failBits & t.mask) !== 0;
      const card = `**${taskLabel(t.bit)}** ${t.desc}  _(${where})_`;
      if (done) cols.fatto.push(card);
      else if (fail) cols.fallito.push(card);
      else if (firstDark && t.bit === firstDark.bit) cols.corso.push(card);
      else cols.buio.push(card);
    }
    const nf = notesFile(p.file);
    if (fs.existsSync(nf)) notes.push(`- ${where}: ${nf.replace(/\\/g, '/')}`);
  }
  const md = [
    `# Kanban del regno  ·  ${k.popcount} stanze  ·  validate(regno) = ${k.conforme ? 'TRUE' : 'FALSE'}`,
    '',
    '> Board auto-generata da `castle.js kanban` — la verita\' e\' la Trace firmata; rigenera invece di editare.',
    '',
    `## Fatto (${cols.fatto.length})`, ...cols.fatto.map(c => `- [x] ${c}`),
    '',
    `## In corso (${cols.corso.length})`, ...cols.corso.map(c => `- [ ] ${c} ◀`),
    '',
    `## Al buio (${cols.buio.length})`, ...cols.buio.map(c => `- [ ] ${c}`),
    '',
    `## Fallito (${cols.fallito.length})`, ...cols.fallito.map(c => `- [!] ${c}`),
    ...(notes.length ? ['', '## Appunti (liberi, Write/Edit ammessi)', ...notes] : []),
    '',
    '## Mappa del regno',
    '',
    '```mermaid',
    kingdomMermaid(),
    '```',
    '',
  ].join('\n');

  if (raw.includes('--write')) {
    const out = path.join(cwd, 'VASCEND_KANBAN.md');
    fs.writeFileSync(out, md, 'utf8');
    console.log(`kanban scritto: ${out}  (${k.popcount}, rigenera con: castle.js kanban --write)`);
  } else {
    process.stdout.write(md);
  }
  process.exit(k.conforme ? 0 : 1);
}

die(`comando sconosciuto: ${cmd} (new|list|map|next|drop|kanban|mermaid)`);
