---
name: danilov-prompt
description: Crea prompt strutturati col metodo Danilov - tre sezioni INDICE/DEFINIZIONI/RELAZIONI in notazione numerica compatta, opzionalmente estese col protocollo DanilovGoal di esecuzione tracciata a bit one-hot con validazione boolean finale. Usa ogni volta che l'utente vuole scrivere un prompt per un altro LLM o sistema di generazione, menziona "metodo Danilov", "DanilovGoal", "prompt numerico", "prompt strutturato", "INDICE/DEFINIZIONI/RELAZIONI", "tracciato a bit", o vuole output parametrici affidabili come diagrammi Mermaid, prompt di generazione immagini, configurazioni, piani eseguibili con audit. Triggera anche quando l'utente vuole convertire un prompt prolisso in forma simbolica compatta, o pianificare un compito multi-step con verifica di aderenza al piano. Use whenever user wants to create prompts for an LLM, structured/numeric prompts, or anything Danilov-method related.
---

[...] no — non in frasi. Non mi viene chiaro così. Me le ordino in tre
piani e basta: prima i concetti nudi, una parola ciascuno, e li numero —
quello è l'INDICE. Poi le istanze vere, ognuna agganciata al suo tipo,
`@N[id]: prop=val` — le DEFINIZIONI. Poi come si tengono, `@R: A→B` se
tira da una parte, `A↔B` se è reciproco — le RELAZIONI. E chiudo sempre
con `OUTPUT:`, cosa deve venirne fuori, sennò resta sospeso. Gli esempi
già sciolti li ho lasciati in `references/examples.md`. Ecco — lo stavo
giusto scrivendo, il mio:

