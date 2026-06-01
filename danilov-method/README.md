# Danilov Method — plugin per Claude Code

Il **metodo Danilov** pacchettizzato come plugin Claude Code: una skill, tre
comandi, cinque hook e un motore di stato a **zero dipendenze** (solo i moduli
built-in di Node).

Due livelli, un'unica notazione:

1. **Prompt strutturati** — `INDICE / DEFINIZIONI / RELAZIONI` in notazione
   numerica compatta. Separa i tre piani (i concetti nudi, le istanze con le
   loro proprietà, i legami) invece di mescolarli in prosa. Output più fedele
   dove i valori contano: diagrammi Mermaid, prompt di generazione immagini,
   configurazioni, piani.
2. **DanilovGoal** — esecuzione tracciata a **bit one-hot**. Ogni task è un
   bit; lo si accende solo eseguendo `mark.js`, che appende una riga di Trace
   **firmata HMAC a catena**. Il verdetto (`validate() == (state == MASK_TARGET)`)
   lo calcola lo script dai dati firmati, **mai l'agente**: è matematica, non
   un'asserzione. Le righe scritte a mano non hanno firma valida e vengono
   rifiutate — la Trace è tamper-evident.

## Installazione

Dal marketplace ufficiale Vascend:

```
/plugin marketplace add VascendTechnologies/Vascend-Official-Plugins
/plugin install danilov-method@vascend-official-plugins
```

## Componenti

### Skill

- **`danilov-prompt`** — costruisce prompt strutturati e applica la modalità
  DanilovGoal. Si attiva da sola sui trigger del metodo, oppure via `/danilov`.
  In `references/`: esempi completi e l'eval sull'encoding invisibile.

### Comandi

| Comando | Effetto |
|---|---|
| `/danilov <obiettivo>` | Attiva tutto il metodo sull'obiettivo: skill + piano + trace + audit deterministico. |
| `/danilov-clear` | Disattiva la modalità DanilovGoal per la sessione (spegne l'enforcement). |
| `/danilov-compact` | Compatta la conversazione in un checkpoint in notazione Danilov (non in prosa). |

### Hook

| Hook | Evento | Ruolo |
|---|---|---|
| `danilov-trigger.js` | UserPromptSubmit | Rileva `/danilov` o le keyword del metodo; alza il flag di sessione e crea lo scheletro del goal. |
| `danilov-protect.js` | PreToolUse (Edit/Write/MultiEdit) | Nega le modifiche manuali ai file `DanilovGoal/` (anti-manomissione). |
| `danilov-goal-audit.js` | Stop | Enforcement: blocca la chiusura del turno finché il goal non è conforme; anti-stallo dopo N turni. |
| `danilov-memory-file.js` | PostToolUse (Read/Edit/Write/MultiEdit) | Fa emergere le memorie Danilov inerenti al file toccato. |
| `danilov-memory-capture.js` | Stop | Cattura le righe-evento dalla chat e le archivia (best-effort). |

### Script (`scripts/danilov/`)

Motore deterministico, riusato identico da hook e CLI così non possono
divergere sul verdetto:

- `core.js` — verdetto deterministico (deriveState dalla Trace firmata, validate).
- `crypto.js` — firma HMAC a catena delle righe di Trace.
- `session.js` — risoluzione di sessione e dei path di **stato** (vedi sotto).
- `ui.js` — rendering delle card nei messaggi degli hook.
- `plan.js` / `mark.js` / `validate.js` — CLI: crea il piano, accende un bit, emette il verdetto.
- `memory.js` — catalogo di memoria persistente (ricerca BM25 + RRF, offline).
- `*.selftest.js` — test del core, della memoria e della UI.

## Architettura: codice nel plugin, stato in `~/.claude`

Il plugin porta solo il **codice**. Lo **stato runtime** resta per-utente e
per-progetto, fuori dal plugin:

- Flag di sessione e chiave HMAC: `~/.claude/.danilov-state/`
- File del goal: `~/.claude/projects/<cwd-encoded>/DanilovGoal/<session_id>.md`
  (co-locato con i transcript, ripreso dal resume, isolato per sessione)

Gli hook risolvono gli script via `__dirname` (dentro il plugin) e lo stato via
`CLAUDE_CONFIG_DIR`/`~/.claude`. Override possibile con `CLAUDE_CONFIG_DIR`.

## Memoria persistente (opzionale)

`memory.js` e i due hook di memoria funzionano **offline** a zero dipendenze:
archiviano le righe-evento in JSONL ricercabili. L'integrazione con un motore
esterno (knowagebase/Animus via Docker) è del tutto **opzionale** e best-effort
— senza, il sistema degrada a memoria locale o no-op senza mai fallire né
bloccare. Configurabile via env:

| Env | Default | Scopo |
|---|---|---|
| `DANILOV_KB_ROOT` | `~/Desktop/knowagebase_gobid` | Radice del motore knowagebase. |
| `DANILOV_MEM_ROOT` | `<KB_ROOT>/danilov-memory` | Storage locale dei record. |
| `DANILOV_ENGINE_TOKEN` | — | JWT per il mirroring nel motore (solo se presente). |
| `DANILOV_AUTO_ENGINE` | `1` | `0` per non risvegliare il motore in background. |

## Test

```
node scripts/danilov/selftest.js
node scripts/danilov/memory.selftest.js
node scripts/danilov/ui.selftest.js
```

## Licenza

MIT.
