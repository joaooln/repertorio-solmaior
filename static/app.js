function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

const CHORD_TOKEN_RE = /^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|º|°|\+)?(?:[0-9]{1,2}|M|[#b+-][0-9]{1,2}|sus[0-9]?|add[0-9]{1,2}|dim|\([^)]*\))*(?:\/[A-G][#b]?)?$/;

function isChordLine(linha) {
  const tokens = linha.trim().split(/\s+/);
  return tokens[0] !== '' && tokens.every(t =>
    CHORD_TOKEN_RE.test(t) || ['|', '%', '-'].includes(t) || /^\(?x\d+\)?$/i.test(t));
}

// ══════════════════════════════════════════════════════════════════════
// OFFLINE / SYNC
// ══════════════════════════════════════════════════════════════════════
let _isOnline = navigator.onLine;

function updateOnlineUI() {
  _isOnline = navigator.onLine;
  const banner = document.getElementById('offline-banner');
  const dot    = document.getElementById('conn-dot');
  const text   = document.getElementById('conn-text');
  if (banner) banner.style.display = _isOnline ? 'none' : 'flex';
  if (dot)  dot.className  = 'conn-dot' + (_isOnline ? '' : ' off');
  if (text) text.textContent = _isOnline ? 'Online · sincronizado' : 'Offline — cache local';
  if (_isOnline) syncPendingWrites();
}

window.addEventListener('online',  updateOnlineUI);
window.addEventListener('offline', updateOnlineUI);

// Atualiza badge com contagem de escritas pendentes
async function refreshPendingBadge() {
  const items = await idbGetAll('pending');
  const badge = document.getElementById('pending-badge');
  if (!badge) return;
  if (items.length > 0) {
    badge.style.display = 'inline';
    badge.textContent = `${items.length} alteração${items.length !== 1 ? 'ões' : ''} pendente${items.length !== 1 ? 's' : ''}`;
  } else {
    badge.style.display = 'none';
  }
}

// Executa todas as escritas enfileiradas em ordem
let _isSyncing = false;
async function syncPendingWrites() {
  if (_isSyncing) return;
  _isSyncing = true;
  try {
    const items = await idbGetAll('pending');
    if (!items.length) return;

    toast(`🔄 Sincronizando ${items.length} alteração${items.length!==1?'ões':''}...`, 'warn');
    let ok = 0, fail = 0;

  for (const item of items) {
    try {
      const opts = { 
        method: item.method, 
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Password': localStorage.getItem('adminPassword') || ''
        } 
      };
      if (item.body) opts.body = JSON.stringify(item.body);
      let r = await fetch(item.url, opts);
      if (r.status === 401) {
        localStorage.removeItem('adminPassword');
        const pw = prompt('Senha de administrador necessária para sincronizar alterações pendentes:');
        if (pw) {
          localStorage.setItem('adminPassword', pw);
          opts.headers['X-Admin-Password'] = pw;
          r = await fetch(item.url, opts);
        }
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await idbDelete('pending', item.qid);
      ok++;
    } catch (e) {
      console.warn('Sync falhou para', item.url, e);
      fail++;
    }
  }

  await refreshPendingBadge();
  if (fail === 0) {
    toast(`✅ ${ok} alteração${ok!==1?'ões':''} sincronizada${ok!==1?'s':''}!`);
  } else {
    toast(`⚠️ ${ok} sincronizadas, ${fail} com erro`, 'warn');
  }

  // Atualiza a página com dados frescos do servidor
  if (currentPage === 'musicas') renderMusicas();
  else if (currentPage === 'repertorios') renderRepertorios();
  } finally {
    _isSyncing = false;
  }
}

// Enfileira uma escrita para sync posterior
async function enqueueWrite(method, url, body) {
  // Coalesce: se já existe um PUT pendente para a mesma URL, substitui
  if (method === 'PUT') {
    const all = await idbGetAll('pending');
    const dup = all.find(i => i.method === 'PUT' && i.url === url);
    if (dup) {
      await idbDelete('pending', dup.qid);
    }
  }
  await idbAdd('pending', { method, url, body, ts: Date.now() });
  await refreshPendingBadge();
}

// ══════════════════════════════════════════════════════════════════════
// API — offline-aware
// ══════════════════════════════════════════════════════════════════════
const CACHEABLE = ['/api/musicas', '/api/repertorios', '/api/stats'];

function isCacheable(url) {
  return CACHEABLE.some(p => url === p || url.startsWith(p + '?') || url.startsWith(p + '/'));
}

function checkOfflineAuth() {
  if (!localStorage.getItem('adminPassword')) {
    const pw = prompt('Senha de administrador necessária para realizar alterações:');
    if (!pw) throw new Error('Senha de administrador não fornecida');
    localStorage.setItem('adminPassword', pw);
  }
}

async function fetchWithAuth(url, method, bodyObj) {
  let pw = localStorage.getItem('adminPassword');
  if (!pw) {
    pw = prompt('Senha de administrador necessária para realizar alterações:');
    if (!pw) {
      return {
        ok: false,
        status: 401,
        json: async () => ({ erro: 'Senha de administrador não fornecida' })
      };
    }
    localStorage.setItem('adminPassword', pw);
  }

  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Password': pw
    }
  };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);

  let r = await fetch(url, opts);
  if (r.status === 401) {
    localStorage.removeItem('adminPassword');
    const newPw = prompt('Senha de administrador incorreta. Digite novamente:');
    if (newPw) {
      localStorage.setItem('adminPassword', newPw);
      opts.headers['X-Admin-Password'] = newPw;
      r = await fetch(url, opts);
    } else {
      return {
        ok: false,
        status: 401,
        json: async () => ({ erro: 'Senha de administrador incorreta' })
      };
    }
  }
  return r;
}

const api = {
  async get(url) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      if (isCacheable(url)) await idbPut('api_cache', url, { data, ts: Date.now() });
      return data;
    } catch (e) {
      // offline ou erro de rede: tenta cache para a URL exata
      const cached = await idbGet('api_cache', url);
      if (cached) return cached.data;

      // Fallback especial para filtragem e buscas locais de músicas
      if (url.startsWith('/api/musicas')) {
        const idMatch = url.match(/^\/api\/musicas\/([^/?]+)$/);
        if (idMatch) {
          // Se for rota de detalhe /api/musicas/:id
          const list = await idbGet('api_cache', '/api/musicas');
          if (list) {
            const found = list.data.find(m => m.id === idMatch[1]);
            if (found) {
              found.cifra_tradicional = found.cifra_tradicional || JSON.parse(found.cifra_json || '[]');
              found.tabela = found.tabela || JSON.parse(found.tabela_json || '[]');
              return found;
            }
          }
        } else {
          // Se for rota de lista com ou sem filtros (/api/musicas ou /api/musicas?...)
          const listCache = await idbGet('api_cache', '/api/musicas');
          if (listCache && listCache.data) {
            let list = [...listCache.data];
            
            // Tratamento de URLs relativas para extrair os parâmetros de query
            const urlObj = new URL(url, window.location.origin);
            const q = urlObj.searchParams.get('q');
            const favorito = urlObj.searchParams.get('favorito');
            const tom = urlObj.searchParams.get('tom');
            const tag = urlObj.searchParams.get('tag');

            if (q) {
              const query = removeAccents(q).toLowerCase();
              list = list.filter(m => 
                removeAccents(m.titulo || '').toLowerCase().includes(query) ||
                removeAccents(m.artista || '').toLowerCase().includes(query) ||
                removeAccents(m.tom || '').toLowerCase().includes(query)
              );
            }
            if (favorito === '1') {
              list = list.filter(m => m.favorito);
            }
            if (tom) {
              list = list.filter(m => m.tom === tom);
            }
            if (tag) {
              list = list.filter(m => (m.tags || []).includes(tag));
            }

            list.sort((a, b) => (a.titulo || '').localeCompare(b.titulo || '', 'pt-BR'));
            return list;
          }
        }
      }
      throw e;
    }
  },

  async post(url, d) {
    if (!navigator.onLine) {
      checkOfflineAuth();
      if (url.includes('/importar')) throw new Error('Importação requer conexão com a internet');
      
      if (url === '/api/musicas' || url === '/api/repertorios') {
        const clientId = crypto.randomUUID().slice(0, 8);
        d.id = clientId;
        
        if (url === '/api/musicas') {
          const newSong = {
            id: clientId,
            titulo: d.titulo,
            artista: d.artista,
            tom: d.tom || 'C',
            tom_original: d.tom_original || d.tom || 'C',
            cifra_json: JSON.stringify(d.cifra_tradicional || []),
            tabela_json: JSON.stringify(d.tabela || []),
            tags: JSON.stringify(d.tags || []),
            cifra_tradicional: d.cifra_tradicional || [],
            tabela: d.tabela || [],
            favorito: d.favorito || false,
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString()
          };
          
          let listCache = await idbGet('api_cache', '/api/musicas');
          if (!listCache) {
            listCache = { data: [], ts: Date.now() };
          }
          listCache.data.push(newSong);
          await idbPut('api_cache', '/api/musicas', listCache);
          await idbPut('api_cache', `/api/musicas/${clientId}`, { data: newSong, ts: Date.now() });
        } else {
          const newRep = {
            id: clientId,
            nome: d.nome,
            musicas: [],
            criado_em: new Date().toISOString(),
            atualizado_em: new Date().toISOString()
          };
          
          let listCache = await idbGet('api_cache', '/api/repertorios');
          if (!listCache) {
            listCache = { data: [], ts: Date.now() };
          }
          listCache.data.push(newRep);
          await idbPut('api_cache', '/api/repertorios', listCache);
          await idbPut('api_cache', `/api/repertorios/${clientId}`, { data: newRep, ts: Date.now() });
        }
        
        await enqueueWrite('POST', url, d);
        return { ok: true, id: clientId, offline: true };
      }
      
      await enqueueWrite('POST', url, d);
      return { ok: true, offline: true };
    }
    const r = await fetchWithAuth(url, 'POST', d);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      return { erro: errData.erro || `Erro HTTP ${r.status}` };
    }
    return r.json();
  },

  async put(url, d) {
    if (!navigator.onLine) {
      checkOfflineAuth();
      // Atualiza o cache local imediatamente
      const mListCache = await idbGet('api_cache', '/api/musicas');
      if (mListCache) {
        const idMatch = url.match(/\/api\/musicas\/([^/]+)$/);
        if (idMatch) {
          mListCache.data = mListCache.data.map(m => m.id === idMatch[1] ? {...m, ...d} : m);
          await idbPut('api_cache', '/api/musicas', mListCache);
          
          const detailCache = await idbGet('api_cache', url);
          if (detailCache) {
            detailCache.data = {...detailCache.data, ...d};
            await idbPut('api_cache', url, detailCache);
          }
        }
      }
      
      const rListCache = await idbGet('api_cache', '/api/repertorios');
      if (rListCache) {
        const idMatch = url.match(/\/api\/repertorios\/([^/]+)$/);
        if (idMatch) {
          let resolvedSongs = [];
          if (d.musicas && mListCache && mListCache.data) {
            resolvedSongs = d.musicas.map(id => mListCache.data.find(m => m.id === id)).filter(Boolean);
          }
          
          rListCache.data = rListCache.data.map(r => {
            if (r.id === idMatch[1]) {
              const updated = { ...r };
              if (d.nome !== undefined) updated.nome = d.nome;
              if (d.musicas !== undefined) updated.musicas = resolvedSongs;
              return updated;
            }
            return r;
          });
          await idbPut('api_cache', '/api/repertorios', rListCache);
        }
      }
      
      await enqueueWrite('PUT', url, d);
      return { ok: true, offline: true };
    }
    const r = await fetchWithAuth(url, 'PUT', d);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      return { erro: errData.erro || `Erro HTTP ${r.status}` };
    }
    return r.json();
  },

  async del(url) {
    if (!navigator.onLine) {
      checkOfflineAuth();
      // Remover do cache local
      const mListCache = await idbGet('api_cache', '/api/musicas');
      if (mListCache) {
        const idMatch = url.match(/\/api\/musicas\/([^/]+)$/);
        if (idMatch) {
          mListCache.data = mListCache.data.filter(m => m.id !== idMatch[1]);
          await idbPut('api_cache', '/api/musicas', mListCache);
          await idbDelete('api_cache', url);
        }
      }
      
      const rListCache = await idbGet('api_cache', '/api/repertorios');
      if (rListCache) {
        const idMatch = url.match(/\/api\/repertorios\/([^/]+)$/);
        if (idMatch) {
          rListCache.data = rListCache.data.filter(r => r.id !== idMatch[1]);
          await idbPut('api_cache', '/api/repertorios', rListCache);
          await idbDelete('api_cache', url);
        }
      }
      
      await enqueueWrite('DELETE', url, null);
      return { ok: true, offline: true };
    }
    const r = await fetchWithAuth(url, 'DELETE', null);
    if (!r.ok) {
      const errData = await r.json().catch(() => ({}));
      return { erro: errData.erro || `Erro HTTP ${r.status}` };
    }
    return r.json();
  },
};

// ══════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type === 'err' ? ' toast-err' : type === 'warn' ? ' toast-warn' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

function loading(msg='Carregando...') {
  document.body.insertAdjacentHTML('beforeend',
    `<div class="loading-overlay" id="loading">
       <div class="spin"></div>
       <div class="loading-msg">${msg}</div>
     </div>`);
}
function unload() { document.getElementById('loading')?.remove(); }

let _modalGuard = null;

function requestCloseModal() {
  if (_modalGuard && !_modalGuard()) return;
  closeModal();
}

function closeModal() {
  _modalGuard = null;
  const modal = document.getElementById('modal-root');
  if (modal) {
    modal.removeAttribute('id');
    modal.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 300);
  }
}

