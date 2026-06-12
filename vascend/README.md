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
| `danilov-goal-audit.js` | Stop | Enforcement sul REGNO: blocca la chiusura del turno finché ogni castello non è conforme; indica la prossima stanza al buio; anti-stallo dopo `DANILOV_MAX_STALL` turni senza stanze nuove in tutto il regno (`0` = persistente, mai rilasciare). |
| `danilov-memory-file.js` | PostToolUse (Read/Edit/Write/MultiEdit) | Fa emergere le memorie Danilov inerenti al file toccato. |
| `danilov-memory-capture.js` | Stop | Cattura le righe-evento dalla chat e le archivia (best-effort). |

### Agenti (`agents/`)

Due subagenti dedicati, col **prompt in notazione Danilov**:

- **`vascend-planner`** — progetta un piano (INDICE/DEFINIZIONI/RELAZIONI) e la
  lista di task one-hot; non esegue. Lancialo in parallelo (uno per macro-task)
  per i piani grandi. Per obiettivi con più workstream propone N castelli
  nominati e le dipendenze tra loro (`--after`).
- **`vascend-executor`** — esegue una stanza (bit) alla volta: fa il lavoro
  reale e marca via script, senza mai toccare il file del goal a mano.

Il comando `/vascend` delega la progettazione a `vascend-planner` e l'esecuzione
a `vascend-executor`.

### Script (`scripts/danilov/`)

Motore deterministico, riusato identico da hook e CLI così non possono
divergere sul verdetto:

- `core.js` — verdetto deterministico (deriveState dalla Trace firmata, validate).
- `crypto.js` — firma HMAC a catena delle righe di Trace.
- `session.js` — risoluzione di sessione e dei path di **stato** (vedi sotto): master, castelli nominati, figli ricorsivi.
- `kingdom.js` — vista aggregata del **regno** (tutti i castelli della sessione): verdetto aggregato, prossima stanza al buio.
- `scaffold.js` — unica fabbrica dello scheletro markdown dei piani (plan/castle/subplan: nessun drift di forma).
- `ui.js` — rendering delle card nei messaggi degli hook.
- `plan.js` / `mark.js` / `validate.js` — CLI: crea il piano (accetta `@dep:T01,T02` per le dipendenze), accende un bit (`--dry` anteprima, `--note "<t>"` annota, `--check "<cmd>"` gate di verifica, `--force` bypassa dipendenze e gate After), emette il verdetto (`--deep` figli ricorsivi + coerenza roll-up, `--kingdom` tutti i castelli).
- `castle.js` — **castelli multipli**: `new <slug> … [--after <slug>]`, `list`, `map`, `next` (prossima stanza al buio del regno), `drop`.
- `unmark.js` — annulla una marcatura sbagliata: appende una riga `UNDO` firmata che spegne il bit (append-only, tracciato).
- `resume.js` — riprende un REGNO aperto di un'altra sessione: `--list`, anteprima, `--attach` (riporta master + castelli + sotto-piani sulla sessione corrente).
- `mode.js` — interruttore della modalità (`on`/`off`/`status`): scrive il flag sticky in modo deterministico; lo invoca il comando `/vascend on|off`. `off` spegne l'intero regno.
- `subplan.js` — crea un sotto-piano di micro-task per un task di QUALSIASI piano (master, castello o altro sub): gerarchia ricorsiva senza fondo.
- `status.js` — vista dello stato (`--pretty` albero ricorsivo, `--todo` JSON per la todo nativa, `--all` l'intero regno).
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

### Castelli multipli — il regno

Un obiettivo grande non è un castello più grosso: è **più castelli**. Il
master (`plan.js`) è il castello di default; con `castle.js` se ne alzano
quanti servono (illimitati) — il loro insieme è il **regno** della sessione.
Lo Stop hook fa enforcement sul regno intero: il turno si chiude solo quando
**ogni** castello è illuminato.

```
node scripts/danilov/castle.js new api "Refactor API" "T01: ..." "T02: ..."
node scripts/danilov/castle.js new deploy "Deploy" "T01: ..." --after api   # DAG tra castelli
node scripts/danilov/castle.js list        # radici del regno + verdetti
node scripts/danilov/castle.js map         # mappa completa (castelli → macro → micro)
node scripts/danilov/castle.js next        # prossima stanza al buio del regno
node scripts/danilov/validate.js --kingdom # verdetto aggregato: TRUE sse tutti illuminati
node scripts/danilov/status.js --all --pretty
```

`--after <slug>` mette i castelli in DAG: `mark.js` nega ogni stanza del
castello finché il prerequisito non è conforme (prima le fondamenta, poi la
torre). `castle.js drop <slug>` demolisce un castello coi suoi sotto-piani.

### Piani gerarchici (macro → micro, profondità ricorsiva)

Dentro ogni castello i task sono su livelli: ogni task può avere un
**sotto-piano**, e ogni micro a sua volta il suo — **ricorsivo senza fondo**.
Il tetto di 30 bit vale per il singolo piano: la scala viene dalla
composizione (n castelli × profondità), quindi i task possono essere
infiniti. Un bit con figlio si illumina SOLO quando il figlio è conforme —
il **roll-up** è garantito da `mark.js` livello per livello, non dall'agente.

```
node scripts/danilov/subplan.js <macroBit> "<titolo>" "t01: micro" ...          # padre = master
node scripts/danilov/subplan.js <padre.md> <bit> "<titolo>" "t01: micro" ...    # padre = castello o sub
node scripts/danilov/mark.js <sub.md> <microBit> OK   # accende un micro
node scripts/danilov/mark.js <padre.md> <bit> OK      # accende il padre (rifiutato se il figlio non è completo)
node scripts/danilov/status.js --pretty               # albero ricorsivo
node scripts/danilov/validate.js --deep               # piano + figli ricorsivi + coerenza roll-up
```

La relazione padre↔figlio è implicita nel naming (`<base>.sub<bit>.md`):
nessuna modifica al padre, nessuna violazione del protect hook. I task senza
sotto-piano restano atomici (comportamento invariato). Rigenerare un piano
(`plan.js`, `castle.js new`, `subplan.js`) **invalida e rimuove** i SUOI
discendenti, così non si riagganciano per naming ai nuovi bit; i castelli
nominati sono indipendenti e non vengono toccati da `plan.js`. Il comando
`/vascend` può delegare la progettazione dei sotto-piani a più sotto-agenti
in parallelo, poi seguirli con `mark.js`/`status.js`.

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
  (master; i castelli nominati accanto: `<session_id>.castle-<slug>.md`,
  i sotto-piani ricorsivi: `<base>.sub<bit>.md` — co-locati con i transcript,
  ripresi dal resume, isolati per sessione)

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
