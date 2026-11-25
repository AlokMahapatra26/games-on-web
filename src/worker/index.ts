import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  GAMES_BUCKET: R2Bucket;
};

type GameRow = {
  id: number;
  slug: string;
  title: string;
  creator: string;
  entry_file: string;
  created_at: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot !== -1) {
    const ext = lower.slice(dot);
    if (MIME_TYPES[ext]) return MIME_TYPES[ext];
  }
  return 'application/octet-stream';
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const rand = crypto.randomUUID().slice(0, 6);
  return `${base || 'game'}-${rand}`;
}

function normalizePath(rawPath: string): string | null {
  const cleaned = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..') || cleaned.includes('\0')) {
    return null;
  }
  return cleaned;
}

app.get('/api/games', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, slug, title, creator, entry_file, created_at FROM games ORDER BY id DESC LIMIT 100'
  ).all<GameRow>();
  return c.json({ games: results ?? [] });
});

app.get('/api/games/:slug', async (c) => {
  const slug = c.req.param('slug');
  const game = await c.env.DB.prepare(
    'SELECT id, slug, title, creator, entry_file, created_at FROM games WHERE slug = ?'
  )
    .bind(slug)
    .first<GameRow>();

  if (!game) {
    return c.json({ error: 'Game not found' }, 404);
  }
  return c.json({ game });
});

app.post('/api/games', async (c) => {
  const formData = await c.req.formData();
  const title = String(formData.get('title') ?? '').trim().slice(0, 80);
  const creator = String(formData.get('creator') ?? '').trim().slice(0, 40) || 'Anonymous';

  if (!title) {
    return c.json({ error: 'Game title is required.' }, 400);
  }

  const rawFiles = formData.getAll('files');
  const rawPaths = formData.getAll('paths').map((p) => String(p));

  const files = rawFiles.filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return c.json({ error: 'Please attach at least one HTML file or zip.' }, 400);
  }
  if (files.length > 100) {
    return c.json({ error: 'Too many files (max 100).' }, 400);
  }

  let totalBytes = 0;
  const entries: { path: string; file: File }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    totalBytes += file.size;
    if (totalBytes > 25 * 1024 * 1024) {
      return c.json({ error: 'Total game size exceeds 25 MB limit.' }, 400);
    }
    const relPath = normalizePath(rawPaths[i] || file.name);
    if (!relPath) {
      return c.json({ error: 'Invalid file path.' }, 400);
    }
    entries.push({ path: relPath, file });
  }

  // If a single .html/.htm file was uploaded with a custom name, normalize it to index.html
  if (entries.length === 1 && /\.(html?)$/i.test(entries[0].path)) {
    entries[0].path = 'index.html';
  }

  const hasIndex = entries.some((e) => e.path.toLowerCase() === 'index.html');
  if (!hasIndex) {
    return c.json({ error: 'Your upload must include an index.html file.' }, 400);
  }

  const slug = slugify(title);

  await Promise.all(
    entries.map(async ({ path, file }) => {
      const buffer = await file.arrayBuffer();
      await c.env.GAMES_BUCKET.put(`games/${slug}/${path}`, buffer, {
        httpMetadata: {
          contentType: getMimeType(path),
        },
      });
    })
  );

  await c.env.DB.prepare(
    'INSERT INTO games (slug, title, creator, entry_file) VALUES (?, ?, ?, ?)'
  )
    .bind(slug, title, creator, 'index.html')
    .run();

  const created = await c.env.DB.prepare(
    'SELECT id, slug, title, creator, entry_file, created_at FROM games WHERE slug = ?'
  )
    .bind(slug)
    .first<GameRow>();

  return c.json({ game: created }, 201);
});

app.get('/sandbox/:slug/*', async (c) => {
  const slug = c.req.param('slug');
  const prefix = `/sandbox/${slug}/`;
  const reqPath = new URL(c.req.url).pathname;
  const rawSubPath = reqPath.startsWith(prefix) ? reqPath.slice(prefix.length) : '';
  const subPath = normalizePath(rawSubPath || 'index.html');

  if (!subPath) {
    return c.text('Invalid path', 400);
  }

  const object = await c.env.GAMES_BUCKET.get(`games/${slug}/${subPath}`);
  if (!object) {
    return c.text('Not found', 404);
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    object.httpMetadata?.contentType || getMimeType(subPath)
  );
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(object.body, { headers });
});

export default app;

