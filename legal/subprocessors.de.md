---
date: 2026-09-19
status: draft
translates: 2026-09-18+d52d92a5
review: Sachliche Angaben, keine juristische Formulierung — aber sie müssen genau der Wirklichkeit entsprechen, und die Wirklichkeit ändert sich. Auch diese Übersetzung ist noch nicht geprüft worden; wo die Übersetzung und der englische Text voneinander abweichen, gilt der englische Text.
---

# Wer sonst beteiligt ist

*Dies ist eine Übersetzung des englischen Textes. Wo die beiden voneinander abweichen, gilt der englische Text.*

Dies ist die vollständige Liste der anderen Unternehmen, die mit den Daten Ihres Vereins in Berührung kommen. Sie ist eine **Offenlegung, keine Vereinbarung** — hier gibt es nichts zu akzeptieren. Sie hat eine eigene Versionsnummer, damit sich, wenn ein Unternehmen hinzukommt, diese Liste ändert und nichts anderes, und damit Sie sehen können, wann sie zuletzt geändert wurde.

**Wenn wir jemanden hinzunehmen, wird Ihr Verein informiert, bevor es geschieht.**

## Heute

| Wer | Wo | Wofür | Was sie sehen können |
|---|---|---|---|
| Der Server, auf dem die Daten Ihres Vereins liegen | *(wird angegeben, sobald das Hosting feststeht — siehe docs/LAUNCH_PHASES.md Phase 2)* | Betrieb des Dienstes | Alles, was auf dem Server gespeichert ist |
| Cloudflare | Weltweit | Weiterleitung der Verbindung zwischen Ihnen und dem Server | Den Datenverkehr der Verbindung. Nicht die Inhalte Ihres Kontos |

## Sobald kostenpflichtige Abonnemente beginnen

| Wer | Wofür | Was sie sehen können |
|---|---|---|
| Stripe | Abwicklung von Karten- und TWINT-Zahlungen | Die Zahlungsdaten des Vereins. **Nie Daten eines Spielers** |
| bexio | Ausstellen von Rechnungen | Die Rechnungsangaben des Vereins. **Nie Daten eines Spielers** |

## Nur wenn eingeschaltet, standardmässig ausgeschaltet

| Wer | Wofür | Was sie sehen können |
|---|---|---|
| Ein Text-zu-Video-Anbieter | Umwandlung eines Spielzugs in einen kurzen animierten Clip | Die **Taktiktafel-Animation** eines Spielzugs — nie Spielaufnahmen, nie ein Kind |
| Anthropic | Ein Support-Assistent, falls einer gebaut wird | Was Sie ihm eintippen und was er zum Antworten braucht |

## Nie

Wir verwenden keine Werbenetzwerke, keine Analysedienste und keinerlei Tracker. Nichts wird an irgendjemanden verkauft, zu keinem Zweck.

## Was die App NIRGENDWOHIN sendet

Die App erkennt Muster in den eigenen Spielzügen eines Trainers, um Vorschläge zu machen. Aus diesen Mustern werden jeder Titel, jede Notiz, jeder Name, jedes Team und jeder Verein entfernt, und sie werden **auf dem eigenen Gerät dieses Trainers** gespeichert. Diese Muster werden nie an uns oder an sonst jemanden gesendet.
