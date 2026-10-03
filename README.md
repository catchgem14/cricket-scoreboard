# Maiden by SportsCo

Cricket scoring desk for ICC Test, ODI and T20 matches. Static HTML, CSS and plain JavaScript; no build step and no sign-in.

## Features

- Score ball by ball with undo, extras, free hits, powerplays, follow-on, declarations and super overs.
- Named scorer on every match and fixture.
- Tournaments: World Cup mode (two seeded groups, semi-finals, final), leagues and custom fixture lists, with a points table and net run rate.
- Stats corner for every match (worm, runs per over, run sources, phases, partnerships) and every tournament (leaders, records, scoring rates).
- Installable on Android and works offline. Data is stored on the device (`localStorage`).

## Run locally

```powershell
python -m http.server 8000
```

Open http://localhost:8000/.

## Files

- `engine.js` scoring maths, `store.js` device storage, `tournament.js` fixtures and standings, `stats.js` charts.
- `app.js` router, scorer profile and scoring screen; `hub.js` home, matches and tournaments.
- `supabase/` holds the earlier cloud schema; it is not used by the current app.

Scoring follows the ICC Playing Conditions handbook supplied (2019-20). Maiden is a scoring aid and not an official ICC product.
