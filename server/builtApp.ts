import express from 'express';
import fs from 'fs';
import path from 'path';

/**
 * Vite ends the name of every script and stylesheet it builds with a hash of the contents,
 * such as index-C3SLzDb5.js. A file with such a name never changes, so a browser may keep it
 * for good. Files copied from public/ keep their own names and get no such promise.
 */
const HASHED_NAME = /-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

/** Serves the production build in `distDir`: its files first, then the page for any other address. */
export function serveBuiltApp(app: express.Express, distDir: string): void {
  app.use(
    '/assets',
    express.static(path.join(distDir, 'assets'), {
      setHeaders(res, filePath) {
        if (HASHED_NAME.test(filePath)) {
          res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`);
        }
      },
    })
  );
  // A file under /assets that is gone answers 404. The page fallback below would answer a
  // script request with HTML, which the browser reports as a broken module. A deploy removes
  // the old scripts, so a tab opened before it can ask for one.
  app.use('/assets', (_req, res) => {
    res.status(404).type('text/plain').send('Not found');
  });
  app.use(express.static(distDir));
  app.get('*', (_req, res) => {
    const indexFile = path.join(distDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(404).send('Build output not found. Run bun run build first.');
    }
  });
}
