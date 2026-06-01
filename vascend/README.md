# Vascend — plugin per Claude Code (metodo Danilov)

**Vascend** pacchettizza il **metodo Danilov** come plugin Claude Code: una
skill, tre comandi (`/vascend`, `/vascend-clear`, `/vascend-compact`), cinque
hook e un motore di stato a **zero dipendenze** (solo i moduli built-in di Node).

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
/plugin install vascend@vascend-official-plugins
```

## Componenti

### Skill

- **`danilov-prompt`** — costruisce prompt strutturati e applica la modalità
  DanilovGoal. Si attiva da sola sui trigger del metodo, oppure via `/vascend`.
  In `references/`: esempi completi e l'eval sull'encoding invisibile.

### Comandi

| Comando | Effetto |
|---|---|
| `/vascend on` (o senza argomento) | Attiva la **modalità sticky**: da lì ogni prompt è un obiettivo Danilov, senza riscrivere il comando. |
| `/vascend off` | Spegne la modalità sticky (enforcement + goal). |
| `/vascend <obiettivo>` | Esegue un goal **one-shot** sull'obiettivo: skill + piano + trace + audit deterministico. |
| `/vascend-clear` | Equivale a `/vascend off`. |
| `/vascend-compact` | Compatta la conversazione in un checkpoint in notazione Danilov (non in prosa), lo salva in `.vascend-compact.md`, poi invita a `/clear` per ripartire pulito. |

### Modalità sticky (on/off)

`/vascend on` mette la sessione in modalità Vascend **persistente**: ogni
messaggio successivo viene trattato come un obiettivo (pianificato con `plan.js`,
tracciato, validato) senza dover ripetere il comando. La modalità sopravvive al
completamento di un obiettivo (a goal conforme lo Stop hook azzera il tracking ma
mantiene il flag) e anche a uno stallo; si spegne solo con `/vascend off`,
`/vascend-clear` o "annulla vascend". Il flag di sessione porta `sticky:true` in
`~/.claude/.danilov-state/<sid>.json`.

### Hook

| Hook | Evento | Ruolo |
|---|---|---|
| `vascend-resume.js` | SessionStart | Fa emergere un goal aperto di un'altra sessione (resume cross-sessione); nudge solo se la sessione corrente non ne ha uno. |
| `danilov-trigger.js` | UserPromptSubmit | Rileva `/vascend` o le keyword del metodo; alza il flag di sessione e crea lo scheletro del goal. |
| `danilov-protect.js` | PreToolUse (Edit/Write/MultiEdit) | Nega le modifiche manuali ai file `DanilovGoal/` (anti-manomissione). |
| `danilov-goal-audit.js` | Stop | Enforcement: blocca la chiusura del turno finché il goal non è conforme; anti-stallo dopo `DANILOV_MAX_STALL` turni (`0` = persistente, mai rilasciare). |
| `danilov-memory-file.js` | PostToolUse (Read/Edit/Write/MultiEdit) | Fa emergere le memorie Danilov inerenti al file toccato. |
| `danilov-memory-capture.js` | Stop | Cattura le righe-evento dalla chat e le archivia (best-effort). |

### Agenti (`agents/`)

Due subagenti dedicati, col **prompt in notazione Danilov**:

- **`vascend-planner`** — progetta un piano (INDICE/DEFINIZIONI/RELAZIONI) e la
  lista di task one-hot; non esegue. Lancialo in parallelo (uno per macro-task)
  per i piani grandi.
- **`vascend-executor`** — esegue una stanza (bit) alla volta: fa il lavoro
  reale e marca via script, senza mai toccare il file del goal a mano.

Il comando `/vascend` delega la progettazione a `vascend-planner` e l'esecuzione
a `vascend-executor`.

### Script (`scripts/danilov/`)

Motore deterministico, riusato identico da hook e CLI così non possono
divergere sul verdetto:

- `core.js` — verdetto deterministico (deriveState dalla Trace firmata, validate).
- `crypto.js` — firma HMAC a catena delle righe di Trace.
- `session.js` — risoluzione di sessione e dei path di **stato** (vedi sotto).
- `ui.js` — rendering delle card nei messaggi degli hook.
- `plan.js` / `mark.js` / `validate.js` — CLI: crea il piano (accetta `@dep:T01,T02` per le dipendenze), accende un bit (`--dry` anteprima, `--note "<t>"` annota, `--check "<cmd>"` gate di verifica, `--force` bypassa le dipendenze), emette il verdetto (`--deep` valida anche i sotto-piani).
- `unmark.js` — annulla una marcatura sbagliata: appende una riga `UNDO` firmata che spegne il bit (append-only, tracciato).
- `resume.js` — riprende un DanilovGoal aperto di un'altra sessione: `--list`, anteprima, `--attach` (lo riporta sulla sessione corrente, coi sotto-piani).
- `mode.js` — interruttore della modalità (`on`/`off`/`status`): scrive il flag sticky in modo deterministico; lo invoca il comando `/vascend on|off`.
- `subplan.js` — crea un sotto-piano di micro-task legato a un macro-task del master.
- `status.js` — vista dello stato del goal (`--pretty` albero macro/micro, `--todo` JSON per la todo nativa).
- `memory.js` — catalogo di memoria persistente (ricerca BM25 + RRF, offline).
- `*.selftest.js` — test del core, della memoria e della UI.

### Todo list nativa

Durante un `/vascend`, gli obiettivi del goal vengono specchiati nella **todo
list nativa** dell'harness (TaskCreate/TodoWrite): un task per ogni stanza, con
lo stato derivato dalla Trace firmata (`completed` per i bit accesi, la prima
stanza al buio `in_progress`, le altre `pending`). La fonte è deterministica:

```
node scripts/danilov/status.js --todo     # {todos:[{content,status,activeForm}]}
node scripts/danilov/status.js --pretty    # checklist [x]/[ ] per la chat
```

Così, oltre al castello in notazione Danilov, l'utente vede tutti gli obiettivi
e il loro avanzamento nella UI nativa.

### Piani gerarchici (macro-task → micro-task)

Per obiettivi grossi un piano piatto non basta. Il **master** contiene i
**macro-task**; ogni macro-task può avere un **sotto-piano** di **micro-task**.
Un macro-task si illumina SOLO quando il suo sotto-piano è conforme — il
**roll-up** è garantito da `mark.js`, non dall'agente.

```
node scripts/danilov/subplan.js <macroBit> "<titolo>" "t01: micro" "t02: micro" ...
node scripts/danilov/mark.js <sub.md> <microBit> OK   # accende un micro
node scripts/danilov/mark.js <macroBit> OK            # accende il macro (rifiutato se il sub non è completo)
node scripts/danilov/status.js --pretty               # albero macro → micro
node scripts/danilov/validate.js --deep               # master + ogni sub + coerenza roll-up
```

La relazione master↔sub è implicita nel naming (`<sid>.sub<macroBit>.md`
accanto al master): nessuna modifica al master, nessuna violazione del protect
hook. I macro-task senza sotto-piano restano atomici (comportamento invariato).
Rigenerare il master con `plan.js` **invalida e rimuove** i sotto-piani della
sessione precedente, così non si riagganciano per naming ai nuovi macro-bit.
Il comando `/vascend` può delegare la progettazione dei sotto-piani a più
sotto-agenti in parallelo, poi seguirli con `mark.js`/`status.js`.

### Annullare e confermare (contro gli errori di marcatura)

Capita di marcare il task sbagliato — o di lanciare `mark.js` dal **cwd
sbagliato** (il goal si risolve da `process.cwd()`). Due rimedi:

```
node scripts/danilov/mark.js <bit> OK --dry   # ANTEPRIMA: mostra goal+cwd+task, non scrive
node scripts/danilov/unmark.js <bit>          # ANNULLA: riga UNDO firmata che spegne il bit
```

- `--dry` stampa `goal: <file> "<titolo>" · cwd: <…>` e la transizione di
  stato senza toccare nulla: confermi che goal e cwd siano quelli giusti
  **prima** di marcare. Anche il `mark.js` reale stampa sempre `goal`/`cwd`.
- `unmark.js` non cancella righe (romperebbe la catena HMAC): appende una riga
  `UNDO` firmata che in `deriveState` spegne il bit. L'annullamento resta
  tracciato e a prova di manomissione; `validate.js` ricalcola lo stato reale
  dalla Trace comprese le righe `UNDO`.

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
