const express = require('express');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

// Pretty URLs.
const PRETTY_ROUTES = {
  '/apply': 'apply.html',
  '/imprint': 'imprint.html',
  '/privacy': 'privacy.html',
  '/upgrade': 'upgrade.html',
  '/legal': 'legal.html',
  '/terms': 'terms.html',
  '/acceptable-use': 'acceptable-use.html',
  '/cookies': 'cookies.html',
  '/data-retention': 'data-retention.html',
  '/dsa-notice': 'dsa-notice.html',
  '/copyright': 'copyright.html',
  '/guide-agreement': 'guide-agreement.html',
  '/operator-agreement': 'operator-agreement.html',
};
for (const [route, file] of Object.entries(PRETTY_ROUTES)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, file));
  });
}
// /app — landing page targeted by approval-email GUILD_LOGIN_URL.
// "You're approved, here's how to install the app" copy + store
// badges (placeholders until App Store / Play Store listings are live).
app.get('/app', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});
// /admin — city admin dashboard. Auth gated client-side via Supabase,
// then admins approve/reject pending guide_applications. /admin/* is
// handled by express.static for css/js; this route resolves the bare
// /admin URL to the dashboard's index.html.
app.get('/admin', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin', 'index.html'));
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Guild → http://localhost:${PORT}`);
});
