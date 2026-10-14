import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import path from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const env = process.env;
const MAX_MB = Number(env.MAX_MB || 50);
const CHUNK = 3 * 1024 * 1024; // pedaços de 3 MB (a Vercel aceita no máximo 4,5 MB por requisição)
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 5 });
const UUID = /^[0-9a-f-]{36}$/i;
const fileUrl = (id) => `/api/photos/${id}/file`;
const safeName = (n) => String(n).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);

pool.query(`
  SELECT
    current_database() AS banco,
    current_schema() AS schema,
    current_user AS usuario,
    current_setting('search_path') AS search_path,
    to_regclass('public.albums') AS tabela_albums
`).then(({ rows }) => {
  console.log('DIAGNÓSTICO NEON:', rows[0]);
}).catch(console.error);

const kindOf = (mime, name) => {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (mime.startsWith('video/') || ['mp4','mov','m4v','webm','3gp','avi','mkv'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3','m4a','aac','wav','ogg','opus','flac','amr'].includes(ext)) return 'audio';
  if (mime.startsWith('image/') || ['jpg','jpeg','png','webp','gif','avif','bmp','heic','heif','tif','tiff','dng'].includes(ext)) return 'image';
  return 'other';
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));

const hits = new Map(); // limite simples contra abuso: 60 envios/hora por IP
const limit = (req, res, next) => {
  const now = Date.now(), list = (hits.get(req.ip) || []).filter((t) => now - t < 36e5);
  if (list.length >= 60) return res.status(429).json({ erro: 'Muitos envios seguidos. Tente novamente mais tarde.' });
  list.push(now); hits.set(req.ip, list); next();
};
const h = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); if (!res.headersSent) res.status(500).json({ erro: 'Erro interno do servidor.' }); else res.destroy(); });
const getAlbum = async (slug) => (await pool.query('select id, slug, title from albums where slug=$1 and is_active', [slug])).rows[0];
const listPhotos = async (albumId) => (await pool.query(
  `select id, original_name, caption, uploaded_by, mime, kind, size_bytes, created_at
   from photos where album_id=$1 and is_approved and is_complete order by created_at desc`, [albumId])).rows;
const getPhoto = async (id) => UUID.test(id) ? (await pool.query(
  'select id, original_name, mime, size_bytes, chunk_size, chunk_count from photos where id=$1 and is_approved and is_complete', [id])).rows[0] : null;

// Escreve os bytes [start, end] de um arquivo, lendo um pedaço por vez do Neon
async function writeRange(out, photo, start, end) {
  const cs = photo.chunk_size;
  for (let i = Math.floor(start / cs); i <= Math.floor(end / cs); i++) {
    const { rows } = await pool.query('select data from photo_chunks where photo_id=$1 and idx=$2', [photo.id, i]);
    if (!rows[0]) throw new Error(`pedaço ${i} faltando em ${photo.id}`);
    const base = i * cs, buf = rows[0].data.subarray(Math.max(0, start - base), end - base + 1);
    if (!out.write(buf)) await once(out, 'drain');
  }
}

async function sendFile(req, res, attachment) {
  const p = await getPhoto(req.params.id);
  if (!p) return res.status(404).json({ erro: 'Arquivo não encontrado.' });
  const size = Number(p.size_bytes);
  let start = 0, end = size - 1;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && size) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(Number(m[2]), size - 1); }
    else start = Math.max(0, size - Number(m[2]));
    if (start > end || start >= size) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.setHeader('Content-Type', p.mime || 'application/octet-stream');
  res.setHeader('Content-Length', end - start + 1);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // arquivo nunca muda: a Vercel guarda em cache
  if (attachment) res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(p.original_name)}`);
  if (req.method === 'HEAD' || !size) return res.end();
  await writeRange(res, p, start, end);
  res.end();
}

app.get('/api/albums', h(async (_req, res) => {
  const { rows } = await pool.query(`
    select a.slug, a.title, a.description, a.event_date as date, a.icon, count(p.id)::int as photo_count,
      (select id from photos where album_id=a.id and is_approved and is_complete and kind='image' order by created_at limit 1) as cover_id
    from albums a left join photos p on p.album_id=a.id and p.is_approved and p.is_complete
    where a.is_active group by a.id order by a.sort_order, a.created_at`);
  res.json(rows.map(({ cover_id, ...a }) => ({ ...a, cover: cover_id ? fileUrl(cover_id) : '' })));
}));

app.get('/api/albums/:slug/photos', h(async (req, res) => {
  const album = await getAlbum(req.params.slug);
  if (!album) return res.status(404).json({ erro: 'Álbum não encontrado.' });
  const rows = await listPhotos(album.id);
  res.json(rows.map((p) => ({
    id: p.id, name: p.original_name, caption: p.caption, by: p.uploaded_by, kind: p.kind, mime: p.mime,
    size: Number(p.size_bytes), date: p.created_at, url: fileUrl(p.id), download: `/api/photos/${p.id}/download`,
  })));
}));

// 1) o navegador avisa que vai enviar um arquivo e recebe um id
app.post('/api/albums/:slug/uploads', limit, h(async (req, res) => {
  const album = await getAlbum(req.params.slug);
  if (!album) return res.status(404).json({ erro: 'Álbum não encontrado.' });
  const { name, type = '', size = 0, caption = '', by = '' } = req.body || {};
  if (!name || !(size > 0) || size > MAX_MB * 1024 * 1024) return res.status(400).json({ erro: `Arquivo inválido ou maior que ${MAX_MB} MB.` });
  await pool.query("delete from photos where not is_complete and created_at < now() - interval '1 day'"); // envios abandonados
  const mime = String(type || 'application/octet-stream').slice(0, 100);
  const { rows } = await pool.query(
    `insert into photos (album_id, original_name, caption, uploaded_by, mime, kind, size_bytes, chunk_size, chunk_count)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [album.id, String(name).slice(0, 200), String(caption).slice(0, 120), String(by).slice(0, 60), mime, kindOf(mime, name), Math.floor(size), CHUNK, Math.ceil(size / CHUNK)]);
  res.status(201).json({ id: rows[0].id, chunkSize: CHUNK });
}));

