---
description: Disattiva la modalita' DanilovGoal per la sessione corrente (spegne il flag di enforcement). Equivale a scrivere "annulla danilov".
---

# Comando /danilov-clear

Spegne la modalita' Danilov per questa sessione.

La disattivazione e' **deterministica**: avviene nell'hook
`danilov-trigger.js` (UserPromptSubmit), che intercetta `/danilov-clear`
e rimuove il flag di sessione `~/.claude/.danilov-state/<session>.json`
prima ancora che parta il turno. Lo Stop hook quindi non pretende piu'
un DanilovGoal conforme e gli hook rumorosi tornano attivi.

Non serve fare altro: conferma all'utente che la modalita' e' stata
disattivata.
