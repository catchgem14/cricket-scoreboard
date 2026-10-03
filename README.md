# CricNova

CricNova is a responsive, installable cricket scorer built with plain HTML, CSS, and JavaScript. It runs on GitHub Pages without a build step.

## Features

- Test, One Day International, and T20 International match setup
- Innings progression, targets, Test declarations, follow-on eligibility, and limited-overs tie handling
- Ball-by-ball scoring, batter and bowler figures, extras, fall of wickets, and over summaries
- Legal-ball tracking, bowler quotas, free hits after no-balls, undo, and local match persistence
- Responsive score centre for desktop, tablet, and mobile; Android install and offline launch support
- Tournament workspaces with admin, assigned-scorer, and viewer roles
- Supabase-backed sign-in, shared scorecards, live match updates, and concurrent-version protection

## Multi-scorer setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. In the Supabase dashboard, enable Realtime for the `public.matches` table and configure email-link authentication with the GitHub Pages URL as an allowed redirect.
4. Copy the project URL and **publishable** key into `supabase-config.js`. Never use a service-role key in this browser app.
5. Publish the updated files to GitHub Pages.

The tournament creator becomes an admin and receives an invite code. Members join as scorers; an admin can change them to viewers or admins, create fixtures, and assign each match to one scorer. Different assigned matches can be scored at the same time. Other tournament members receive live, read-only score updates. Score writes use a version check so stale tabs are stopped instead of silently replacing a newer score.

Cloud scoring stays unavailable until Supabase is configured. The local scorer remains available for testing on one device.

## Rules profile

Scoring follows the relevant innings, over, runs, no-ball, wide, bye, and leg-bye conditions from the supplied ICC Playing Conditions Handbook 2019–20. This is a scoring aid, not an official ICC product. Competition-specific revisions, DLS calculations, umpire decisions, and non-scoring regulations are not automated.

## Local run

Open `index.html` directly in a browser, or serve the files locally with:

```bash
cd cricket-scoreboard
python -m http.server 8000
```

Then open http://localhost:8000 in a browser.

## Install on Android

After the site is published over HTTPS, open it in Chrome on Android, open the browser menu, and choose **Install app** or **Add to Home screen**. The app shell is cached for offline launches; match data remains saved on that device.

## GitHub Pages deployment

1. Push this folder to a GitHub repository.
2. In GitHub, go to the repository settings.
3. Open Pages.
4. Select the branch to deploy (for example `main`), and keep the folder as `/root`.
5. Save the settings.
6. GitHub will give you a public URL for the scoreboard.

## Notes

Cloud match data is shared within a tournament according to its membership roles. The local demo stores data in the current browser only. DLS calculations and competition-specific rule changes are not automated.
