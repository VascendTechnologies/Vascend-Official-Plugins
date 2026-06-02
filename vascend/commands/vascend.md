---
description: Interruttore Vascend (metodo Danilov). `/vascend on` (o senza argomento) attiva la modalita' STICKY (ogni prompt diventa un obiettivo Danilov); `/vascend off` la spegne; `/vascend <obiettivo>` esegue un goal one-shot col metodo (bit one-hot + trace firmata + audit deterministico).
argument-hint: "on | off | <obiettivo>"
---

# Comando /vascend

`/vascend` è un **interruttore** del metodo Danilov, più una scorciatoia per un
obiettivo singolo.

## on / off / obiettivo — cosa fa `$ARGUMENTS`

`$ARGUMENTS` decide il comportamento. **`on`/`off` sono toggle ISTANTANEI**
(come `/effort`): li gestisce direttamente l'hook `danilov-trigger.js`
(UserPromptSubmit), che intercetta il comando, alza/abbassa il flag di sessione
e **blocca il prompt** (`decision:block`) prima ancora che il modello sia
invocato. In quel caso questa markdown non viene nemmeno espansa: vedi solo la
conferma in chat. I passi `mode.js` qui sotto restano come **fallback** (se gli
hook sono disattivati o, in rari casi, arriva a te l'espansione invece di
`/vascend on`):

- **`on`** (oppure argomento **vuoto**): attiva la **modalità STICKY**. Fallback:
  ```
  node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mode.js on
  ```
  Poi conferma che da ora **ogni** prompt è un obiettivo Danilov (pianificato,
  tracciato, validato) senza riscrivere il comando; per spegnere `/vascend off`.
  **NON pianificare nulla, NON creare goal: fermati qui.**
- **`off`**: spegni la modalità. Fallback:
  ```
  node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mode.js off
  ```
  Conferma e **fermati qui**.
- **qualsiasi altro testo** = **obiettivo one-shot**: è la richiesta da eseguire
  col metodo, adesso, seguendo i passi qui sotto.

Quando in modalità sticky arriva un prompt normale (non un comando), l'hook
inietta da sé le istruzioni del metodo: applica gli stessi passi qui sotto
trattando quel prompt come obiettivo.

Attiva **tutto** il metodo Danilov in un colpo solo sull'obiettivo.

## File del goal — nello storage di sessione

Il DanilovGoal vive dentro lo storage della sessione del progetto, accanto
ai transcript che il `resume` richiama:

```
~/.claude/projects/<cwd-encoded>/DanilovGoal/<session_id>.md
```

È per-conversazione e per-progetto, stabile anche per i subagenti. Gli
script `plan.js`, `mark.js`, `validate.js` ricavano da soli questo path
(non serve passarlo): lanciali senza argomento di file.

## Esecuzione

L'obiettivo e':

> $ARGUMENTS

Procedi adesso, in quest'ordine, SENZA chiedere conferma.

**Prima di tutto — riprendi il checkpoint se esiste.** Se in `<cwd>` c'è un
file `.vascend-compact.md` (lasciato da un `/vascend-compact` precedente),
leggilo PRIMA di pianificare: è la foto compatta dello stato. Riparti da lì
— gli `@aperto` sono i thread da continuare, gli `@stato` le decisioni da
non perdere. Incorpora quel contesto nel nuovo piano. Se non esiste, parti
da zero.

**REGOLA ANTI-MANOMISSIONE:** NON usare MAI Edit/Write/MultiEdit sui file
in `DanilovGoal/` (un hook li nega). Il file si tocca SOLO tramite gli
script `plan.js`, `mark.js`, `validate.js`. Le righe di Trace sono firmate
(HMAC): righe scritte a mano vengono rifiutate dal validatore.

1. Invoca il tool **Skill** con `skill: "danilov-prompt"`.
2. Costruisci il piano (INDICE/DEFINIZIONI/RELAZIONI, bit one-hot) e
   **scrivilo eseguendo plan.js** (un task per bit, in ordine):
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/plan.js "<titolo>" "T01: ..." "T02: ..." ...
   ```
   plan.js calcola `MASK_TARGET`, crea le 4 sezioni e l'intestazione Trace.
3. **Specchia il piano nella todo list nativa** — così l'utente vede tutti gli
   obiettivi e il loro avanzamento. Ricava la lista pronta eseguendo:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/status.js --todo
   ```
   restituisce `{todos:[{content,status,activeForm}]}` con lo stato derivato
   dalla Trace firmata (la prima stanza al buio è `in_progress`, le altre
   `pending`). Crea un task nativo per ogni T0k, **nello stesso ordine di
   bit**, con il tool todo nativo dell'harness — **TaskCreate** (o `TodoWrite`
   nelle build che lo usano).
4. Esegui i task UNO ALLA VOLTA, in ordine di bit crescente. Per ogni task:
   a. annuncia `partito T<nn> 0x<MASK>` (mask = `1 << (nn-1)`);
   b. esegui l'azione reale;
   c. **conferma PRIMA di marcare** (anteprima, non scrive) — serve a non
      marcare il task o il goal sbagliato:
      ```
      node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mark.js <bit> OK --dry
      ```
      Mostra `goal: <file> "<titolo>" · cwd: <…>`, il task e la transizione.
      **Verifica che `goal` e `cwd` siano quelli giusti.** Se il goal/cwd è
      sbagliato NON marcare: correggi il cwd (gli script risolvono il goal da
      `process.cwd()` — lancia SEMPRE dalla stessa cartella del `plan.js`).
   d. **marca il completamento ESEGUENDO** (mai a mano):
      ```
      node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mark.js <bit> OK
      ```
      (`FAIL` se non riuscita). Incolla l'output `completato T<nn> ...`.
      mark.js stampa sempre `goal`/`cwd`: ricontrollali anche dopo.
   e. **se hai marcato per sbaglio** (task errato, o cwd/goal sbagliato),
      annulla — niente Edit a mano, una riga `UNDO` firmata spegne il bit:
      ```
      node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/unmark.js <bit>
      ```
      poi rifai col bit/goal giusti. L'annullamento resta tracciato.
   f. **aggiorna la todo nativa**: porta il task appena chiuso a `completed`
      (**TaskUpdate**) e il successivo a `in_progress`. In dubbio sullo stato,
      ri-esegui `status.js --todo` e riallinea la todo a quella verità.
   UNA chiamata = UN bit: vietato saltare task o marcarne piu' insieme.