function modal(html, size='modal-md') {
  closeModal();
  document.body.insertAdjacentHTML('beforeend',
    `<div class="overlay" id="modal-root" onclick="if(event.target===this)requestCloseModal()">
       <div class="modal ${size}">${html}</div>
     </div>`);
}

// Fecha modal com a tecla Escape
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('modal-root') && !document.getElementById('ap-root')) {
    requestCloseModal();
  }
});

let pendingConfirmCallback = null;

function confirm_del(msg, cb) {
  pendingConfirmCallback = cb;
  modal(`
    <div class="modal-header"><h3 class="modal-title">Confirmar</h3></div>
    <p style="color:var(--text-dim);font-size:15px;margin-bottom:32px">${msg}</p>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="closeModal(); if(pendingConfirmCallback) pendingConfirmCallback();">Excluir Definitivamente</button>
    </div>`, 'modal-sm');
}

// ══════════════════════════════════════════════════════════════════════
// NAVEGAÇÃO
// ══════════════════════════════════════════════════════════════════════
let currentPage = '';
function page(p) {
  currentPage = p;
  
  // Atualiza sidebar desktop
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
  const navEl = document.getElementById('nav-'+p);
  if (navEl) navEl.classList.add('active');
  
  // Atualiza bottom nav mobile
  document.querySelectorAll('.bottom-nav-item').forEach(e=>e.classList.remove('active'));
  const mNavEl = document.getElementById('m-nav-'+p);
  if (mNavEl) mNavEl.classList.add('active');

  if(p==='musicas') renderMusicas();
  else if(p==='repertorios') renderRepertorios();
  else renderStats();
}

// ══════════════════════════════════════════════════════════════════════
// MÚSICAS
// ══════════════════════════════════════════════════════════════════════
let mFilter = '';
let mFavOnly = false;
let mTagFilter = '';
let mTomFilter = '';
let allMusicas = [];
let _searchTimer = null;

function onSearchInput(val) {
  mFilter = val;
  clearTimeout(_searchTimer);
  _searchTimer = setTimeout(renderMusicas, 300);
}

function buildMusicasUrl() {
  const p = new URLSearchParams();
  if(mFilter)    p.set('q', mFilter);
  if(mFavOnly)   p.set('favorito', '1');
  if(mTomFilter) p.set('tom', mTomFilter);
  if(mTagFilter) p.set('tag', mTagFilter);
  const s = p.toString();
  return '/api/musicas' + (s ? '?' + s : '');
}

async function renderMusicas() {
  const url = buildMusicasUrl();
  let allMusicas_, counts;
  if (url === '/api/musicas') {
    counts = await api.get('/api/musicas');
    allMusicas_ = counts;
  } else {
    [allMusicas_, counts] = await Promise.all([
      api.get(url),
      api.get('/api/musicas'),
    ]);
  }
  allMusicas = allMusicas_;

  const allTags = [...new Set(counts.flatMap(m => m.tags||[]))].sort();
  const favCount = counts.filter(m => m.favorito).length;
  const noFilter = !mFavOnly && !mTagFilter;

  // Update sidebar count
  const nc = document.getElementById('nav-count-musicas');
  if (nc) nc.textContent = counts.length;

  const inputEl = document.getElementById('search-input');

  // Se o input de busca já está no DOM, fazemos uma atualização parcial
  // para evitar recriar o elemento de busca e perder o foco/seleção.
  if (inputEl) {
    const pageSubEl = document.querySelector('.page-title-block .page-sub');
    if (pageSubEl) {
      pageSubEl.textContent = `${counts.length} cifras na biblioteca · ${favCount} favoritas`;
    }

    if (inputEl.value !== mFilter) {
      inputEl.value = mFilter;
    }

    const selectEl = document.querySelector('.searchrow select');
    if (selectEl && selectEl.value !== mTomFilter) {
      selectEl.value = mTomFilter;
    }

    const chiprowEl = document.querySelector('.chiprow');
    if (chiprowEl) {
      chiprowEl.innerHTML = `
        <button class="chip ${noFilter?'on':''}" onclick="mFavOnly=false;mTagFilter='';renderMusicas()">Todas <span class="chip-count">${counts.length}</span></button>
        <button class="chip ${mFavOnly?'on':''}" onclick="mFavOnly=!mFavOnly;mTagFilter='';renderMusicas()">★ Favoritas <span class="chip-count">${favCount}</span></button>
        ${allTags.length ? `<span style="width:1px;height:16px;background:var(--line);margin:0 4px;display:inline-block"></span>` : ''}
        ${allTags.map(t => {
          const n = counts.filter(m=>(m.tags||[]).includes(t)).length;
          return `<button class="chip ${mTagFilter===t?'on':''}" onclick="mTagFilter=mTagFilter==='${t}'?'':'${t}';mFavOnly=false;renderMusicas()">${t} <span class="chip-count">${n}</span></button>`;
        }).join('')}
      `;
    }

    const songlistEl = document.querySelector('.songlist');
    if (songlistEl) {
      songlistEl.innerHTML = `
        <div class="songlist-head">
          <div></div>
          <div>Título · Artista</div>
          <div>Estilos</div>
          <div>Tom</div>
          <div>BPM · Duração</div>
          <div></div>
        </div>
        ${allMusicas.map(m => `
          <div class="songrow" onclick="openEdit('${m.id}')">
            <button class="song-fav ${m.favorito?'on':''}" onclick="event.stopPropagation();toggleFav('${m.id}',${!!m.favorito})">
              ${m.favorito ? '★' : '☆'}
            </button>
            <div>
              <div class="song-title">${m.titulo}</div>
              <div class="song-artist">${m.artista}</div>
            </div>
            <div class="song-tags">
              ${(m.tags||[]).map(t=>`<span class="song-tag">${t}</span>`).join('')}
            </div>
            <div class="song-tom">${m.tom}</div>
            <div class="song-meta">
              ${m.bpm ? `<span class="bpm">${m.bpm} bpm</span>` : ''}
              ${m.duracao_min ? `<span class="dur">${m.duracao_min}min</span>` : ''}
            </div>
            <div class="song-action">
              <button class="song-play" onclick="event.stopPropagation();openApresentacao('${m.id}')">▶</button>
            </div>
          </div>
        `).join('')}
        ${allMusicas.length===0 ? `
          <div class="empty">
            <h3>${(mFilter||mFavOnly||mTagFilter) ? 'Nenhuma música encontrada' : 'Biblioteca vazia'}</h3>
            <p>${(mFilter||mFavOnly||mTagFilter) ? 'Tente outros termos ou limpe os filtros.' : 'Adicione cifras via link ou comece do zero.'}</p>
            ${!(mFilter||mFavOnly||mTagFilter) ? `<button class="btn btn-primary" onclick="openImport()">✦ Importar via link</button>` : ''}
          </div>
        ` : ''}
      `;
    }
    return;
  }

  // Renderização inicial completa
  document.getElementById('app-main').innerHTML = `
    <div class="page-bar">
      <div class="page-title-block">
        <div class="page-title">Banco de <em>músicas</em></div>
        <div class="page-sub">${counts.length} cifras na biblioteca · ${favCount} favoritas</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="openImport()">✦ Importar via link</button>
        <button class="btn btn-ghost btn-sm" onclick="openImportPDF()">📄 Importar PDF (Moises)</button>
        <button class="btn btn-ghost btn-sm" onclick="openImportLote()">Importar em lote</button>
        <button class="btn btn-ghost btn-sm" onclick="openBackup()">Backup</button>
        <button class="btn btn-primary" onclick="openAddManual()">+ Nova música</button>
      </div>
    </div>

    <div class="page-body">
      <div class="searchrow">
        <div class="search">
          <span class="search-ico">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input placeholder="Buscar por título, artista ou tom…" value="${mFilter}" oninput="onSearchInput(this.value)" id="search-input"/>
        </div>
        <select onchange="mTomFilter=this.value;renderMusicas()" style="width: 130px; flex: 0 0 auto; margin: 0; height: 44px; padding: 0 32px 0 12px; border-radius: 10px;">
          <option value="">Tom: Todos</option>
          ${['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B', 
             'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'A#m', 'Bbm', 'Bm']
             .map(t => `<option value="${t}" ${mTomFilter===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>

      <div class="chiprow">
        <button class="chip ${noFilter?'on':''}" onclick="mFavOnly=false;mTagFilter='';renderMusicas()">Todas <span class="chip-count">${counts.length}</span></button>
        <button class="chip ${mFavOnly?'on':''}" onclick="mFavOnly=!mFavOnly;mTagFilter='';renderMusicas()">★ Favoritas <span class="chip-count">${favCount}</span></button>
        ${allTags.length ? `<span style="width:1px;height:16px;background:var(--line);margin:0 4px;display:inline-block"></span>` : ''}
        ${allTags.map(t => {
          const n = counts.filter(m=>(m.tags||[]).includes(t)).length;
          return `<button class="chip ${mTagFilter===t?'on':''}" onclick="mTagFilter=mTagFilter==='${t}'?'':'${t}';mFavOnly=false;renderMusicas()">${t} <span class="chip-count">${n}</span></button>`;
        }).join('')}
      </div>

      <div class="songlist">
        <div class="songlist-head">
          <div></div>
          <div>Título · Artista</div>
          <div>Estilos</div>
          <div>Tom</div>
          <div>BPM · Duração</div>
          <div></div>
        </div>
        ${allMusicas.map(m => `
          <div class="songrow" onclick="openEdit('${m.id}')">
            <button class="song-fav ${m.favorito?'on':''}" onclick="event.stopPropagation();toggleFav('${m.id}',${!!m.favorito})">
              ${m.favorito ? '★' : '☆'}
            </button>
            <div>
              <div class="song-title">${m.titulo}</div>
              <div class="song-artist">${m.artista}</div>
            </div>
            <div class="song-tags">
              ${(m.tags||[]).map(t=>`<span class="song-tag">${t}</span>`).join('')}
            </div>
            <div class="song-tom">${m.tom}</div>
            <div class="song-meta">
              ${m.bpm ? `<span class="bpm">${m.bpm} bpm</span>` : ''}
              ${m.duracao_min ? `<span class="dur">${m.duracao_min}min</span>` : ''}
            </div>
            <div class="song-action">
              <button class="song-play" onclick="event.stopPropagation();openApresentacao('${m.id}')">▶</button>
            </div>
          </div>
        `).join('')}
        ${allMusicas.length===0 ? `
          <div class="empty">
            <h3>${(mFilter||mFavOnly||mTagFilter) ? 'Nenhuma música encontrada' : 'Biblioteca vazia'}</h3>
            <p>${(mFilter||mFavOnly||mTagFilter) ? 'Tente outros termos ou limpe os filtros.' : 'Adicione cifras via link ou comece do zero.'}</p>
            ${!(mFilter||mFavOnly||mTagFilter) ? `<button class="btn btn-primary" onclick="openImport()">✦ Importar via link</button>` : ''}
          </div>
        ` : ''}
      </div>
    </div>`;
}

async function toggleFav(id, current) {
  try {
    await api.put(`/api/musicas/${id}`, { favorito: !current });
    await renderMusicas();
  } catch(e) { toast('Erro ao alterar favorito', 'err'); }
}

// ── Importar via link ──────────────────────────────────────────────────
function openImport() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">🔗 Importar via Link</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="info-box">
      Cole um link do <strong>Cifra Club</strong>, <strong>Cifras.com.br</strong> ou <strong>YouTube</strong>.<br>
      A inteligência artificial fará a extração/detecção dos acordes automaticamente.
    </div>
    <div class="form-group">
      <label>URL da Cifra ou Vídeo</label>
      <input id="imp-url" type="url" placeholder="https://www.cifraclub.com.br/... ou https://youtu.be/..." onkeydown="if(event.key==='Enter')doImport()">
    </div>
    <div id="imp-msg" style="font-size:13px;color:var(--text-dim);min-height:20px;margin-bottom:10px;"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-imp" onclick="doImport()">Importar</button>
    </div>`, 'modal-md');
  document.getElementById('imp-url').focus();
}

async function doImport(substituir = false) {
  const url = document.getElementById('imp-url').value.trim();
  if(!url) { toast('Cole uma URL', 'err'); return; }
  const btn = document.getElementById('btn-imp');
  const msg = document.getElementById('imp-msg');
  const isYt = /youtube\.com|youtu\.be/i.test(url);
  btn.disabled = true;
  btn.innerHTML = '<span class="spin spin-sm"></span> Importando...';
  if (isYt) {
    msg.innerHTML = '<span style="color:var(--accent)">🎬 Analisando áudio do YouTube e detectando acordes com IA... Isso pode levar alguns segundos.</span>';
  } else {
    msg.innerHTML = '<span style="color:var(--accent)">Consultando Inteligência Artificial... Isso pode levar alguns segundos.</span>';
  }
  try {
    const r = await api.post('/api/musicas/importar', {url, substituir});
    if(r.erro) throw new Error(r.erro);
    if(r.duplicada) {
      btn.disabled = false;
      btn.innerHTML = 'Importar';
      msg.innerHTML = `
        <div style="background:rgba(212,168,83,.1);border:1px solid rgba(212,168,83,.3);border-radius:8px;padding:10px 14px;font-size:13px;">
          <strong style="color:var(--accent)">⚠️ Música já existe na biblioteca:</strong><br>
          <span style="color:var(--text)">"${r.titulo}" — ${r.artista}</span><br>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancelar</button>
            <button class="btn btn-primary btn-sm" onclick="doImport(true)">Substituir</button>
          </div>
        </div>`;
      return;
    }
    closeModal();
    toast(`✅ "${r.titulo}" importada com sucesso!`);
    mFilter = '';
    await renderMusicas();
    setTimeout(() => openEdit(r.id), 300);
  } catch(e) {
    msg.innerHTML = '<span style="color:var(--red)">❌ ' + e.message + '</span>';
    btn.disabled = false;
    btn.innerHTML = 'Tentar Novamente';
  }
}

