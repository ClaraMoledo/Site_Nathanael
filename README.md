# Memórias do Nathanael — v3 (tudo no Neon)

Galeria de álbuns em tons de verde, com envio de fotos/vídeos/áudios, visualizador em tela cheia e **download de uma foto ou de todas (ZIP)**.

## Como funciona
- **Neon (Postgres):** guarda os álbuns, os dados de cada arquivo **e os próprios arquivos** (tabela `photo_chunks`, em pedaços de 3 MB). Veja `schema.sql`.
- **`server.js` (Express):** a API. Na Vercel ele vira uma função automaticamente. A senha do banco fica só no servidor.
- **`public/`:** o site (index.html, style.css, premium.css, dados.js, fotos.js).
- O navegador envia cada arquivo em pedaços de 3 MB, porque a Vercel aceita no máximo 4,5 MB por requisição. Fotos com mais de 3 MB são reduzidas para até 3000 px antes do envio, para economizar espaço (o plano grátis do Neon tem 0,5 GB).

## Publicar na Vercel
1. Em **Settings → Environment Variables** do projeto, crie `DATABASE_URL` com a connection string do Neon (Production, Preview e Development).
2. `git push`. A Vercel faz o redeploy sozinha.

## Rodar local
1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`.
2. `npm install` e depois `npm start` → http://localhost:3000

## Banco de dados
- `node scripts/migrar-fotos.js` cria as tabelas (roda o `schema.sql`) e sobe as fotos listadas em `public/local-fotos.js`. As 66 fotos do chá de bebê já foram enviadas, por isso o `local-fotos.js` está vazio.
- Não rode o `gerar.py` de novo, ou as fotos locais aparecem duplicadas.

## Privacidade
Qualquer pessoa com o link vê e envia arquivos, sem moderação. Há limite de 60 envios/hora por IP. Por ser um bebê, considere adicionar senha de família antes de divulgar o link.
