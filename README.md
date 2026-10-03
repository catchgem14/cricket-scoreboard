# Cricket Scoreboard

A lightweight cricket scoring app built with plain HTML, CSS, and JavaScript so it can be hosted on GitHub Pages with no build step.

## Features

- Simple score tracking for runs, wickets, and overs
- Quick action buttons for 0, 1, 2, 3, 4, 6, wide, no ball, and wicket
- Undo and reset controls
- Responsive layout for desktop, laptop, tablet, and mobile
- Stores match state locally in the browser
- Can be installed on Android from Chrome and runs offline after its first visit

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

This is intentionally lightweight to keep the app simple and fast to load on mobile devices and shared public links.