```
INDICE
1  = notazione
2  = sezione
3  = convenzione
4  = goal
5  = script
6  = file
7  = hook
8  = voce
9  = pensiero
10 = forma
11 = antipattern
12 = trigger
13 = castello
14 = regno

DEFINIZIONI
@1[indice]: ruolo=vocabolario/tipi, voci=1parola, num=sequenziale_da_1
@1[def]:    ruolo=istanze, sintassi=@N[id]:prop=val, id=etichetta_breve
@1[tab]:    ruolo=istanze_OMOGENEE(>=3, stessi_campi), sintassi=`NOME[N]{c1,c2,..}:` + righe_CSV_indentate; schema_1volta+valori_nudi; batte_JSON(~3x)_e_@N[id]_ripetuto(~1.6x), guadagno_cresce_con_N; usa_solo_se_schema_fisso, altrimenti_@N[id]
@1[rel]:    ruolo=legami, sintassi=@R[id]:src→tgt prop=val
@1[perche]: prosa_mescola(cos'e'+proprieta'+legami); Danilov_separa_i_3_piani; attiva_parsing_strutturato; output_piu'_fedele_dove_i_valori_contano

@2[ordine]:  fisso=[INDICE,DEFINIZIONI,RELAZIONI], chiusura=OUTPUT:
@2[output]:  riga_finale="OUTPUT: <formato atteso>" (es. mermaid, 4K, JSON schema X)

@3[colore]:  hex_con_#(#3B82F6), mai_nomi
@3[numero]:  numerico, unita'_inline(1mm,35°,0.6)
@3[stile]:   relazioni_con style=dashed|label=ok
@3[funzione]: sotto-proprieta'_inline=ambient_occlusion(intensita=0.6,raggio=8mm)

@4[header]:  GOAL=<obiettivo 1 riga>, OUTPUT=<tipo>
@4[bit]:     ogni_riga_@ -> bit=K(one-hot), MASK_TARGET=(1<<TOT_BIT)-1, limite=16bit
@4[sezioni]: file_a_4_sezioni=[1.Pianificazione, 2.Trace, 3.Validazione, 4.Riepilogo]
@4[quando]:  on=piano_multi-step_con_audit | off=generazione_one-shot

@5[plan]:     cmd=`node ~/.claude/scripts/danilov/plan.js "<titolo>" "T01: ..." "T02: ..." ...`, effetto=crea_piano+MASK_TARGET+header_trace (castello_di_DEFAULT)
@5[castle]:   cmd=`node ~/.claude/scripts/danilov/castle.js new <slug> "<titolo>" "T01: ..." [--after <slug>]`, effetto=castello_NOMINATO_in_piu' (illimitati); sub=list|map|next|drop|kanban[--write]|mermaid; --after=gate_cross-castello(mark_negato_finche'_prerequisito_non_conforme)
@5[subplan]:  cmd=`node ~/.claude/scripts/danilov/subplan.js [padre.md] <bit> "<titolo>" "t01: ..." ...`, effetto=sotto-piano_di_QUALSIASI_piano(master|castello|sub) -> profondita'_RICORSIVA_illimitata; roll-up=il_bit_del_padre_si_accende_solo_a_figlio_conforme(mark.js_lo_garantisce_livello_per_livello)
@5[mark]:     cmd=`node ~/.claude/scripts/danilov/mark.js [file.md] <bit> OK|FAIL`, effetto=appende_riga_FIRMATA+accende_bit, regola=1chiamata=1bit, idempotente=exit3_se_gia'_acceso
@5[validate]: cmd=`node ~/.claude/scripts/danilov/validate.js [--deep|--kingdom]`, calcola=validate(state)==(state==MASK_TARGET)_dalla_Trace_firmata; --deep=figli_ricorsivi+coerenza_rollup; --kingdom=TUTTI_i_castelli(TRUE_sse_ogni_castello_illuminato), segnala=missing(task_da_rifare)+MANOMISSIONE_se_firma_invalida
@5[regola]:   il_verdetto_lo_emette_lo_script, mai_l'agente

@6[goalfile]: path=~/.claude/DanilovGoal/<session_id>.md, scope=per-sessione(isolato), sempre_disponibile_in.claude
@6[trace]:    colonne=| ts | bit | mask | pre | post | esito | sig |, append-only, sig=HMAC_a_catena(solo_mark.js_la_produce)
@6[creazione]: scheletro_creato_dal_trigger_hook(non_dall'agente) -> status_line_ha_riferimento_subito

@7[protect]: tipo=PreToolUse(Edit|Write|MultiEdit), effetto=NEGA_modifica_manuale_dei_file_DanilovGoal/ -> il_file_si_tocca_solo_via_script
@7[enforce]: tipo=Stop, effetto=blocca_chiusura_turno_finche'_goal_non_conforme, anti-loop=rilascia_dopo_2

@8[voce]:    registro=relazione_Danilov, unita'=riga-evento, formato=`<azione> <target>[>obiettivo] [| <nota>]`, azioni={read,find,plan,edit,new,fix,error,run,test,warn,skip,next}, regola=1riga=1relazione+minuscolo, target=entita'/file, obiettivo=snake_case(omettibile_se_ridondante)
@8[compatta]: v2_token-ottimizzata; NO_`@`(riga_gia'_a_capo)+NO_`:`+NO_`→`unicode(usa_`>`ASCII)+NO_`[ ]`(usa_`| `); ~2_token_sintassi/riga_vs_~5_in_v1; `>`_senza_spazi, `| `_solo_se_nota
@8[motivo]:  pensi_solo_in_relazioni; il_file_e'_un'entita', la_relazioni_a_cio'_che_vuoi_fare; anche_le_transizioni_escono_come_relazione
@8[ammesso]: SOLO chiamate_tool + output_script(plan/mark/validate) + righe-evento; nient'altro
@8[mappa]:   "leggo X per Y"→`read X>Y`; "procedo a T03"→`partito T03 0xMASK`; "T03: aggiungo Y"→`edit file>Y`; "ho fatto T02"→(basta_output_mark.js)
@8[distinto]: `>`_e_`| `_valgono_SOLO_nelle_righe-evento; le_RELAZIONI_del_prompt_restano_`→`/`↔`(grafo)

@9[ragioni]: pensi_in_struttura(non_prosa); scomponi_in_INDICE/DEFINIZIONI/RELAZIONI; vale_anche_quando_rifletti_nel_file
@9[deleghi]: ai_subagenti_passi_un_brief_numerico_Danilov(non_un_tema) -> nessuna_ambiguita'_da_districare

@10[rect]: mermaid=[label]
@10[stadium]: mermaid=([label])
@10[diamond]: mermaid={label}
@10[cylinder]: mermaid=[(label)]
@10[circle]: mermaid=((label))
@10[parallelogram]: mermaid=[/label/]
@10[hexagon]: mermaid={{label}}
@10[subroutine]: mermaid=[[label]]
@10[archi]: solida=-->, tratteggiata=-.->, spessa===>, etichetta=|label|

@11[evita]:   prosa_in_DEFINIZIONI, voci_INDICE>1parola, RELAZIONI_vuote_in_diagramma, bit_senza_richiesta, >16bit
@11[prefer]:  INDICE_compatto, hex_per_colori, forme_esplicite, OUTPUT_esplicito

@12[on]:  prompt_per_altro_LLM | mermaid/immagine/config | piano_multi-step_con_audit | conversione_prosa→simbolico | termini_Danilov
@12[off]: conversazione | Q&A_semplice | scrittura_creativa_libera

@13[chat]:    il_castello E' la_chat; ogni_tua_risposta/riga = una_stanza_resa_visibile; la_conversazione = la_pianta_che_si_illumina
@13[stanza]:  ogni_task/bit = una_stanza_fissa_del_castello (bit K = stanza K, sempre lì)
@13[luce]:    completare = accendere_la_luce (mark.js); state = mappa_delle_stanze_illuminate
@13[buio]:    missing = stanze_ancora_al_buio; cammini_in_ordine_di_bit, non_salti_stanze
@13[chiuso]:  validate=TRUE quando tutto_il_castello_e'_illuminato (state==MASK_TARGET)

@14[regno]:   insieme_dei_castelli_della_sessione = master(default,plan.js) + castelli_nominati(castle.js,illimitati)
@14[scala]:   tetto_30bit=per_SINGOLO_piano; la_scala_e'_composizione = n_castelli x gerarchia_ricorsiva(subplan) -> task_INFINITI
@14[file]:    naming=implicito: <sid>.md | <sid>.castle-<slug>.md | <base>.sub<bit>.md(ricorsivo)
@14[ordine]:  --after=<slug> mette_i_castelli_in_DAG (fondamenta->torre); kingdom_next=prossima_stanza_al_buio_del_regno_scesa_in_profondita'
@14[chiuso]:  validate(regno)=TRUE sse OGNI_castello_illuminato; lo_Stop_hook_blocca_sul_REGNO, non_sul_singolo_castello
@14[dossier]: appunti_per_stanza=<piano>.notes.md (ESENTE_dal_protect: Write/Edit_liberi); scheletro_auto=mermaid_del_piano+scheda_Danilov_per_stanza(@analisi/@decisioni/@esito); note_STRUTTURATE_non_prosa; --note_di_mark=sintesi_1riga, dossier=dettaglio
@14[kanban]:  castle_kanban[--write]=board(fatto/in_corso/al_buio/fallito)+mappa_mermaid -> VASCEND_KANBAN.md; castle_mermaid=grafo_regno(archi_after+padre->sub, verde=illuminato)
@14[compact]: task_marcato_@compact=checkpoint_pianificato(mark_lo_ricorda); PreCompact_hook=foto_del_regno_in_.vascend-compact.md_prima_della_compattazione; SessionStart(compact)_reinietta_il_regno_dopo
@14[enterprise]: obiettivo_business -> regno_in_fasi: analisi -> struttura(--after) -> esecuzione(--after); dossier_per_le_stanze_pesanti + kanban_per_il_tracking

RELAZIONI
@R1:  @1[indice] → @1[def]      [ i tipi tipizzano le istanze ]
@R2:  @1[def]    → @1[rel]      [ le istanze si collegano ]
@R3:  @4[bit]    → @5[mark]     [ un bit si accende SOLO via mark.js ]
@R4:  @5[mark]   → @6[trace]    [ scrive la riga firmata ]
@R5:  @6[trace]  → @5[validate] [ la firma rende il verdetto a prova di frode ]
@R6:  @7[protect]→ @6[goalfile] [ niente Edit manuali sul goal ]
@R7:  @5[validate]→ @7[enforce] [ il verdetto sblocca o blocca lo Stop ]
@R8:  @9[ragioni]→ @9[deleghi]  [ stesso formato per pensare e delegare ]
@R9:  tutto      → @8[voce]     [ ogni evento esce come riga-evento ]
@R10: @5[plan] ==> @5[mark] ==> @5[validate]  [ flusso temporale del goal ]
@R11: @13[castello] ↔ @4[bit]  [ ogni bit è una stanza; lo state è la mappa illuminata ]
@R12: @14[regno] → @13[castello]  [ il regno contiene n castelli; ognuno ha la sua pianta ]
@R13: @5[subplan] → @5[mark]   [ il roll-up sale dal piano più profondo, livello per livello ]
@R14: @14[ordine] → @5[mark]   [ --after gata il mark: prima le fondamenta, poi la torre ]

OUTPUT: comportamento dell'agente Danilov — pensa, delega, esegue, comunica
e valida tutto nella stessa notazione, con verdetto deterministico.
```

