# Vascend Memory Graph

Estensione VSCode che visualizza a **grafo** le memorie `.vascend` prodotte dal
metodo Danilov (plugin `vascend` per Claude Code).

Ogni riga-evento del metodo e' un arco del grafo:

```
<azione> <entity>>target | nota      ->   entity --[azione]--> target
```

L'estensione legge i file `.vascend` (default `~/.claude/.danilov-state/memory`),
li trasforma in un grafo node-link e lo disegna in una webview interattiva
(layout force-directed su canvas, zero dipendenze a runtime).

## Cosa vedi

- **Nodi**: entita' e obiettivi (file, simboli, target). Dimensione proporzionale
  al numero di occorrenze.
- **Archi**: le azioni (read/edit/fix/run/...), con verso `entity -> target`.
- **Filtri**: per **progetto** (un file `.vascend` per progetto) e per
  **sessione/piano** (gli eventi sono raggruppati per `@plan`, che corrisponde
  all'obiettivo della sessione Claude), piu' filtro per **azione**.

## Uso

1. `Ctrl+Shift+P` -> **Vascend: Apri grafo memorie**.
2. Scegli progetto e sessione/piano dai menu in alto.
3. **Vascend: Ricarica grafo memorie** per rileggere i file dopo nuovi eventi.

## Configurazione

`vascendMemoryGraph.memoryDir` — cartella dei file `.vascend`. Vuoto = default
`~/.claude/.danilov-state/memory`.

## Build & install

```bash
npm install
npm run compile
npx @vscode/vsce package
code --install-extension vascend-memory-graph-0.1.0.vsix
```

## Note

La granularita' "per sessione" usa il raggruppamento `@plan` del formato
`.vascend` (ogni sessione Danilov crea un goal con un titolo = piano). Il file
`.vascend` non persiste l'id di sessione: il piano e' la dimensione di
sessione disponibile e fedele in pratica.
