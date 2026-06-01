# Valutazione: codifica invisibile U+200E nel metodo Danilov

> Decision record. Domanda: conviene sfruttare caratteri invisibili (`U+200E`,
> LEFT-TO-RIGHT MARK) con uno schema run-length per "comprimere" la notazione
> Danilov? Verdetto in fondo. Misure riproducibili: `measure-invisible-encoding.js`.

## La proposta

Codificare il testo come ripetizioni di `U+200E` (A=1, B=2, … Z=26), separate
da `|`. Esempio: `CIAO` → 3+9+1+15 ripetizioni con tre separatori. L'osservazione
di partenza è corretta: senza una regola di decodifica scelta da noi, N caratteri
`U+200E` non sono una parola, sono solo N marcatori invisibili. Con la regola,
diventano decodificabili.

Il principio — *una codifica con regola di decodifica nostra* — è valido. Ma è
già il cuore del metodo Danilov (INDICE numerico, bit one-hot, voce v2). La
domanda vera è se *questa specifica implementazione* serva lo scopo del metodo,
che è uno solo: **meno token, mantenendo leggibilità e robustezza.**

## Misura (numeri reali, da `measure-invisible-encoding.js`)

| parola | testo (token~) | U+200E (token~) | fattore | byte |
|--------|---------------:|----------------:|--------:|-----:|
| CIAO | 1 | 31 | **31x** | 22x |
| test | 1 | 67 | **67x** | 49x |
| edit | 1 | 41 | **41x** | 29x |
| anti_timing | 3 | 125 | **42x** | 33x |
| auth.py | 2 | 96 | **48x** | 40x |

Riga-evento campione (37 char): testo ~10 token → U+200E ~416 token, **41x**.

`U+200E` è 3 byte UTF-8 (`E2 80 8E`) e non esiste come merge nel vocabolario
BPE (o200k/cl100k): finisce in byte-fallback, ~1 token per occorrenza nel caso
*migliore*, spesso peggio. La stima 1 token/occorrenza è un limite inferiore
prudente: il costo reale è ≥ questo. La conclusione non cambia di segno.

**La proposta non comprime: moltiplica i token per 30-67×.** È esattamente il
contrario dell'obiettivo del metodo.

## Perdita di informazione (strutturale, non aggirabile)

Lo schema A-Z copre 26 simboli. Il metodo Danilov usa molto di più:

- cifre (`0x003F`, bit, hex colori `#3B82F6`)
- punteggiatura e simboli (`_`, `.`, `>`, `|`, `/`, `=`)
- maiuscole/minuscole distinte (case-insensitive → `CIAO`==`ciao`)
- path, snake_case, nomi file

Tutto questo non è rappresentabile. Per recuperarlo servirebbe un alfabeto più
grande → ripetizioni ancora più lunghe → ancora più token.

## Robustezza (fragile su ogni canale)

- **Copia-incolla / editor**: molti editor e campi web strippano o normalizzano
  i caratteri di controllo bidi. Il payload si corrompe silenziosamente.
- **Normalizzazione Unicode** (NFC/NFKC): pipeline di testo comuni rimuovono o
  alterano `U+200E`. Il dato sopravvive solo se *nessuno* tocca la stringa.
- **Trim/whitespace**: `U+200E` è trattato come spazio/zero-width da molti
  strumenti → tagliato ai bordi.
- **Diff/git/review**: invisibile = non revisionabile. Un diff non mostra nulla,
  ma il contenuto cambia. Incompatibile con i conventional commit e la review.

## Sicurezza (anti-pattern per Vascend)

Caratteri invisibili e bidi sono un vettore d'attacco noto: **Trojan Source**
(CVE-2021-42574) usa proprio i marcatori bidi (`U+200E`/`U+202E`…) per nascondere
logica nel codice che l'occhio non vede. Introdurli *di proposito* nei prompt e
nei file del metodo:

- apre la porta a prompt-injection invisibile (testo che l'LLM legge ma l'umano no);
- contraddice la postura security-ossessiva del progetto (il WAF e i linter
  dovrebbero *segnalare* questi caratteri, non vederli come formato legittimo);
- rende impossibile distinguere un marcatore "nostro" da uno ostile iniettato.

Per un progetto come Vascend, normalizzare l'uso di caratteri invisibili è un
regresso di sicurezza, non un miglioramento.

## Leggibilità (rompe il castello)

Il principio fondante: *la chat È il castello, ogni riga è una stanza resa
visibile, chi legge ci cammina dentro.* Testo invisibile = stanze al buio per
definizione. Lorenzo non potrebbe più leggere il flusso. Il metodo perderebbe la
sua proprietà migliore.

## Verdetto

```
INDICE
1 = proposta
2 = scopo
3 = misura
4 = verdetto
5 = alternativa

DEFINIZIONI
@1: U+200E_run-length, regola_decodifica=nostra
@2: meno_token + leggibile + robusto + sicuro
@3: token=+30..67x, byte=+20..49x, perdita=cifre/punteggiatura/case/path
@4[voce]:    RIFIUTATO per la voce/notazione del metodo (viola @2 su ogni asse)
@4[kernel]:  VALIDO il principio "codifica con regola nostra" -> e' gia' Danilov
@4[nicchia]: steganografia/watermark_provenienza = caso diverso (NON compressione), e anche li' attenzione sicurezza
@5[densita]: piu' densita' = direzione OPPOSTA -> glifi ASCII corti, sigle, ref numeriche all'INDICE, dizionario simboli ad alta frequenza (tutto visibile, BPE-friendly)

RELAZIONI
@R1: @1 → @3        [ misurata, non opinata ]
@R2: @3 → @4[voce]  [ i numeri impongono il rifiuto ]
@R3: @2 ↔ @5        [ lo scopo si serve con l'opposto della proposta ]

OUTPUT: non adottare U+200E nella notazione. Per piu' densita', comprimere in
ASCII visibile. Riservare i caratteri invisibili — se mai — al solo watermark,
trattandoli come superficie d'attacco, non come formato.
```

## Cosa fare per il vero obiettivo (più densità)

Se l'obiettivo è "più informazione in meno token", la leva è ASCII visibile e
BPE-friendly:

1. **Sigle azione 1-char** nella voce (`e`=edit, `f`=fix, `r`=read…): ~1 token/riga.
2. **Riferimenti numerici all'INDICE** invece di ripetere i nomi (già nel metodo:
   `@1[a]` invece di "il primo nodo stage").
3. **Dizionario di simboli ad alta frequenza** definito una volta in testa al
   prompt e riusato (un merge BPE stabile batte 30 caratteri invisibili).

Tutte e tre tagliano token *mantenendo* leggibilità, robustezza e sicurezza —
cioè rispettano lo scopo del metodo invece di tradirlo.
