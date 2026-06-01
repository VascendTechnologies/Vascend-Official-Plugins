#!/usr/bin/env node
// danilov-memory — catalogo CLI di memoria persistente per il metodo Danilov.
// Le righe-evento "@<azione>: <entita> -> <obiettivo> [ nota ]" prodotte durante
// un DanilovGoal vengono catturate e archiviate come memoria ricercabile,
// taggata per PROGETTO + PIANO. La ricerca porta la logica del paper VibeSearch
// (SearchPlan + BM25 + cue-coverage + RRF fusion + plan_hash verificabile) in
// un layer Node portatile a zero dipendenze: funziona offline, non avvia il
// motore pesante (Docker/Postgres/FalkorDB). Quando il motore vero e' acceso,
// 'search --engine' puo' delegargli la query (bridge opzionale).
//
// Stile CLI: registry auto-descrivente (CLI-Anything) + output JSON {ok:...}
// a riga singola (lead-craft-forge). Exit 0 = JSON valido (leggi "ok"); 1 = ok:false.
//
// Uso:  node memory.js <comando> [args]   |   node memory.js tools
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

// UTF-8 forzato su Windows (come lead-craft-forge).
try { process.stdout.setDefaultEncoding('utf8'); process.stderr.setDefaultEncoding('utf8'); } catch {}

// Radice del progetto knowagebase (per docker compose e CLI nativa).
const KB_ROOT = process.env.DANILOV_KB_ROOT ||
  path.join(os.homedir(), 'Desktop', 'knowagebase_gobid');
// Dati DENTRO knowagebase_gobid (override via env per i test).
const MEM_ROOT = process.env.DANILOV_MEM_ROOT || path.join(KB_ROOT, 'danilov-memory');

// ---- util di base -----------------------------------------------------------

function projectSlug(cwd) {
  const base = path.basename(String(cwd || process.cwd())) || 'root';
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'root';
}
function storeFile(slug) { return path.join(MEM_ROOT, `${slug}.jsonl`); }

// Parsing argv minimale: positionals + --flag value / --flag (boolean).
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

// Riga-evento Danilov -> record strutturato (o null se non e' una @-riga).
const EVENT_RE = /^@(\w+)\s*:\s*(.+?)\s*(?:→|->)\s*(.+?)\s*(?:\[\s*(.*?)\s*\])?\s*$/;
function parseEventLine(line) {
  const m = EVENT_RE.exec(String(line).trim());
  if (!m) return null;
  return { action: m[1].toLowerCase(), entity: m[2].trim(), target: m[3].trim(), note: (m[4] || '').trim() };
}

function recordId(session, raw) {
  return crypto.createHash('sha1').update(`${session}|${raw}`).digest('hex').slice(0, 16);
}

function readRecords(slug) {
  const f = storeFile(slug);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n')
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function appendRecord(slug, rec) {
  fs.mkdirSync(MEM_ROOT, { recursive: true });
  fs.appendFileSync(storeFile(slug), JSON.stringify(rec) + '\n', 'utf8');
}

// Titolo del piano corrente dal goal di sessione (se risolvibile).
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

// ---- costruzione record + ingest condiviso ----------------------------------

function buildRecord(raw, ctx) {
  const parsed = parseEventLine(raw);
  if (!parsed) return null;
  const session = ctx.session || 'no-session';
  return {
    id: recordId(session, raw),
    ts: ctx.ts || new Date().toISOString(),
    project: ctx.project,
    cwd: ctx.cwd || null,
    plan: ctx.plan || '(senza piano)',
    session,
    action: parsed.action,
    entity: parsed.entity,
    target: parsed.target,
    note: parsed.note,
    raw: String(raw).trim(),
  };
}

// Inserisce record nuovi (dedup per id), ritorna {added, skipped, ids}.
function ingest(slug, records) {
  const existing = new Set(readRecords(slug).map(r => r.id));
  let added = 0, skipped = 0; const ids = [];
  for (const r of records) {
    if (existing.has(r.id)) { skipped++; continue; }
    appendRecord(slug, r); existing.add(r.id); added++; ids.push(r.id);
  }
  return { added, skipped, ids };
}

// ---- retrieval portatile (logica VibeSearch: BM25 + cue + RRF) --------------

function tokenize(text) {
  return String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 2);
}
const docText = (r) => [r.action, r.entity, r.target, r.note].join(' ');

