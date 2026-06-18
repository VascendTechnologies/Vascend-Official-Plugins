#!/usr/bin/env node
// SKILL CUSTOM per-sessione: il modello, dopo aver spezzato un mega-prompt in
// task, genera per i task complessi una "skill" su misura in NOTAZIONE Danilov
// (.md) e la abbina al task con `@skill:<name>`. La skill NON e' nel registro
// di Claude Code (un file creato a runtime non e' caricabile col tool Skill a
// meta' sessione): viene RICHIAMATA AL VOLO dall'hook, che ne inietta il
// contenuto quando quella stanza e' la prossima. Vivono in <goalDir>/<sid>.cskills/.
//
// Uso:
//   node cskill.js new  <name> [--task TNN]      scaffolda un template Danilov (se assente)
//   node cskill.js set  <name> [--from file]     scrive il contenuto da --from o da STDIN
//   node cskill.js list                          elenca le skill custom della sessione
//   node cskill.js show <name>                   stampa il contenuto
//   node cskill.js path <name>                   stampa il path del file
//
// I file sono ESENTI dal protect hook: il modello puo' anche editarli con
// Write/Edit. Questo script e' l'entry canonico (naming validato + template).
'use strict';

const fs = require('fs');
const path = require('path');
const { cskillName, cskillDir, cskillFile, listCskills } = require('./session.js');

const argv = process.argv.slice(2);
const cmd = (argv.shift() || '').toLowerCase();

// Flag --task / --from.
let task = null, from = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--task') task = argv[++i];
  else if (a.startsWith('--task=')) task = a.slice('--task='.length);
  else if (a === '--from') from = argv[++i];
  else if (a.startsWith('--from=')) from = a.slice('--from='.length);
  else pos.push(a);
}

const cwd = process.cwd();
const SCRIPT = path.join(__dirname, 'cskill.js').replace(/\\/g, '/');

function usage(code) {
  console.error('Uso: node cskill.js <new|set|list|show|path> <name> [--task TNN] [--from file]');
  process.exit(code == null ? 1 : code);
}

// Template di una skill custom in NOTAZIONE Danilov (lo stesso formato della
// skill danilov-prompt): INDICE/DEFINIZIONI/RELAZIONI + OUTPUT. Il modello lo
// riempie; l'hook lo inietta quando la stanza abbinata e' la prossima.
function template(name, taskRef) {
  return `# Skill custom: ${name}
${taskRef ? `Task: ${taskRef}\n` : ''}(notazione Danilov — INDICE/DEFINIZIONI/RELAZIONI + OUTPUT. Questo file viene
INIETTATO nel contesto quando la stanza abbinata (@skill:${name}) e' la prossima.)

INDICE
1 = obiettivo
2 = vincolo
3 = passo

DEFINIZIONI
@1[scopo]:  -
@2[limite]: -
@3[t01]:    -

RELAZIONI
@R1: @3[t01] -> @1[scopo]

OUTPUT: <cosa deve produrre questa stanza>
`;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

if (cmd === 'list') {
  const items = listCskills(cwd);
  if (!items.length) { console.log(`nessuna skill custom (dir: ${cskillDir(cwd).replace(/\\/g, '/')})`); process.exit(0); }
  console.log(`skill custom (${items.length}):`);
  for (const it of items) console.log(`  ${it.name}  ${it.file.replace(/\\/g, '/')}`);
  process.exit(0);
}

const name = cskillName(pos.shift());
if (!name) usage(1);
const file = cskillFile(cwd, undefined, name);

if (cmd === 'path') { console.log(file.replace(/\\/g, '/')); process.exit(0); }

if (cmd === 'show') {
  if (!fs.existsSync(file)) { console.error(`skill custom inesistente: ${name}`); process.exit(1); }
  process.stdout.write(fs.readFileSync(file, 'utf8'));
  process.exit(0);
}

if (cmd === 'new') {
  fs.mkdirSync(cskillDir(cwd), { recursive: true });
  if (fs.existsSync(file)) { console.log(`gia' esistente: ${file.replace(/\\/g, '/')} (usa 'set' per riscrivere)`); process.exit(0); }
  fs.writeFileSync(file, template(name, task), 'utf8');
  console.log(`skill custom creata: ${name} -> ${file.replace(/\\/g, '/')}`);
  console.log(`abbinala a un task col token  @skill:${name}  nella sua descrizione del piano.`);
  console.log(`riempila: Edit ${file.replace(/\\/g, '/')}  oppure  node ${SCRIPT} set ${name} --from <file>`);
  process.exit(0);
}

if (cmd === 'set') {
  const content = from ? (fs.existsSync(from) ? fs.readFileSync(from, 'utf8') : null) : readStdin();
  if (content == null) { console.error(`--from non trovato: ${from}`); process.exit(1); }
  if (!content.trim()) { console.error('contenuto vuoto: niente da scrivere (passa --from <file> o pipe via STDIN).'); process.exit(1); }
  fs.mkdirSync(cskillDir(cwd), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  console.log(`skill custom scritta: ${name} (${content.length} byte) -> ${file.replace(/\\/g, '/')}`);
  process.exit(0);
}

usage(1);
