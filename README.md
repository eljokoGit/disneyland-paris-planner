# Disneyland Paris Two-Day Planner

*[Version française](README.fr.md)*

A phone-first web app to run two full days at Disneyland Paris — one hand free,
in the sun, with a five-year-old in the other arm.

**Success criterion:** at 3:12 pm on day one, take out your phone and know in
three seconds whether you are on time and what comes next.

> **About this repository.** A personal project, shared as-is after the trip
> (3–4 September 2026). Family details are anonymised, and the server and email
> addresses are replaced with placeholders (`exemple.com`, `mon-serveur`). The
> official park maps are not included because they are copyrighted — see
> `data/plans/LISEZ-MOI.txt`. Email alerts are switched off in
> `data/alertes-mail.json`.
>
> The app runs in **French and Spanish**. The code, its comments and the plan
> data are written in French.

## Quick start

Requires Node.js 22.

```bash
cd backend && npm install
cd ../frontend && npm install && npm run build
cd ../backend && node server.js        # http://localhost:3000
```

With `APP_CLE` left empty, no access key is required. For development, run
`node --watch server.js` in `backend/` and `npm run dev` in `frontend/` (Vite
proxies `/api` to port 3000).

## The five screens

- **Now** (*Maintenant*) — 90% of the use. A banner answers one question at a
  glance: on time, early or late, and how many minutes until the next fixed
  appointment. Below it: the current step in large type, a **Done** button, an
  undo, the next step, the note, a park map and nearby photo spots. When a delay
  truly threatens an appointment, and only then, the app shows what it costs and
  which activity could be dropped. Otherwise it stays quiet.
- **Day** (*Journée*) — the full timeline, with anchored steps and buffers
  (walks, free time, meals) marked. At the bottom: the order in which
  activities get sacrificed, re-orderable, and the day's decision points.
- **Waits** (*Attentes*) — every wait time in the park, live, with the hourly
  history collected over previous days.
- **Bookings** (*Résas*) — virtual queues: email alerts per queue, and the slot
  you obtained. Entering a slot re-schedules the whole day around it.
- **Settings** (*Réglages*) — language (per phone), the state to copy for
  Claude, and the day's log.

## How it works

- **One engine, both sides.** `shared/moteur.js` computes the schedule and is
  imported as-is by the server *and* the browser, so the phone keeps
  recalculating when the network drops, without ever diverging from the server.
- **Anchors.** Only two things are fixed: a virtual-queue slot you actually
  obtained, and a show with a single performance. Everything else can move. A
  slot that is not yet obtained anchors nothing.
- **The clock, not the tap.** Delay is measured against the clock, never
  against when someone pressed a button.
- **Hard rules.** `shared/contraintes.js` holds 16 rules (nothing silently
  dropped, meal windows, walking times, real showtimes, opening hours, toilet
  breaks…). A plan that breaks a hard rule is refused by the server and nothing
  is written. Every replaced plan is backed up.
- **Wait-time collector.** `collecteur/` is a separate service that reads
  [ThemeParks.wiki](https://themeparks.wiki) every 5 minutes — standby and Single
  Rider waits, Premier Access prices and return windows, virtual queues,
  showtimes, per-attraction hours — archives everything, and emails when a
  virtual queue opens or closes. It is kept apart on purpose: redeploying the app
  never leaves a hole in the history.
- **Bad park network.** Every action applies locally first, then syncs. Failed
  sends wait in a `localStorage` queue replayed in order; the last snapshot is
  cached so the app opens offline. Updates reach every phone live over SSE.

## Languages

The interface and the plan content exist in French and Spanish. French is the
key: the code calls `t('Dans les temps')`, the Spanish lives in
`frontend/src/i18n/es.js` (interface) and `frontend/src/i18n/plan-es.json` (plan
texts). A missing translation falls back to French. List what is missing with:

```bash
node outils/verifier-traductions.mjs --liste
```

The recalculation text for Claude and the "state to copy" stay in French on
purpose — that is the language the planning procedure reads.

## Planning with Claude Code

There is no feedback system in the app. During the day, you talk to Claude
directly: **Copy the situation for Claude** produces a brief, and the skill in
`.claude/skills/recalcul-plan/` describes how a plan is recalculated, checked
and pushed (`PUT /api/plan`). `data/README.md` describes who owns which file.

## Deployment

The original setup ran on a small home server:

```bash
cp .env.exemple .env           # APP_CLE, PUID/PGID
docker compose up -d --build   # starts the app AND the collector
./watch-and-rebuild.sh &       # rebuilds when synced code changes
```

Access goes through a secret link, `https://<domain>/?k=<APP_CLE>`. An nginx
template is in `deploiement/nginx-disney.conf.modele`; the `/api/stream` block is
required, or nginx buffers the live updates. Code and data were synced from a
Windows PC with Syncthing — see `deploiement/syncthing.md`.

## Project layout

```
backend/      Express server: API, atomic writes, file watching, SSE
frontend/     React + Vite, offline cache and action queue, i18n
shared/       moteur.js (schedule engine), contraintes.js (rules), brief.js
collecteur/   standalone wait-time collector and email alerts
data/         plan.json (the two days), alertes-mail.json, README.md
deploiement/  nginx / systemd templates, Syncthing notes, server inspection
outils/       CLI, plan search, tests, translation check
```

## Tests and tools

```bash
node outils/test-journee.mjs          # day reset at midnight
node outils/test-garde-journee.mjs    # a started day is never wiped
node outils/verifier-traductions.mjs  # translation coverage
node outils/chercher-plan.mjs 1       # try every showtime combination for day 1
```

## API

| Method | Route | Effect |
|---|---|---|
| GET | `/api/etat` | human-readable summary (text) |
| GET | `/api/snapshot` | plan + state + computed days (JSON) |
| GET | `/api/stream` | SSE: plan reloaded, state changed |
| GET | `/api/journal` | full log |
| GET | `/api/attentes/:jour` | live wait times for the whole park |
| GET | `/api/historique/:jour` | hourly averages from the collected history |
| GET | `/api/plans-precedents` · `/:fichier` | list plan backups / read one without applying it |
| PUT | `/api/plan` | replace the plan (checked against the rules) |
| POST | `/api/plan/verifier` | check a plan without saving it |
| POST | `/api/etape/:id/terminee` · `/reprendre` | mark a step done / undo |
| POST | `/api/etape/:id/supprimer` · `/restaurer` | drop a step for the day / put it back |
| POST | `/api/etape/:id/annuler` · `/retablir` | cancellation (weather, closure, full) / undo |
| POST | `/api/etape/:id/duree` | `{ minutes }` — shorten free time or a meal |
| POST | `/api/creneau/:id` | `{ obtenu, heure }` — virtual-queue slot obtained |
| POST | `/api/file/:id` | follow or mute a virtual queue's email alerts |
| POST | `/api/reprise` | restart the day's schedule from a given time |
| POST | `/api/jour` | `{ jour: 1 \| 2 }` — active day |
