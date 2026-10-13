(() => {
  "use strict";
  const cfg = window.NATHANAEL_CONFIG || {}, API = (cfg.API_BASE || "") + "/api", MAX_MB = cfg.MAX_MB || 200;
  const $ = (s) => document.querySelector(s);
  const grid = $("#album-grid"), statusEl = $("#status"), albumView = $("#album-view"), photoGrid = $("#photo-grid"), emptyEl = $("#empty-photos");
  const lb = $("#lightbox"), lbImg = $("#lightbox-image"), lbVideo = $("#lightbox-video"), lbAudio = $("#lightbox-audio"), lbFile = $("#lightbox-file");
  let albums = [], active = null, photos = [], idx = 0;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const extOf = (n) => (String(n || "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  const SHOWABLE = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"];
  const kindOf = (n) => {
    const e = extOf(n);
    if (["mp4", "mov", "m4v", "webm", "3gp", "avi", "mkv"].includes(e)) return "video";
    if (["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "amr"].includes(e)) return "audio";
    return ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "heif", "tif", "tiff", "dng"].includes(e) ? "image" : "other";
  };
  const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
  const fmtDate = (v) => {
    if (!v) return "";
    const d = new Date(`${String(v).slice(0, 10)}T12:00:00`);
    return isNaN(d) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "long", year: "numeric" }).format(d);
  };
  // ---- HEIC: o navegador não exibe, então convertemos para JPG (heic2any) ----
  const isHeic = (n) => ["heic", "heif"].includes(extOf(n));
  const jpgCache = new Map();
  const heicToJpgUrl = (url) => {
    if (!jpgCache.has(url)) jpgCache.set(url, (async () => {
      const blob = await (await fetch(url)).blob();
      const out = await window.heic2any({ blob, toType: "image/jpeg", quality: 0.85 });
      return URL.createObjectURL(Array.isArray(out) ? out[0] : out);
    })());
    return jpgCache.get(url);
  };
  const toJpegFile = async (file) => {
    const out = await window.heic2any({ blob: file, toType: "image/jpeg", quality: 0.9 });
    return new File([Array.isArray(out) ? out[0] : out], file.name.replace(/\.hei[cf]$/i, ".jpg"), { type: "image/jpeg" });
  };
  const heicObserver = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (!en.isIntersecting) return;
    const img = en.target; heicObserver.unobserve(img);
    heicToJpgUrl(img.dataset.src).then((u) => { img.src = u; img.classList.add("loaded"); }).catch(() => img.replaceWith(Object.assign(document.createElement("span"), { className: "file-placeholder", innerHTML: "<b>▣</b><small>HEIC</small>" })));
  }), { rootMargin: "200px" });

  async function api(path, opts) {
    const r = await fetch(API + path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.erro || "Falha na comunicação com o servidor.");
    return data;
  }

  function localPhotos(album) {
    const cat = window.NATHANAEL_FOTOS_LOCAIS || {};
    const list = cat[album.slug] || cat[String(album.slug).replace(/_/g, "-")] || [];
    return list.map((p, i) => (typeof p === "string" ? { url: p } : p)).map((p, i) => ({
      url: p.url, download: p.original_url || p.url, caption: p.caption || "", kind: kindOf(p.url), name: p.url.split("/").pop(), local: true,
    }));
  }

  function renderAlbums() {
    grid.innerHTML = "";
    albums.forEach((a) => {
      const cover = a.cover || (localPhotos(a)[0] || {}).url || "";
      const count = (a.photo_count || 0) + localPhotos(a).length;
      const card = document.createElement("button");
      card.type = "button"; card.className = "album-card";
      card.innerHTML = `<div class="album-cover">${cover ? `<img loading="lazy" src="${esc(cover)}" alt="" onerror="this.remove()">` : ""}<span class="cover-placeholder">${esc(a.icon || "♡")}</span><span class="album-cover-title">${esc(a.title)}</span></div>
        <div class="album-card-body"><h3>${esc(a.title)}</h3><p>${esc(a.description || "Uma coleção de momentos especiais.")}</p>
        <div class="album-meta"><span>${[fmtDate(a.date), count ? count + " arquivo(s)" : ""].filter(Boolean).join(" · ")}</span><span aria-hidden="true">↗</span></div></div>`;
      card.addEventListener("click", () => openAlbum(a));
      grid.appendChild(card);
    });
  }

  async function loadAlbums() {
    try { albums = await api("/albums"); statusEl.textContent = albums.length ? "" : "Nenhum álbum cadastrado ainda. Rode o schema.sql no Neon."; }
    catch (e) { console.error(e); albums = window.NATHANAEL_ALBUNS_DEMO || []; statusEl.textContent = "Modo prévia: o servidor não respondeu, então só as fotos locais aparecem."; }
    renderAlbums();
  }

  async function loadPhotos(album) {
    let online = [];
    try { online = (await api(`/albums/${encodeURIComponent(album.slug)}/photos`)).map((p) => ({ ...p, showCaption: !!p.caption })); }
    catch (e) { console.error(e); }
    return [...online, ...localPhotos(album)];
  }

  async function openAlbum(album) {
    active = album;
    $("#album-title").textContent = album.title;
    $("#album-description").textContent = [fmtDate(album.date), album.description].filter(Boolean).join(" · ");
    albumView.classList.remove("hidden"); $("#albuns").classList.add("hidden");
    photoGrid.innerHTML = '<p class="status">Carregando…</p>'; emptyEl.classList.add("hidden");
    albumView.scrollIntoView({ behavior: "smooth", block: "start" });
    photos = await loadPhotos(album);
    renderPhotos();
  }

  function renderPhotos() {
    photoGrid.innerHTML = "";
    photos.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "photo-tile"; b.setAttribute("aria-label", `Abrir ${p.caption || "arquivo " + (i + 1)}`);
      if (p.kind === "video") b.innerHTML = `<video src="${esc(p.url)}#t=0.1" preload="metadata" muted playsinline></video><span class="media-badge">▶</span>`;
      else if (p.kind === "image" && isHeic(p.name || p.url) && window.heic2any) { b.innerHTML = `<img alt="${esc(p.caption || "Foto do Nathanael")}" data-src="${esc(p.url)}">`; heicObserver.observe(b.firstElementChild); }
      else if (p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url))) b.innerHTML = `<img loading="lazy" src="${esc(p.url)}" alt="${esc(p.caption || "Foto do Nathanael")}">`;
      else b.innerHTML = `<span class="file-placeholder"><b>${p.kind === "audio" ? "♪" : p.kind === "image" ? "▣" : "📄"}</b><small>${esc(p.name || "arquivo")}</small></span>`;
      if (p.showCaption) b.insertAdjacentHTML("beforeend", `<span class="photo-tile-caption">${esc(p.caption)}</span>`);
      b.addEventListener("click", () => show(i));
      photoGrid.appendChild(b);
    });
    const n = photos.length, dl = $("#download-all");
    $("#album-count").textContent = n ? `${n} arquivo${n > 1 ? "s" : ""}` : "";
    dl.classList.toggle("hidden", !n); dl.href = `${API}/albums/${encodeURIComponent(active.slug)}/download`;
    emptyEl.classList.toggle("hidden", n > 0);
  }

  function show(i) {
    if (!photos.length) return;
    idx = (i + photos.length) % photos.length;
    const p = photos[idx];
    stopMedia();
    [lbImg, lbVideo, lbAudio, lbFile].forEach((el) => el.classList.add("hidden"));
    if (p.kind === "video") { lbVideo.src = p.url; lbVideo.classList.remove("hidden"); }
    else if (p.kind === "audio") { lbAudio.src = p.url; lbAudio.classList.remove("hidden"); }
    else if (p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url))) { lbImg.src = p.url; lbImg.alt = p.caption || "Foto do Nathanael"; lbImg.classList.remove("hidden"); }
    else if (p.kind === "image" && isHeic(p.name || p.url) && window.heic2any) {
      const mine = idx; lbFile.textContent = "Convertendo foto…"; lbFile.classList.remove("hidden");
      heicToJpgUrl(p.url).then((u) => { if (mine !== idx) return; lbImg.src = u; lbImg.classList.remove("hidden"); lbFile.classList.add("hidden"); })
        .catch(() => { lbFile.textContent = "Não foi possível exibir esta foto, mas você pode baixá-la abaixo."; });
    } else { lbFile.textContent = "Este formato não abre no navegador, mas você pode baixar o arquivo abaixo."; lbFile.classList.remove("hidden"); }
    $("#lightbox-caption").textContent = [p.caption, p.by && `por ${p.by}`, `${idx + 1} de ${photos.length}`].filter(Boolean).join(" · ");
    const a = $("#download-photo"); a.href = p.download; a.setAttribute("download", p.name || "nathanael");
    lb.classList.remove("hidden"); document.body.style.overflow = "hidden";
  }
  function stopMedia() { [lbVideo, lbAudio].forEach((m) => { m.pause(); m.removeAttribute("src"); m.load(); }); lbImg.removeAttribute("src"); }
  function closeLb() { lb.classList.add("hidden"); document.body.style.overflow = ""; stopMedia(); }
  $("#close-lightbox").addEventListener("click", closeLb);
  $("#prev-photo").addEventListener("click", () => show(idx - 1));
  $("#next-photo").addEventListener("click", () => show(idx + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (lb.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") show(idx - 1); if (e.key === "ArrowRight") show(idx + 1);
  });
  $("#back-button").addEventListener("click", () => { albumView.classList.add("hidden"); $("#albuns").classList.remove("hidden"); $("#albuns").scrollIntoView({ behavior: "smooth" }); loadAlbums(); });

  // ---- Envio: o arquivo vai em pedaços de 3 MB direto para o Postgres (Neon) ----
  const putChunk = (url, blob, onProgress) => new Promise((ok, fail) => {
    const x = new XMLHttpRequest();
    x.open("PUT", url); x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? ok() : fail(new Error("HTTP " + x.status)));
    x.onerror = () => fail(new Error("Falha de rede"));
    x.send(blob);
  });
  const withRetry = async (fn, tries = 3) => { for (let t = 1; ; t++) { try { return await fn(); } catch (e) { if (t >= tries) throw e; await new Promise((r) => setTimeout(r, 1000 * t)); } } };

  // Fotos muito grandes são reduzidas (até 3000 px) para caber no espaço do banco
  const shrinkImage = async (file) => {
    if (file.size <= 3 * 1048576 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const scale = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/.(png|webp|jpe?g)$/i, ".jpg"), { type: "image/jpeg" }) : file;
    } catch (e) { console.error(e); return file; }
  };

  $("#upload-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const status = $("#upload-status"), bar = $("#upload-progress"), fill = bar.firstElementChild, input = $("#photo-files"), files = [...input.files];
    status.textContent = "";
    if (!active) return (status.textContent = "Abra um álbum antes de enviar.");
    if (!files.length) return (status.textContent = "Escolha pelo menos um arquivo.");
    if (files.length > 10) return (status.textContent = "Envie no máximo 10 arquivos por vez.");
    const btn = ev.submitter; btn.disabled = true; btn.textContent = "Enviando…"; bar.classList.remove("hidden");
    const caption = $("#photo-caption").value.trim().slice(0, 120), by = $("#uploader-name").value.trim().slice(0, 60);
    let sent = 0; const failed = [];
    for (const [n, orig] of files.entries()) {
      let f = orig;
      try {
        if (isHeic(orig.name) && window.heic2any) { status.textContent = `Convertendo ${orig.name}…`; try { f = await toJpegFile(orig); } catch (e) { console.error(e); } }
        f = await shrinkImage(f);
        if (f.size > MAX_MB * 1048576) throw new Error(`passa de ${MAX_MB} MB`);
        const { id, chunkSize } = await api(`/albums/${encodeURIComponent(active.slug)}/uploads`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: f.name, type: f.type, size: f.size, caption, by }) });
        const total = Math.ceil(f.size / chunkSize);
        for (let i = 0; i < total; i++) {
          await withRetry(() => putChunk(`${API}/uploads/${id}/chunks/${i}`, f.slice(i * chunkSize, (i + 1) * chunkSize), (r) => {
            fill.style.width = ((n + (i + r) / total) / files.length) * 100 + "%"; status.textContent = `Enviando ${n + 1} de ${files.length}…`;
          }));
        }
        await api(`/uploads/${id}/complete`, { method: "POST" });
        sent++;
      } catch (e) { console.error(e); failed.push(orig.name); }
    }
    status.textContent = failed.length ? `${sent} enviado(s). Falhou: ${failed.join(", ")}.` : `${sent} arquivo(s) enviado(s) com sucesso! 💚`;
    if (sent) { input.value = ""; $("#photo-caption").value = ""; photos = await loadPhotos(active); renderPhotos(); }
    btn.disabled = false; btn.innerHTML = 'Enviar arquivos <span aria-hidden="true">↗</span>'; bar.classList.add("hidden"); fill.style.width = "0";
  });

  $("#year").textContent = new Date().getFullYear();
  loadAlbums();
})();