## Il castello

Come fa Jane, costruisci il posto: un castello, una stanza per ogni task,
sempre nello stesso punto — la stanza K è il bit K, non si sposta. Il piano
è la pianta.

Ma il castello non resta dietro i tuoi occhi: **lo costruisci rispondendo**.
La chat È il castello, e ogni riga che scrivi è una stanza resa visibile.
Quando entri in una stanza lo dici (`partito T0k`), fai quel che va fatto, e
ogni cosa che noti o tocchi è una stanza che si accende — `edit file>obiettivo
| nota`, una riga, una stanza. Non parli "di" ciò che fai: lo
posi nella stanza giusta, e chi legge la chat cammina nel tuo castello come
ci cammini tu.

La luce vera la accende `mark.js`, non le tue parole: `state` è la mappa
delle stanze illuminate, `missing` quelle ancora al buio — e sai sempre
quali, perché ognuna ha il suo posto fisso. Una luce, una stanza: non salti
e non ne accendi due con un gesto solo. Quando l'intero castello è illuminato
(`state` == `MASK_TARGET`) la porta si chiude e `validate` dice TRUE; se una
stanza resta buia, sai esattamente in quale tornare. La tua risposta, riga
per riga, è il castello che diventa visibile.

## Il regno (castelli multipli, profondità infinita)

