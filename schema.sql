-- Rode no SQL Editor do Neon (pode rodar de novo sem problemas).
-- Os arquivos (fotos, vídeos, áudios) ficam guardados no próprio Neon, divididos em pedaços
-- de até 3 MB na tabela photo_chunks (limite de envio por requisição da Vercel é 4,5 MB).
create extension if not exists pgcrypto;

create table if not exists albums (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  title       text not null,
  description text not null default '',
  event_date  date,
  icon        text not null default '♡',
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists photos (
  id            uuid primary key default gen_random_uuid(),
  album_id      uuid not null references albums(id) on delete cascade,
  original_name text not null,
  caption       text not null default '',
  uploaded_by   text not null default '',
  mime          text not null default '',
  kind          text not null default 'other' check (kind in ('image','video','audio','other')),
  size_bytes    bigint not null default 0,
  chunk_size    int not null default 3145728,
  chunk_count   int not null default 0,
  is_complete   boolean not null default false,
  is_approved   boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists photos_album_idx on photos (album_id, created_at desc);

create table if not exists photo_chunks (
  photo_id uuid not null references photos(id) on delete cascade,
  idx      int  not null,
  data     bytea not null,
  primary key (photo_id, idx)
);

insert into albums (slug, title, description, event_date, icon, sort_order) values
 ('cha_de_bebe', 'Chá de Bebê', 'Nosso pequeno aventureiro está chegando. Com muito amor e alegria, celebramos junto de pessoas especiais!', '2026-10-11', '♡', 1),
 ('nascimento_bebe', 'Nascimento do Bebê', 'Aguardando...', null, '❔', 2)
on conflict (slug) do nothing;