// plan_hash: SHA-256 del SearchPlan canonico -> ricerca riproducibile/verificabile.
// Canonicalizza ricorsivamente (chiavi ordinate a OGNI livello). Un replacer-
// array di JSON.stringify scarterebbe le chiavi annidate dei filtri -> hash
// che ignora i filtri (collisione). Cosi il plan_hash resta fedele al piano.
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = canonical(v[k]); return o; }, {});
  return v;
}
function planHash(plan) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(plan))).digest('hex').slice(0, 16);
}

// Carica i record candidati: progetto specifico, o tutti i .jsonl se project==null.
function loadCandidates(filters, cwd) {
  if (filters.project) return readRecords(filters.project);
  if (!fs.existsSync(MEM_ROOT)) return [];
  const out = [];
  for (const f of fs.readdirSync(MEM_ROOT)) {
    if (f.endsWith('.jsonl')) out.push(...readRecords(f.replace(/\.jsonl$/, '')));
  }
  return out;
}

// BM25 + cue-coverage IDF-pesata, fusi con Reciprocal Rank Fusion.
function rankRecords(query, pool) {
  if (!pool.length) return [];
  const k1 = 1.5, b = 0.75, RRF_K = 60;
  const docs = pool.map(r => tokenize(docText(r)));
  const N = docs.length;
  const df = new Map();
  for (const toks of docs) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => { const n = df.get(t) || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)); };
  const avgdl = docs.reduce((s, d) => s + d.length, 0) / N;

  const qAll = tokenize(query);
  const qTerms = [...new Set(qAll)];
  const sumIdfQ = qTerms.reduce((s, t) => s + idf(t), 0) || 1;

  const scored = pool.map((r, i) => {
    const toks = docs[i];
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    const dl = toks.length || 1;
    let bm25 = 0;
    const matched = [];
    let coveredIdf = 0;
    for (const t of qTerms) {
      const f = tf.get(t) || 0;
      if (f > 0) {
        bm25 += idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / avgdl));
        coveredIdf += idf(t);
        matched.push({ term: t, idf: +idf(t).toFixed(3) });
      }
    }
    const cue = coveredIdf / sumIdfQ; // copertura cue (SPECTRA-MEM-lite)
    return { i, bm25, cue, matched, r };
  }).filter(s => s.bm25 > 0 || s.cue > 0);

  // ranking per BM25 e per cue, poi RRF.
  const byBm25 = [...scored].sort((a, c) => c.bm25 - a.bm25);
  const byCue = [...scored].sort((a, c) => c.cue - a.cue);
  const rankB = new Map(byBm25.map((s, idx) => [s.i, idx]));
  const rankC = new Map(byCue.map((s, idx) => [s.i, idx]));
  for (const s of scored) {
    s.score = (s.bm25 > 0 ? 1 / (RRF_K + rankB.get(s.i)) : 0) +
              (s.cue > 0 ? 1 / (RRF_K + rankC.get(s.i)) : 0);
  }
  scored.sort((a, c) => c.score - a.score);
  return scored.map(s => ({
    score: +s.score.toFixed(6), bm25: +s.bm25.toFixed(3), cue: +s.cue.toFixed(3),
    explain: { matched: s.matched, coverage: +s.cue.toFixed(3) },
    id: s.r.id, ts: s.r.ts, project: s.r.project, plan: s.r.plan,
    action: s.r.action, raw: s.r.raw,
  }));
}

