#!/usr/bin/env node
// vascend-memory — memoria persistente LOCALE del metodo Danilov.
// Le righe-evento prodotte durante un DanilovGoal vengono catturate e archiviate
// come memoria ricercabile, taggata per PROGETTO + PIANO.
//
// Storage: file `.vascend` in NOTAZIONE A RELAZIONI (compatta), uno per
// progetto, sotto ~/.claude. NESSUN motore esterno (Animus/Docker/Postgres):
// tutto locale, offline, zero dipendenze. Ogni riga e' un ARCO del grafo:
//   <ts> · <azione> <entity>[>target] [| nota]
// entity --[azione]--> target. Da qui: ricerca (BM25+cue+RRF), query
// strutturata e export a grafo (node-link JSON) per un'app esterna.
//
// Uso:  node memory.js <comando> [args]   |   node memory.js tools
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

try { process.stdout.setDefaultEncoding('utf8'); process.stderr.setDefaultEncoding('utf8'); } catch {}

// Storage LOCALE per-utente (niente knowagebase/Animus). Override via env (test).
const MEM_ROOT = process.env.DANILOV_MEM_ROOT ||
  path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), '.danilov-state', 'memory');

// Azioni della voce Danilov (apertura di una riga-evento v2).
// Attivita' (cosa ho fatto) + CONOSCENZA (cosa ho deciso/imparato, col perche').
const ACTIONS = ['read', 'find', 'plan', 'edit', 'new', 'fix', 'error', 'run', 'test', 'warn', 'skip', 'next',
  'decide', 'learn', 'bug', 'rootcause', 'constrain'];
// Azioni di CONOSCENZA: memorie ad alto valore, pesate di piu' nel retrieval (C/A).
const KNOWLEDGE = new Set(['decide', 'learn', 'bug', 'rootcause', 'constrain']);
function isKnowledge(action) { return KNOWLEDGE.has(action); }

// ---- util di base -----------------------------------------------------------

function projectSlug(cwd) {
  const base = path.basename(String(cwd || process.cwd())) || 'root';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}
function storeFile(slug) { return path.join(MEM_ROOT, `${slug}.vascend`); }

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

// Riga-evento -> {action, entity, target, note}, o null.
//  v1 (retrocompat): @azione: entity -> target [nota]
//  v2 (voce attuale): azione entity[>target] [| nota]  (azione nota + marcatore)
const V1_RE = /^@(\w+)\s*:\s*(.+?)\s*(?:→|->)\s*(.+?)\s*(?:\[\s*(.*?)\s*\])?\s*$/;
function parseEventLine(line) {
  const s = String(line).trim();
  const m1 = V1_RE.exec(s);
  if (m1) return { action: m1[1].toLowerCase(), entity: m1[2].trim(), target: m1[3].trim(), note: (m1[4] || '').trim() };
  const m2 = s.match(/^(\w+)\s+(.+)$/);
  if (!m2) return null;
  const action = m2[1].toLowerCase();
  if (!ACTIONS.includes(action)) return null;     // solo azioni note
  let rest = m2[2];
  if (!/[>|]/.test(rest)) return null;            // serve un marcatore di relazione
  let note = '';
  const pipe = rest.indexOf('|');
  if (pipe >= 0) { note = rest.slice(pipe + 1).trim(); rest = rest.slice(0, pipe).trim(); }
  let entity = rest, target = '';
  const gt = rest.indexOf('>');
  if (gt >= 0) { entity = rest.slice(0, gt).trim(); target = rest.slice(gt + 1).trim(); }
  if (!entity) return null;
  return { action, entity, target, note };
}

// raw canonico = riga-relazione v2 (cio' che salviamo e mostriamo).
function toRelation(p) {
  return `${p.action} ${p.entity}${p.target ? `>${p.target}` : ''}${p.note ? ` | ${p.note}` : ''}`;
}
function recordId(project, plan, raw) {
  return crypto.createHash('sha1').update(`${project}|${plan}|${raw}`).digest('hex').slice(0, 16);
}

// ---- serializzazione .vascend (archi raggruppati per piano) -----------------

