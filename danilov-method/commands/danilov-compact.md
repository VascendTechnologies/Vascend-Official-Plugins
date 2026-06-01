---
description: Compatta strategicamente la conversazione in un sommario nel formato del metodo Danilov (INDICE/DEFINIZIONI/RELAZIONI) invece che in prosa. Produce un checkpoint denso e riprendibile dello stato attuale.
---

# Comando /danilov-compact

Comprimi lo stato della conversazione come fa un compact, ma il sommario è
in **notazione Danilov**, non in prosa. È la pianta del castello finora:
quali stanze sono illuminate, quali restano aperte.

Nota: un comando non può invocare il `/compact` nativo del CLI. Questo
genera il **sommario compatto** in formato Danilov — la parte che conta — e
lo salva come checkpoint. Per liberare davvero il contesto, dopo puoi usare
`/clear` (o il resume) ripartendo da questo checkpoint.

## Cosa produrre

Sintetizza TUTTA la conversazione finora in un blocco Danilov compatto.
Niente prosa: solo la notazione. Comprimi senza perdere ciò che serve a
riprendere a freddo.

```
INDICE
1 = <area/concetto chiave 1>      (una parola)
2 = <area/concetto chiave 2>
...

DEFINIZIONI
@fatto[id]:   <cosa è stato completato>, file=<path>, esito=<ok|...>
@stato[id]:   <decisione/valore/config corrente che va ricordato>
@aperto[id]:  <thread non chiuso / prossimo passo>, blocco=<se presente>
@file[id]:    <path>, ruolo=<a cosa serve>, stato=<modificato|nuovo|dead>

RELAZIONI
@R[n]: @<id> → @<id>, <dipendenza o "poi">
...

OUTPUT: stato compatto della sessione, pronto a riprendere a freddo.
```

## Regole di compressione

- **INDICE**: i pochi concetti/aree attorno a cui ruota la sessione.
- **@fatto**: ciò che è chiuso e verificato (con il file e l'esito reale).
- **@stato**: decisioni e valori che andrebbero persi nel compact e che
  servono dopo (path, convenzioni, scelte architetturali, id, flag).
- **@aperto**: i thread non finiti e il prossimo passo concreto — è la parte
  più importante per riprendere.
- **@file**: i file toccati, col loro ruolo; marca i `dead` (es. componenti
  non più renderizzati).
- Nessun dettaglio decorativo: se non serve a riprendere, non entra.

## Salvataggio del checkpoint

Dopo aver prodotto il blocco, salvalo (tool Write) in:

```
<cwd>/.danilov-compact.md
```

(nella root del progetto, fuori da `DanilovGoal/` quindi scrivibile). Se
esiste già, sovrascrivilo: è sempre l'ultima foto dello stato. In chat
restituisci SOLO il blocco Danilov + la riga `saved: .danilov-compact.md`.
