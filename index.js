const express = require('express');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

// Pretty URLs: /apply -> apply.html, /imprint -> imprint.html, /privacy -> privacy.html
app.get('/apply', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'apply.html'));
});
app.get('/imprint', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'imprint.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'privacy.html'));
});

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Guild → http://localhost:${PORT}`);
});
