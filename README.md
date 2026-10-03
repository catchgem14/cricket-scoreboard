# CricNova

CricNova is a responsive, installable cricket scorer built with plain HTML, CSS, and JavaScript. It runs on GitHub Pages without a build step.

## Features

- Test, One Day International, and T20 International match setup
- Innings progression, targets, Test declarations, follow-on eligibility, and limited-overs tie handling
- Ball-by-ball scoring, batter and bowler figures, extras, fall of wickets, and over summaries
- Legal-ball tracking, bowler quotas, free hits after no-balls, undo, and local match persistence
- Responsive score centre for desktop, tablet, and mobile; Android install and offline launch support

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

Match data is stored in the current browser on the current device. This static version does not synchronize scorecards between devices.
