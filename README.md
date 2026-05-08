# guild-guide-website

"Coming Soon" landing page for Guild — a tiny Node.js site, zero dependencies, using the Guild brand palette.

## Run locally

```sh
npm start          # serves on http://localhost:3000
npm run dev        # same, but auto-restarts on server.js changes
```

Set `PORT` to override (`PORT=8080 npm start`).

## Files

- `index.js` — Express server (zero config, serves `public/`)
- `index.html` — markup
- `styles.css` — brand tokens mirrored from the Flutter app's `lib/core/theme/guild_colors.dart`

## Deploy

Anywhere that runs Node 18+: Vercel, Render, Fly, Railway, a plain VM. Set `PORT` via env if the platform requires it (most do — the server already reads it).