// ── Importar em lote ───────────────────────────────────────────────────
function openImportLote() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📋 Importar em Lote</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="info-box">
      Cole um link por linha do <strong>Cifra Club</strong>, <strong>Cifras.com.br</strong> ou <strong>YouTube</strong>.<br>
      Cada cifra será importada automaticamente pela IA.
    </div>
    <div class="form-group">
      <label>URLs (uma por linha)</label>
      <textarea id="lote-urls" rows="6" placeholder="https://www.cifraclub.com.br/artista/musica-1/&#10;https://www.cifraclub.com.br/artista/musica-2/&#10;..." style="width:100%;resize:vertical;"></textarea>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer;font-size:13px;color:var(--text-dim);text-transform:none;letter-spacing:0;">
      <input type="checkbox" id="lote-substituir" style="width:16px;height:16px;cursor:pointer;">
      Substituir músicas já importadas
    </label>
    <div id="lote-progress" style="display:none;max-height:220px;overflow-y:auto;margin-bottom:10px;border:1px solid var(--line);border-radius:8px;padding:4px 8px;"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" id="btn-lote-cancel" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btn-lote-imp" onclick="doImportLote()">Importar Todas</button>
    </div>`, 'modal-md');
  document.getElementById('lote-urls').focus();
}

async function doImportLote() {
  const raw = document.getElementById('lote-urls').value;
  const urls = raw.split('\n').map(u => u.trim()).filter(u => u);
  if (!urls.length) { toast('Cole pelo menos uma URL', 'err'); return; }

  const substituir = document.getElementById('lote-substituir').checked;
  const btn = document.getElementById('btn-lote-imp');
  const cancelBtn = document.getElementById('btn-lote-cancel');
  const progress = document.getElementById('lote-progress');
  const textarea = document.getElementById('lote-urls');

  btn.disabled = true;
  cancelBtn.disabled = true;
  textarea.disabled = true;
  document.getElementById('lote-substituir').disabled = true;
  progress.style.display = 'block';
  progress.innerHTML = urls.map((url, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--line);font-size:13px;">
      <span id="lote-icon-${i}" style="width:18px;text-align:center;flex-shrink:0;">⏳</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim)" title="${url}">${url}</span>
      <span id="lote-status-${i}" style="color:var(--text-dim);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;flex-shrink:0;" title="">Aguardando...</span>
    </div>
  `).join('');

  let ok = 0, skip = 0, fail = 0;
  for (let i = 0; i < urls.length; i++) {
    const icon = document.getElementById(`lote-icon-${i}`);
    const status = document.getElementById(`lote-status-${i}`);
    icon.innerHTML = '<span class="spin spin-sm"></span>';
    status.style.color = 'var(--accent)';
    status.textContent = 'Importando...';
    try {
      const r = await api.post('/api/musicas/importar', {url: urls[i], substituir});
      if (r.erro) throw new Error(r.erro);
      if (r.duplicada) {
        icon.textContent = '⏭️';
        status.style.color = 'var(--text-dim)';
        status.title = `Já existe: ${r.titulo}`;
        status.textContent = `Já existe: ${r.titulo}`;
        skip++;
      } else {
        icon.textContent = '✅';
        status.style.color = 'var(--green)';
        status.title = r.titulo;
        status.textContent = r.titulo;
        ok++;
      }
    } catch(e) {
      icon.textContent = '❌';
      status.style.color = 'var(--red)';
      status.title = e.message;
      status.textContent = e.message.slice(0, 50);
      fail++;
    }
  }

  btn.textContent = 'Concluído';
  btn.disabled = false;
  btn.onclick = closeModal;
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Fechar';
  await renderMusicas();
  const partes = [];
  if (ok) partes.push(`${ok} importada${ok!==1?'s':''}`);
  if (skip) partes.push(`${skip} já existia${skip!==1?'m':''}`);
  if (fail) partes.push(`${fail} com erro`);
  toast(partes.join(', '), ok > 0 ? 'ok' : (skip > 0 ? 'ok' : 'err'));
}

// ── Importar PDF (Moises) ──────────────────────────────────────────────
let _filaImport = [];
let _filaTotal = 0;
let _biblioteca = [];

function normTxt(s) {
  return removeAccents(s || '').toLowerCase().trim();
}

function openImportPDF() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📄 Importar PDF do Moises</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="info-box">
      Use o PDF de <strong>acordes</strong> exportado pelo <strong>Moises</strong>.<br>
      Pode escolher vários de uma vez — cada música abre no editor para você revisar <strong>antes de salvar</strong>.
    </div>
    <div class="dropzone" id="pdf-drop" onclick="document.getElementById('pdf-input').click()"
         ondragover="event.preventDefault();this.classList.add('over')"
         ondragleave="this.classList.remove('over')"
         ondrop="event.preventDefault();this.classList.remove('over');lerPDFs(event.dataTransfer.files)">
      <input type="file" id="pdf-input" accept="application/pdf,.pdf" multiple hidden onchange="lerPDFs(this.files)">
      <div class="dropzone-ico">⬆</div>
      <div class="dropzone-t">Arraste os PDFs aqui ou <span>escolha os arquivos</span></div>
      <div class="dropzone-s">Arquivos “… chords.pdf” gerados pelo Moises.ai</div>
    </div>
    <div id="pdf-progress" class="import-progress" style="display:none"></div>
    <div class="modal-footer" id="pdf-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    </div>`, 'modal-md');
}

function lerArquivoBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
}

async function lerPDFs(fileList) {
  const files = [...fileList].filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) { toast('Selecione arquivos PDF', 'err'); return; }
  const prog = document.getElementById('pdf-progress');
  document.getElementById('pdf-drop').style.display = 'none';
  prog.style.display = 'block';
  prog.innerHTML = files.map((f, i) => `
    <div class="import-row">
      <span class="import-ico" id="pdf-ico-${i}"><span class="spin spin-sm"></span></span>
      <span class="import-name" title="${escAttr(f.name)}">${escHtml(f.name)}</span>
      <span class="import-status" id="pdf-st-${i}">Lendo…</span>
    </div>`).join('');

  try { _biblioteca = await api.get('/api/musicas'); } catch(e) { _biblioteca = []; }

  const lidas = [];
  for (let i = 0; i < files.length; i++) {
    const ico = document.getElementById(`pdf-ico-${i}`);
    const st  = document.getElementById(`pdf-st-${i}`);
    try {
      const conteudo = await lerArquivoBase64(files[i]);
      const r = await api.post('/api/musicas/importar-pdf', { conteudo });
      if (r.erro) throw new Error(r.erro);
      r._arquivo = files[i].name;
      lidas.push(r);
      ico.textContent = '✅';
      st.style.color = 'var(--green)';
      st.textContent = `${r.titulo} · ${r.tom}`;
    } catch(e) {
      ico.textContent = '❌';
      st.style.color = 'var(--red)';
      st.title = e.message;
      st.textContent = e.message;
    }
  }
  if (!lidas.length) return;
  _filaImport = lidas;
  _filaTotal = lidas.length;
  if (lidas.length === files.length) { setTimeout(abrirProximaRevisao, 500); return; }
  document.getElementById('pdf-footer').innerHTML = `
    <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
    <button class="btn btn-primary" onclick="abrirProximaRevisao()">Revisar ${lidas.length} música${lidas.length>1?'s':''} →</button>`;
}

function abrirProximaRevisao() {
  const d = _filaImport.shift();
  if (!d) { _filaTotal = 0; renderMusicas(); return; }
  let { titulo, artista } = d;
  const artistas = new Set(_biblioteca.map(m => normTxt(m.artista)));
  if (artistas.has(normTxt(titulo)) && !artistas.has(normTxt(artista))) [titulo, artista] = [artista, titulo];
  editM = {
    id: null, _novoId: crypto.randomUUID().slice(0, 8),
    titulo, artista, tom: d.tom, tom_original: d.tom,
    cifra_tradicional: d.cifra_tradicional,
    tabela: gerarGradeDaCifra(d.cifra_tradicional),
    tags: [], notas: '', favorito: false, bpm: null, duracao_min: null,
    _fonte: d._arquivo || d.titulo_pdf,
  };
  editTab = 'cifra';
  _editDirty = true;
  renderEditModal();
}

function trocarTituloArtista() {
  collectEdits();
  [editM.titulo, editM.artista] = [editM.artista, editM.titulo];
  renderEditModal();
}

function gerarGradeDaCifra(cifra) {
  const secoes = [];
  let atual = null;
  for (const l of cifra || []) {
    if (l.secao || !atual) {
      atual = { nome: l.secao || 'Intro', acordes: [] };
      secoes.push(atual);
    }
    for (const tk of (l.acordes || '').split(/\s+/)) {
      if (CHORD_TOKEN_RE.test(tk) && atual.acordes[atual.acordes.length - 1] !== tk) atual.acordes.push(tk);
    }
  }
  const tabela = [], vistos = new Set(), contagem = {};
  for (const s of secoes) {
    if (!s.acordes.length) continue;
    const grid = [];
    for (let i = 0; i < s.acordes.length; i += 4) {
      const row = s.acordes.slice(i, i + 4);
      while (row.length < 4) row.push('%');
      grid.push(row);
    }
    const chave = s.nome + JSON.stringify(grid);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    contagem[s.nome] = (contagem[s.nome] || 0) + 1;
    tabela.push({ nome_secao: contagem[s.nome] > 1 ? `${s.nome} ${contagem[s.nome]}` : s.nome, grid });
  }
  return tabela;
}

// ── Adicionar manual ───────────────────────────────────────────────────
function openAddManual() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">+ Nova Música</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Título</label><input id="nm-titulo" placeholder="Nome da música" onkeydown="if(event.key==='Enter')doAddManual()"></div>
      <div class="form-group"><label>Artista</label><input id="nm-artista" placeholder="Nome do artista" onkeydown="if(event.key==='Enter')doAddManual()"></div>
    </div>
    <div class="form-group"><label>Tom</label><input id="nm-tom" placeholder="Ex: Am, D, G" onkeydown="if(event.key==='Enter')doAddManual()"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="doAddManual()">Criar Obra →</button>
    </div>`, 'modal-sm');
  document.getElementById('nm-titulo').focus();
}

async function doAddManual() {
  const titulo  = document.getElementById('nm-titulo').value.trim();
  const artista = document.getElementById('nm-artista').value.trim();
  const tom     = document.getElementById('nm-tom').value.trim() || 'C';
  if(!titulo||!artista) { toast('Preencha título e artista','err'); return; }
  try {
    const r = await api.post('/api/musicas', {titulo, artista, tom});
    if(r.erro) throw new Error(r.erro);
    closeModal();
    await renderMusicas();
    setTimeout(() => openEdit(r.id, 'cifra'), 200);
  } catch(e) {
    toast('❌ ' + e.message, 'err');
  }
}

// ── Editar música ──────────────────────────────────────────────────────
let editM = null;
let editTab = 'info';
let _editDirty = false;
let _editPreview = false;
let _previewTimer = null;

const SECOES_CIFRA = ['Intro', 'Verso', 'Pré-Refrão', 'Refrão', 'Ponte', 'Solo', 'Final'];

async function openEdit(id, tab='info') {
  editTab = tab;
  const m = await api.get(`/api/musicas/${id}`);
  editM = m;
  _editDirty = false;
  renderEditModal();
}

function cifraParaTexto(cifra) {
  return (cifra||[]).map((l, i) => {
    let s = '';
    if(l.secao)   s += `${i ? '\n' : ''}[${l.secao}]\n`;
    if(l.acordes) s += l.acordes + '\n';
    if(l.letra)   s += l.letra   + '\n';
    return s;
  }).join('');
}

function tabelaParaTexto(tabela) {
  return (tabela||[]).map(s =>
    `## ${s.nome_secao}\n` + (s.grid||[]).map(r=>r.join(' | ')).join('\n')
  ).join('\n\n');
}

