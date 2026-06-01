# Vascend Official Plugins

Marketplace ufficiale dei plugin [Vascend](https://github.com/VascendTechnologies)
per [Claude Code](https://claude.com/claude-code).

## Installazione

```
/plugin marketplace add VascendTechnologies/Vascend-Official-Plugins
/plugin install vascend@vascend-official-plugins
```

Dopo un push su questo repo, per aggiornare:

```
/plugin marketplace update vascend-official-plugins
/reload-plugins
```

## Plugin disponibili

| Plugin | Descrizione | Install |
|---|---|---|
| [`vascend`](./vascend) | Metodo Danilov per Claude Code: prompt strutturati `INDICE/DEFINIZIONI/RELAZIONI` + esecuzione `DanilovGoal` tracciata a bit one-hot, con Trace firmata HMAC e verdetto deterministico. | `/plugin install vascend@vascend-official-plugins` |

## Il plugin `vascend` in breve

Due livelli, un'unica notazione:

1. **Prompt strutturati** — separa concetti, istanze e relazioni in notazione
   numerica compatta invece che in prosa: output più fedele dove i valori
   contano (diagrammi, configurazioni, piani).
2. **DanilovGoal** — esecuzione tracciata a **bit one-hot**: ogni task è una
   stanza del castello, si accende SOLO eseguendo `mark.js` (riga di Trace
   firmata HMAC a catena). Il verdetto `validate() == (state == MASK_TARGET)`
   lo calcola lo script dai dati firmati, **mai l'agente** — è matematica, non
   un'asserzione.

Cosa porta:

- **Modalità sticky** (`/vascend on`): ogni prompt diventa un obiettivo tracciato.
- **Piani gerarchici** macro → micro con **roll-up** garantito dallo script.
- **Enforcement**: il turno non si chiude finché il castello non è illuminato
  (anti-stallo configurabile via `DANILOV_MAX_STALL`, `0` = persistente).
- **Resume cross-sessione**: un task lungo non si perde cambiando sessione
  (hook `SessionStart` + `resume.js --attach`).
- **Precisione**: dipendenze tra task (DAG), gate di verifica (`mark --check`),
  note per-bit (`mark --note`).
- **Subagenti** `vascend-planner` (progetta) e `vascend-executor` (esegue).
- **Checkpoint** in notazione Danilov (`/vascend-compact`) + invito a `/clear`.

Dettagli completi: [`vascend/README.md`](./vascend/README.md).

## Struttura del repo

```
.claude-plugin/marketplace.json   # indice del marketplace
vascend/                          # plugin (skill + comandi + hook + agenti + script)
```

Ogni plugin vive in una sottocartella col proprio `.claude-plugin/plugin.json`.
Per aggiungerne uno nuovo: crea la cartella, aggiungi il manifest e referenziala
in `marketplace.json` (`source`).

## Licenza

MIT.
