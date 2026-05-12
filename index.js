const express = require('express');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

// Pretty URLs: /apply, /imprint, /privacy, /upgrade
app.get('/apply', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'apply.html'));
});
app.get('/imprint', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'imprint.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});
app.get('/upgrade', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'upgrade.html'));
});
// /app — landing page targeted by approval-email GUILD_LOGIN_URL.
// "You're approved, here's how to install the app" copy + store
// badges (placeholders until App Store / Play Store listings are live).
app.get('/app', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'app.html'));
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Guild → http://localhost:${PORT}`);
});