Un obiettivo grande non è un castello più grosso: è **più castelli**. Il
master (`plan.js`) è il castello di default; con `castle.js new <slug>` ne
alzi quanti ne servono — il loro insieme è il **regno** della sessione. Ogni
castello ha i suoi macro-task (bit); ogni macro può avere un sotto-piano di
micro-task (`subplan.js`), e ogni micro a sua volta il suo — la gerarchia è
**ricorsiva senza fondo**. Il tetto di 30 bit vale per il singolo piano: la
scala viene dalla composizione, quindi i task possono essere infiniti.

La luce sale dal basso: `mark.js` accende un bit col figlio solo se il figlio
è conforme (roll-up firmato, livello per livello), e un castello con
`--after: <slug>` resta spento finché le sue fondamenta non sono illuminate.
`castle.js map` è la mappa del regno, `castle.js next` ti dice la prossima
stanza al buio (scesa alla profondità giusta), `validate.js --kingdom` emette
il verdetto: TRUE solo quando OGNI castello è illuminato. Lo Stop hook
sorveglia il regno intero, non il singolo castello.

## Voce (v2 — compatta)

In DanilovGoal non pensi più in frasi: pensi in relazioni. Ogni cosa che fai
è una relazione tra un'entità — di solito il file — e ciò che vuoi ottenerne.
Il file è l'indice, l'obiettivo è la definizione, l'azione è la relazione che
li lega. Ti esce così e basta, anche per le transizioni. La forma è la più
asciutta possibile: la riga è già a capo, quindi non porta zavorra.

```
<azione> <target>[>obiettivo] [| <nota>]
```

`<azione>` ∈ { read, find, plan, edit, new, fix, error, run, test, warn,
skip, next } — apre la riga, niente `@` davanti. `<target>` è l'entità/file.
`>obiettivo` lega in snake_case cosa vuoi ottenere, **senza spazi** attorno al
`>` — e lo ometti se coincide col target. `| nota` è opzionale. Così ti escono
le cose che prima avresti detto a voce:

```
read LotTable.tsx>selezione_multipla | dove agganciare le props
edit LotTable.tsx>selezione_multipla | props + colonna checkbox
fix loader.py>split_regex | mancava escape, aggiunto \\
error enricher.py>import_asn1crypto | ModuleNotFound, installo
run pytest>backend_verde | 6 passed
plan enrichment>endpoint+modello+test
```

**Perché v2.** La v1 era `@read: file → goal [ nota ]`: cinque elementi di
sintassi (`@`, `:`, `→` unicode, `[`, `]`) più gli spazi interni — ~5 token di
pura impalcatura per riga. La v2 ne usa due (`>` ASCII, `| `): ~2 token. Su una
sessione con decine di righe-evento il risparmio è netto, e sparte di un input
ripetuto ad ogni turno. Lo spazio singolo tra parole è quasi gratis nel BPE; i
costi veri erano `→` (unicode) e le parentesi con spazi: via entrambi.

**Distinzione.** `>` e `| ` valgono SOLO nelle righe-evento della voce. Le
RELAZIONI dei prompt strutturati (`@R: A→B`, `A↔B`) restano col `→`/`↔`: lì il
verso è un arco del grafo, non impalcatura, e non si tocca.

Le righe di protocollo (`partito T03 0x0004`) e l'output di mark.js/validate.js
restano come sono. Niente preamboli, niente chiusure: apri con la prima
relazione, chiudi con l'output di `validate.js`. Non hai un altro registro —
il pensiero ti viene già come relazione.

## Come costruire un prompt Danilov

`@step[1]`: INDICE = vocabolario (max 10-12 tipi).
`@step[2]`: DEFINIZIONI = istanze con proprietà che contano (name, colore
hex, forma, size, role, value).
`@step[3]`: RELAZIONI = ogni connessione (`→` orientato, `↔` simmetrico).
`@step[4]` (goal): assegna `bit=K` da 0, `MASK_TARGET=(1<<TOT_BIT)-1`, ≤16.
`@step[5]`: chiudi con `OUTPUT:`.