const SEP = ' · ';
function readRecords(slug) {
  const f = storeFile(slug);
  if (!fs.existsSync(f)) return [];
  const out = [];
  let plan = '(senza piano)';
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const ph = t.match(/^@plan\[(.*)\]$/);
    if (ph) { plan = ph[1] || '(senza piano)'; continue; }
    const i = t.indexOf(SEP);
    if (i < 0) continue;
    const ts = t.slice(0, i).trim();
    const raw = t.slice(i + SEP.length).trim();
    const p = parseEventLine(raw);
    if (!p) continue;
    out.push({ id: recordId(slug, plan, raw), ts, project: slug, plan,
      action: p.action, entity: p.entity, target: p.target, note: p.note, raw,
      kind: isKnowledge(p.action) ? 'knowledge' : 'activity' });
  }
  return out;
}
function writeRecords(slug, records) {
  fs.mkdirSync(MEM_ROOT, { recursive: true });
  const byPlan = new Map();
  for (const r of records) { if (!byPlan.has(r.plan)) byPlan.set(r.plan, []); byPlan.get(r.plan).push(r); }
  const lines = [`# vascend-memory · ${slug}`, ''];
  for (const [plan, recs] of byPlan) {
    recs.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
    lines.push(`@plan[${plan}]`);
    for (const r of recs) lines.push(`${r.ts}${SEP}${r.raw}`);
    lines.push('');
  }
  fs.writeFileSync(storeFile(slug), lines.join('\n'), 'utf8');
}

// Titolo del piano corrente dal goal di sessione (best-effort).
function detectPlan(cwd) {
  try {
    const { goalFile } = require('./session.js');
    const gf = goalFile(cwd);
    if (gf && fs.existsSync(gf)) {
      const m = fs.readFileSync(gf, 'utf8').match(/^#\s*DanilovGoal:\s*(.+)$/m);
      if (m) return m[1].trim();
    }
  } catch {}
  return '(senza piano)';
}
function detectSession() {
  try { return require('./session.js').currentSessionId() || 'no-session'; }
  catch { return 'no-session'; }
}

function out(obj, pretty) {
  process.stdout.write(JSON.stringify(obj, null, pretty ? 2 : 0) + '\n');
  process.exit(obj.ok === false ? 1 : 0);
}

// ---- record + ingest --------------------------------------------------------

function buildRecord(rawInput, ctx) {
  const parsed = parseEventLine(rawInput);
  if (!parsed) return null;
  const raw = toRelation(parsed);                 // normalizza a relazione v2
  const project = ctx.project;
  const plan = ctx.plan || '(senza piano)';
  return {
    id: recordId(project, plan, raw),
    ts: ctx.ts || new Date().toISOString(),
    project, cwd: ctx.cwd || null, plan, session: ctx.session || 'no-session',
    action: parsed.action, entity: parsed.entity, target: parsed.target, note: parsed.note, raw,
    kind: isKnowledge(parsed.action) ? 'knowledge' : 'activity',
  };
}

// Inserisce record nuovi (dedup per id), riscrive lo store. {added, skipped, ids}.
function ingest(slug, records) {
  const existing = readRecords(slug);
  const seen = new Set(existing.map(r => r.id));
  let added = 0, skipped = 0; const ids = [];
  const merged = existing.slice();
  for (const r of records) {
    if (seen.has(r.id)) { skipped++; continue; }
    seen.add(r.id); merged.push(r); added++; ids.push(r.id);
  }
  if (added) writeRecords(slug, merged);
  return { added, skipped, ids };
}

// ---- retrieval portatile (VibeSearch: BM25 + cue + RRF) ---------------------

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2);
}
const docText = (r) => [r.action, r.entity, r.target, r.note].join(' ');

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o; }, {});
  return v;
}
function planHash(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex').slice(0, 16);
}

// Candidati: progetto specifico, o tutti i .vascend se project==null.
function loadCandidates(filters) {
  if (filters.project) return readRecords(filters.project);
  if (!fs.existsSync(MEM_ROOT)) return [];
  const out = [];
  for (const f of fs.readdirSync(MEM_ROOT)) {
    if (f.endsWith('.vascend')) out.push(...readRecords(f.replace(/\.vascend$/, '')));
  }
  return out;
}

