---
date: 2026-09-18
status: draft
review: Factual, not legal drafting — but it must match reality exactly, and reality changes.
---

# Who else is involved

This is the full list of other companies that touch your club's data. It is a **disclosure, not an
agreement** — there is nothing here to accept. It has its own version so that adding someone
changes this list and nothing else, and so you can see when it last changed.

**If we add anyone, your club is told before it happens.**

## Today

| Who | Where | What for | What they can see |
|---|---|---|---|
| The server your club's data is on | *(to be stated once hosting is settled — see docs/LAUNCH_PHASES.md Phase 2)* | Running the service | Everything stored on the server |
| Cloudflare | Global | Carrying the connection between you and the server | Connection traffic. Not the contents of your account |

## When paid subscriptions start

| Who | What for | What they can see |
|---|---|---|
| Stripe | Taking card and TWINT payments | The club's payment details. **Never a player's data** |
| bexio | Issuing invoices | The club's billing details. **Never a player's data** |

## Only if switched on, and off by default

| Who | What for | What they can see |
|---|---|---|
| A text-to-video provider | Turning a play into a short animated clip | The **board animation** of a play — never match footage, never a child |
| Anthropic | A support assistant, if one is built | What you type to it, and what it needs to answer |

## Never

We do not use advertising networks, analytics services or trackers of any kind. Nothing is sold to
anyone, for any purpose.

## What the app does NOT send anywhere

The app notices patterns in a coach's own plays to make suggestions. Those patterns are stripped of
every title, note, name, team and club and are kept **on that coach's own device**. They are never
sent to us or to anybody else.