function renderEditModal() {
  const m = editM;
  const novo = !m.id;
  const diffSt = semitonesDiff(m.tom_original, m.tom);
  const dup = novo ? _biblioteca.find(b => normTxt(b.titulo) === normTxt(m.titulo)) : null;
  const posFila = _filaTotal > 1 ? `<span class="fila-badge">${_filaTotal - _filaImport.length} de ${_filaTotal}</span>` : '';
  const transpRow = `
    <span class="tom-badge" id="tom-disp">${escHtml(m.tom)}</span>
    <button class="btn btn-ghost btn-sm" onclick="doTransp(-1)">♭ −1</button>
    <button class="btn btn-ghost btn-sm" onclick="doTransp(+1)">♯ +1</button>
    ${diffSt!==0 ? `<button class="btn btn-ghost btn-sm" onclick="doTransp(0,true)">↺ Voltar p/ ${escHtml(m.tom_original)}</button>` : ''}`;

  modal(`
    <span data-edit hidden></span>
    <div class="modal-header">
      <h3 class="modal-title">${novo ? '📄 Revisar importação' : '✏️ ' + escHtml(m.titulo)} ${novo ? posFila : ''}</h3>
      <button class="close-btn" onclick="requestCloseModal()">×</button>
    </div>

    ${novo ? `
      <div class="info-box">
        <strong>Nada foi salvo ainda.</strong> Confira título, artista e cifra, ajuste o que precisar e clique em <strong>Salvar na biblioteca</strong>.
        ${m._fonte ? `<div class="import-fonte">Arquivo: ${escHtml(m._fonte)}</div>` : ''}
      </div>
      ${dup ? `<div class="warn-box">⚠️ Já existe <strong>“${escHtml(dup.titulo)}”</strong> — ${escHtml(dup.artista)} na biblioteca. Se for a mesma, clique em Descartar.</div>` : ''}
      <div class="quick-info">
        <div class="form-group"><label>Título</label><input id="e-titulo" value="${escAttr(m.titulo)}" placeholder="Nome da música"></div>
        <button class="btn btn-ghost btn-sm quick-swap" onclick="trocarTituloArtista()" title="Inverter título e artista">⇄</button>
        <div class="form-group"><label>Artista</label><input id="e-artista" value="${escAttr(m.artista)}" placeholder="Nome do artista"></div>
        <div class="form-group quick-tom"><label>Tom</label><input id="e-tom" value="${escAttr(m.tom)}"></div>
      </div>
    ` : ''}

    <div class="tabs">
      <button class="tab ${editTab==='info'?'active':''}"   onclick="switchTab('info')">Informações</button>
      <button class="tab ${editTab==='cifra'?'active':''}"  onclick="switchTab('cifra')">Cifra Completa</button>
      <button class="tab ${editTab==='tabela'?'active':''}" onclick="switchTab('tabela')">Grade Acordes</button>
    </div>

    ${editTab==='info' ? `
      ${novo ? '' : `
        <div class="form-row">
          <div class="form-group"><label>Título</label><input id="e-titulo" value="${escAttr(m.titulo)}"></div>
          <div class="form-group"><label>Artista</label><input id="e-artista" value="${escAttr(m.artista)}"></div>
        </div>`}
      <div class="form-row">
        ${novo ? '' : `
          <div class="form-group">
            <label>Tom Original</label>
            <input id="e-tom-orig" value="${escAttr(m.tom_original)}">
          </div>`}
        <div class="form-group">
          <label>BPM</label>
          <input id="e-bpm" type="number" min="40" max="300" placeholder="Ex: 120" value="${m.bpm||''}">
        </div>
        <div class="form-group">
          <label>Duração (min)</label>
          <input id="e-duracao" type="number" min="0" step="0.5" placeholder="Ex: 3.5" value="${m.duracao_min||''}">
        </div>
      </div>
      <div class="form-group">
        <label>Transposição (Tom Atual)</label>
        <div class="transp-row">${transpRow}</div>
        ${diffSt!==0 ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Transposto ${diffSt>0?'+':''}${diffSt} semitons do original (${escHtml(m.tom_original)})</div>` : ''}
      </div>
      <div class="form-group">
        <label>Estilos / Tags</label>
        <div class="tags-editor" id="tags-editor">
          ${(m.tags||[]).map(t=>`<span class="tag-chip">${t}<button onclick="removeTag('${t.replace(/'/g,"\\'")}')">×</button></span>`).join('')}
          <input id="tag-input" placeholder="Adicionar estilo..." onkeydown="if(event.key==='Enter'||event.key===','){event.preventDefault();addTag()}" style="border:none;background:transparent;outline:none;flex:1;min-width:100px;color:var(--text);font-size:13px;">
        </div>
        <div class="tag-suggestions" id="tag-suggestions">
          ${['Samba','Forró','Bossa Nova','Choro','Pagode','Axé','Sertanejo','MPB','Gospel','Internacional','Rock','Pop'].map(t=>`<span class="tag-sug" onclick="addTagDirect('${t}')">${t}</span>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Notas / Observações</label>
        <textarea id="e-notas" rows="2" placeholder="Ex: Entrar depois do intro, repetir refrão no final...">${escHtml(m.notas||'')}</textarea>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:10px;">
        <label style="margin:0;cursor:pointer;display:flex;align-items:center;gap:8px;">
          <input type="checkbox" id="e-favorito" ${m.favorito?'checked':''} style="width:16px;height:16px;">
          <span>Marcar como favorita ⭐</span>
        </label>
      </div>
      ${m.url_origem ? `
        <div class="form-group">
          <label>URL de origem</label>
          <input value="${escAttr(m.url_origem)}" readonly style="opacity:0.6;">
        </div>` : ''}
    ` : ''}

    ${editTab==='cifra' ? `
      <div class="cifra-toolbar">
        <div class="tb-group">
          <span class="tb-label">Inserir seção</span>
          ${SECOES_CIFRA.map(s=>`<button class="tb-btn" onclick="inserirSecao('${s}')">${s}</button>`).join('')}
        </div>
        <div class="tb-group">
          <span class="tb-label">Tom <b>${escHtml(m.tom)}</b></span>
          <button class="tb-btn" onclick="doTransp(-1)" title="Descer meio tom">♭ −1</button>
          <button class="tb-btn" onclick="doTransp(+1)" title="Subir meio tom">♯ +1</button>
          <button class="tb-btn tb-preview-toggle ${_editPreview?'on':''}" onclick="togglePreviewCifra()">${_editPreview ? '✎ Editar' : '👁 Visualizar'}</button>
        </div>
      </div>
      <div class="cifra-editor ${_editPreview ? 'show-preview' : ''}">
        <textarea id="e-cifra" class="cifra-textarea" wrap="off" spellcheck="false"
          oninput="agendarPreviewCifra()" onkeydown="teclaEditorCifra(event)">${escHtml(cifraParaTexto(m.cifra_tradicional))}</textarea>
        <div class="cifra-preview" id="cifra-preview">${renderCifraHtml(m.cifra_tradicional)}</div>
      </div>
      <div class="editor-hint">
        <b>[Seção]</b> abre uma parte · a linha de <b>acordes</b> fica logo acima da <b>letra</b> — alinhe com espaços e confira na prévia.
        <span class="editor-keys"><kbd>Tab</kbd> insere espaços · <kbd>Ctrl/⌘ S</kbd> salva</span>
      </div>
    ` : ''}

    ${editTab==='tabela' ? `
      <div class="info-box">
        <strong>## Nome da Seção</strong> cria um novo bloco na tabela geral.<br>
        Acordes separados por <strong>|</strong>, sendo 4 por linha sempre. Utilize <strong>%</strong> para repetir compasso.
      </div>
      <div class="form-group">
        <div class="tb-row">
          <label>Editor de Tabela de Acordes</label>
          <button class="tb-btn" onclick="gerarGradeEditor()">↻ Gerar a partir da cifra</button>
        </div>
        <textarea id="e-tabela" class="cifra-textarea" spellcheck="false" style="min-height:400px;">${escHtml(tabelaParaTexto(m.tabela))}</textarea>
      </div>
    ` : ''}

    <div class="modal-footer">
      ${novo ? `
        <button class="btn btn-danger btn-sm" onclick="descartarImportacao()">Descartar</button>
        <span style="flex:1"></span>
        <button class="btn btn-primary" onclick="doSave()">💾 ${_filaImport.length ? 'Salvar e próxima →' : 'Salvar na biblioteca'}</button>
      ` : `
        <button class="btn btn-danger btn-sm" onclick="delMusica('${m.id}','${m.titulo.replace(/'/g,"\\'")}',true)">🗑️ Excluir</button>
        <button class="btn btn-ghost btn-sm" onclick="openPDFMusica('${m.id}','${m.titulo.replace(/'/g,"\\'")}')">📄 PDF</button>
        <button class="btn btn-ghost" onclick="requestCloseModal()">Fechar</button>
        <button class="btn btn-primary" onclick="doSave()">💾 Salvar</button>
      `}
    </div>
  `, 'modal-lg modal-editor');

  document.querySelector('#modal-root .modal').addEventListener('input', () => { _editDirty = true; });
  _modalGuard = () => {
    if (!_editDirty) return true;
    const ok = confirm(novo ? 'Descartar esta importação? A música não será salva.' : 'Descartar as alterações não salvas?');
    if (ok && novo) setTimeout(abrirProximaRevisao, 320);
    return ok;
  };
}

function descartarImportacao() {
  requestCloseModal();
}

function switchTab(tab) {
  collectEdits();
  editTab = tab;
  renderEditModal();
}

function collectEdits() {
  if(!editM) return;
  const val = id => document.getElementById(id)?.value;
  if(val('e-titulo')   !== undefined) editM.titulo   = val('e-titulo').trim();
  if(val('e-artista')  !== undefined) editM.artista  = val('e-artista').trim();
  if(val('e-tom-orig') !== undefined) editM.tom_original = val('e-tom-orig').trim();
  if(val('e-tom')      !== undefined) {
    const t = val('e-tom').trim() || 'C';
    if (editM.tom === editM.tom_original) editM.tom_original = t;
    editM.tom = t;
  }
  if(val('e-bpm')      !== undefined) editM.bpm = parseInt(val('e-bpm'))||null;
  if(val('e-duracao')  !== undefined) editM.duracao_min = parseFloat(val('e-duracao'))||null;
  if(val('e-notas')    !== undefined) editM.notas = val('e-notas');
  if(document.getElementById('e-favorito')) editM.favorito = document.getElementById('e-favorito').checked;
  if(val('e-cifra')    !== undefined) editM.cifra_tradicional = parseCifra(val('e-cifra'));
  if(val('e-tabela')   !== undefined) editM.tabela   = parseTabela(val('e-tabela'));
}

function inserirSecao(nome) {
  const ta = document.getElementById('e-cifra');
  if (!ta) return;
  const ini = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  const antes = ta.value.slice(0, ini);
  const prefixo = antes.trim() && !antes.endsWith('\n\n') ? '\n' : '';
  ta.setRangeText(`${prefixo}[${nome}]\n`, ini, ini, 'end');
  ta.focus();
  _editDirty = true;
  atualizarPreviewCifra();
}

function teclaEditorCifra(e) {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const ta = e.target;
  ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
  _editDirty = true;
  agendarPreviewCifra();
}

function agendarPreviewCifra() {
  clearTimeout(_previewTimer);
  _previewTimer = setTimeout(atualizarPreviewCifra, 150);
}

function atualizarPreviewCifra() {
  const ta = document.getElementById('e-cifra');
  const pv = document.getElementById('cifra-preview');
  if (ta && pv) pv.innerHTML = renderCifraHtml(parseCifra(ta.value)) || '<div class="cifra-preview-vazio">A prévia aparece aqui</div>';
}

function togglePreviewCifra() {
  _editPreview = !_editPreview;
  document.querySelector('.cifra-editor')?.classList.toggle('show-preview', _editPreview);
  const btn = document.querySelector('.tb-preview-toggle');
  if (btn) { btn.classList.toggle('on', _editPreview); btn.textContent = _editPreview ? '✎ Editar' : '👁 Visualizar'; }
  atualizarPreviewCifra();
}

function gerarGradeEditor() {
  collectEdits();
  if ((editM.tabela||[]).length && !confirm('Substituir a grade atual pela gerada a partir da cifra?')) return;
  editM.tabela = gerarGradeDaCifra(editM.cifra_tradicional);
  _editDirty = true;
  renderEditModal();
}

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && document.querySelector('#modal-root [data-edit]')) {
    e.preventDefault();
    doSave();
  }
});

function addTag() {
  const input = document.getElementById('tag-input');
  const val = input.value.trim().replace(/,$/,'');
  if(!val) return;
  if(!editM.tags) editM.tags = [];
  if(!editM.tags.includes(val)) editM.tags.push(val);
  input.value = '';
  _editDirty = true;
  renderTagsEditor();
}
function addTagDirect(t) {
  if(!editM.tags) editM.tags = [];
  if(!editM.tags.includes(t)) { editM.tags.push(t); _editDirty = true; renderTagsEditor(); }
}
function removeTag(t) {
  editM.tags = (editM.tags||[]).filter(x=>x!==t);
  _editDirty = true;
  renderTagsEditor();
}
function renderTagsEditor() {
  const ed = document.getElementById('tags-editor');
  if(!ed) return;
  const chips = (editM.tags||[]).map(t=>`<span class="tag-chip">${t}<button onclick="removeTag('${t.replace(/'/g,"\\'")}')">×</button></span>`).join('');
  const input = `<input id="tag-input" placeholder="Adicionar estilo..." onkeydown="if(event.key==='Enter'||event.key===','){event.preventDefault();addTag()}" style="border:none;background:transparent;outline:none;flex:1;min-width:100px;color:var(--text);font-size:13px;">`;
  ed.innerHTML = chips + input;
}

let _salvando = false;

async function doSave() {
  if (_salvando) return;
  collectEdits();
  if (!editM.titulo) { toast('Informe o título da música', 'err'); return; }
  const novo = !editM.id;
  const tabelaSecoesCount = (editM.tabela||[]).length;
  const { _fonte, _novoId, ...dados } = editM;
  const btn = document.querySelector('#modal-root .modal-footer .btn-primary');
  const btnHtml = btn?.innerHTML;
  _salvando = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin spin-sm"></span> Salvando…'; }
  try {
    const r = novo
      ? await api.post('/api/musicas', { ...dados, id: _novoId, artista: dados.artista || 'Desconhecido' })
      : await api.put(`/api/musicas/${editM.id}`, dados);
    if (r.erro) throw new Error(r.erro);
    if (novo) editM.id = r.id;
    _editDirty = false;
    closeModal();
    let msg = r.offline ? '💾 Salvo localmente — será sincronizado quando conectar' : `✅ ${novo ? `“${dados.titulo}” adicionada à biblioteca` : 'Salvo!'}`;
    if (editTab === 'tabela' && tabelaSecoesCount > 0) msg += ` Grade: ${tabelaSecoesCount} seção(ões)`;
    toast(msg);
    if (novo) {
      _biblioteca.push({ titulo: dados.titulo, artista: dados.artista });
      if (_filaImport.length) { setTimeout(abrirProximaRevisao, 320); return; }
      _filaTotal = 0;
      mFilter = '';
    }
    renderMusicas();
  } catch(e) {
    toast('❌ Erro ao salvar: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
  } finally {
    _salvando = false;
  }
}

function transporLinhaAlinhada(linha, st) {
  if (!st || !linha) return linha;
  let out = '', excesso = 0;
  for (const parte of linha.match(/\s+|\S+/g) || []) {
    if (/^\s/.test(parte)) {
      const n = Math.max(1, parte.length - excesso);
      excesso -= parte.length - n;
      out += ' '.repeat(n);
    } else {
      const novo = CHORD_TOKEN_RE.test(parte) ? jsTranspoeAcorde(parte, st) : parte;
      excesso += novo.length - parte.length;
      out += novo;
    }
  }
  return out;
}

function doTransp(st, reset=false) {
  collectEdits();
  if (reset) st = -semitonesDiff(editM.tom_original, editM.tom);
  if (!st) return;
  editM.cifra_tradicional = (editM.cifra_tradicional||[]).map(l => ({...l, acordes: transporLinhaAlinhada(l.acordes||'', st)}));
  editM.tabela = (editM.tabela||[]).map(s => ({
    ...s, grid: (s.grid||[]).map(row => row.map(c => c === '%' ? c : jsTranspoeAcorde(c, st)))
  }));
  editM.tom = jsTranspoeAcorde(editM.tom, st);
  _editDirty = true;
  renderEditModal();
  toast(`Tom: ${editM.tom} — clique em Salvar para gravar`);
}

function semitonesDiff(orig, atual) {
  const NOTAS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ENH={'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B'};
  const norm = n => ENH[n]||n;
  const get  = t => { const m=(t||'').match(/^([A-G][b#]?)/); return m ? NOTAS.indexOf(norm(m[1])) : -1; };
  const o=get(orig), a=get(atual);
  if(o<0||a<0) return 0;
  let d=a-o; if(d>6)d-=12; if(d<-6)d+=12;
  return d;
}

function parseCifra(text) {
  const res = [];
  let secaoAtual = '', pendente = null;
  const push = (acordes, letra) => {
    res.push({secao: secaoAtual, acordes, letra});
    secaoAtual = '';
  };
  for(const line of text.split('\n')) {
    const t = line.replace(/\s+$/, '');
    if(!t.trim()) continue;
    const sm = t.trim().match(/^\[(.+)\]$/);
    if(sm) {
      if(pendente !== null) { push(pendente, ''); pendente = null; }
      secaoAtual = sm[1].trim();
      continue;
    }
    if(isChordLine(t)) {
      if(pendente !== null) push(pendente, '');
      pendente = t;
    } else if(pendente !== null) {
      push(pendente, t);
      pendente = null;
    } else {
      push('', t);
    }
  }
  if(pendente !== null) push(pendente, '');
  return res;
}

// ── Renderização da cifra (palco + prévia do editor) ───────────────────
function spanAcorde(tk) {
  return CHORD_TOKEN_RE.test(tk)
    ? `<span class="ap-ch" data-original="${escAttr(tk)}">${escHtml(tk)}</span>`
    : escHtml(tk);
}

function spansAcordes(linha) {
  return (linha.match(/\s+|\S+/g) || []).map(p => /^\s/.test(p) ? p : spanAcorde(p)).join('');
}

function renderParCifra(acordes, letra) {
  const pos = [...acordes.matchAll(/\S+/g)].map(m => ({ col: m.index, tk: m[0] }));
  const seg = (tk, txt) =>
    `<span class="ap-seg"><span class="ap-seg-ch">${tk ? spanAcorde(tk) : ''}</span><span class="ap-seg-ly">${escHtml(txt)}</span></span>`;
  let html = pos[0].col > 0 && letra.slice(0, pos[0].col) ? seg('', letra.slice(0, pos[0].col)) : '';
  pos.forEach((p, i) => {
    html += seg(p.tk, letra.slice(p.col, i + 1 < pos.length ? pos[i + 1].col : undefined));
  });
  return `<div class="ap-par">${html}</div>`;
}

function renderCifraHtml(cifra) {
  let secaoAtual = '';
  return (cifra||[]).map(l => {
    let h = '';
    if (l.secao && l.secao !== secaoAtual) {
      secaoAtual = l.secao;
      h += `<div class="ap-secao-l">${escHtml(l.secao)}</div>`;
    }
    if (l.acordes && !l.acordes.trim()) l = {...l, acordes: ''};
    if (l.acordes && l.letra) h += renderParCifra(l.acordes, l.letra);
    else if (l.acordes)       h += `<div class="ap-acorde-l">${spansAcordes(l.acordes)}</div>`;
    else if (l.letra)         h += `<div class="ap-letra-l">${escHtml(l.letra)}</div>`;
    return h;
  }).join('');
}

function parseTabela(text) {
  const lines = text.split('\n');
  const secoes = [];
  let cur = null;
  for(const line of lines) {
    const t = line.trim();
    if(!t) continue;
    if(t.startsWith('##')) {
      if(cur) secoes.push(cur);
      cur = {nome_secao: t.replace(/^##\s*/,''), grid: []};
    } else {
      if(!cur) cur = {nome_secao: 'Principal', grid: []};
      const cells = t.split('|').map(c=>c.trim()).filter(Boolean);
      if(cells.length) cur.grid.push(cells);
    }
  }
  if(cur) secoes.push(cur);
  return secoes;
}

async function delMusica(id, titulo, fromModal=false) {
  confirm_del(`Deseja excluir permanentemente a música "<strong>${titulo}</strong>"?<br><br>Ela também será removida de qualquer Repertório onde esteja contida.`, async()=>{
    await api.del(`/api/musicas/${id}`);
    toast('🗑️ Música removida da biblioteca');
    if(fromModal) closeModal();
    renderMusicas();
  });
}

// ── PDF individual ─────────────────────────────────────────────────────
function openPDFMusica(id, titulo) {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📄 PDF — ${titulo}</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0 16px">
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadMusicaPDF('${id}','${titulo.replace(/'/g,"\\'")}','completo')">
        <span style="font-size:18px">📚</span>
        <div style="text-align:left"><div style="font-weight:600">Cifra + Grade de Acordes</div><div style="font-size:12px;color:var(--text-dim)">Letra com acordes e mapa de compassos</div></div>
      </button>
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadMusicaPDF('${id}','${titulo.replace(/'/g,"\\'")}','cifra')">
        <span style="font-size:18px">🎵</span>
        <div style="text-align:left"><div style="font-weight:600">Só Cifra com Letra</div><div style="font-size:12px;color:var(--text-dim)">Acordes acima da letra, sem grade</div></div>
      </button>
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadMusicaPDF('${id}','${titulo.replace(/'/g,"\\'")}','tabela')">
        <span style="font-size:18px">🗂️</span>
        <div style="text-align:left"><div style="font-weight:600">Só Mapa de Acordes</div><div style="font-size:12px;color:var(--text-dim)">Grade de compassos por seção</div></div>
      </button>
    </div>`, 'modal-sm');
}

async function _downloadMusicaPDF(id, titulo, modo) {
  loading('Gerando PDF...');
  try {
    const resp = await fetch(`/api/musicas/${id}/pdf?modo=${modo}`);
    if(!resp.ok) { const e=await resp.json(); throw new Error(e.erro||'Erro'); }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = titulo.replace(/[^a-z0-9]/gi,'_')+`_${modo}.pdf`; a.click();
    URL.revokeObjectURL(url);
    toast('✅ PDF baixado!');
  } catch(e) { toast('❌ '+e.message,'err'); }
  finally { unload(); }
}

// ── Backup ─────────────────────────────────────────────────────────────
function openBackup() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">💾 Backup da Biblioteca</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="info-box">Exporte todas as músicas e repertórios em um arquivo JSON. Para restaurar, importe o mesmo arquivo.</div>
    <div style="display:flex;flex-direction:column;gap:12px;padding:8px 0 16px">
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_exportBackup()">
        <span style="font-size:18px">⬇️</span>
        <div style="text-align:left"><div style="font-weight:600">Exportar Backup</div><div style="font-size:12px;color:var(--text-dim)">Baixar backup_solmaior.json com todos os dados</div></div>
      </button>
      <div class="pdf-opt-btn" style="display:flex;align-items:center;gap:16px;cursor:pointer;" onclick="document.getElementById('import-file').click()">
        <span style="font-size:18px">⬆️</span>
        <div style="text-align:left;flex:1"><div style="font-weight:600">Importar Backup</div><div style="font-size:12px;color:var(--text-dim)">Restaurar músicas de um arquivo JSON exportado anteriormente</div></div>
        <input type="file" id="import-file" accept=".json" style="display:none" onchange="doImportBackup(this)">
      </div>
    </div>`, 'modal-sm');
}

async function _exportBackup() {
  loading('Exportando...');
  try {
    if (!navigator.onLine) {
      const mList = await idbGet('api_cache', '/api/musicas');
      const rList = await idbGet('api_cache', '/api/repertorios');
      const data = {
        musicas: (mList && mList.data) ? mList.data : [],
        repertorios: (rList && rList.data) ? rList.data : [],
        exportado_em: new Date().toISOString(),
        offline: true
      };
      const jsonStr = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'backup_solmaior.json'; a.click();
      URL.revokeObjectURL(url);
      toast('✅ Backup exportado (cache local)!');
      return;
    }
    const resp = await fetch('/api/biblioteca/export');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='backup_solmaior.json'; a.click();
    URL.revokeObjectURL(url);
    toast('✅ Backup exportado!');
  } catch(e) { toast('❌ '+e.message,'err'); }
  finally { unload(); }
}

async function doImportBackup(input) {
  const file = input.files[0];
  if(!file) return;
  loading('Importando...');
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.musicas && !data.repertorios) throw new Error('Formato de arquivo de backup inválido');

    if (!navigator.onLine) {
      checkOfflineAuth();
      let mList = await idbGet('api_cache', '/api/musicas');
      if (!mList) mList = { data: [], ts: Date.now() };
      let rList = await idbGet('api_cache', '/api/repertorios');
      if (!rList) rList = { data: [], ts: Date.now() };

      let imported = 0, skipped = 0;
      for (const m of (data.musicas || [])) {
        const exists = mList.data.find(x => x.id === m.id);
        if (exists) { skipped++; continue; }
        mList.data.push(m);
        await idbPut('api_cache', `/api/musicas/${m.id}`, { data: m, ts: Date.now() });
        await enqueueWrite('POST', '/api/musicas', m);
        imported++;
      }
      for (const r of (data.repertorios || [])) {
        const exists = rList.data.find(x => x.id === r.id);
        if (exists) continue;
        rList.data.push(r);
        await idbPut('api_cache', `/api/repertorios/${r.id}`, { data: r, ts: Date.now() });
        await enqueueWrite('POST', '/api/repertorios', r);
      }
      await idbPut('api_cache', '/api/musicas', mList);
      await idbPut('api_cache', '/api/repertorios', rList);
      closeModal();
      toast(`✅ ${imported} música${imported!==1?'s':''} importada${imported!==1?'s':''} offline${skipped?' ('+skipped+' já existiam)':''}`);
      renderMusicas();
      return;
    }

    const r = await api.post('/api/biblioteca/import', data);
    if(r.erro) throw new Error(r.erro);
    closeModal();
    const partes = [`${r.importadas} música${r.importadas!==1?'s':''} importada${r.importadas!==1?'s':''}`];
    if (r.restauradas) partes.push(`${r.restauradas} com cifra restaurada`);
    if (r.puladas) partes.push(`${r.puladas} já completa${r.puladas!==1?'s':''}`);
    toast('✅ ' + partes.join(' · '));
    renderMusicas();
  } catch(e) { toast('❌ '+e.message,'err'); }
  finally { unload(); }
}

// ── Transposição de Chords no Palco (JS Frontend) ────────────────────────
const JS_NOTAS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const JS_ENHAR = {'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B'};

function jsNormaliza(n) {
  if (!n) return '';
  const clean = String(n).replace('♭', 'b').replace('♯', '#');
  return JS_ENHAR[clean] || clean;
}

function jsTranspoeAcorde(acorde, st) {
  if (st === 0) return acorde;
  return acorde.split('/').map(part => {
    const m = part.match(/^([A-G][b#]?)(.*)$/);
    if (!m) return part;
    let raiz = m[1];
    const suf = m[2];
    raiz = jsNormaliza(raiz);
    const idx = JS_NOTAS.indexOf(raiz);
    if (idx === -1) return part;
    let newIdx = (idx + st) % 12;
    if (newIdx < 0) newIdx += 12;
    return JS_NOTAS[newIdx] + suf;
  }).join('/');
}

function jsTranspoeLinha(linha, st) {
  if (st === 0) return linha;
  const chordRegex = /\b([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|M|7M|\+)?[0-9]?(?:\/[A-G][b#]?(?:m|maj|min|dim|aug|sus|add|M|7M|\+)?[0-9]?)?)(?![A-Za-z0-9#])/g;
  return linha.replace(chordRegex, (match) => {
    return jsTranspoeAcorde(match, st);
  });
}

let _apTransposeDiff = 0;

function transposeStage(st) {
  _apTransposeDiff += st;
  
  // Atualiza badge do tom
  const tomBadge = document.getElementById('ap-tom-stage');
  if (tomBadge) {
    const origTom = tomBadge.dataset.original;
    tomBadge.textContent = jsTranspoeAcorde(origTom, _apTransposeDiff);
  }
  
  // Atualiza todos os acordes da cifra
  document.querySelectorAll('#ap-root .ap-ch').forEach(el => {
    el.textContent = jsTranspoeAcorde(el.dataset.original, _apTransposeDiff);
  });

  // Atualiza todas as células da grade de acordes
  document.querySelectorAll('.ap-grid-cell').forEach(el => {
    const origChord = el.dataset.original;
    if (origChord) {
      el.textContent = jsTranspoeLinha(origChord, _apTransposeDiff);
    }
  });
  
  toast(`Tom transposto: ${_apTransposeDiff > 0 ? '+' : ''}${_apTransposeDiff} semitons`);
}

// ── Modo Apresentação ──────────────────────────────────────────────────
async function openApresentacao(id) {
  const m = await api.get(`/api/musicas/${id}`);
  const cifra = m.cifra_tradicional || [];

  const bpm = m.bpm || 80;
  const scrollSpeed = Math.max(0.3, Math.min(3, bpm / 80));

  const html = renderCifraHtml(cifra);

  const gridSections = m.tabela || [];
  const gridHtml = gridSections.length ? gridSections.map(s => {
    const secaoNome = s.nome_secao || '';
    const rowsHtml = (s.grid || []).map(row => {
      const cellsHtml = row.map(cell => {
        return `<div class="ap-grid-cell" data-original="${cell.replace(/"/g, '&quot;')}">${cell}</div>`;
      }).join('');
      return `<div class="ap-grid-row">${cellsHtml}</div>`;
    }).join('');
    return `
      <div class="ap-grid-secao">
        <div class="ap-secao-l">${secaoNome}</div>
        <div class="ap-grid-container">${rowsHtml}</div>
      </div>
    `;
  }).join('') : '<div style="color:var(--text-faint);padding:60px;text-align:center;font-family:var(--font-m)">Nenhuma grade de acordes cadastrada</div>';

  _apBpm = bpm;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="ap-overlay" id="ap-root" style="--ap-zoom: ${_apZoom};">
      <div class="ap-bar">
        <button class="ap-back" onclick="closeApresentacao()">✕</button>
        <div class="ap-titles">
          <div class="ap-title">${m.titulo}</div>
          <div class="ap-artist">${m.artista}</div>
        </div>
        <div class="ap-zoom-container" style="display:flex;align-items:center;gap:4px;margin-right:8px;">
          <button class="ap-btn" onclick="changeApZoom(-0.1)" title="Diminuir fonte ([)" style="width:28px;height:28px;font-size:11px;padding:0;">A-</button>
          <span id="ap-zoom-val" style="font-size:11px;color:var(--text-dim);min-width:32px;text-align:center;font-family:var(--font-m);">${Math.round(_apZoom*100)}%</span>
          <button class="ap-btn" onclick="changeApZoom(0.1)" title="Aumentar fonte (])" style="width:28px;height:28px;font-size:11px;padding:0;">A+</button>
        </div>
        <div class="ap-transpose-container" style="display:flex;align-items:center;gap:6px;margin-right:12px;">
          <button class="ap-btn" onclick="transposeStage(-1)" title="Transpor -1 semitom" style="width:32px;height:32px;font-size:12px;padding:0;">♭</button>
          <div class="ap-tom-large" id="ap-tom-stage" data-original="${m.tom}">${m.tom}</div>
          <button class="ap-btn" onclick="transposeStage(1)" title="Transpor +1 semitom" style="width:32px;height:32px;font-size:12px;padding:0;">♯</button>
        </div>
        <div class="ap-controls">
          <div class="ap-speed">
            <span>vel.</span>
            <input type="range" min="0.3" max="3.5" step="0.1" value="${scrollSpeed.toFixed(1)}" id="ap-speed" oninput="setScrollSpeed(this.value)">
            <span id="ap-speed-val">${scrollSpeed.toFixed(1)}×</span>
          </div>
          <button class="ap-btn ${_apSoloAcordes ? 'on' : ''}" id="ap-view-mode-btn" onclick="toggleApViewMode()" title="Alternar Letra/Grade de Acordes">▤</button>
          <button class="ap-btn" id="ap-metro-btn" onclick="toggleMetronomo()" title="Metrônomo">🥁</button>
          <button class="ap-btn" id="ap-scroll-btn" onclick="toggleAutoScroll()" title="Auto-scroll (espaço)">▶</button>
        </div>
      </div>
      <div class="ap-stage" id="ap-body">
        <div class="ap-content" id="ap-view-cifra" style="${_apSoloAcordes ? 'display:none' : ''}">${html || '<div style="color:var(--text-faint);padding:60px;text-align:center;font-family:var(--font-m)">Nenhuma cifra cadastrada</div>'}</div>
        <div class="ap-content" id="ap-view-grid" style="${_apSoloAcordes ? '' : 'display:none'}">${gridHtml}</div>
      </div>
      <div class="metro" id="ap-metro" style="display:none">
        <div class="metro-beats">
          <div class="metro-dot first" id="mb-0"></div>
          <div class="metro-dot" id="mb-1"></div>
          <div class="metro-dot" id="mb-2"></div>
          <div class="metro-dot" id="mb-3"></div>
        </div>
        <div>
          <div class="metro-bpm" id="ap-metro-info">${bpm}</div>
          <div class="metro-bpm-sub">bpm</div>
        </div>
        <button class="metro-toggle off" id="ap-metro-toggle" onclick="toggleMetronomo()">▶</button>
      </div>
    </div>`);

  document.addEventListener('keydown', apKeyHandler);
  requestWakeLock();
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

let _apWakeLock = null;

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    _apWakeLock = await navigator.wakeLock.request('screen');
    console.log('Screen Wake Lock active');
  } catch (err) {
    console.warn(`Screen Wake Lock error: ${err.name}, ${err.message}`);
  }
}

async function releaseWakeLock() {
  if (!_apWakeLock) return;
  try {
    await _apWakeLock.release();
    _apWakeLock = null;
    console.log('Screen Wake Lock released');
  } catch (err) {
    console.error(err);
  }
}

async function handleVisibilityChange() {
  if (_apWakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
}

let _apScrollInterval = null;
let _apScrollActive   = false;
let _apScrollSpeed    = 1;
let _apMetroInterval  = null;
let _apMetroActive    = false;
let _apAudioCtx       = null;
let _apBpm            = 80;
let _apBeat           = 0;
let _apRepList        = [];
let _apRepIdx         = -1;
let _apSoloAcordes    = localStorage.getItem('apSoloAcordes') === 'true';
let _apZoom           = parseFloat(localStorage.getItem('apZoom')) || 1.0;

function changeApZoom(delta) {
  _apZoom = Math.max(0.7, Math.min(1.8, Math.round((_apZoom + delta) * 10) / 10));
  localStorage.setItem('apZoom', _apZoom.toString());
  const root = document.getElementById('ap-root');
  if (root) {
    root.style.setProperty('--ap-zoom', _apZoom);
  }
  const zoomLbl = document.getElementById('ap-zoom-val');
  if (zoomLbl) zoomLbl.textContent = `${Math.round(_apZoom * 100)}%`;
  toast(`Tamanho da fonte: ${Math.round(_apZoom * 100)}%`);
}

function toggleApViewMode() {
  _apSoloAcordes = !_apSoloAcordes;
  localStorage.setItem('apSoloAcordes', _apSoloAcordes);
  const viewCifra = document.getElementById('ap-view-cifra');
  const viewGrid = document.getElementById('ap-view-grid');
  const btn = document.getElementById('ap-view-mode-btn');
  if (viewCifra && viewGrid) {
    if (_apSoloAcordes) {
      viewCifra.style.display = 'none';
      viewGrid.style.display = 'block';
      if (btn) btn.classList.add('on');
    } else {
      viewCifra.style.display = 'block';
      viewGrid.style.display = 'none';
      if (btn) btn.classList.remove('on');
    }
  }
}

async function openPalcoRep(id) {
  const reps = await api.get('/api/repertorios');
  const rep = reps.find(r => r.id === id);
  if (!rep || !rep.musicas || rep.musicas.length === 0) {
    toast('Repertório sem músicas', 'warn'); return;
  }
  _apRepList = rep.musicas;
  _apRepIdx  = 0;
  await openApresentacao(_apRepList[0].id);
  _renderRepNav();
}

function _renderRepNav() {
  if (_apRepList.length === 0) return;
  const bar = document.querySelector('.ap-bar');
  if (!bar || document.getElementById('ap-rep-nav')) return;
  const nav = document.createElement('div');
  nav.id = 'ap-rep-nav';
  nav.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto;margin-right:8px';
  nav.innerHTML = `
    <button class="ap-btn" onclick="apRepNav(-1)" title="Música anterior">◀</button>
    <button class="ap-btn" onclick="toggleSetlistDrawer()" id="ap-rep-pos-btn" style="font-size:12px;font-family:var(--font-m);min-width:64px;text-align:center;padding:0 8px;" title="Ver setlist do show">
      ${_apRepIdx+1}/${_apRepList.length} 📋
    </button>
    <button class="ap-btn" onclick="apRepNav(1)" title="Próxima música">▶</button>`;
  bar.querySelector('.ap-controls').before(nav);
}

async function apRepNav(dir) {
  const next = _apRepIdx + dir;
  if (next < 0 || next >= _apRepList.length) return;
  _apRepIdx = next;
  closeApresentacao(false);
  await openApresentacao(_apRepList[_apRepIdx].id);
  _renderRepNav();
}

function toggleSetlistDrawer() {
  let drawer = document.getElementById('ap-setlist-drawer');
  if (!drawer) {
    const itemsHtml = _apRepList.map((m, i) => `
      <button class="ap-drawer-item ${i === _apRepIdx ? 'active' : ''}" onclick="apRepNavTo(${i})">
        <span class="num">${String(i + 1).padStart(2, '0')}</span>
        <span class="nm">${m.titulo}</span>
        <span class="tm" style="color: ${i === _apRepIdx ? 'var(--accent)' : 'var(--text-dim)'}">${m.tom || ''}</span>
      </button>
    `).join('');

    document.getElementById('ap-root').insertAdjacentHTML('beforeend', `
      <div class="ap-drawer" id="ap-setlist-drawer">
        <div class="ap-drawer-h">
          <span>Setlist do Show</span>
          <button class="ap-btn btn-xs btn-icon-only" onclick="toggleSetlistDrawer()">✕</button>
        </div>
        <div class="ap-drawer-list">
          ${itemsHtml}
        </div>
      </div>
    `);
    drawer = document.getElementById('ap-setlist-drawer');
    drawer.offsetHeight; // force reflow
  }
  drawer.classList.toggle('open');
}

async function apRepNavTo(idx) {
  if (idx < 0 || idx >= _apRepList.length) return;
  _apRepIdx = idx;
  closeApresentacao(false);
  await openApresentacao(_apRepList[_apRepIdx].id);
  _renderRepNav();
}

function toggleAutoScroll() {
  _apScrollActive = !_apScrollActive;
  const btn = document.getElementById('ap-scroll-btn');
  if (_apScrollActive) {
    btn.textContent = '⏸'; btn.classList.add('on');
    _apScrollInterval = setInterval(() => {
      const body = document.getElementById('ap-body');
      if (body) body.scrollTop += _apScrollSpeed;
    }, 30);
  } else {
    btn.textContent = '▶'; btn.classList.remove('on');
    clearInterval(_apScrollInterval);
  }
}

function setScrollSpeed(v) {
  _apScrollSpeed = parseFloat(v);
  const lbl = document.getElementById('ap-speed-val');
  if (lbl) lbl.textContent = parseFloat(v).toFixed(1) + '×';
}

function toggleMetronomo() {
  _apMetroActive = !_apMetroActive;
  const btn    = document.getElementById('ap-metro-btn');
  const toggle = document.getElementById('ap-metro-toggle');
  const panel  = document.getElementById('ap-metro');
  if (_apMetroActive) {
    if (btn) btn.classList.add('on');
    if (panel) panel.style.display = 'flex';
    if (toggle) { toggle.textContent = '⏸'; toggle.className = 'metro-toggle'; }
    
    // Inicializa AudioContext no fluxo do clique para contornar restrições do iOS
    if (!_apAudioCtx) {
      _apAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_apAudioCtx.state === 'suspended') {
      _apAudioCtx.resume();
    }
    
    _startMetronomo();
  } else {
    if (btn) btn.classList.remove('on');
    if (panel) panel.style.display = 'none';
    if (toggle) { toggle.textContent = '▶'; toggle.className = 'metro-toggle off'; }
    clearInterval(_apMetroInterval);
  }
}

function _startMetronomo() {
  const ms = Math.round(60000 / _apBpm);
  _apBeat = 0;
  clearInterval(_apMetroInterval);
  _apMetroInterval = setInterval(() => {
    for (let i = 0; i < 4; i++) {
      const d = document.getElementById('mb-' + i);
      if (d) d.classList.remove('on');
    }
    const dot = document.getElementById('mb-' + _apBeat);
    if (dot) dot.classList.add('on');
    try {
      if (_apAudioCtx) {
        const osc = _apAudioCtx.createOscillator();
        const gain = _apAudioCtx.createGain();
        osc.connect(gain);
        gain.connect(_apAudioCtx.destination);
        osc.frequency.value = _apBeat === 0 ? 1000 : 800;
        gain.gain.value = 0.18;
        osc.start();
        osc.stop(_apAudioCtx.currentTime + 0.04);
      }
    } catch(e) {}
    _apBeat = (_apBeat + 1) % 4;
  }, ms);
}

function apKeyHandler(e) {
  if (e.key === 'Escape') { closeApresentacao(); return; }
  if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleAutoScroll(); return; }
  if (e.key === 'PageDown' || e.key === 'ArrowDown') {
    e.preventDefault();
    const b = document.getElementById('ap-body');
    if (b) b.scrollTop += (e.key === 'PageDown' ? 350 : 80);
    return;
  }
  if (e.key === 'PageUp' || e.key === 'ArrowUp') {
    e.preventDefault();
    const b = document.getElementById('ap-body');
    if (b) b.scrollTop -= (e.key === 'PageUp' ? 350 : 80);
    return;
  }
  if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
    if (_apRepList && _apRepList.length > 0) {
      e.preventDefault();
      apRepNav(1);
      return;
    }
  }
  if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
    if (_apRepList && _apRepList.length > 0) {
      e.preventDefault();
      apRepNav(-1);
      return;
    }
  }
  if (e.key === '+' || e.key === '=' || e.key === '♯') {
    e.preventDefault(); transposeStage(1); return;
  }
  if (e.key === '-' || e.key === '_' || e.key === '♭') {
    e.preventDefault(); transposeStage(-1); return;
  }
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault(); toggleMetronomo(); return;
  }
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault(); toggleApViewMode(); return;
  }
  if (e.key === '[' || e.key === '{') {
    e.preventDefault(); changeApZoom(-0.1); return;
  }
  if (e.key === ']' || e.key === '}') {
    e.preventDefault(); changeApZoom(0.1); return;
  }
}

function closeApresentacao(resetRep = true) {
  clearInterval(_apScrollInterval);
  clearInterval(_apMetroInterval);
  _apScrollActive = false;
  _apMetroActive = false;
  _apTransposeDiff = 0;

  // Reseta UI do metrônomo se estava ativo
  const metroBtn = document.getElementById('ap-metro-btn');
  const metroPanel = document.getElementById('ap-metro');
  if (metroBtn) metroBtn.classList.remove('on');
  if (metroPanel) metroPanel.style.display = 'none';

  // Reseta UI do auto-scroll
  const scrollBtn = document.getElementById('ap-scroll-btn');
  if (scrollBtn) { scrollBtn.textContent = '▶'; scrollBtn.classList.remove('on'); }

  releaseWakeLock();
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  document.removeEventListener('keydown', apKeyHandler);
  document.getElementById('ap-root')?.remove();

  if (resetRep) {
    _apRepList = [];
    _apRepIdx = -1;
  }
}

// ── Stats ──────────────────────────────────────────────────────────────
async function renderStats() {
  const stats = await api.get('/api/stats');
  const horas = Math.floor(stats.duracao_total_min/60);
  const mins  = Math.round(stats.duracao_total_min % 60);
  const durStr = stats.duracao_total_min > 0 ? (horas > 0 ? `${horas}h ${mins}min` : `${mins}min`) : '—';
  const favPct = stats.total_musicas > 0 ? Math.round(stats.total_favoritas/stats.total_musicas*100) : 0;
  const maxArt = stats.top_artistas[0]?.n || 1;
  const maxTom = stats.por_tom[0]?.n || 1;

  document.getElementById('app-main').innerHTML = `
    <div class="page-bar">
      <div class="page-title-block">
        <div class="page-title">Estatísticas <em>da biblioteca</em></div>
        <div class="page-sub">Visão geral do acervo, artistas, tons e estilos</div>
      </div>
    </div>

    <div class="page-body">
      <div class="stats-grid">
        <div class="card stat-tile">
          <div class="stat-tile-label">Músicas</div>
          <div class="stat-tile-num">${stats.total_musicas}</div>
          <div class="stat-tile-sub">cifras catalogadas</div>
        </div>
        <div class="card stat-tile">
          <div class="stat-tile-label">Favoritas</div>
          <div class="stat-tile-num" style="color:var(--accent)">${stats.total_favoritas}</div>
          <div class="stat-tile-sub">${favPct}% do acervo</div>
        </div>
        <div class="card stat-tile">
          <div class="stat-tile-label">Repertórios</div>
          <div class="stat-tile-num">${stats.total_repertorios}</div>
          <div class="stat-tile-sub">prontos para o palco</div>
        </div>
        <div class="card stat-tile">
          <div class="stat-tile-label">Duração total</div>
          <div class="stat-tile-num">${durStr}</div>
          <div class="stat-tile-sub">somando todo o acervo</div>
        </div>
      </div>

      <div class="stats-cols">
        <div class="card">
          <div class="card-h"><div class="card-title">Artistas mais cadastrados</div></div>
          ${stats.top_artistas.map(a=>`
            <div class="bar-row">
              <div class="bar-label">${a.artista}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${Math.round(a.n/maxArt*100)}%"></div></div>
              <div class="bar-val">${a.n}</div>
            </div>`).join('') || '<div style="color:var(--text-dim);font-size:13px">Nenhum dado ainda</div>'}
        </div>
        <div class="card">
          <div class="card-h"><div class="card-title">Distribuição por tom</div></div>
          <div class="tons-grid">
            ${stats.por_tom.map(t=>`
              <div class="tom-cell" style="background:color-mix(in oklab, var(--accent) ${Math.round(t.n/maxTom*15)}%, transparent)">
                <div class="t">${t.tom}</div>
                <div class="n">${t.n}</div>
              </div>`).join('') || '<div style="color:var(--text-dim);font-size:13px">Nenhum dado ainda</div>'}
          </div>
        </div>
      </div>

      ${stats.top_tags.length ? `
        <div class="card">
          <div class="card-h"><div class="card-title">Nuvem de estilos</div></div>
          <div class="tagcloud">
            ${stats.top_tags.map(t=>`
              <span class="tag-cloud-item" style="font-size:${12 + t.n * 1.4}px">
                ${t.tag}<span class="n">${t.n}</span>
              </span>`).join('')}
          </div>
        </div>
      ` : ''}
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════
// REPERTÓRIOS
// ══════════════════════════════════════════════════════════════════════
let allReps = [];

async function renderRepertorios() {
  allReps = await api.get('/api/repertorios');

  // Update sidebar count
  const nc = document.getElementById('nav-count-reps');
  if (nc) nc.textContent = allReps.length;

  document.getElementById('app-main').innerHTML = `
    <div class="page-bar">
      <div class="page-title-block">
        <div class="page-title">Repertórios <em>do palco</em></div>
        <div class="page-sub">${allReps.length} repertório${allReps.length!==1?'s':''} · QR & PDF integrados</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost btn-sm" onclick="openBackup()">Backup</button>
        <button class="btn btn-primary" onclick="openNovoRep()">+ Novo repertório</button>
      </div>
    </div>

    <div class="page-body">
      ${allReps.length===0 ? `
        <div class="empty">
          <h3>Nenhuma lista criada</h3>
          <p>Crie um repertório e organize as músicas para o próximo show.</p>
          <button class="btn btn-primary" onclick="openNovoRep()">+ Criar repertório</button>
        </div>
      ` : `
        <div class="repgrid">
          ${allReps.map(r => {
            const songs = r.musicas||[];
            const durTotal = songs.reduce((acc,s)=>acc+(s.duracao_min||0),0);
            const min = Math.floor(durTotal);
            const durStr = durTotal > 0 ? (min >= 60 ? `${Math.floor(min/60)}h ${min%60}min` : `${min}min`) : '';
            const nomeEsc = r.nome.replace(/'/g,"\\'");
            return `
              <div class="rep-card" onclick="openEditRep('${r.id}')">
                <div class="rep-card-bar"></div>
                <div>
                  <div class="rep-name">${r.nome}</div>
                  <div class="rep-desc">${songs.length} música${songs.length!==1?'s':''}${durStr?' · '+durStr:''}</div>
                </div>
                <div class="rep-songs-mini">
                  ${songs.slice(0,5).map((s,i)=>`
                    <div class="rep-song-mini">
                      <span class="num">${String(i+1).padStart(2,'0')}</span>
                      <span class="nm">${s.titulo}</span>
                      <span class="tm">${s.tom||''}</span>
                    </div>
                  `).join('')}
                  ${songs.length>5 ? `<div class="rep-song-mini"><span class="num">···</span><span class="nm" style="color:var(--text-faint)">+ ${songs.length-5} músicas</span></div>` : ''}
                  ${songs.length===0 ? `<div style="color:var(--text-faint);font-size:12px;padding:8px 10px">Setlist vazio — adicione músicas</div>` : ''}
                </div>
                <div class="rep-foot">
                  <div class="rep-stats">
                    <span><b>${songs.length}</b> músicas</span>
                    ${durStr ? `<span><b>${durStr}</b></span>` : ''}
                  </div>
                  <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
                    <button class="btn btn-quiet btn-sm" onclick="openQRCode('${r.id}','${nomeEsc}')">QR</button>
                    <button class="btn btn-quiet btn-sm" onclick="gerarPDF('${r.id}','${nomeEsc}')">PDF</button>
                    <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openPalcoRep('${r.id}')">▶ Palco</button>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      `}
    </div>`;
}

function openNovoRep() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">Novo Repertório</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>Nome do Evento / Lista</label>
      <input id="rep-nome" placeholder="Ex: Casamento Especial João e Maria" onkeydown="if(event.key==='Enter')doNovoRep()">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" onclick="doNovoRep()">Gerar Lista →</button>
    </div>`, 'modal-sm');
  document.getElementById('rep-nome').focus();
}

async function doNovoRep() {
  const nome = document.getElementById('rep-nome').value.trim();
  if(!nome) { toast('Digite um nome válido','err'); return; }
  try {
    const r = await api.post('/api/repertorios', {nome});
    if(r.erro) throw new Error(r.erro);
    closeModal();
    await renderRepertorios();
    setTimeout(()=>openEditRep(r.id), 200);
  } catch(e) {
    toast('❌ ' + e.message, 'err');
  }
}

// ── Editar repertório ──────────────────────────────────────────────────
let editRep = null;
let dragSrc = null;

async function openEditRep(id) {
  const reps = await api.get('/api/repertorios');
  editRep = reps.find(r=>r.id===id);
  if(!editRep) return;
  const todasMusicas = await api.get('/api/musicas');
  const selecionadasIds = (editRep.musicas||[]).map(m=>m.id);
  const disponiveis = todasMusicas.filter(m=>!selecionadasIds.includes(m.id));

  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📋 ${editRep.nome}</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>

    <div class="form-group" style="margin-bottom:28px">
      <label>Modificar Nome</label>
      <div style="display:flex;gap:12px">
        <input id="rep-edit-nome" value="${editRep.nome}" style="flex:1" onkeydown="if(event.key==='Enter')saveRepNome('${id}')">
        <button class="btn btn-ghost" onclick="saveRepNome('${id}')">Salvar</button>
      </div>
    </div>

    <div class="two-col">
      <!-- Músicas selecionadas -->
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--line);border-radius:var(--radius-sm);padding:16px">
        <div class="col-title">
          <span id="rep-selected-count">Setlist Atual (${(editRep.musicas||[]).length})</span>
        </div>
        <div class="drag-list" id="drag-selected" ondragover="event.preventDefault()" ondrop="onDrop(event,'selected')">
          ${(editRep.musicas||[]).map((m,i)=>`
            <div class="drag-item" draggable="true" data-id="${m.id}"
              ondragstart="dragSrc=this;this.classList.add('dragging')"
              ondragend="this.classList.remove('dragging')">
              <span class="drag-handle">⠿</span>
              <div class="drag-arrows" style="display:flex;flex-direction:column;gap:1px;margin-right:2px;flex-shrink:0;">
                <button class="btn btn-quiet btn-xs btn-icon-only" onclick="event.stopPropagation();moveSongInRep('${m.id}', -1)" title="Mover para cima" style="padding:0;width:18px;height:14px;line-height:1;font-size:8px;display:flex;align-items:center;justify-content:center;">▲</button>
                <button class="btn btn-quiet btn-xs btn-icon-only" onclick="event.stopPropagation();moveSongInRep('${m.id}', 1)" title="Mover para baixo" style="padding:0;width:18px;height:14px;line-height:1;font-size:8px;display:flex;align-items:center;justify-content:center;">▼</button>
              </div>
              <div class="di-info">
                <div class="di-title">${m.titulo}</div>
                <div class="di-artist">${m.artista} · <span>${m.tom}</span></div>
              </div>
              <button class="btn btn-quiet btn-xs btn-icon-only" onclick="removerDaLista('${m.id}')" title="Remover da lista">✕</button>
            </div>
          `).join('') || '<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:40px 0;border:1px dashed var(--line);border-radius:var(--radius-xs)">Setlist vazio. Adicione músicas →</div>'}
        </div>
      </div>

      <!-- Disponíveis -->
      <div style="background:rgba(255,255,255,0.02);border:1px solid var(--line);border-radius:var(--radius-sm);padding:16px">
        <div class="col-title" id="rep-avail-count">Adicionar Novas (${disponiveis.length})</div>
        <input placeholder="Buscar na biblioteca..." id="rep-avail-search" style="margin-bottom:16px;" oninput="filtrarDisp(this.value)">
        <div class="avail-scroll" id="avail-list">
          ${renderDisponiveis(disponiveis)}
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-danger btn-sm" onclick="delRep('${id}','${editRep.nome.replace(/'/g,"\\'")}',true)">🗑️ Excluir Geral</button>
      <button class="btn btn-ghost" onclick="closeModal()">Sair</button>
      <button class="btn btn-green" onclick="closeModal();gerarPDF('${id}','${editRep.nome.replace(/'/g,"\\'")}')">📄 Baixar Livro em PDF</button>
    </div>`, 'modal-lg');
}

function renderDisponiveis(lista) {
  if(!lista.length) return '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0; border:1px dashed var(--line); border-radius:12px;">Busca não encontrada</div>';
  return lista.map(m=>`
    <div class="avail-item" onclick="adicionarNaLista('${m.id}')">
      <div class="di-info" style="flex:1">
        <div class="di-title">${m.titulo}</div>
        <div class="di-artist">${m.artista} · <span>${m.tom}</span></div>
      </div>
      <button class="btn btn-primary btn-xs btn-icon-only">+</button>
    </div>`).join('');
}

async function filtrarDisp(q) {
  const todas = await api.get('/api/musicas' + (q ? `?q=${encodeURIComponent(q)}` : ''));
  const qNorm = removeAccents(q).toLowerCase();
  const selIds = getSelectedIds();
  const disp = todas.filter(m => {
    if (selIds.includes(m.id)) return false;
    if (!qNorm) return true;
    const titNorm = removeAccents(m.titulo || '').toLowerCase();
    const artNorm = removeAccents(m.artista || '').toLowerCase();
    const tomNorm = removeAccents(m.tom || '').toLowerCase();
    return titNorm.includes(qNorm) || artNorm.includes(qNorm) || tomNorm.includes(qNorm);
  });
  const el = document.getElementById('avail-list');
  if(el) el.innerHTML = renderDisponiveis(disp);
  const countEl = document.getElementById('rep-avail-count');
  if (countEl) countEl.textContent = `Adicionar Novas (${disp.length})`;
}

function getSelectedIds() {
  return [...document.querySelectorAll('#drag-selected .drag-item')].map(el=>el.dataset.id);
}

async function refreshEditRepLists() {
  if (!editRep) return;
  const selectedContainer = document.getElementById('drag-selected');
  const countEl = document.getElementById('rep-selected-count');
  if (countEl) countEl.textContent = `Setlist Atual (${(editRep.musicas||[]).length})`;
  
  if (selectedContainer) {
    selectedContainer.innerHTML = (editRep.musicas||[]).map((m,i)=>`
      <div class="drag-item" draggable="true" data-id="${m.id}"
        ondragstart="dragSrc=this;this.classList.add('dragging')"
        ondragend="this.classList.remove('dragging')">
        <span class="drag-handle">⠿</span>
        <div class="drag-arrows" style="display:flex;flex-direction:column;gap:1px;margin-right:2px;flex-shrink:0;">
          <button class="btn btn-quiet btn-xs btn-icon-only" onclick="event.stopPropagation();moveSongInRep('${m.id}', -1)" title="Mover para cima" style="padding:0;width:18px;height:14px;line-height:1;font-size:8px;display:flex;align-items:center;justify-content:center;">▲</button>
          <button class="btn btn-quiet btn-xs btn-icon-only" onclick="event.stopPropagation();moveSongInRep('${m.id}', 1)" title="Mover para baixo" style="padding:0;width:18px;height:14px;line-height:1;font-size:8px;display:flex;align-items:center;justify-content:center;">▼</button>
        </div>
        <div class="di-info">
          <div class="di-title">${m.titulo}</div>
          <div class="di-artist">${m.artista} · <span>${m.tom}</span></div>
        </div>
        <button class="btn btn-quiet btn-xs btn-icon-only" onclick="removerDaLista('${m.id}')" title="Remover da lista">✕</button>
      </div>
    `).join('') || '<div style="color:var(--text-faint);font-size:13px;text-align:center;padding:40px 0;border:1px dashed var(--line);border-radius:var(--radius-xs)">Setlist vazio. Adicione músicas →</div>';
  }

  const searchInput = document.getElementById('rep-avail-search');
  const q = searchInput ? searchInput.value : '';
  await filtrarDisp(q);
  renderRepertorios();
}

async function adicionarNaLista(musicaId) {
  const selIds = getSelectedIds();
  if(selIds.includes(musicaId)) return;
  const novas = [...selIds, musicaId];
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: novas});
  const reps = await api.get('/api/repertorios');
  editRep = reps.find(r=>r.id===editRep.id);
  await refreshEditRepLists();
}

async function removerDaLista(musicaId) {
  const novas = getSelectedIds().filter(id=>id!==musicaId);
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: novas});
  const reps = await api.get('/api/repertorios');
  editRep = reps.find(r=>r.id===editRep.id);
  await refreshEditRepLists();
}

async function moveSongInRep(musicaId, direction) {
  const selIds = getSelectedIds();
  const idx = selIds.indexOf(musicaId);
  if (idx === -1) return;
  const targetIdx = idx + direction;
  if (targetIdx < 0 || targetIdx >= selIds.length) return;
  
  // Troca de posição no array
  const temp = selIds[idx];
  selIds[idx] = selIds[targetIdx];
  selIds[targetIdx] = temp;
  
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: selIds});
  const reps = await api.get('/api/repertorios');
  editRep = reps.find(r=>r.id===editRep.id);
  await refreshEditRepLists();
}

async function saveRepNome(id) {
  const nome = document.getElementById('rep-edit-nome').value.trim();
  if(!nome) return;
  await api.put(`/api/repertorios/${id}`, {nome});
  toast('✅ Nome alterado!');
  editRep.nome = nome;
  document.querySelector('.modal-title').textContent = '📋 ' + nome;
  renderRepertorios();
}

function onDrop(event, zone) {
  event.preventDefault();
  if(!dragSrc) return;
  const target = event.target.closest('.drag-item');
  const list = document.getElementById('drag-selected');
  if(target && target!==dragSrc) {
    const items = [...list.querySelectorAll('.drag-item')];
    const srcIdx  = items.indexOf(dragSrc);
    const tgtIdx  = items.indexOf(target);
    if(srcIdx<tgtIdx) list.insertBefore(dragSrc, target.nextSibling);
    else              list.insertBefore(dragSrc, target);
    saveOrder();
  }
}

async function saveOrder() {
  const novas = getSelectedIds();
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: novas});
}

async function delRep(id, nome, fromModal=false) {
  confirm_del(`Excluir repertório "<strong>${nome}</strong>"?`, async()=>{
    await api.del(`/api/repertorios/${id}`);
    if(fromModal) closeModal();
    toast('🗑️ Repertório apagado');
    renderRepertorios();
  });
}

// ══════════════════════════════════════════════════════════════════════
// GERAR PDF
// ══════════════════════════════════════════════════════════════════════
function gerarPDF(id, nome) {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">📄 Gerar PDF — ${nome}</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;padding:8px 0 16px">
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadPDF('${id}','${nome.replace(/'/g,"\\'")}','completo')">
        <span style="font-size:18px">📚</span>
        <div style="text-align:left">
          <div style="font-weight:600;margin-bottom:2px">PDF Completo</div>
          <div style="font-size:12px;color:var(--text-dim)">Cifra com letra + mapa de acordes para cada música</div>
        </div>
      </button>
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadPDF('${id}','${nome.replace(/'/g,"\\'")}','cifra')">
        <span style="font-size:18px">🎵</span>
        <div style="text-align:left">
          <div style="font-weight:600;margin-bottom:2px">Só Cifras e Letras</div>
          <div style="font-size:12px;color:var(--text-dim)">Acordes acima da letra, sem mapa de grade</div>
        </div>
      </button>
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadPDF('${id}','${nome.replace(/'/g,"\\'")}','tabela')">
        <span style="font-size:18px">🗂️</span>
        <div style="text-align:left">
          <div style="font-weight:600;margin-bottom:2px">Só Mapa de Acordes</div>
          <div style="font-size:12px;color:var(--text-dim)">Grade de compassos por seção, sem letra</div>
        </div>
      </button>
      <button class="btn btn-ghost pdf-opt-btn" onclick="closeModal();_downloadPDF('${id}','${nome.replace(/'/g,"\\'")}','setlist')">
        <span style="font-size:18px">🎤</span>
        <div style="text-align:left">
          <div style="font-weight:600;margin-bottom:2px">Lista de Palco</div>
          <div style="font-size:12px;color:var(--text-dim)">Título, artista e tom em letra grande — para ver a sequência no show</div>
        </div>
      </button>
    </div>`, 'modal-sm');
}

async function _downloadPDF(id, nome, modo) {
  loading(`Gerando PDF...`);
  try {
    const resp = await fetch(`/api/repertorios/${id}/pdf?modo=${modo}`);
    if(!resp.ok) {
      const err = await resp.json();
      throw new Error(err.erro||'Erro desconhecido');
    }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = nome.replace(/[^a-z0-9]/gi,'_') + `_${modo}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ PDF baixado com sucesso!');
  } catch(e) {
    toast('❌ ' + e.message, 'err');
  } finally {
    unload();
  }
}

// ── QR Code ────────────────────────────────────────────────────────────
function openQRCode(rid, nome) {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">QR Code — ${nome}</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div style="text-align:center;padding:20px">
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:16px">Escaneie para ver a lista de músicas</div>
      <img src="/api/repertorios/${rid}/qrcode" alt="QR Code" style="width:220px;height:220px;border-radius:12px;border:4px solid var(--line)">
      <div style="margin-top:16px">
        <a href="/api/repertorios/${rid}/qrcode" download="${nome.replace(/\s+/g,'_')}_qr.png" class="btn btn-ghost btn-sm">⬇️ Baixar PNG</a>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
    </div>`, 'modal-sm');
}

// ── Aparência / Personalização ─────────────────────────────────────────
const ACCENT_PRESETS = {
  gold:    { hex: '#d4a853', hex2: '#e5b966' },
  copper:  { hex: '#d18a5d', hex2: '#e6a075' },
  emerald: { hex: '#67c39a', hex2: '#8ad8b6' },
  indigo:  { hex: '#9b8fe8', hex2: '#b4a8ff' },
  bone:    { hex: '#e8ddc8', hex2: '#f5ecd8' },
};

const FONT_PRESETS = {
  fraunces: { display: "'Fraunces', 'Playfair Display', serif" },
  sansonly: { display: "'DM Sans', system-ui, sans-serif" },
};

function applyAppearance() {
  const bg = localStorage.getItem('sm-bg') || 'midnight';
  const density = localStorage.getItem('sm-density') || 'cozy';
  const cards = localStorage.getItem('sm-cards') || 'glass';
  const layout = localStorage.getItem('sm-layout') || 'sidebar';
  const accent = localStorage.getItem('sm-accent') || 'gold';
  const font = localStorage.getItem('sm-font') || 'fraunces';

  const root = document.documentElement;
  root.setAttribute('data-bg', bg);
  root.setAttribute('data-density', density);
  root.setAttribute('data-cards', cards);
  root.setAttribute('data-layout', layout);
  
  const a = ACCENT_PRESETS[accent] || ACCENT_PRESETS.gold;
  root.style.setProperty('--accent', a.hex);
  root.style.setProperty('--accent-2', a.hex2);
  
  const f = FONT_PRESETS[font] || FONT_PRESETS.fraunces;
  root.style.setProperty('--font-d', f.display);
}

function saveApperanceKey(key, value) {
  localStorage.setItem(key, value);
  applyAppearance();
}

function openAparência() {
  const bg = localStorage.getItem('sm-bg') || 'midnight';
  const density = localStorage.getItem('sm-density') || 'cozy';
  const cards = localStorage.getItem('sm-cards') || 'glass';
  const layout = localStorage.getItem('sm-layout') || 'sidebar';
  const accent = localStorage.getItem('sm-accent') || 'gold';
  const font = localStorage.getItem('sm-font') || 'fraunces';

  modal(`
    <div class="modal-header">
      <h3 class="modal-title">✨ Ajustes de Aparência</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <label>Cor de Destaque (Acento)</label>
      <select id="ap-accent-sel" onchange="saveApperanceKey('sm-accent', this.value)">
        <option value="gold" ${accent==='gold'?'selected':''}>Dourado (Original)</option>
        <option value="copper" ${accent==='copper'?'selected':''}>Cobre Quente</option>
        <option value="emerald" ${accent==='emerald'?'selected':''}>Verde Esmeralda</option>
        <option value="indigo" ${accent==='indigo'?'selected':''}>Índigo Noturno</option>
        <option value="bone" ${accent==='bone'?'selected':''}>Marfim</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <label>Tema de Fundo</label>
      <select id="ap-bg-sel" onchange="saveApperanceKey('sm-bg', this.value)">
        <option value="midnight" ${bg==='midnight'?'selected':''}>Meia-noite (Escuro Azul)</option>
        <option value="warm" ${bg==='warm'?'selected':''}>Quente (Escuro Marrom)</option>
        <option value="cool" ${bg==='cool'?'selected':''}>Frio (Escuro Cinza)</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <label>Estilo dos Cartões</label>
      <select id="ap-cards-sel" onchange="saveApperanceKey('sm-cards', this.value)">
        <option value="glass" ${cards==='glass'?'selected':''}>Vidro Translúcido (Glassmorphism)</option>
        <option value="flat" ${cards==='flat'?'selected':''}>Plano Sólido (Flat)</option>
        <option value="outlined" ${cards==='outlined'?'selected':''}>Apenas Linha (Outlined)</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <label>Densidade do Espaçamento</label>
      <select id="ap-density-sel" onchange="saveApperanceKey('sm-density', this.value)">
        <option value="compact" ${density==='compact'?'selected':''}>Compacto</option>
        <option value="cozy" ${density==='cozy'?'selected':''}>Aconchegante (Cozy)</option>
        <option value="comfy" ${density==='comfy'?'selected':''}>Espaçoso (Comfy)</option>
      </select>
    </div>
    <div class="form-group" style="margin-bottom: 14px;">
      <label>Tipografia de Destaque</label>
      <select id="ap-font-sel" onchange="saveApperanceKey('sm-font', this.value)">
        <option value="fraunces" ${font==='fraunces'?'selected':''}>Fraunces (Serifada Elegante)</option>
        <option value="sansonly" ${font==='sansonly'?'selected':''}>DM Sans (Moderna Sem Serifas)</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal()">Concluído</button>
    </div>
  `, 'modal-sm');
}

// ── Pre-cache para uso offline ─────────────────────────────────────────
async function preCacheCriticalData() {
  try {
    await Promise.all([
      api.get('/api/musicas'),
      api.get('/api/repertorios'),
      api.get('/api/stats')
    ]);
    
    // Atualiza contadores do sidebar imediatamente caso estejam carregados
    const mList = await idbGet('api_cache', '/api/musicas');
    const rList = await idbGet('api_cache', '/api/repertorios');
    if (mList && mList.data) {
      const ncMusicas = document.getElementById('nav-count-musicas');
      if (ncMusicas) ncMusicas.textContent = mList.data.length;
    }
    if (rList && rList.data) {
      const ncReps = document.getElementById('nav-count-reps');
      if (ncReps) ncReps.textContent = rList.data.length;
    }
  } catch (e) {
    console.warn('Pre-cache falhou (dispositivo offline):', e);
  }
}

// ══════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════
applyAppearance();
updateOnlineUI();
refreshPendingBadge();
preCacheCriticalData();
page('musicas');
