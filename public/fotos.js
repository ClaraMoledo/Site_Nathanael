(() => {
  "use strict";
  const cfg = window.NATHANAEL_CONFIG || {}, API = (cfg.API_BASE || "") + "/api", MAX_MB = cfg.MAX_MB || 200;
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const grid = $("#album-grid"), statusEl = $("#status"), albumView = $("#album-view"), photoGrid = $("#photo-grid"), emptyEl = $("#empty-photos");
  const lb = $("#lightbox"), lbImg = $("#lightbox-image"), lbVideo = $("#lightbox-video"), lbAudio = $("#lightbox-audio"), lbFile = $("#lightbox-file");
  lbImg.addEventListener("error", () => { const f = lbImg.dataset.f; if (f && lbImg.getAttribute("src") !== f) { delete lbImg.dataset.f; lbImg.src = f; } }); // versão leve faltando: abre o original
  const PAPEL = { superadmin: "Superadmin", admin: "Administrador", convidado: "Convidado" };
  let albums = [], active = null, photos = [], idx = 0, me = null, escolhendoCapa = false;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const extOf = (n) => (String(n || "").split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || "";
  const SHOWABLE = ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"];
  const kindOf = (n) => {
    const e = extOf(n);
    if (["mp4", "mov", "m4v", "webm", "3gp", "avi", "mkv"].includes(e)) return "video";
    if (["mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "amr"].includes(e)) return "audio";
    return ["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp", "heic", "heif", "tif", "tiff", "dng"].includes(e) ? "image" : "other";
  };
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

  // Se a sessão acabar (401), volta para a tela de login
  async function api(path, opts) {
    const r = await fetch(API + path, opts);
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { location.href = "/login.html"; throw new Error(data.erro || "Sessão expirada."); }
    if (!r.ok) throw new Error(data.erro || "Falha na comunicação com o servidor.");
    return data;
  }

  // Versões leves geradas por miniaturas.py: grade usa a "mini" (480 px) e a tela cheia usa a "tela" (1600 px).
  // Se a versão leve não existir, a imagem cai para o arquivo original (veja o onerror).
  const versoesWeb = (url) => {
    if (kindOf(url) !== "image" || isHeic(url)) return {};
    const nome = String(url).split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    return { thumb: `fotos-web/mini/${nome}.webp`, view: `fotos-web/tela/${nome}.webp` };
  };
  const reserva = (url) => `data-f="${esc(url)}" onerror="if(this.dataset.f){this.src=this.dataset.f;this.removeAttribute('data-f')}"`;

  function localPhotos(album) {
    const cat = window.NATHANAEL_FOTOS_LOCAIS || {};
    const list = cat[album.slug] || cat[String(album.slug).replace(/_/g, "-")] || [];
    return list.map((p) => (typeof p === "string" ? { url: p } : p)).map((p) => ({
      url: p.url, download: p.original_url || p.url, caption: p.caption || "", kind: kindOf(p.url), name: p.url.split("/").pop(), local: true,
      ...versoesWeb(p.url),
    }));
  }

  function renderAlbums() {
    grid.innerHTML = "";
    albums.forEach((a, pos) => {
      const l0 = localPhotos(a)[0] || {}, cover = a.cover || l0.thumb || l0.url || "";
      const count = (a.photo_count || 0) + localPhotos(a).length;
      const card = document.createElement("button");
      card.type = "button"; card.className = "album-card";
      card.innerHTML = `<div class="album-cover">${cover ? `<img loading="lazy" src="${esc(cover)}" alt="" onerror="this.remove()">` : ""}<span class="cover-placeholder">${esc(a.icon || "♡")}</span><span class="cover-edit admin-only" role="button" tabindex="0">★ Trocar capa</span><span class="order-btns super-only">${pos > 0 ? '<span class="order-btn" role="button" tabindex="0" data-dir="antes" aria-label="Mover para antes" title="Mover para antes">◀</span>' : ""}${pos < albums.length - 1 ? '<span class="order-btn" role="button" tabindex="0" data-dir="depois" aria-label="Mover para depois" title="Mover para depois">▶</span>' : ""}</span></div>
        <div class="album-card-body"><h3>${esc(a.title)}</h3><p>${esc(a.description || "Uma coleção de momentos especiais.")}</p>
        <div class="album-meta"><span>${[fmtDate(a.date), count ? count + " arquivo(s)" : ""].filter(Boolean).join(" · ")}</span><span aria-hidden="true">↗</span></div></div>`;
      card.addEventListener("click", () => openAlbum(a));
      const trocar = card.querySelector(".cover-edit");
      const iniciaTroca = (ev) => { ev.stopPropagation(); ev.preventDefault(); escolhendoCapa = true; openAlbum(a); };
      trocar.addEventListener("click", iniciaTroca);
      trocar.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") iniciaTroca(ev); });
      card.querySelectorAll(".order-btn").forEach((btn) => {
        const mover = async (ev) => {
          ev.stopPropagation(); ev.preventDefault();
          try { await api(`/albums/${encodeURIComponent(a.slug)}/mover`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dir: btn.dataset.dir }) }); await loadAlbums(); }
          catch (e) { alert(e.message); }
        };
        btn.addEventListener("click", mover);
        btn.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") mover(ev); });
      });
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

  async function openAlbum(album, push = true) {
    active = album;
    if (push) history.pushState({ v: "album", slug: album.slug }, "", "?album=" + encodeURIComponent(album.slug)); // o botão voltar do celular/navegador volta para a lista
    $("#album-title").textContent = album.title;
    $("#album-description").textContent = [fmtDate(album.date), album.description].filter(Boolean).join(" · ");
    albumView.classList.remove("hidden"); $("#albuns").classList.add("hidden");
    $("#cover-banner").classList.toggle("hidden", !escolhendoCapa);
    photoGrid.innerHTML = '<p class="status">Carregando…</p>'; emptyEl.classList.add("hidden");
    albumView.scrollIntoView({ behavior: "smooth", block: "start" });
    photos = await loadPhotos(album);
    renderPhotos();
  }

  function renderPhotos() {
    photoGrid.innerHTML = "";
    photoGrid.classList.toggle("escolhendo", escolhendoCapa);
    photos.forEach((p, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "photo-tile"; b.setAttribute("aria-label", `Abrir ${p.caption || "arquivo " + (i + 1)}`);
      if (p.kind === "video") b.innerHTML = `<video src="${esc(p.url)}#t=0.1" preload="metadata" muted playsinline></video><span class="media-badge">▶</span>`;
      else if (p.kind === "image" && isHeic(p.name || p.url) && window.heic2any) { b.innerHTML = `<img alt="${esc(p.caption || "Foto do Nathanael")}" data-src="${esc(p.url)}">`; heicObserver.observe(b.firstElementChild); }
      else if (p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url))) b.innerHTML = `<img loading="lazy" decoding="async" src="${esc(p.thumb || p.url)}" ${reserva(p.url)} alt="${esc(p.caption || "Foto do Nathanael")}">`;
      else b.innerHTML = `<span class="file-placeholder"><b>${p.kind === "audio" ? "♪" : p.kind === "image" ? "▣" : "📄"}</b><small>${esc(p.name || "arquivo")}</small></span>`;
      if (p.showCaption) b.insertAdjacentHTML("beforeend", `<span class="photo-tile-caption">${esc(p.caption)}</span>`);
      b.addEventListener("click", () => (escolhendoCapa ? escolherCapa(p) : show(i)));
      photoGrid.appendChild(b);
    });
    const n = photos.length, dl = $("#download-all");
    $("#album-count").textContent = n ? `${n} arquivo${n > 1 ? "s" : ""}` : "";
    dl.classList.toggle("hidden", !n); dl.href = `${API}/albums/${encodeURIComponent(active.slug)}/download`;
    emptyEl.classList.toggle("hidden", n > 0);
  }

  function show(i) {
    if (!photos.length) return;
    const abrindo = lb.classList.contains("hidden");
    idx = (i + photos.length) % photos.length;
    const p = photos[idx];
    stopMedia();
    [lbImg, lbVideo, lbAudio, lbFile].forEach((el) => el.classList.add("hidden"));
    if (p.kind === "video") { lbVideo.src = p.url; lbVideo.classList.remove("hidden"); }
    else if (p.kind === "audio") { lbAudio.src = p.url; lbAudio.classList.remove("hidden"); }
    else if (p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url))) { lbImg.dataset.f = p.url; lbImg.src = p.view || p.url; lbImg.alt = p.caption || "Foto do Nathanael"; lbImg.classList.remove("hidden"); }
    else if (p.kind === "image" && isHeic(p.name || p.url) && window.heic2any) {
      const mine = idx; lbFile.textContent = "Convertendo foto…"; lbFile.classList.remove("hidden");
      heicToJpgUrl(p.url).then((u) => { if (mine !== idx) return; lbImg.src = u; lbImg.classList.remove("hidden"); lbFile.classList.add("hidden"); })
        .catch(() => { lbFile.textContent = "Não foi possível exibir esta foto, mas você pode baixá-la abaixo."; });
    } else { lbFile.textContent = "Este formato não abre no navegador, mas você pode baixar o arquivo abaixo."; lbFile.classList.remove("hidden"); }
    $("#lightbox-caption").textContent = [p.caption, p.by && `por ${p.by}`, `${idx + 1} de ${photos.length}`].filter(Boolean).join(" · ");
    const a = $("#download-photo"); a.href = p.download; a.setAttribute("download", p.name || "nathanael");
    const capa = $("#set-cover");
    capa.textContent = "Usar como capa ★"; capa.disabled = false;
    capa.classList.toggle("hidden", !(p.id && !p.local && p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url)))); // só fotos que o navegador consegue mostrar
    $("#delete-photo").classList.toggle("hidden", !!p.local); // fotos locais (da pasta) não podem ser apagadas por aqui
    if (abrindo) history.pushState({ v: "photo", slug: active && active.slug }, "", location.href); // voltar fecha a foto
    lb.classList.remove("hidden"); document.body.style.overflow = "hidden";
  }
  function stopMedia() { [lbVideo, lbAudio].forEach((m) => { m.pause(); m.removeAttribute("src"); m.load(); }); lbImg.removeAttribute("src"); }
  function closeLbUI() { lb.classList.add("hidden"); document.body.style.overflow = ""; stopMedia(); }
  function closeLb() { if (history.state && history.state.v === "photo") history.back(); else closeLbUI(); }

  // ---- Voltar (botão do navegador, gesto do celular ou a seta do site) ----
  function mostraListaUI() {
    escolhendoCapa = false; $("#cover-banner").classList.add("hidden");
    albumView.classList.add("hidden"); $("#albuns").classList.remove("hidden");
    $("#albuns").scrollIntoView({ behavior: "smooth" }); loadAlbums();
  }
  function voltaParaLista() { if (history.state && history.state.v === "album") history.back(); else mostraListaUI(); }
  window.addEventListener("popstate", (e) => {
    const st = e.state || {};
    if (!lb.classList.contains("hidden") && st.v !== "photo") closeLbUI();
    if (st.v === "album" || st.v === "photo") {
      if (!active || active.slug !== st.slug || albumView.classList.contains("hidden")) {
        const alvo = albums.find((a) => a.slug === st.slug);
        if (alvo) openAlbum(alvo, false);
      }
    } else if (!albumView.classList.contains("hidden")) mostraListaUI();
  });

  // Deslizar para o lado na foto aberta troca para a anterior/próxima
  let tx = 0, ty = 0;
  lb.addEventListener("touchstart", (e) => { tx = e.changedTouches[0].clientX; ty = e.changedTouches[0].clientY; }, { passive: true });
  lb.addEventListener("touchend", (e) => {
    if (e.target.closest && e.target.closest("video, audio")) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) show(idx + (dx < 0 ? 1 : -1));
  }, { passive: true });
  $("#close-lightbox").addEventListener("click", closeLb);
  $("#prev-photo").addEventListener("click", () => show(idx - 1));
  $("#next-photo").addEventListener("click", () => show(idx + 1));
  lb.addEventListener("click", (e) => { if (e.target === lb) closeLb(); });
  document.addEventListener("keydown", (e) => {
    if (lb.classList.contains("hidden")) return;
    if (e.key === "Escape") closeLb(); if (e.key === "ArrowLeft") show(idx - 1); if (e.key === "ArrowRight") show(idx + 1);
  });
  $("#back-button").addEventListener("click", voltaParaLista);

  // ---- Apagar foto (só administrador; o servidor também confere) ----
  $("#delete-photo").addEventListener("click", async () => {
    const p = photos[idx], btn = $("#delete-photo");
    if (!p || p.local || !p.id) return;
    if (!confirm(`Apagar "${p.name || "este arquivo"}" para sempre?\nNão dá para desfazer.`)) return;
    btn.disabled = true;
    try {
      await api(`/photos/${p.id}`, { method: "DELETE" });
      photos.splice(idx, 1);
      renderPhotos();
      if (photos.length) show(Math.min(idx, photos.length - 1)); else closeLb();
    } catch (e) { alert(e.message); }
    btn.disabled = false;
  });

  // ---- Capa do álbum (só administrador) ----
  const podeSerCapa = (p) => p.id && !p.local && p.kind === "image" && SHOWABLE.includes(extOf(p.name || p.url));
  async function escolherCapa(p) {
    if (!podeSerCapa(p)) return alert("Escolha uma foto (JPG, PNG ou WEBP). Vídeos e áudios não servem como capa.");
    try {
      await api(`/albums/${encodeURIComponent(active.slug)}/cover`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: p.id }) });
      escolhendoCapa = false; $("#cover-banner").classList.add("hidden"); photoGrid.classList.remove("escolhendo");
      voltaParaLista(); // a lista recarrega já com a capa nova
    } catch (e) { alert(e.message); }
  }
  $("#cover-mode").addEventListener("click", () => {
    escolhendoCapa = true; $("#cover-banner").classList.remove("hidden"); photoGrid.classList.add("escolhendo");
    photoGrid.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("#cover-cancel").addEventListener("click", () => { escolhendoCapa = false; $("#cover-banner").classList.add("hidden"); photoGrid.classList.remove("escolhendo"); });
  $("#set-cover").addEventListener("click", async () => {
    const p = photos[idx], btn = $("#set-cover");
    if (!p || !p.id || !active) return;
    btn.disabled = true;
    try {
      await api(`/albums/${encodeURIComponent(active.slug)}/cover`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ photoId: p.id }) });
      btn.textContent = "Capa definida ✓";
    } catch (e) { alert(e.message); btn.disabled = false; }
  });

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
      return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, ".jpg"), { type: "image/jpeg" }) : file;
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

  // ---- Modo claro / noturno ----
  $("#theme-toggle").addEventListener("click", () => {
    const novo = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = novo;
    try { localStorage.setItem("tema", novo); } catch (e) { /* sem armazenamento: tudo bem */ }
  });

  // ---- Sair ----
  $("#logout").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (e) { /* segue para o login mesmo assim */ }
    location.href = "/login.html";
  });

  // ---- Acessos (só administrador): quem pode entrar no site ----
  const modal = $("#users-modal"), usersList = $("#users-list"), userStatus = $("#user-status");
  const uName = $("#u-name"), uEmail = $("#u-email"), uPass = $("#u-pass"), uRole = $("#u-role");

  const setBadge = (list) => {
    const n = list.filter((u) => !u.approved).length;
    const b = $("#users-open");
    b.textContent = n ? `Acessos (${n})` : "Acessos";
    b.classList.toggle("tem-pendente", n > 0);
  };

  async function loadUsers() {
    usersList.innerHTML = "<li>Carregando…</li>";
    try {
      const list = await api("/usuarios");
      setBadge(list);
      usersList.innerHTML = "";
      list.forEach((u) => {
        const pendente = !u.approved, li = document.createElement("li");
        li.innerHTML = `<div class="u-info"><strong>${esc(u.name || u.email)}</strong><small>${esc(u.email)} · ${PAPEL[u.role] || "Convidado"}</small>${pendente ? '<span class="u-tag">Aguardando aprovação</span>' : ""}</div>
          <div class="u-actions">${pendente ? '<button type="button" class="ghost-button small-btn" data-ok>Aprovar</button>' : '<button type="button" class="ghost-button small-btn" data-edit>Editar</button>'}${u.id === me.id ? "" : `<button type="button" class="danger-button small-btn" data-del>${pendente ? "Recusar" : "Remover"}</button>`}</div>`;
        const ok = li.querySelector("[data-ok]"), edit = li.querySelector("[data-edit]"), del = li.querySelector("[data-del]");
        if (ok) ok.addEventListener("click", async () => {
          try { await api(`/usuarios/${u.id}/aprovar`, { method: "POST" }); loadUsers(); } catch (e) { userStatus.textContent = e.message; }
        });
        if (edit) edit.addEventListener("click", () => {
          uName.value = u.name || ""; uEmail.value = u.email; uPass.value = ""; uRole.value = u.role; uPass.focus();
          userStatus.textContent = "Editando. Deixe a senha vazia para manter a atual.";
        });
        if (del) del.addEventListener("click", async () => {
          if (!confirm(`${pendente ? "Recusar o pedido de" : "Remover o acesso de"} ${u.name || u.email}?`)) return;
          try { await api(`/usuarios/${u.id}`, { method: "DELETE" }); loadUsers(); } catch (e) { userStatus.textContent = e.message; }
        });
        usersList.appendChild(li);
      });
    } catch (e) { usersList.innerHTML = `<li>${esc(e.message)}</li>`; }
  }
  const openUsers = () => { userStatus.textContent = ""; modal.classList.remove("hidden"); loadUsers(); };
  const closeUsers = () => modal.classList.add("hidden");
  $("#users-open").addEventListener("click", openUsers);
  $("#users-close").addEventListener("click", closeUsers);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeUsers(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeUsers(); });
  $("#user-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    userStatus.textContent = "Salvando…";
    try {
      await api("/usuarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: uName.value, email: uEmail.value, senha: uPass.value, role: uRole.value }) });
      userStatus.textContent = "Salvo! 💚";
      uName.value = ""; uEmail.value = ""; uPass.value = ""; uRole.value = "convidado";
      loadUsers();
    } catch (e) { userStatus.textContent = e.message; }
  });

  // ---- Álbuns (só administrador): criar, editar e apagar ----
  const albumModal = $("#album-modal"), albumStatus = $("#album-status"), aTitle = $("#a-title"), aIcon = $("#a-icon"), aDate = $("#a-date"), aDesc = $("#a-desc");
  let editando = null; // null = novo álbum
  function openAlbumModal(album) {
    editando = album;
    $("#album-modal-title").textContent = album ? "Editar álbum" : "Novo álbum";
    aTitle.value = album ? album.title : ""; aIcon.value = album ? album.icon || "" : ""; aDate.value = album && album.date ? String(album.date).slice(0, 10) : ""; aDesc.value = album ? album.description || "" : "";
    $("#album-delete").classList.toggle("hidden", !album);
    albumStatus.textContent = "";
    albumModal.classList.remove("hidden"); aTitle.focus();
  }
  const closeAlbumModal = () => albumModal.classList.add("hidden");
  $("#album-new").addEventListener("click", () => openAlbumModal(null));
  $("#album-edit").addEventListener("click", () => active && openAlbumModal(active));
  $("#album-close").addEventListener("click", closeAlbumModal);
  albumModal.addEventListener("click", (e) => { if (e.target === albumModal) closeAlbumModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !albumModal.classList.contains("hidden")) closeAlbumModal(); });

  $("#album-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    albumStatus.textContent = "Salvando…";
    const body = JSON.stringify({ title: aTitle.value, icon: aIcon.value, date: aDate.value, description: aDesc.value });
    const headers = { "Content-Type": "application/json" };
    try {
      if (editando) {
        await api(`/albums/${encodeURIComponent(editando.slug)}`, { method: "PUT", headers, body });
        if (active && active.slug === editando.slug) {
          Object.assign(active, { title: aTitle.value.trim(), icon: aIcon.value.trim() || "♡", date: aDate.value, description: aDesc.value.trim() });
          $("#album-title").textContent = active.title;
          $("#album-description").textContent = [fmtDate(active.date), active.description].filter(Boolean).join(" · ");
        }
      } else {
        await api("/albums", { method: "POST", headers, body });
      }
      closeAlbumModal();
      loadAlbums();
    } catch (e) { albumStatus.textContent = e.message; }
  });

  $("#album-delete").addEventListener("click", async () => {
    if (!editando || !confirm(`Apagar o álbum "${editando.title}"?\nSó álbuns vazios podem ser apagados.`)) return;
    try {
      await api(`/albums/${encodeURIComponent(editando.slug)}`, { method: "DELETE" });
      closeAlbumModal();
      voltaParaLista();
    } catch (e) { albumStatus.textContent = e.message; }
  });

  // ---- Início: confere o login antes de mostrar qualquer coisa ----
  async function iniciar() {
    $("#year").textContent = new Date().getFullYear();
    try {
      me = await api("/me");
    } catch (e) {
      // 401 já redirecionou para o login; outro erro (servidor fora do ar) cai no modo prévia
      console.error(e); root.classList.add("logado"); loadAlbums(); return;
    }
    root.classList.toggle("is-admin", me.role === "admin" || me.role === "superadmin");
    root.classList.toggle("is-super", me.role === "superadmin");
    root.classList.add("logado");
    const chip = $("#user-chip");
    chip.textContent = `${me.name || me.email} · ${PAPEL[me.role] || "Convidado"}`;
    chip.classList.remove("hidden");
    if (me.role === "superadmin") api("/usuarios").then(setBadge).catch(() => {}); // mostra quantos pedidos esperam aprovação
    await loadAlbums();
    const pedido = new URLSearchParams(location.search).get("album");
    const alvo = pedido && albums.find((a) => a.slug === pedido);
    if (alvo) { history.replaceState({ v: "album", slug: alvo.slug }, "", location.href); openAlbum(alvo, false); }
    else history.replaceState({ v: "list" }, "", location.pathname);
  }
  iniciar();
})();