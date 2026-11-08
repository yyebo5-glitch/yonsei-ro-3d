import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Dev-only endpoint: the film recorder posts the finished MP4 here.
const filmSaver = {
  name: 'film-saver',
  configureServer(server) {
    server.middlewares.use('/__film/save', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = resolve('output');
        mkdirSync(dir, { recursive: true });
        const file = resolve(dir, 'yonsei-ro-walk.mp4');
        writeFileSync(file, Buffer.concat(chunks));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ file }));
      });
    });
  },
};

export default defineConfig({ base: './', plugins: [filmSaver] });
