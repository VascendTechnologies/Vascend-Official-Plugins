// Firma HMAC a catena per le righe di Trace DanilovGoal.
// Solo mark.js (che firma con la chiave locale) puo' produrre righe valide:
// righe scritte a mano dall'agente (Edit/echo) non hanno firma corretta e
// vengono rifiutate dal validatore -> la Trace e' tamper-evident.
// La catena (prevSig nel calcolo) impedisce anche riordino/inserimento.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const KEYFILE = path.join(
  process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
  '.danilov-state',
  '.hmackey'
);

// Chiave locale persistente (generata una volta). Non e' segreto crittografico
// forte contro l'agente stesso, ma rende impossibile firmare righe "per caso":
// solo chi esegue mark.js produce firme valide.
function getKey() {
  try {
    if (fs.existsSync(KEYFILE)) return fs.readFileSync(KEYFILE);
  } catch {}
  const k = crypto.randomBytes(32);
  try {
    fs.mkdirSync(path.dirname(KEYFILE), { recursive: true });
    fs.writeFileSync(KEYFILE, k, { mode: 0o600 });
  } catch {}
  return k;
}

// Firma deterministica di una riga, concatenata alla precedente.
// I campi sono le STRINGHE esatte scritte nella tabella (no riformattazione),
// cosi' firma in scrittura (mark.js) e verifica (core.js) combaciano sempre.
function signRow(prevSig, bit, mask, pre, post, esito) {
  return crypto
    .createHmac('sha256', getKey())
    .update(`${prevSig}|${bit}|${mask}|${pre}|${post}|${esito}`)
    .digest('hex')
    .slice(0, 16);
}

module.exports = { signRow, getKey };
