---
date: 2026-09-19
status: draft
translates: 2026-09-18+d52d92a5
review: Testo fattuale, non redazione giuridica — ma deve corrispondere esattamente alla realtà, e la realtà cambia. Nemmeno questa traduzione è stata rivista; dove la traduzione e il testo inglese divergono, fa stato il testo inglese.
---

# Chi altro è coinvolto

*Questa è una traduzione del testo inglese. Dove i due testi divergono, fa stato il testo inglese.*

Questo è l’elenco completo delle altre aziende che entrano in contatto con i dati del Suo club. È
un’**informativa, non un accordo** — qui non c’è nulla da accettare. Ha una propria versione, così
che l’aggiunta di qualcuno modifichi questo elenco e nient’altro, e così che Lei possa vedere quando
è cambiato l’ultima volta.

**Se aggiungiamo qualcuno, il Suo club viene informato prima che ciò avvenga.**

## Oggi

| Chi | Dove | Per che cosa | Che cosa possono vedere |
|---|---|---|---|
| Il server su cui si trovano i dati del Suo club | *(da indicare quando l’hosting sarà definito — vedi docs/LAUNCH_PHASES.md, fase 2)* | Gestione del servizio | Tutto ciò che è memorizzato sul server |
| Cloudflare | In tutto il mondo | Trasporto della connessione tra Lei e il server | Il traffico di connessione. Non il contenuto del Suo account |

## Quando inizieranno gli abbonamenti a pagamento

| Chi | Per che cosa | Che cosa possono vedere |
|---|---|---|
| Stripe | Incasso dei pagamenti con carta e TWINT | I dati di pagamento del club. **Mai i dati di un giocatore** |
| bexio | Emissione delle fatture | I dati di fatturazione del club. **Mai i dati di un giocatore** |

## Solo se attivati, e disattivati per impostazione predefinita

| Chi | Per che cosa | Che cosa possono vedere |
|---|---|---|
| Un fornitore di servizi text-to-video | Trasformare uno schema in una breve clip animata | L’**animazione sulla lavagna** di uno schema — mai riprese delle partite, mai un bambino |
| Anthropic | Un assistente di supporto, se ne verrà realizzato uno | Ciò che Lei gli scrive e ciò di cui ha bisogno per rispondere |

## Mai

Non utilizziamo reti pubblicitarie, servizi di analisi né tracker di alcun tipo. Nulla viene venduto
a nessuno, per nessuno scopo.

## Ciò che l’app NON invia da nessuna parte

L’app rileva modelli ricorrenti negli schemi di un allenatore per dare suggerimenti. Questi modelli
sono privati di ogni titolo, nota, nome, squadra e club e sono conservati **sul dispositivo
personale di quell’allenatore**. Non vengono mai inviati a noi né a nessun altro.
