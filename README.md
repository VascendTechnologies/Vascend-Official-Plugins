# Vascend Official Plugins

Marketplace ufficiale dei plugin [Vascend](https://github.com/VascendTechnologies)
per [Claude Code](https://claude.com/claude-code).

## Installazione

```
/plugin marketplace add VascendTechnologies/Vascend-Official-Plugins
```

Poi installa il plugin che ti serve (vedi sotto).

## Plugin disponibili

| Plugin | Descrizione | Install |
|---|---|---|
| [`danilov-method`](./danilov-method) | Metodo Danilov: prompt strutturati `INDICE/DEFINIZIONI/RELAZIONI` + esecuzione `DanilovGoal` tracciata a bit one-hot con Trace firmata HMAC e verdetto deterministico. | `/plugin install danilov-method@vascend-official-plugins` |

## Struttura del repo

```
.claude-plugin/marketplace.json   # indice del marketplace
danilov-method/                   # plugin (skill + comandi + hook + script)
```

Ogni plugin vive in una sottocartella con il proprio
`.claude-plugin/plugin.json`. Per aggiungerne uno nuovo: crea la cartella,
aggiungi il manifest e referenziala in `marketplace.json` (`source`).

## Aggiornare un plugin installato

Dopo un push su questo repo:

```
/plugin marketplace update vascend-official-plugins
```

## Licenza

MIT.
