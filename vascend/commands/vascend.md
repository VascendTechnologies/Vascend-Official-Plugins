---
description: Interruttore Vascend (metodo Danilov). `/vascend on` (o senza argomento) attiva la modalita' STICKY (ogni prompt diventa un obiettivo Danilov); `/vascend off` la spegne; `/vascend <obiettivo>` esegue un goal one-shot col metodo (bit one-hot + trace firmata + audit deterministico).
argument-hint: "on | off | <obiettivo>"
---

# Comando /vascend

`/vascend` è un **interruttore** del metodo Danilov, più una scorciatoia per un
obiettivo singolo. **Il comportamento lo guida l'hook `danilov-trigger.js`**
(UserPromptSubmit), non questa markdown: l'hook intercetta `on`/`off`/obiettivo
sul testo grezzo, gestisce flag e goal, e **inietta da sé il metodo completo**
(la skill `danilov-prompt` + il protocollo di pianificazione). Questo file resta
volutamente magro: serve solo come **fallback** se gli hook sono disattivati.

## on / off / obiettivo — cosa fa `$ARGUMENTS`

- **`on`** (o argomento **vuoto**): attiva la **modalità STICKY** — da ora ogni
  prompt è un obiettivo Danilov. All'attivazione l'hook carica la skill e il
  primer del metodo: conferma in una riga e **NON pianificare, NON creare goal**.
  Fallback (hook off): `node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mode.js on`.
- **`off`**: spegne la modalità e l'intero regno della sessione.
  Fallback (hook off): `node ${CLAUDE_PLUGIN_ROOT}/scripts/danilov/mode.js off`.
- **qualsiasi altro testo** = **obiettivo one-shot**: eseguilo col metodo
  seguendo le istruzioni che l'hook inietta (INDICE/DEFINIZIONI/RELAZIONI, bit
  one-hot, trace firmata, audit). L'obiettivo è: `$ARGUMENTS`.

## Fallback — protocollo essenziale (se l'hook non ha iniettato il metodo)

Tutti gli script stanno in `${CLAUDE_PLUGIN_ROOT}/scripts/danilov/` e ricavano da
soli il file del goal (`~/.claude/projects/<cwd-encoded>/DanilovGoal/<sid>.md`):
lanciali senza argomento di file, sempre dalla stessa cartella.

1. Carica la skill `danilov-prompt` (tool Skill) se non è già in contesto.
2. Pianifica: `plan.js "<titolo>" "T01: ..." "T02: ..." ...` (un task per bit).
   Più workstream = castelli multipli: `castle.js new <slug> "<titolo>" "T01: ..." [--after <slug>]`.
3. Esegui un task alla volta, in ordine di bit. Per ciascuno: anteprima
   `mark.js <bit> OK --dry` (verifica `goal`/`cwd`), poi `mark.js <bit> OK`
   (`FAIL` se fallita; `unmark.js <bit>` per annullare). Specchia nella todo
   nativa (`status.js --todo`). **Non dichiarare tu il verdetto.**
4. **REGOLA ANTI-MANOMISSIONE**: mai Edit/Write sui file in `DanilovGoal/` (un
   hook li nega); la Trace è firmata HMAC. Il dossier `<piano>.notes.md` è invece
   libero (Write/Edit) per gli appunti per stanza.
5. Chiudi con `validate.js` (o `validate.js --kingdom` per il regno): il verdetto
   è `validate(state) == (state == MASK_TARGET)`, deterministico dalla Trace.

In chat pensi in relazioni, non in frasi: una riga per evento
`<azione> <target>>obiettivo | nota` (azione ∈ read/find/plan/edit/new/fix/error/
run/test/warn/skip/next). Niente preamboli/chiusure: il pensiero esteso vive nel
file. `partito T<nn> 0x<MASK>` lo scrivi tu; `completato`/`Result` vengono dagli
script.
