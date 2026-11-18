/* global __dirname */
/** Local static homepage preview. Uses the backend's existing Express dependency. */
const path = require('node:path');
const {createRequire} = require('node:module');
const express = createRequire(path.resolve(__dirname, '../backend/package.json'))('express');
const app = express();
const home = path.resolve(__dirname, '../public/home');
app.get('/', (_req, res) => res.sendFile(path.join(home, 'index.html')));
app.use('/home', express.static(home));
for (const page of ['privacy', 'terms', 'cookies', 'account-deletion', 'contact', 'content-policy']) {
  app.get(`/${page}`, (_req, res) => res.sendFile(path.join(home, 'legal', `${page}.html`)));
}
const port = Number(process.env.PORT || 4174);
app.listen(port, '127.0.0.1', () => console.log(`Mystash homepage: http://127.0.0.1:${port}`));
