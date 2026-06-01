// Core dati: lettura dei file .vascend e costruzione del grafo node-link.
// Mirror in TypeScript di scripts/danilov/memory.js (readRecords + graph), ma
// orientato alla lettura di un'intera cartella di store .vascend. Zero
// dipendenze esterne: solo i moduli Node integrati (fs, path, crypto, os).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

// Azioni della voce Danilov (apertura di una riga-evento v2).
export const ACTIONS = [
  'read', 'find', 'plan', 'edit', 'new', 'fix',
  'error', 'run', 'test', 'warn', 'skip', 'next',
] as const;

export type Action = (typeof ACTIONS)[number];

export interface ParsedEvent {
  action: string;
  entity: string;
  target: string;
  note: string;
}

export interface VascendRecord {
  id: string;
  ts: string;
  project: string;
  plan: string;
  action: string;
  entity: string;
  target: string;
  note: string;
  raw: string;
}

export interface GraphNode {
  id: string;
  label: string;
  count: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  action: string;
  plan: string;
  ts: string;
  note?: string;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { nodes: number; edges: number };
}

export interface ProjectInfo {
  project: string;
  file: string;
  events: number;
  plans: number;
  last: string;
}

const SEP = ' · '; // " · "
const V1_RE = /^@(\w+)\s*:\s*(.+?)\s*(?:→|->)\s*(.+?)\s*(?:\[\s*(.*?)\s*\])?\s*$/;

// Cartella di default degli store .vascend.
export function defaultMemoryDir(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, '.danilov-state', 'memory');
}

// Riga-evento -> ParsedEvent, o null.
//  v1 (retrocompat): @azione: entity -> target [nota]
//  v2 (voce attuale): azione entity[>target] [| nota]
export function parseEventLine(line: string): ParsedEvent | null {
  const s = String(line).trim();
  const m1 = V1_RE.exec(s);
  if (m1) {
    return {
      action: m1[1].toLowerCase(),
      entity: m1[2].trim(),
      target: m1[3].trim(),
      note: (m1[4] || '').trim(),
    };
  }
  const m2 = s.match(/^(\w+)\s+(.+)$/);
  if (!m2) {
    return null;
  }
  const action = m2[1].toLowerCase();
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return null; // solo azioni note
  }
  let rest = m2[2];
  if (!/[>|]/.test(rest)) {
    return null; // serve un marcatore di relazione
  }
  let note = '';
  const pipe = rest.indexOf('|');
  if (pipe >= 0) {
    note = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe).trim();
  }
  let entity = rest;
  let target = '';
  const gt = rest.indexOf('>');
  if (gt >= 0) {
    entity = rest.slice(0, gt).trim();
    target = rest.slice(gt + 1).trim();
  }
  if (!entity) {
    return null;
  }
  return { action, entity, target, note };
}

// raw canonico = riga-relazione v2.
export function toRelation(p: ParsedEvent): string {
  return `${p.action} ${p.entity}${p.target ? `>${p.target}` : ''}${p.note ? ` | ${p.note}` : ''}`;
}

export function recordId(project: string, plan: string, raw: string): string {
  return crypto.createHash('sha1').update(`${project}|${plan}|${raw}`).digest('hex').slice(0, 16);
}

function projectOfFile(file: string): string {
  return path.basename(file).replace(/\.vascend$/i, '');
}

// Legge un singolo file .vascend in una lista di record.
export function readRecordsFromFile(file: string): VascendRecord[] {
  if (!fs.existsSync(file)) {
    return [];
  }
  const project = projectOfFile(file);
  const out: VascendRecord[] = [];
  let plan = '(senza piano)';
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      continue;
    }
    const ph = t.match(/^@plan\[(.*)\]$/);
    if (ph) {
      plan = ph[1] || '(senza piano)';
      continue;
    }
    const i = t.indexOf(SEP);
    if (i < 0) {
      continue;
    }
    const ts = t.slice(0, i).trim();
    const raw = t.slice(i + SEP.length).trim();
    const p = parseEventLine(raw);
    if (!p) {
      continue;
    }
    out.push({
      id: recordId(project, plan, raw),
      ts,
      project,
      plan,
      action: p.action,
      entity: p.entity,
      target: p.target,
      note: p.note,
      raw,
    });
  }
  return out;
}

// Elenca i file .vascend presenti nella cartella.
export function listVascendFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.toLowerCase().endsWith('.vascend'))
    .map((f) => path.join(dir, f));
}

// Riepilogo dei progetti (un file = un progetto).
export function listProjects(dir: string): ProjectInfo[] {
  const out: ProjectInfo[] = [];
  for (const file of listVascendFiles(dir)) {
    const recs = readRecordsFromFile(file);
    const plans = new Set(recs.map((r) => r.plan));
    let last = '';
    for (const r of recs) {
      if (String(r.ts) > last) {
        last = r.ts;
      }
    }
    out.push({
      project: projectOfFile(file),
      file,
      events: recs.length,
      plans: plans.size,
      last,
    });
  }
  out.sort((a, b) => String(b.last).localeCompare(String(a.last)));
  return out;
}

// Carica tutti i record dell'intera cartella.
export function loadAll(dir: string): VascendRecord[] {
  const out: VascendRecord[] = [];
  for (const file of listVascendFiles(dir)) {
    out.push(...readRecordsFromFile(file));
  }
  return out;
}

export interface Filters {
  project?: string | null;
  plan?: string | null;
  action?: string | null;
}

export function filterRecords(records: VascendRecord[], f: Filters): VascendRecord[] {
  return records.filter(
    (r) =>
      (!f.project || r.project === f.project) &&
      (!f.plan || r.plan === f.plan) &&
      (!f.action || r.action === f.action),
  );
}

export function plansOf(records: VascendRecord[]): string[] {
  return [...new Set(records.map((r) => r.plan))].sort();
}

export function actionsOf(records: VascendRecord[]): string[] {
  return [...new Set(records.map((r) => r.action))].sort();
}

// Costruisce il grafo node-link dai record. Nodo = entity/target, arco = azione.
export function buildGraph(records: VascendRecord[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const touch = (label: string): void => {
    if (!label) {
      return;
    }
    const n = nodes.get(label) || { id: label, label, count: 0 };
    n.count++;
    nodes.set(label, n);
  };
  const edges: GraphEdge[] = [];
  for (const r of records) {
    touch(r.entity);
    if (r.target) {
      touch(r.target);
      edges.push({
        source: r.entity,
        target: r.target,
        action: r.action,
        plan: r.plan,
        ts: r.ts,
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }
  return {
    nodes: [...nodes.values()],
    edges,
    stats: { nodes: nodes.size, edges: edges.length },
  };
}