// 2) envia cada pedaço (corpo binário cru)
app.put('/api/uploads/:id/chunks/:n', express.raw({ type: () => true, limit: CHUNK + 1024 }), h(async (req, res) => {
  const n = Number(req.params.n);
  if (!UUID.test(req.params.id) || !Number.isInteger(n) || n < 0 || !Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ erro: 'Dados inválidos.' });
  const { rowCount } = await pool.query(
    `insert into photo_chunks (photo_id, idx, data)
     select id, $2, $3 from photos where id=$1 and not is_complete and $2 < chunk_count
     on conflict (photo_id, idx) do update set data=excluded.data`, [req.params.id, n, req.body]);
  if (!rowCount) return res.status(404).json({ erro: 'Envio não encontrado.' });
  res.json({ ok: true });
}));

// 3) confere se chegou tudo e libera na galeria
app.post('/api/uploads/:id/complete', h(async (req, res) => {
  if (!UUID.test(req.params.id)) return res.status(400).json({ erro: 'Dados inválidos.' });
  const { rowCount } = await pool.query(
    `update photos p set is_complete=true where id=$1 and not is_complete
       and (select count(*) from photo_chunks c where c.photo_id=p.id) = p.chunk_count
       and (select coalesce(sum(length(data)),0) from photo_chunks c where c.photo_id=p.id) = p.size_bytes`, [req.params.id]);
  if (!rowCount) return res.status(400).json({ erro: 'O arquivo não chegou completo. Tente enviar de novo.' });
  res.json({ ok: true });
}));

app.get('/api/photos/:id/file', h((req, res) => sendFile(req, res, false)));
app.get('/api/photos/:id/download', h((req, res) => sendFile(req, res, true)));

// Baixar TODAS as fotos do álbum em um .zip
app.get('/api/albums/:slug/download', h(async (req, res) => {
  const album = await getAlbum(req.params.slug);
  if (!album) return res.status(404).json({ erro: 'Álbum não encontrado.' });
  const zip = archiver('zip', { store: true }); // fotos já são comprimidas
  zip.on('error', (e) => { console.error(e); res.destroy(); });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName(album.title)}.zip"`);
  zip.pipe(res);
  let n = 0;
  const used = new Set();
  const unique = (name) => { let f = name; while (used.has(f)) f = `${++n}-${name}`; used.add(f); return f; };
  for (const row of await listPhotos(album.id)) {
    const p = await getPhoto(row.id);
    // o zip lê um arquivo por vez, então cada pedaço só sai do Neon na hora de entrar no zip
    zip.append(Readable.from((async function* () {
      for (let i = 0; i < p.chunk_count; i++) yield (await pool.query('select data from photo_chunks where photo_id=$1 and idx=$2', [p.id, i])).rows[0].data;
    })()), { name: unique(p.original_name) });
  }
  await zip.finalize();
}));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'site-nathanael'
  });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        current_database() AS banco,
        current_schema() AS schema,
        current_user AS usuario,
        to_regclass('public.albums') IS NOT NULL AS tabela_existe
    `);

    res.json({
      status: 'conectado',
      ...rows[0]
    });
  } catch (error) {
    console.error('ERRO NEON PRODUCAO:', {
      message: error.message,
      code: error.code,
      name: error.name
    });

    res.status(503).json({
      status: 'erro',
      codigo: error.code || 'SEM_CODIGO'
    });
  }
});

app.use(express.static(PUBLIC_DIR, { dotfiles: 'ignore', maxAge: '1h' }));

export default app; // a Vercel usa este export
if (!env.VERCEL) app.listen(env.PORT || 3000, () => console.log(`Site no ar: http://localhost:${env.PORT || 3000}`));