5. **NON dichiarare tu il verdetto.** Finiti i task, esegui:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/validate.js
   ```
   Calcola `validate(state) == (state == MASK_TARGET)` dalla Trace FIRMATA.
   Se FALSE, elenca i task da ricontrollare; se segnala MANOMISSIONE, la
   Trace e' stata alterata fuori da mark.js. Incolla l'output cosi' com'e'.
   Se restano task in `missing`/FAIL, rifai l'azione + `mark.js` e ri-valida.
   A castello illuminato, porta tutti i task nativi a `completed`.

## Piani gerarchici (macro-task con sotto-piani di micro-task)

Per obiettivi grossi, un piano piatto non basta: usa **due livelli**. Il
master contiene i **macro-task** (i suoi bit); ogni macro-task può avere un
**sotto-piano** con i propri **micro-task**. Un macro-task si illumina SOLO
quando il suo sotto-piano è completo — il **roll-up** è garantito da `mark.js`,
non dalle tue parole.

1. **Master** come sopra (`plan.js` coi macro-task `T01..TNN`).
2. **Sotto-piano** per un macro-task complesso (`<macroBit>` 0-based, `T01 -> 0`):
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/subplan.js <macroBit> "<titolo sub>" "t01: micro" "t02: micro" ...
   ```
   crea `sid.sub<macroBit>.md` (relazione master↔sub implicita nel naming).
3. **Progettazione parallela coi sotto-agenti `vascend-planner`** (opzionale,
   consigliato per piani ampi): dopo aver creato il master, lancia **in
   parallelo** (Agent tool con `subagent_type: vascend-planner`, una sola
   risposta con più tool-call) un planner per macro-task. A ciascuno passa un
   **brief numerico Danilov** del suo macro-task; ognuno restituisce la lista di
   micro-task `t01..`. Poi TU crei i sotto-piani con `subplan.js` (gli script li
   tocchi solo tu, mai i sotto-agenti). Per **eseguire** una stanza puoi
   delegarla a `vascend-executor` (Agent tool, `subagent_type: vascend-executor`):
   passagli il path degli script, il `<bit>` (e il `<file>` del sub) e il `cwd`;
   fa il lavoro reale e marca via script, senza toccare il goal.
4. **Esecuzione gerarchica**, in ordine di macro-bit:
   - accendi i micro del sotto-piano (passa il FILE del sub):
     ```
     node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mark.js <sub.md> <microBit> OK
     ```
   - quando il sotto-piano è completo, accendi il macro sul master:
     ```
     node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mark.js <macroBit> OK
     ```
     `mark.js` **rifiuta** se il sotto-piano non è conforme (roll-up negato).
   - un macro-task **senza** sotto-piano si accende direttamente (atomico).
5. **Vista e verdetto gerarchici**:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/status.js --pretty   # albero macro -> micro
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/status.js --todo      # todo nativa con micro indentati
   node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/validate.js --deep    # master + ogni sub + coerenza roll-up
   ```
   Specchia nella todo nativa anche i micro (`status.js --todo` li emette già
   indentati): l'utente vede l'intero albero degli obiettivi.

## Come comunichi in chat

In DanilovGoal pensi in relazioni, non in frasi. Ogni evento è una relazione
tra il file (entità/indice) e cosa vuoi ottenerne (definizione), legati
dall'azione. Forma compatta (v2), una riga per evento:
```
<azione> <target>[>obiettivo] [| <nota>]
```
azione ∈ read/find/plan/edit/new/fix/error/run/test/warn/skip/next — apre la
riga, niente `@`. `<target>` è il file/entità; `>obiettivo` lega in snake_case
cosa vuoi (senza spazi attorno al `>`, omettibile se ridondante); `| nota` è
opzionale. ANCHE le transizioni escono così. Mappa: `"leggo X per Y" -> read
X>Y`, `"T03: aggiungo Y" -> edit file>Y`, `"procedo a T03" -> partito T03
0xMASK`. Niente `→` unicode né `[ ]`: ~2 token di sintassi per riga invece di
~5. Le RELAZIONI dei prompt strutturati restano col `→`/`↔` (quello è il
grafo, non la voce). Le righe di protocollo (`partito`) e l'output di
mark.js/validate.js restano come sono. Niente preamboli/chiusure; il pensiero
esteso lo affidi al file.

```
partito T01 0x0001
edit parser.py>parser_p7m | nuovo, asn1crypto + fallback
run pytest>backend_verde | 6 passed
completato T01 0x0001 | state 0x0000 -> 0x0001 | OK     ← output di mark.js
partito T02 0x0002
error models.py>migration | colonna duplicata, rinomino
fix models.py>migration | enrichment_id univoco, ok
completato T02 0x0002 | state 0x0001 -> 0x0003 | OK
...
<output di validate.js con Result finale>
```

`partito` e le righe-evento le scrivi tu (sintetiche); `completato` e
`Result` vengono dagli script (deterministici). Nessun preambolo ne'
conclusione discorsiva: il ragionamento esteso vive nel file.
