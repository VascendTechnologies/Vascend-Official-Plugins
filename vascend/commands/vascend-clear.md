---
description: Disattiva la modalita' DanilovGoal per la sessione corrente (spegne il flag di enforcement). Equivale a scrivere "annulla danilov".
---

# Comando /vascend-clear

Spegne la modalita' Vascend (metodo Danilov) per questa sessione.

La disattivazione e' **deterministica**: avviene nell'hook
`danilov-trigger.js` (UserPromptSubmit), che intercetta `/vascend-clear`
e rimuove il flag di sessione `~/.claude/.danilov-state/<session>.json`
prima ancora che parta il turno. Lo Stop hook quindi non pretende piu'
un DanilovGoal conforme e gli hook rumorosi tornano attivi.

Non serve fare altro: conferma all'utente che la modalita' e' stata
disattivata.