// Base URL del motore (override env). Unica fonte per probe e bridge.
function engineBase() {
  return (process.env.DANILOV_ENGINE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
}

const HEALTH_CACHE = path.join(MEM_ROOT, '.engine-health.json');
const HEALTH_TTL = 30000; // 30s: durante un piano non risondare a ogni search.

// Probe di raggiungibilita': QUALUNQUE risposta HTTP = motore su; connessione
// rifiutata / timeout = giu. Prova /health poi / (root). Timeout breve.
async function probeEngine() {
  const base = engineBase();
  const t0 = Date.now();
  let last;
  for (const pth of ['/health', '/']) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1200);
      const res = await fetch(base + pth, { method: 'GET', signal: ctrl.signal });
      clearTimeout(timer);
      return { up: true, url: base, status: res.status, latency_ms: Date.now() - t0 };
    } catch (e) { last = e; }
  }
  return { up: false, url: base, latency_ms: Date.now() - t0, error: String((last && last.message) || last) };
}

// Stato del motore con cache TTL (file in MEM_ROOT). force=true ignora la cache.
async function engineUp(opts = {}) {
  if (!opts.force) {
    try {
      const c = JSON.parse(fs.readFileSync(HEALTH_CACHE, 'utf8'));
      // valida solo se fresca E riferita allo STESSO url (l'env puo' cambiare).
      if (Date.now() - c.ts < HEALTH_TTL && c.v && c.v.url === engineBase()) return { ...c.v, cached: true };
    } catch {}
  }
  const v = await probeEngine();
  try { fs.mkdirSync(MEM_ROOT, { recursive: true }); fs.writeFileSync(HEALTH_CACHE, JSON.stringify({ ts: Date.now(), v }), 'utf8'); } catch {}
  return { ...v, cached: false };
}

// Bridge al motore vero. Usa /api/search/memory: modalita' deterministica
// (niente lane dense/embedding) pensata per il richiamo di memorie, con piu'
// risultati. Timeout breve.
async function tryEngine(plan, k) {
  const url = engineBase() + '/api/search/memory';
  const token = process.env.DANILOV_ENGINE_TOKEN;
  // Il motore Vascend protegge la search (Depends get_current_user): senza
  // Bearer risponde 401 e la delega non avviene mai. Mandiamo il token se c'e'.
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(url, {
      method: 'POST', signal: ctrl.signal, headers,
      body: JSON.stringify({ query: plan.semantic, k: Math.max(1, Math.min(100, k || 20)) }),
    });
    clearTimeout(timer);
    if (!res.ok) {
      const hint = (res.status === 401 || res.status === 403) && !token
        ? ' — manca DANILOV_ENGINE_TOKEN (Bearer)' : '';
      return { ok: false, note: `engine HTTP ${res.status}${hint} (fallback locale)` };
    }
    const json = await res.json();
    return { ok: true, url, authed: !!token, results: json };
  } catch (e) {
    return { ok: false, note: `engine non raggiungibile: ${String(e && e.message || e)} (fallback locale)` };
  }
}

// ---- comandi (registry auto-descrivente) ------------------------------------

