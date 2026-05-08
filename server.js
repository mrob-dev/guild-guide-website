import express from 'express';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

const app = express();

app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR));

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Guild → http://localhost:${PORT}`);
});
