---
date: 2026-09-19
status: draft
translates: 2026-09-18+d52d92a5
review: Texte factuel, et non rédaction juridique — mais il doit correspondre exactement à la réalité, et la réalité change. Cette traduction n’a pas non plus été relue, et en cas de divergence entre la traduction et le texte anglais, le texte anglais fait foi.
---

# Qui d’autre intervient

*Ceci est une traduction du texte anglais. En cas de divergence, le texte anglais fait foi.*

Voici la liste complète des autres entreprises qui ont accès aux données de votre club. Il s’agit
d’une **information, et non d’un contrat** — il n’y a rien à accepter ici. Elle a son propre numéro
de version, afin que l’ajout de quelqu’un modifie cette liste et rien d’autre, et que vous puissiez
voir quand elle a changé pour la dernière fois.

**Si nous ajoutons quelqu’un, votre club en est informé avant que cela se produise.**

## Aujourd’hui

| Qui | Où | Pour quoi | Ce qu’ils peuvent voir |
|---|---|---|---|
| Le serveur sur lequel se trouvent les données de votre club | *(à indiquer une fois l’hébergement arrêté — voir docs/LAUNCH_PHASES.md Phase 2)* | Exploitation du service | Tout ce qui est stocké sur le serveur |
| Cloudflare | Monde entier | Acheminement de la connexion entre vous et le serveur | Le trafic de connexion. Pas le contenu de votre compte |

## Lorsque les abonnements payants commenceront

| Qui | Pour quoi | Ce qu’ils peuvent voir |
|---|---|---|
| Stripe | Encaissement des paiements par carte et TWINT | Les données de paiement du club. **Jamais les données d’un joueur** |
| bexio | Émission des factures | Les données de facturation du club. **Jamais les données d’un joueur** |

## Uniquement si activé, et désactivé par défaut

| Qui | Pour quoi | Ce qu’ils peuvent voir |
|---|---|---|
| Un prestataire texte-vers-vidéo | Transformer une combinaison en un court clip animé | L’**animation du tableau** d’une combinaison — jamais d’images de match, jamais un enfant |
| Anthropic | Un assistant de support, s’il en est développé un | Ce que vous lui écrivez, et ce dont il a besoin pour répondre |

## Jamais

Nous n’utilisons ni réseaux publicitaires, ni services d’analytique, ni traceurs d’aucune sorte.
Rien n’est vendu à qui que ce soit, à quelque fin que ce soit.

## Ce que l’application n’envoie NULLE PART

L’application repère des schémas dans les propres combinaisons d’un entraîneur afin de faire des
suggestions. Ces schémas sont dépouillés de chaque titre, note, nom, équipe et club, et sont
conservés **sur le propre appareil de cet entraîneur**. Ils ne sont jamais envoyés ni à nous ni à
qui que ce soit d’autre.