const COMMANDS = {
  add: {
    summary: 'Memorizza una riga-evento "@azione: entita -> obiettivo [nota]" taggata project+plan.',
    args: ['<raw>', '--project S', '--plan S', '--session S', '--cwd P', '--pretty'],
    run(a) {
      const raw = a._[0];
      if (!raw) return out({ ok: false, error: 'manca la riga-evento (primo argomento)' }, a.pretty);
      const cwd = a.cwd || process.cwd();
      const ctx = {
        project: a.project || projectSlug(cwd),
        cwd,
        plan: a.plan || detectPlan(cwd),
        session: a.session || detectSession(),
      };
      const rec = buildRecord(raw, ctx);
      if (!rec) return out({ ok: false, error: 'la riga non e\' un evento Danilov (@azione: x -> y)' }, a.pretty);
      const { added } = ingest(rec.project, [rec]);
      out({ ok: true, added: added === 1, id: rec.id, project: rec.project, plan: rec.plan, record: rec }, a.pretty);
    },
  },

  harvest: {
    summary: 'Estrae le righe-evento @ dai messaggi assistant di un transcript jsonl e le ingerisce (dedup).',
    args: ['<transcript.jsonl>', '--project S', '--plan S', '--session S', '--cwd P', '--pretty'],
    run(a) {
      const tf = a._[0];
      if (!tf || !fs.existsSync(tf)) return out({ ok: false, error: `transcript non trovato: ${tf || '(manca)'}` }, a.pretty);
      const cwd = a.cwd || process.cwd();
      const ctx = {
        project: a.project || projectSlug(cwd),
        cwd,
        plan: a.plan || detectPlan(cwd),
        session: a.session || detectSession(),
      };
      let scanned = 0, candidates = 0;
      const records = [];
      const seenRaw = new Set(); // dedup intra-transcript prima dell'ingest
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
            const raw = tline.trim();
            if (seenRaw.has(raw)) continue;
            seenRaw.add(raw);
            const ts = o.timestamp || ctx.ts;
            const rec = buildRecord(raw, { ...ctx, ts });
            if (rec) records.push(rec);
          }
        }
      }
      const { added, skipped, ids } = ingest(ctx.project, records);
      out({ ok: true, transcript: path.basename(tf), project: ctx.project, plan: ctx.plan,
            scanned, candidates, added, skipped, ids }, a.pretty);
    },
  },
  search: {
    summary: 'Cerca nella memoria (BM25 + cue-coverage + RRF). AUTO: usa il motore se UP, altrimenti locale. plan_hash riproducibile.',
    args: ['--query S', '--project S', '--all', '--plan S', '--action S', '--k N', '--engine (forza)', '--local (salta motore)', '--pretty'],
    async run(a) {
      const query = a.query || a._[0];
      if (!query) return out({ ok: false, error: 'manca --query' }, a.pretty);
      const k = Math.max(1, parseInt(a.k, 10) || 8);
      const cwd = a.cwd || process.cwd();
      const filters = {
        project: a.all ? null : (a.project || projectSlug(cwd)),
        plan: a.plan || null,
        action: a.action || null,
      };
      const plan = { semantic: String(query), filters, exclude: [] };
      const plan_hash = planHash(plan);

      // Gating motore: default AUTO -> sonda lo stato; up=delega, giu=locale.
      // --engine forza il motore (no probe). --local salta il motore.
      let mode, engineNote;
      if (a.local) { mode = 'local-forced'; }
      else if (a.engine) { mode = 'engine-forced'; }
      else { const h = await engineUp(); mode = h.up ? 'engine-auto' : 'local-auto-down'; }

      if (mode === 'engine-forced' || mode === 'engine-auto') {
        const eng = await tryEngine(plan, k);
        if (eng.ok) {
          return out({ ok: true, source: 'engine', mode, engine_up: true, plan_hash, engine: eng.url, results: eng.results }, a.pretty);
        }
        // motore atteso up ma search fallita -> fallback locale, riporta perche'.
        engineNote = eng.note; mode = 'local-engine-failed';
      }

      let pool = loadCandidates(filters, cwd);
      pool = pool.filter(r =>
        (!filters.plan || r.plan === filters.plan) &&
        (!filters.action || r.action === filters.action));
      const ranked = rankRecords(query, pool).slice(0, k);
      out({ ok: true, source: 'local', mode, engine_up: mode !== 'local-forced' ? (mode === 'local-auto-down' ? false : undefined) : undefined,
            plan_hash, query: String(query), filters, count: ranked.length, total_pool: pool.length,
            ...(engineNote ? { engine: engineNote } : {}), results: ranked }, a.pretty);
    },
  },
  list: {
    summary: 'Elenca gli ultimi N eventi memorizzati (filtrabili per project/plan/action).',
    args: ['--project S', '--all', '--plan S', '--action S', '--limit N', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)), plan: a.plan || null, action: a.action || null };
      const limit = Math.max(1, parseInt(a.limit, 10) || 20);
      let pool = loadCandidates(filters, cwd)
        .filter(r => (!filters.plan || r.plan === filters.plan) && (!filters.action || r.action === filters.action));
      pool.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      out({ ok: true, count: Math.min(limit, pool.length), total: pool.length,
            results: pool.slice(0, limit).map(r => ({ ts: r.ts, plan: r.plan, action: r.action, raw: r.raw, id: r.id })) }, a.pretty);
    },
  },
  plans: {
    summary: 'Elenca i piani presenti per un progetto, con conteggio eventi e ultimo aggiornamento.',
    args: ['--project S', '--all', '--pretty'],
    run(a) {
      const cwd = a.cwd || process.cwd();
      const filters = { project: a.all ? null : (a.project || projectSlug(cwd)) };
      const pool = loadCandidates(filters, cwd);
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
      const pool = loadCandidates(filters, cwd);
      const byProject = {}, byAction = {};
      for (const r of pool) { byProject[r.project] = (byProject[r.project] || 0) + 1; byAction[r.action] = (byAction[r.action] || 0) + 1; }
      out({ ok: true, root: MEM_ROOT, total: pool.length, byProject, byAction }, a.pretty);
    },
  },

  engine: {
    summary: 'Container Docker (up|down|status) + bridge alla CLI nativa (ingest|search) di knowagebase.',
    args: ['up|down|status|ingest|search', '--user-id S', '--query S', '--project S', '--mem-file P', '--docker', '--all', '--k N', '--dry', '--pretty'],
    run(a) {
      const sub = (a._[0] || 'status').toLowerCase();
      const compose = path.join(KB_ROOT, 'docker-compose.yml');
      const backendDir = path.join(KB_ROOT, 'backend');

      // --- ciclo di vita dei container ---
      if (sub === 'up' || sub === 'down' || sub === 'status') {
        if (!fs.existsSync(compose)) return out({ ok: false, error: `compose non trovato: ${compose}` }, a.pretty);
        const core = a.all ? [] : ['postgres', 'falkordb', 'backend'];
        let args;
        if (sub === 'up') args = ['compose', '-f', compose, 'up', '-d', ...core];
        else if (sub === 'down') args = ['compose', '-f', compose, 'down'];
        else args = ['compose', '-f', compose, 'ps'];
        const cmd = `docker ${args.join(' ')}`;
        if (a.dry) return out({ ok: true, action: sub, dry: true, cmd, compose }, a.pretty);
        try {
          const stdout = execFileSync('docker', args, { encoding: 'utf8', timeout: sub === 'up' ? 180000 : 30000, stdio: ['ignore', 'pipe', 'pipe'] });
          return out({ ok: true, action: sub, cmd, output: String(stdout).trim().split('\n').slice(-20).join('\n') }, a.pretty);
        } catch (e) {
          return out({ ok: false, action: sub, cmd, error: String((e && e.stderr) || (e && e.message) || e).trim() }, a.pretty);
        }
      }

      // --- bridge alla CLI nativa Python (ingest/search) ---
      if (sub === 'ingest' || sub === 'search') {
        if (!a['user-id']) return out({ ok: false, error: 'manca --user-id' }, a.pretty);
        const project = a.project || projectSlug(a.cwd || process.cwd());
        const nat = ['-m', 'scripts.danilov_memory', sub, '--user-id', String(a['user-id'])];
        if (sub === 'ingest') {
          // local: store sull'host; docker: percorso montato dentro al container.
          const store = a['mem-file'] || (a.docker ? `/app/danilov-memory/${project}.jsonl` : storeFile(project));
          nat.push('--mem-file', store);
          if (a['project-name']) nat.push('--project-name', String(a['project-name']));
          if (a.session) nat.push('--session', String(a.session));
        } else {
          if (!a.query) return out({ ok: false, error: 'manca --query' }, a.pretty);
          nat.push('--query', String(a.query));
          if (a.k) nat.push('--top-k', String(a.k));
        }
        const runner = a.docker ? 'docker' : 'python';
        const runnerArgs = a.docker
          ? ['compose', '-f', compose, 'exec', '-T', 'backend', 'python', ...nat]
          : nat;
        const runCwd = a.docker ? undefined : backendDir;
        const cmd = `${runner} ${runnerArgs.join(' ')}`;
        if (a.dry) return out({ ok: true, action: sub, dry: true, via: a.docker ? 'docker' : 'local', cmd, cwd: runCwd || KB_ROOT }, a.pretty);
        try {
          const stdout = execFileSync(runner, runnerArgs, { encoding: 'utf8', timeout: 300000, cwd: runCwd, stdio: ['ignore', 'pipe', 'pipe'] });
          let native; try { native = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { native = { raw: String(stdout).trim() }; }
          return out({ ok: native.ok !== false, action: sub, via: a.docker ? 'docker' : 'local', native }, a.pretty);
        } catch (e) {
          // La CLI nativa esce 1 su ok:false: il suo JSON e' in e.stdout, non in stderr.
          const so = String((e && e.stdout) || '').trim();
          if (so) { try { return out({ ok: false, action: sub, via: a.docker ? 'docker' : 'local', native: JSON.parse(so.split('\n').pop()) }, a.pretty); } catch {} }
          return out({ ok: false, action: sub, cmd, error: String((e && e.stderr) || (e && e.message) || e).trim() }, a.pretty);
        }
      }

      return out({ ok: false, error: `sub sconosciuto: ${sub} (up|down|status|ingest|search)` }, a.pretty);
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
      const pool = loadCandidates(filters, cwd).filter(r =>
        String(r.entity || '').toLowerCase().includes(base) ||
        String(r.raw || '').toLowerCase().includes(base));
      pool.sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      const total = pool.length;
      out({ ok: true, file: String(file), basename: path.basename(String(file)),
            count: Math.min(limit, total), total,
            more: total > limit ? `node ${path.join(__dirname, 'memory.js').replace(/\\/g, '/')} related ${path.basename(String(file))} --limit ${total}` : null,
            results: pool.slice(0, limit).map(r => ({ ts: r.ts, plan: r.plan, action: r.action, raw: r.raw, id: r.id })) }, a.pretty);
    },
  },

  health: {
    summary: 'Dice se il motore di ricerca e\' UP (raggiungibile) o giu\'. Cache TTL 30s, --force per risondare.',
    args: ['--force', '--pretty'],
    async run(a) {
      const h = await engineUp({ force: !!a.force });
      out({ ok: true, up: h.up === true, url: h.url, latency_ms: h.latency_ms,
            cached: h.cached === true, ...(h.status ? { status: h.status } : {}), ...(h.error ? { error: h.error } : {}) }, a.pretty);
    },
  },

  tools: {
    summary: 'Elenca il catalogo dei comandi (CLI-Anything style).',
    args: ['--pretty'],
    run(a) {
      const tools = Object.entries(COMMANDS).map(([name, c]) => ({ name, summary: c.summary, args: c.args }));
      out({ ok: true, catalog: 'danilov-memory', root: MEM_ROOT, tools }, a.pretty);
    },
  },
};

// ---- dispatch ---------------------------------------------------------------

// Dispatch SOLO quando eseguito come CLI: `require()` resta senza side-effect
// (gli hook possono riusare le funzioni pure senza far partire un comando).
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

module.exports = { parseEventLine, buildRecord, ingest, readRecords, projectSlug, recordId, storeFile, MEM_ROOT };