function rankRecords(query, pool) {
  if (!pool.length) return [];
  const k1 = 1.5, b = 0.75, RRF_K = 60, KNOWLEDGE_BOOST = 1.6;
  const docs = pool.map(r => tokenize(docText(r)));
  const N = docs.length;
  const df = new Map();
  for (const toks of docs) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => { const n = df.get(t) || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N;

  const qTerms = [...new Set(tokenize(query))];
  const sumIdfQ = qTerms.reduce((s, t) => s + idf(t), 0) || 1;

  const scored = pool.map((r, i) => {
    const toks = docs[i];
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const dl = toks.length || 1;
    let bm25 = 0, coveredIdf = 0;
    const matched = [];
    for (const t of qTerms) {
      const f = tf.get(t) || 0;
      if (f > 0) {
        bm25 += idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl));
        coveredIdf += idf(t);
        matched.push({ term: t, idf: +idf(t).toFixed(3) });
      }
    }
    const cue = coveredIdf / sumIdfQ;
    return { i, bm25, cue, matched, r };
  }).filter(s => s.bm25 > 0 || s.cue > 0);

  const byBm25 = [...scored].sort((a, c) => c.bm25 - a.bm25);
  const byCue = [...scored].sort((a, c) => c.cue - a.cue);
  const rankB = new Map(byBm25.map((s, idx) => [s.i, idx]));
  const rankC = new Map(byCue.map((s, idx) => [s.i, idx]));
  for (const s of scored) {
    s.score = (s.bm25 > 0 ? 1 / (RRF_K + rankB.get(s.i)) : 0) +
              (s.cue > 0 ? 1 / (RRF_K + rankC.get(s.i)) : 0);
    // A/C: la conoscenza (decisioni/lezioni/bug+rootcause) pesa di piu' del semplice log.
    if (s.r.kind === 'knowledge') s.score *= KNOWLEDGE_BOOST;
  }
  scored.sort((a, c) => c.score - a.score);
  return scored.map(s => ({
    score: +s.score.toFixed(6), bm25: +s.bm25.toFixed(3), cue: +s.cue.toFixed(3),
    explain: { matched: s.matched, coverage: +s.cue.toFixed(3) },
    id: s.r.id, ts: s.r.ts, project: s.r.project, plan: s.r.plan, action: s.r.action, kind: s.r.kind || 'activity', raw: s.r.raw,
  }));
}

// ---- comandi ----------------------------------------------------------------

