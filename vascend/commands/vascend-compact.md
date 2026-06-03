---
description: Compatta la conversazione in un checkpoint nel formato del metodo Danilov (INDICE/DEFINIZIONI/RELAZIONI) invece che in prosa, lo salva in .vascend-compact.md, poi invita a /clear per ripartire con contesto pulito.
---

# Comando /vascend-compact

Comprimi lo stato della conversazione come fa un compact, ma il sommario è
in **notazione Danilov**, non in prosa. È la pianta del castello finora:
quali stanze sono illuminate, quali restano aperte. Subito dopo il salvataggio
si riparte puliti con `/clear`.

> **Limite tecnico (verificato).** Un comando di Claude Code NON può lanciare
> `/clear` (né `/compact`) in automatico: l'output di un comando è testo per il
> modello, non viene re-interpretato come slash-command, e nessun hook/tool può
> svuotare il contesto. Quindi questo comando fa la parte che conta —
> **genera e salva il checkpoint Danilov** — e poi **ti invita esplicitamente a
> digitare `/clear`**: è un solo tasto e riparti dal checkpoint appena salvato.

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
<cwd>/.vascend-compact.md
```

(nella root del progetto, fuori da `DanilovGoal/` quindi scrivibile). Se
esiste già, sovrascrivilo: è sempre l'ultima foto dello stato.

## Chiusura: invito a /clear

In chat restituisci, in quest'ordine e SENZA altra prosa:

1. il blocco Danilov;
2. la riga `saved: .vascend-compact.md`;
3. come **ultima riga**, l'invito a pulire il contesto, ben visibile:

```
Checkpoint salvato. Per ripartire con contesto pulito digita ora:  /clear
(il prossimo /vascend riprenderà da .vascend-compact.md)
```

Non aggiungere altro dopo questa riga: è il passo che l'utente deve compiere.
