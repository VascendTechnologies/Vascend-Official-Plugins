<p align="center">
  <img src="img.png" alt="Vascend Official Plugins" width="100%">
</p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/Claude%20Code-plugin-7C5CFF" alt="Claude Code plugin">
  <img src="https://img.shields.io/badge/dipendenze-0-brightgreen" alt="Zero dipendenze">
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>Italiano</b>
</p>

# Vascend Official Plugins

Marketplace ufficiale dei plugin [Vascend](https://github.com/VascendTechnologies)
per [Claude Code](https://claude.com/claude-code): un metodo per far **pensare,
eseguire e ricordare** un agente AI in modo strutturato, tracciabile e
verificabile, a zero dipendenze.

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
| [`vascend`](./vascend) | Metodo Danilov per Claude Code: prompt strutturati `INDICE/DEFINIZIONI/RELAZIONI` ed esecuzione `DanilovGoal` tracciata a bit one-hot, con Trace firmata HMAC e verdetto deterministico. | `/plugin install vascend@vascend-official-plugins` |

## L'idea: il castello delle memorie

Il metodo prende in prestito una tecnica reale, il **palazzo della memoria**
(*method of loci*): per ricordare, ti immagini di camminare in un luogo
familiare e "posi" ogni cosa in una stanza fissa. È il trucco che usa **Patrick
Jane in _The Mentalist_**, il castello mentale dove ogni informazione ha il suo
posto preciso e ci torni camminandoci.

<p align="center">
  <img src="mentalist.jpg" alt="Patrick Jane in The Mentalist" width="60%"><br>
  <sub>Patrick Jane in <i>The Mentalist</i> (CBS / Warner Bros.)</sub>
</p>

Vascend lo rende letterale per un agente AI:

- il **piano** è il castello;
- ogni **task** è una **stanza fissa**: il bit K è sempre la stanza K, non si sposta;
- **completare** un task vuol dire **accendere la luce** di quella stanza (solo via `mark.js`);
- l'obiettivo è raggiunto quando **tutto il castello è illuminato**
  (`state == MASK_TARGET`), e `validate()` dice `TRUE`.

E il castello non resta dietro gli occhi dell'agente: **lo costruisce
rispondendo**. La chat _è_ il castello e ogni riga scritta è una stanza resa
visibile, così chi legge cammina nel ragionamento invece di leggerne un
riassunto. `state` è la mappa delle stanze accese, `missing` quelle ancora al
buio: si sa sempre in quale tornare.

## I tre concetti

### 1. Prompt strutturati: `INDICE / DEFINIZIONI / RELAZIONI`

Un formato nuovo, pensato per le macchine prima che per gli umani. Invece di
descrivere tutto in prosa, dove "cos'è", "che proprietà ha" e "come si collega"
si mescolano, separa i tre piani in notazione numerica compatta:

```
INDICE                       # i concetti nudi, una parola, numerati
1 = nodo
2 = arco

DEFINIZIONI                  # le istanze con le proprietà che contano
@1[start]: colore=#3B82F6, forma=stadium
@1[end]:   colore=#10B981, forma=circle

RELAZIONI                    # i legami: → orientato, ↔ simmetrico
@R1: @1[start] → @1[end]   [ label=ok ]

OUTPUT: diagramma Mermaid
```

Separare i piani attiva il parsing strutturato del modello e dà output **più
fedele dove i valori contano**: diagrammi, prompt per generatori di immagini,
configurazioni, piani eseguibili.

### 2. DanilovGoal: esecuzione a bit one-hot, verificabile

Ogni task è un **bit**. Si accende **solo** eseguendo `mark.js`, che appende una
riga di **Trace firmata HMAC a catena**. Il verdetto
`validate() == (state == MASK_TARGET)` lo calcola lo **script** dai dati firmati,
**mai l'agente**: è matematica, non un'asserzione. Le righe scritte a mano non
hanno firma valida e vengono rifiutate, e la Trace resta a prova di manomissione.

### 3. Notazione compatta: come l'agente risponde e ricorda

Durante un DanilovGoal l'agente non risponde in prosa. Ogni cosa che fa diventa
una **relazione su una riga**:

```
read LotTable.tsx>selezione_multipla | dove agganciare le props
edit LotTable.tsx>selezione_multipla | props + colonna checkbox
run pytest>backend_verde | 6 passed
```

Una riga al posto di una frase intera. Il formato è
`<azione> <entità>>obiettivo | nota` e usa circa 2 token di sintassi per riga,
contro i circa 5 di una notazione carica di `@`, `:`, frecce unicode e parentesi.
Su un intero turno l'effetto è grosso: **molti meno token generati**, e siccome
l'agente pensa già in forma strutturata invece che discorsiva, il **ragionamento
è più corto e più veloce**, sia in token sia in tempo.

Le stesse righe vengono archiviate nei file `.vascend`, un formato di testo a
relazioni progettato per essere **reinjettato nel contesto a basso costo**,
raggruppato per `@plan` (la sessione/obiettivo):

```
# vascend-memory · contabilita

@plan[Correzione rotta: retrieval via CLI]
2026-06-01T22:28:11Z · decide vascend_memory_graph>retrieval_via_cli | niente MCP, memory.js da CLI on demand
2026-06-01T22:28:12Z · decide vascend_memory_graph>no_obsidian | leggiamo .vascend, il viewer e' la nostra estensione
```

Tutto **offline e a zero dipendenze**; il retrieval usa BM25 + RRF via CLI
(`memory.js search`), senza servizi esterni.

Lo stesso file alimenta il **grafo**: l'estensione VS Code
[`vascend-memory-graph`](./vascend-memory-graph) legge i `.vascend` e li disegna
come grafo a nodi e archi con disposizione a forze. I **nodi** sono entità e
obiettivi (dimensione proporzionale alle occorrenze), gli **archi** sono le
azioni (`read`, `edit`, `fix`, `run`, ...), con filtri per progetto, sessione
(`@plan`) e azione.

## Cosa porta il plugin `vascend`

- **Modalità sticky** (`/vascend on`): ogni prompt diventa un obiettivo tracciato.
- **Piani gerarchici** (un piano e i suoi sottopiani) con **consolidamento
  automatico** garantito dallo script.
- **Enforcement**: il turno non si chiude finché il castello non è illuminato
  (protezione contro gli stalli configurabile via `DANILOV_MAX_STALL`, dove `0`
  significa persistente).
- **Resume tra sessioni**: un task lungo non si perde cambiando sessione (hook
  `SessionStart` più `resume.js --attach`).
- **Precisione**: dipendenze tra task (DAG), gate di verifica (`mark --check`),
  note per singolo bit (`mark --note`).
- **Subagenti** `vascend-planner` (progetta) e `vascend-executor` (esegue).
- **Checkpoint** in notazione Danilov (`/vascend-compact`), più invito a `/clear`.

Dettagli completi del plugin: [`vascend/README.md`](./vascend/README.md).

## Struttura del repo

```
.claude-plugin/marketplace.json   # indice del marketplace
vascend/                          # plugin (skill + comandi + hook + agenti + script)
vascend-memory-graph/             # companion: estensione VS Code, grafo delle memorie .vascend
LICENSE                           # MIT
```

Ogni plugin vive in una sottocartella col proprio `.claude-plugin/plugin.json`.
Per aggiungerne uno nuovo: crea la cartella, aggiungi il manifest e referenziala
in `marketplace.json` (`source`).

## Licenza

[MIT](./LICENSE) (c) 2026 Lorenzo Danilov.
