// Cria as tabelas no Neon (schema.sql) e sobe as fotos locais listadas em public/local-fotos.js.
// Uso: node scripts/migrar-fotos.js   (lê DATABASE_URL do .env). Pode rodar de novo: pula fotos já enviadas.
import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CHUNK = 3 * 1024 * 1024;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query(fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8'));
console.log('Tabelas prontas.');

const sandbox = {};
new Function('window', fs.readFileSync(path.join(PUBLIC_DIR, 'local-fotos.js'), 'utf8'))(sandbox);
const catalog = sandbox.NATHANAEL_FOTOS_LOCAIS || {};
const base = Date.parse('2026-10-12T00:00:00Z');

for (const [slug, list] of Object.entries(catalog)) {
  const album = (await db.query('select id from albums where slug=$1', [slug])).rows[0];
  if (!album) { console.log(`Álbum "${slug}" não existe no banco, pulando.`); continue; }
  for (const [i, f] of list.entries()) {
    const abs = path.resolve(PUBLIC_DIR, f.url), name = path.basename(abs);
    if (!fs.existsSync(abs)) { console.log(`Não achei ${f.url}`); continue; }
    if ((await db.query('select 1 from photos where album_id=$1 and original_name=$2 and is_complete', [album.id, name])).rowCount) continue;
    const data = fs.readFileSync(abs), mime = MIME[path.extname(name).slice(1).toLowerCase()] || 'application/octet-stream';
    await db.query('begin');
    const { rows } = await db.query(
      `insert into photos (album_id, original_name, mime, kind, size_bytes, chunk_size, chunk_count, is_complete, created_at)
       values ($1,$2,$3,'image',$4,$5,$6,true,$7) returning id`,
      [album.id, name, mime, data.length, CHUNK, Math.ceil(data.length / CHUNK), new Date(base - i * 1000)]); // mantém a ordem original na galeria
    for (let c = 0; c * CHUNK < data.length; c++)
      await db.query('insert into photo_chunks (photo_id, idx, data) values ($1,$2,$3)', [rows[0].id, c, data.subarray(c * CHUNK, (c + 1) * CHUNK)]);
    await db.query('commit');
    console.log(`[${slug}] ${i + 1}/${list.length} ${name}`);
  }
}
await db.end();
console.log('Migração concluída.');
