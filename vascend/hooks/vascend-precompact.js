#!/usr/bin/env node
// PreCompact Hook (manual + auto): un attimo prima che l'harness comprima il
// contesto, scatta una FOTO DETERMINISTICA del regno (stato castelli, stanze
// al buio, prossima stanza, comandi per riprendere) e la fissa in
// <cwd>/.vascend-compact.md. Zero LLM, zero token: e' kingdom.js che legge la
// Trace firmata. Cosi' la compattazione non puo' perdere il filo del goal —
// qualunque cosa il summary dimentichi, il checkpoint la conserva.
//
// Il rientro lo fa vascend-resume.js su SessionStart(source=compact): reinietta
// la card del regno nel contesto appena compattato. PreCompact non puo'
// aggiungere contesto (solo SessionStart puo'), ma puo' scrivere file: questa
// e' la meta' "salva"; quella e' la meta' "ripristina".
//
// Convivenza col checkpoint MANUALE (/vascend-compact, scritto dall'agente):
// la foto vive in un blocco delimitato in coda al file, sostituito a ogni
// compattazione; il contenuto scritto a mano sopra resta intatto.

const fs = require('fs');
const path = require('path');

const DANILOV = path.join(__dirname, '..', 'scripts', 'danilov');
const { currentSessionId } = require(path.join(DANILOV, 'session.js'));
const { kingdomVerdict, nextRoom, rootLabel } = require(path.join(DANILOV, 'kingdom.js'));

const BLOCK_OPEN = '<!-- vascend:regno:auto -->';
const BLOCK_CLOSE = '<!-- /vascend:regno:auto -->';

let input = '';
const timeout = setTimeout(() => process.exit(0), 4000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(timeout);
  try {
    const data = JSON.parse(input || '{}');
    const sid = String(currentSessionId(data.session_id) || 'default');
    const cwd = data.cwd || process.cwd();
    const trigger = data.trigger || '?';

    const k = kingdomVerdict(cwd, sid);
    if (!k.exists) process.exit(0); // niente regno -> niente da fotografare

    const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const lines = [BLOCK_OPEN];
    lines.push(`## Regno (foto automatica PreCompact ${trigger} · ${ts})`);
    lines.push('');
    lines.push(`@regno: castelli=${k.roots.length}, stanze=${k.popcount}, validate=${k.conforme ? 'TRUE' : 'FALSE'}`);
    for (const r of k.roots) {
      const dark = (r.v.missingTasks || []).map(t => t.task).join(',');
      lines.push(`@stato[${r.kind === 'castle' ? r.slug : 'master'}]: "${r.title}" ${r.v.popcount}${r.after ? ` after=${r.after}` : ''}${dark ? ` al_buio=${dark}` : ' ILLUMINATO'}`);
    }
    const next = nextRoom(cwd, sid);
    if (next) {
      lines.push(`@prossima: ${next.task} ${next.mask} in ${next.trail.join(' > ')}`);
      lines.push(`@riprendi: node <plugin>/scripts/danilov/mark.js ${next.file.replace(/\\/g, '/')} ${next.bit} OK (dopo il lavoro reale)`);
    }
    lines.push('@vista: castle.js map · status.js --all --pretty · validate.js --kingdom');
    lines.push(BLOCK_CLOSE);
    const block = lines.join('\n');

    // Sostituisce il blocco auto se gia' presente, preserva il resto del file.
    const ckFile = path.join(cwd, '.vascend-compact.md');
    let cur = '';
    try { cur = fs.readFileSync(ckFile, 'utf8'); } catch {}
    const re = new RegExp(`${BLOCK_OPEN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${BLOCK_CLOSE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const out = re.test(cur)
      ? cur.replace(re, block)
      : (cur.trim() ? cur.replace(/\s*$/, '\n\n') + block + '\n' : block + '\n');
    fs.writeFileSync(ckFile, out, 'utf8');

    console.log(`[Vascend] foto del regno (${k.popcount}) fissata in .vascend-compact.md prima della compattazione (${trigger}).`);
  } catch {}
  process.exit(0);
});