const COMMANDS = {
  add: {
    summary: 'Memorizza una riga-evento (v2 "azione entity>target | nota" o v1 "@azione: x -> y [n]") taggata project+plan. Azioni di conoscenza (decide/learn/bug/rootcause/constrain) = memorie ad alto valore (note = il perche\'), pesate di piu\' nel retrieval.',
    args: ['<raw>', '--project S', '--plan S', '--session S', '--cwd P', '--pretty'],
    run(a) {
      const raw = a._[0];
      if (!raw) return out({ ok: false, error: 'manca la riga-evento (primo argomento)' }, a.pretty);
      const cwd = a.cwd || process.cwd();
      const ctx = { project: a.project || projectSlug(cwd), cwd, plan: a.plan || detectPlan(cwd), session: a.session || detectSession() };
      const rec = buildRecord(raw, ctx);
      if (!rec) return out({ ok: false, error: 'la riga non e\' un evento Danilov (azione entity>target | nota)' }, a.pretty);
      const { added } = ingest(rec.project, [rec]);
      out({ ok: true, added: added === 1, id: rec.id, project: rec.project, plan: rec.plan, record: rec }, a.pretty);
    },
  },

  harvest: {
    summary: 'Estrae le righe-evento dai messaggi assistant di un transcript jsonl e le ingerisce (dedup).',
    args: ['<transcript.jsonl>', '--project S', '--plan S', '--session S', '--cwd P', '--pretty'],
    run(a) {
      const tf = a._[0];
      if (!tf || !fs.existsSync(tf)) return out({ ok: false, error: `transcript non trovato: ${tf || '(manca)'}` }, a.pretty);
      const cwd = a.cwd || process.cwd();
      const ctx = { project: a.project || projectSlug(cwd), cwd, plan: a.plan || detectPlan(cwd), session: a.session || detectSession() };
      let scanned = 0, candidates = 0;
      const records = [];
      const seenRaw = new Set();
      for (const line of fs.readFileSync(tf, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let o; try { o = JSON.parse(line); } catch { continue; }
        if (o.type !== 'assistant') continue;
        const content = o.message && o.message.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (!block || block.type !== 'text' || typeof block.text !== 'string') continue;
          for (const tline of block.text.split('\n')) {
            scanned++;
            const ev = parseEventLine(tline);
            if (!ev) continue;
            candidates++;
            const raw = toRelation(ev);
            if (seenRaw.has(raw)) continue;
            seenRaw.add(raw);
            const rec = buildRecord(tline, { ...ctx, ts: o.timestamp || ctx.ts });
            if (rec) records.push(rec);
          }
        }
      }
      const { added, skipped, ids } = ingest(ctx.project, records);
      out({ ok: true, transcript: path.basename(tf), project: ctx.project, plan: ctx.plan, scanned, candidates, added, skipped, ids }, a.pretty);
    },
  },

  search: {
    summary: 'Cerca nella memoria locale (BM25 + cue-coverage + RRF). plan_hash riproducibile. Solo locale: nessun motore esterno.',
    args: ['--query S', '--project S', '--all', '--plan S', '--action S', '--k N', '--pretty'],
    run(a) {
      const query = a.query || a._[0];
      if (!query) return out({ ok: false, error: 'manca --query' }, a.pretty);
      const k = Math.max(1, parseInt(a.k, 10) || 8);
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)), plan: a.plan || null, action: a.action || null };
      const plan = { semantic: String(query), filters, exclude: [] };
      const plan_hash = planHash(plan);
      let pool = loadCandidates(filters)
        .filter(r => (!filters.plan || r.plan === filters.plan) && (!filters.action || r.action === filters.action));
      const ranked = rankRecords(query, pool).slice(0, k);
      out({ ok: true, source: 'local', plan_hash, query: String(query), filters, count: ranked.length, total_pool: pool.length, results: ranked }, a.pretty);
    },
  },

  query: {
    summary: 'Interroga la memoria per filtri STRUTTURATI (entity/target/action/plan, match substring). Output diretto, niente ranking.',
    args: ['--entity S', '--target S', '--action S', '--plan S', '--project S', '--all', '--limit N', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const ent = String(a.entity || '').toLowerCase(), tgt = String(a.target || '').toLowerCase();
      const act = String(a.action || '').toLowerCase(), pl = a.plan || null;
      const limit = Math.max(1, parseInt(a.limit, 10) || 50);
      const pool = loadCandidates(filters).filter(r =>
        (!ent || String(r.entity || '').toLowerCase().includes(ent)) &&
        (!tgt || String(r.target || '').toLowerCase().includes(tgt)) &&
        (!act || r.action === act) &&
        (!pl || r.plan === pl));
      pool.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      out({ ok: true, count: Math.min(limit, pool.length), total: pool.length, filters: { entity: a.entity || null, target: a.target || null, action: a.action || null, plan: pl },
        results: pool.slice(0, limit).map(r => ({ ts: r.ts, plan: r.plan, action: r.action, kind: r.kind || 'activity', entity: r.entity, target: r.target, note: r.note, raw: r.raw, id: r.id })) }, a.pretty);
    },
  },

  graph: {
    summary: 'Esporta la memoria come GRAFO (node-link JSON): nodi = entita/obiettivi, archi = azioni. Per visualizzazione in app esterna (D3/Cytoscape).',
    args: ['--project S', '--all', '--plan S', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const pool = loadCandidates(filters).filter(r => !a.plan || r.plan === a.plan);
      const nodes = new Map();
      const touch = (label) => { if (!label) return; const n = nodes.get(label) || { id: label, label, count: 0 }; n.count++; nodes.set(label, n); };
      const edges = [];
      for (const r of pool) {
        touch(r.entity);
        if (r.target) {
          touch(r.target);
          edges.push({ source: r.entity, target: r.target, action: r.action, plan: r.plan, ts: r.ts, ...(r.note ? { note: r.note } : {}) });
        }
      }
      out({ ok: true, project: filters.project || 'ALL', plan: a.plan || null, format: 'node-link',
        stats: { nodes: nodes.size, edges: edges.length }, nodes: [...nodes.values()], edges }, a.pretty);
    },
  },

  list: {
    summary: 'Elenca gli ultimi N eventi memorizzati (filtrabili per project/plan/action).',
    args: ['--project S', '--all', '--plan S', '--action S', '--limit N', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)), plan: a.plan || null, action: a.action || null };
      const limit = Math.max(1, parseInt(a.limit, 10) || 20);
      const pool = loadCandidates(filters)
        .filter(r => (!filters.plan || r.plan === filters.plan) && (!filters.action || r.action === filters.action));
      pool.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      out({ ok: true, count: Math.min(limit, pool.length), total: pool.length,
        results: pool.slice(0, limit).map(r => ({ ts: r.ts, plan: r.plan, action: r.action, kind: r.kind || 'activity', raw: r.raw, id: r.id })) }, a.pretty);
    },
  },

  plans: {
    summary: 'Elenca i piani presenti per un progetto, con conteggio eventi e ultimo aggiornamento.',
    args: ['--project S', '--all', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const pool = loadCandidates(filters);
      const by = new Map();
      for (const r of pool) {
        const key = `${r.project}::${r.plan}`;
        const e = by.get(key) || { project: r.project, plan: r.plan, events: 0, last: '' };
        e.events++; if (String(r.ts) > e.last) e.last = r.ts; by.set(key, e);
      }
      const plans = [...by.values()].sort((x, y) => String(y.last).localeCompare(String(x.last)));
      out({ ok: true, count: plans.length, plans }, a.pretty);
    },
  },

  stats: {
    summary: 'Statistiche memoria: eventi totali, per progetto, per azione.',
    args: ['--project S', '--all', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const pool = loadCandidates(filters);
      const byProject = {}, byAction = {};
      for (const r of pool) { byProject[r.project] = (byProject[r.project] || 0) + 1; byAction[r.action] = (byAction[r.action] || 0) + 1; }
      out({ ok: true, root: MEM_ROOT, total: pool.length, byProject, byAction }, a.pretty);
    },
  },

  related: {
    summary: 'Memorie inerenti a un file: ultime N righe-evento il cui entity/raw cita il file (default 10).',
    args: ['<file>', '--limit N', '--project S', '--all', '--pretty'],
    run(a) {
      const file = a._[0] || a.file;
      if (!file) return out({ ok: false, error: 'manca il file (primo argomento)' }, a.pretty);
      const base = path.basename(String(file)).toLowerCase();
      if (!base) return out({ ok: false, error: 'file non valido' }, a.pretty);
      const limit = Math.max(1, parseInt(a.limit, 10) || 10);
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const pool = loadCandidates(filters).filter(r =>
        String(r.entity || '').toLowerCase().includes(base) || String(r.raw || '').toLowerCase().includes(base));
      pool.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      const total = pool.length;
      out({ ok: true, file: String(file), basename: path.basename(String(file)), count: Math.min(limit, total), total,
        more: total > limit ? `node ${path.join(__dirname, 'memory.js').replace(/\\/g, '/')} related ${path.basename(String(file))} --limit ${total}` : null,
        results: pool.slice(0, limit).map(r => ({ ts: r.ts, plan: r.plan, action: r.action, raw: r.raw, id: r.id })) }, a.pretty);
    },
  },

  engine: {
    summary: 'DISABILITATO: la memoria Vascend e\' locale (.vascend), nessun motore esterno (Animus/Docker).',
    args: ['--pretty'],
    run(a) {
      out({ ok: false, disabled: true, error: 'memoria esterna disabilitata: la memoria Vascend e\' locale in file .vascend (notazione a relazioni). Usa search/query/graph.', root: MEM_ROOT }, a.pretty);
    },
  },

  health: {
    summary: 'Stato memoria: locale (.vascend), nessun motore esterno.',
    args: ['--pretty'],
    run(a) {
      out({ ok: true, engine: 'disabled', store: 'local .vascend', root: MEM_ROOT }, a.pretty);
    },
  },

  tools: {
    summary: 'Elenca il catalogo dei comandi.',
    args: ['--pretty'],
    run(a) {
      const tools = Object.entries(COMMANDS).map(([name, c]) => ({ name, summary: c.summary, args: c.args }));
      out({ ok: true, catalog: 'vascend-memory', root: MEM_ROOT, tools }, a.pretty);
    },
  },
};

// ---- dispatch ---------------------------------------------------------------

if (require.main === module) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const a = parseArgs(argv.slice(1));
  if (!cmd || cmd === 'help' || cmd === '--help') {
    COMMANDS.tools.run(a);
  } else if (COMMANDS[cmd]) {
    try {
      const p = COMMANDS[cmd].run(a);
      if (p && typeof p.catch === 'function') p.catch(e => out({ ok: false, error: String(e && e.message || e) }, a.pretty));
    } catch (e) { out({ ok: false, error: String(e && e.message || e) }, a.pretty); }
  } else {
    out({ ok: false, error: `comando sconosciuto: ${cmd}`, hint: 'node memory.js tools' }, a.pretty);
  }
}

module.exports = { parseEventLine, toRelation, buildRecord, ingest, readRecords, writeRecords, projectSlug, recordId, storeFile, MEM_ROOT };
