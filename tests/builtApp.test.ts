/// <reference types="bun" />
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { serveBuiltApp } from '../server/builtApp.ts';

describe('serveBuiltApp', () => {
  const servers: Server[] = [];
  const folders: string[] = [];
  let built = '';
  let empty = '';

  async function start(distDir: string): Promise<string> {
    const app = express();
    serveBuiltApp(app, distDir);
    const server = app.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    return `http://127.0.0.1:${(address satisfies AddressInfo).port}`;
  }

  beforeAll(async () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cratesync-built-'));
    folders.push(dist);
    fs.mkdirSync(path.join(dist, 'assets', 'aistudio'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>CrateSync</title>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-C3SLzDb5.js'), 'export {};');
    fs.writeFileSync(path.join(dist, 'assets', 'index-Blg1bY3L.css'), 'body{}');
    fs.writeFileSync(path.join(dist, 'assets', 'aistudio', 'image_dbebd81c.png'), 'png');
    built = await start(dist);

    const none = fs.mkdtempSync(path.join(os.tmpdir(), 'cratesync-empty-'));
    folders.push(none);
    empty = await start(none);
  });

  afterAll(() => {
    for (const server of servers) server.close();
    for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
  });

  test('lets the browser keep a file whose name carries a content hash', async () => {
    for (const name of ['index-C3SLzDb5.js', 'index-Blg1bY3L.css']) {
      const reply = await fetch(`${built}/assets/${name}`);
      expect(reply.status).toBe(200);
      expect(reply.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    }
  });

  test('does not tell the browser to keep a file with a plain name', async () => {
    const reply = await fetch(`${built}/assets/aistudio/image_dbebd81c.png`);
    expect(reply.status).toBe(200);
    expect(reply.headers.get('cache-control')).not.toContain('immutable');
  });

  test('answers 404, not the page, for a file under /assets that is gone', async () => {
    const reply = await fetch(`${built}/assets/TransferView-gone1234.js`);
    expect(reply.status).toBe(404);
    expect(reply.headers.get('content-type')).toContain('text/plain');
    expect(await reply.text()).not.toContain('<!doctype html>');
  });

  test('answers a page address with the page, which the browser checks again each visit', async () => {
    const reply = await fetch(`${built}/some/page`);
    expect(reply.status).toBe(200);
    expect(reply.headers.get('content-type')).toContain('text/html');
    expect(reply.headers.get('cache-control')).not.toContain('immutable');
    expect(await reply.text()).toContain('<title>CrateSync</title>');
  });

  test('says the build is missing when there is no page to send', async () => {
    const reply = await fetch(`${empty}/`);
    expect(reply.status).toBe(404);
    expect(await reply.text()).toContain('bun run build');
  });
});
