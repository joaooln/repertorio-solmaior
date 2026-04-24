// ══════════════════════════════════════════════════════════════════════
// API
// ══════════════════════════════════════════════════════════════════════
const api = {
  async get(url)    { const r=await fetch(url); return r.json() },
  async post(url,d) { const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); return r.json() },
  async put(url,d)  { const r=await fetch(url,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)}); return r.json() },
  async del(url)    { const r=await fetch(url,{method:'DELETE'}); return r.json() },
};

// ══════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════
function toast(msg, type='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = type==='err' ? 'rgba(192, 57, 43, 0.9)' : type==='warn' ? 'rgba(230, 126, 34, 0.9)' : 'rgba(39, 174, 96, 0.9)';
  el.style.color = '#fff';
  el.classList.add('show');
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

function closeModal() {
  const modal = document.getElementById('modal-root');
  if (modal) {
    modal.style.opacity = '0';
    setTimeout(() => modal.remove(), 300);
  }
}

function modal(html, size='modal-md') {
  closeModal();
  document.body.insertAdjacentHTML('beforeend',
    `<div class="overlay" id="modal-root" onclick="if(event.target===this)closeModal()">
       <div class="modal ${size}">${html}</div>
     </div>`);
}

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
  document.querySelectorAll('.nav-item').forEach(e=>e.classList.remove('active'));
  document.getElementById('nav-'+p).classList.add('active');
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
  const [allMusicas_, counts] = await Promise.all([
    api.get(buildMusicasUrl()),
    api.get('/api/musicas'),
  ]);
  allMusicas = allMusicas_;

  const allTags = [...new Set(counts.flatMap(m => m.tags||[]))].sort();

  document.getElementById('app-main').innerHTML = `
    <div class="bento-card page-header">
      <div>
        <div class="page-title">Músicas</div>
        <div class="page-sub">${counts.length} música${counts.length!==1?'s':''} na biblioteca</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="openBackup()" title="Backup">💾</button>
        <button class="btn btn-ghost" onclick="openImport()">🔗 Importar Link</button>
        <button class="btn btn-ghost" onclick="openImportLote()">📋 Importar em Lote</button>
        <button class="btn btn-primary" onclick="openAddManual()">+ Adicionar</button>
      </div>
    </div>

    <div class="bento-card search-bento">
      <div class="search-wrap">
        <span class="search-ico">🔍</span>
        <input placeholder="Buscar por título ou artista..." value="${mFilter}"
          oninput="mFilter=this.value; renderMusicas()">
      </div>
      <div class="filter-row">
        <button class="btn btn-xs ${mFavOnly?'btn-gold':'btn-ghost'}" onclick="mFavOnly=!mFavOnly;renderMusicas()">⭐ Favoritas</button>
        <select class="filter-sel" onchange="mTomFilter=this.value;renderMusicas()">
          <option value="">Todos os tons</option>
          ${[...new Set(counts.map(m=>m.tom))].sort().map(t=>`<option value="${t}" ${mTomFilter===t?'selected':''}>${t}</option>`).join('')}
        </select>
        ${allTags.length ? `<select class="filter-sel" onchange="mTagFilter=this.value;renderMusicas()">
          <option value="">Todos os estilos</option>
          ${allTags.map(t=>`<option value="${t}" ${mTagFilter===t?'selected':''}>${t}</option>`).join('')}
        </select>` : ''}
        ${(mFavOnly||mTomFilter||mTagFilter) ? `<button class="btn btn-xs btn-ghost" onclick="mFavOnly=false;mTomFilter='';mTagFilter='';renderMusicas()">✕ Limpar filtros</button>` : ''}
      </div>
    </div>

    ${allMusicas.length===0 ? `
      <div class="empty">
        <div class="empty-ico">🎵</div>
        <h3>${(mFilter||mFavOnly||mTomFilter||mTagFilter) ? 'Nada encontrado' : 'Biblioteca vazia'}</h3>
        <p>${(mFilter||mFavOnly||mTomFilter||mTagFilter) ? 'Tente outros filtros.' : 'Adicione uma nova cifra via link ou comece do zero.'}</p>
        ${!(mFilter||mFavOnly||mTomFilter||mTagFilter) ? `<button class="btn btn-primary" onclick="openImport()">🔗 Importar via Link</button>` : ''}
      </div>
    ` : `
      <div class="bento-grid">
        ${allMusicas.map(m=>`
          <div class="bento-card item-card" onclick="openEdit('${m.id}')">
            <div class="ic-header">
              <div style="flex:1;min-width:0">
                <div class="ic-title">${m.favorito ? '⭐ ' : ''}${m.titulo}</div>
                <div class="ic-subtitle">${m.artista}${m.bpm ? ` · ${m.bpm} BPM` : ''}${m.duracao_min ? ` · ${m.duracao_min}min` : ''}</div>
              </div>
            </div>
            <div class="ic-tags">
              <span class="tag">${m.tom}</span>
              ${m.tom !== m.tom_original ? `<span class="tag danger">orig: ${m.tom_original}</span>` : ''}
              ${(m.tags||[]).map(t=>`<span class="tag tag-style">${t}</span>`).join('')}
              ${m.url_origem ? `<span class="tag" style="background:rgba(41,128,185,.15);border-color:rgba(41,128,185,.3);color:#7fb3d5">🔗</span>` : ''}
            </div>
            <div class="ic-actions" onclick="event.stopPropagation()">
              <button class="btn btn-ghost btn-sm" onclick="openApresentacao('${m.id}')">▶ Apresentar</button>
              <button class="btn btn-ghost btn-sm" onclick="openEdit('${m.id}')">✏️ Editar</button>
              <button class="btn btn-ghost btn-danger btn-sm btn-icon-only" onclick="delMusica('${m.id}','${m.titulo.replace(/'/g,"\\'")}')">🗑️</button>
            </div>
          </div>
        `).join('')}
      </div>
    `}`;
}

// ── Importar via link ──────────────────────────────────────────────────
function openImport() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">🔗 Importar via Link</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="info-box">
      Basta colar um link do <strong>Cifra Club</strong> ou <strong>Cifras.com.br</strong> abaixo.<br>
      A inteligência artificial fará o resto.
    </div>
    <div class="form-group">
      <label>URL da Cifra</label>
      <input id="imp-url" type="url" placeholder="https://www.cifraclub.com.br/artista/musica/">
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
  btn.disabled = true;
  btn.innerHTML = '<span class="spin spin-sm"></span> Importando...';
  msg.innerHTML = '<span style="color:var(--gold)">Consultando Inteligência Artificial... Isso pode levar alguns segundos.</span>';
  try {
    const r = await api.post('/api/musicas/importar', {url, substituir});
    if(r.erro) throw new Error(r.erro);
    if(r.duplicada) {
      btn.disabled = false;
      btn.innerHTML = 'Importar';
      msg.innerHTML = `
        <div style="background:rgba(212,168,83,.1);border:1px solid rgba(212,168,83,.3);border-radius:8px;padding:10px 14px;font-size:13px;">
          <strong style="color:var(--gold)">⚠️ Música já existe na biblioteca:</strong><br>
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
      Cole um link por linha do <strong>Cifra Club</strong> ou <strong>Cifras.com.br</strong>.<br>
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
    <div id="lote-progress" style="display:none;max-height:220px;overflow-y:auto;margin-bottom:10px;border:1px solid var(--card-border);border-radius:8px;padding:4px 8px;"></div>
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
    <div style="display:flex;align-items:center;gap:8px;padding:7px 4px;border-bottom:1px solid var(--card-border);font-size:13px;">
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
    status.style.color = 'var(--gold)';
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
  cancelBtn.disabled = false;
  cancelBtn.textContent = 'Fechar';
  await renderMusicas();
  const partes = [];
  if (ok) partes.push(`${ok} importada${ok!==1?'s':''}`);
  if (skip) partes.push(`${skip} já existia${skip!==1?'m':''}`);
  if (fail) partes.push(`${fail} com erro`);
  toast(partes.join(', '), ok > 0 ? 'ok' : (skip > 0 ? 'ok' : 'err'));
}

// ── Adicionar manual ───────────────────────────────────────────────────
function openAddManual() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">+ Nova Música</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Título</label><input id="nm-titulo" placeholder="Nome da música"></div>
      <div class="form-group"><label>Artista</label><input id="nm-artista" placeholder="Nome do artista"></div>
    </div>
    <div class="form-group"><label>Tom</label><input id="nm-tom" placeholder="Ex: Am, D, G"></div>
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
  const r = await api.post('/api/musicas', {titulo, artista, tom});
  closeModal();
  await renderMusicas();
  setTimeout(() => openEdit(r.id), 200);
}

// ── Editar música ──────────────────────────────────────────────────────
let editM = null;
let editTab = 'info';

async function openEdit(id, tab='info') {
  editTab = tab;
  const m = await api.get(`/api/musicas/${id}`);
  editM = m;
  renderEditModal();
}

function renderEditModal() {
  const m = editM;
  const cifraText = (m.cifra_tradicional||[]).map(l => {
    let s = '';
    if(l.secao) s += `[${l.secao}]\n`;
    if(l.acordes) s += l.acordes + '\n';
    if(l.letra)   s += l.letra   + '\n';
    return s;
  }).join('');

  const tabelaText = (m.tabela||[]).map(s =>
    `\n## ${s.nome_secao}\n` + (s.grid||[]).map(r=>r.join(' | ')).join('\n')
  ).join('\n');

  const diffSt = semitonesDiff(m.tom_original, m.tom);

  modal(`
    <div class="modal-header">
      <h3 class="modal-title">✏️ ${m.titulo}</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="tabs">
      <button class="tab ${editTab==='info'?'active':''}"   onclick="switchTab('info')">Informações</button>
      <button class="tab ${editTab==='cifra'?'active':''}"  onclick="switchTab('cifra')">Cifra Completa</button>
      <button class="tab ${editTab==='tabela'?'active':''}" onclick="switchTab('tabela')">Grade Acordes</button>
    </div>

    ${editTab==='info' ? `
      <div class="form-row">
        <div class="form-group"><label>Título</label><input id="e-titulo" value="${m.titulo}"></div>
        <div class="form-group"><label>Artista</label><input id="e-artista" value="${m.artista}"></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Tom Original</label>
          <input id="e-tom-orig" value="${m.tom_original}">
        </div>
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
        <div class="transp-row">
          <span class="tom-badge" id="tom-disp">${m.tom}</span>
          <button class="btn btn-ghost btn-sm" onclick="doTransp(-1)">♭ −1</button>
          <button class="btn btn-ghost btn-sm" onclick="doTransp(+1)">♯ +1</button>
          <button class="btn btn-ghost btn-sm" onclick="doTransp(0,true)">↺ Resetar</button>
        </div>
        ${diffSt!==0 ? `<div style="font-size:12px;color:var(--text-dim);margin-top:4px;">Transposto ${diffSt>0?'+':''}${diffSt} semitons do original (${m.tom_original})</div>` : ''}
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
        <textarea id="e-notas" rows="2" placeholder="Ex: Entrar depois do intro, repetir refrão no final...">${m.notas||''}</textarea>
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
          <input value="${m.url_origem}" readonly style="opacity:0.6;">
        </div>` : ''}
    ` : ''}

    ${editTab==='cifra' ? `
      <div class="info-box">
        <strong>[Seção]</strong> marca uma parte da música (Verso, Refrão…).<br>
        A linha de <strong>acordes</strong> vem logo antes da linha contendo a <strong>letra</strong> correspondente.
      </div>
      <div class="form-group">
        <label>Editor de Cifra</label>
        <textarea id="e-cifra" style="min-height:400px;font-size:14px;">${cifraText}</textarea>
      </div>
    ` : ''}

    ${editTab==='tabela' ? `
      <div class="info-box">
        <strong>## Nome da Seção</strong> cria um novo bloco na tabela geral.<br>
        Acordes separados por <strong>|</strong>, sendo 4 por linha sempre. Utilize <strong>%</strong> para repetir compasso.
      </div>
      <div class="form-group">
        <label>Editor de Tabela de Acordes</label>
        <textarea id="e-tabela" style="min-height:400px;font-size:14px;">${tabelaText}</textarea>
      </div>
    ` : ''}

    <div class="modal-footer">
      <button class="btn btn-danger btn-sm" onclick="delMusica('${m.id}','${m.titulo.replace(/'/g,"\\'")}',true)">🗑️ Excluir</button>
      <button class="btn btn-ghost btn-sm" onclick="openPDFMusica('${m.id}','${m.titulo.replace(/'/g,"\\'")}')">📄 PDF</button>
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="doSave()">💾 Salvar</button>
    </div>
  `, 'modal-lg');
}

function switchTab(tab) {
  collectEdits();
  editTab = tab;
  renderEditModal();
}

function collectEdits() {
  if(!editM) return;
  if(document.getElementById('e-titulo'))   editM.titulo   = document.getElementById('e-titulo').value;
  if(document.getElementById('e-artista'))  editM.artista  = document.getElementById('e-artista').value;
  if(document.getElementById('e-tom-orig')) editM.tom_original = document.getElementById('e-tom-orig').value;
  if(document.getElementById('e-bpm'))      editM.bpm = parseInt(document.getElementById('e-bpm').value)||null;
  if(document.getElementById('e-duracao'))  editM.duracao_min = parseFloat(document.getElementById('e-duracao').value)||null;
  if(document.getElementById('e-notas'))    editM.notas = document.getElementById('e-notas').value;
  if(document.getElementById('e-favorito')) editM.favorito = document.getElementById('e-favorito').checked;
  if(document.getElementById('e-cifra'))    editM.cifra_tradicional = parseCifra(document.getElementById('e-cifra').value);
  if(document.getElementById('e-tabela'))   editM.tabela   = parseTabela(document.getElementById('e-tabela').value);
}

function addTag() {
  const input = document.getElementById('tag-input');
  const val = input.value.trim().replace(/,$/,'');
  if(!val) return;
  if(!editM.tags) editM.tags = [];
  if(!editM.tags.includes(val)) editM.tags.push(val);
  input.value = '';
  renderTagsEditor();
}
function addTagDirect(t) {
  if(!editM.tags) editM.tags = [];
  if(!editM.tags.includes(t)) { editM.tags.push(t); renderTagsEditor(); }
}
function removeTag(t) {
  editM.tags = (editM.tags||[]).filter(x=>x!==t);
  renderTagsEditor();
}
function renderTagsEditor() {
  const ed = document.getElementById('tags-editor');
  if(!ed) return;
  const chips = (editM.tags||[]).map(t=>`<span class="tag-chip">${t}<button onclick="removeTag('${t.replace(/'/g,"\\'")}')">×</button></span>`).join('');
  const input = `<input id="tag-input" placeholder="Adicionar estilo..." onkeydown="if(event.key==='Enter'||event.key===','){event.preventDefault();addTag()}" style="border:none;background:transparent;outline:none;flex:1;min-width:100px;color:var(--text);font-size:13px;">`;
  ed.innerHTML = chips + input;
}

async function doSave() {
  collectEdits();
  await api.put(`/api/musicas/${editM.id}`, editM);
  closeModal();
  toast('✅ Salvo com sucesso!');
  renderMusicas();
}

async function doTransp(st, reset=false) {
  collectEdits();
  const r = await api.post(`/api/musicas/${editM.id}/transpor`, {semitones: st, reset});
  if(r.ok) {
    editM = await api.get(`/api/musicas/${editM.id}`);
    renderEditModal();
    toast(`Tom alterado para: ${r.novo_tom}`);
  }
}

function semitonesDiff(orig, atual) {
  const NOTAS=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const ENH={'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B'};
  const norm = n => ENH[n]||n;
  const get  = t => { const m=t.match(/^([A-G][b#]?)/); return m ? NOTAS.indexOf(norm(m[1])) : -1; };
  const o=get(orig), a=get(atual);
  if(o<0||a<0) return 0;
  let d=a-o; if(d>6)d-=12; if(d<-6)d+=12;
  return d;
}

function parseCifra(text) {
  const lines = text.split('\n');
  const res = [];
  let secaoAtual = '';
  for(const line of lines) {
    const t = line.trim();
    if(!t) continue;
    const sm = t.match(/^\[(.+)\]$/);
    if(sm) { secaoAtual = sm[1]; continue; }
    const isChord = /^[A-G]/.test(t) && !/[a-z]{5,}/.test(t);
    if(isChord) {
      res.push({secao: secaoAtual, acordes: t, letra: ''});
      secaoAtual = '';
    } else {
      if(res.length && res[res.length-1].letra==='' && !res[res.length-1].secao && res[res.length-1].acordes) {
        res[res.length-1].letra = t;
      } else {
        res.push({secao: secaoAtual, acordes: '', letra: t});
        secaoAtual = '';
      }
    }
  }
  return res;
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
    } else if(cur) {
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
    const r = await api.post('/api/biblioteca/import', data);
    if(r.erro) throw new Error(r.erro);
    closeModal();
    toast(`✅ ${r.importadas} música${r.importadas!==1?'s':''} importada${r.importadas!==1?'s':''}${r.puladas?' ('+r.puladas+' já existiam)':''}`);
    renderMusicas();
  } catch(e) { toast('❌ '+e.message,'err'); }
  finally { unload(); }
}

// ── Modo Apresentação ──────────────────────────────────────────────────
async function openApresentacao(id) {
  const m = await api.get(`/api/musicas/${id}`);
  const cifra = m.cifra_tradicional || [];

  const linhas = [];
  let secaoAtual = '';
  for(const l of cifra) {
    if(l.secao && l.secao !== secaoAtual) {
      secaoAtual = l.secao;
      linhas.push({tipo:'secao', texto: l.secao});
    }
    if(l.acordes) linhas.push({tipo:'acorde', texto: l.acordes});
    if(l.letra)   linhas.push({tipo:'letra',  texto: l.letra});
  }

  const bpm = m.bpm || 80;
  const scrollSpeed = Math.max(0.3, Math.min(3, bpm / 80));

  const html = linhas.map(l => {
    if(l.tipo==='secao')  return `<div class="ap-secao">${l.texto}</div>`;
    if(l.tipo==='acorde') return `<div class="ap-acorde">${l.texto}</div>`;
    return `<div class="ap-letra">${l.texto}</div>`;
  }).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="ap-overlay" id="ap-root">
      <div class="ap-header">
        <div>
          <div class="ap-titulo">${m.titulo}</div>
          <div class="ap-artista">${m.artista} · Tom: ${m.tom}${m.bpm?' · '+m.bpm+' BPM':''}</div>
        </div>
        <div class="ap-controls">
          <button class="ap-btn" id="ap-metro-btn" onclick="toggleMetronomo()" title="Metrônomo">🥁</button>
          <button class="ap-btn" id="ap-scroll-btn" onclick="toggleAutoScroll()" title="Auto-scroll">▶</button>
          <span class="ap-speed-label">Velocidade:</span>
          <input type="range" min="0.2" max="4" step="0.1" value="${scrollSpeed.toFixed(1)}" id="ap-speed" oninput="setScrollSpeed(this.value)" style="width:80px">
          <button class="ap-btn" onclick="closeApresentacao()">✕</button>
        </div>
      </div>
      <div class="ap-body" id="ap-body">${html || '<div style="color:#888;padding:40px;text-align:center">Nenhuma cifra cadastrada</div>'}</div>
      <div class="ap-metro" id="ap-metro" style="display:none">
        <div id="ap-metro-beat" class="metro-beat"></div>
        <div style="font-size:13px;color:#aaa;margin-top:8px" id="ap-metro-info">${bpm} BPM</div>
      </div>
    </div>`);

  document.addEventListener('keydown', apKeyHandler);
}

let _apScrollInterval = null;
let _apScrollActive   = false;
let _apScrollSpeed    = 1;
let _apMetroInterval  = null;
let _apMetroActive    = false;

function toggleAutoScroll() {
  _apScrollActive = !_apScrollActive;
  const btn = document.getElementById('ap-scroll-btn');
  if(_apScrollActive) {
    btn.textContent = '⏸'; btn.style.color = 'var(--gold)';
    _apScrollInterval = setInterval(() => {
      const body = document.getElementById('ap-body');
      if(body) body.scrollTop += _apScrollSpeed;
    }, 30);
  } else {
    btn.textContent = '▶'; btn.style.color = '';
    clearInterval(_apScrollInterval);
  }
}

function setScrollSpeed(v) {
  _apScrollSpeed = parseFloat(v);
}

function toggleMetronomo() {
  _apMetroActive = !_apMetroActive;
  const btn   = document.getElementById('ap-metro-btn');
  const panel = document.getElementById('ap-metro');
  if(_apMetroActive) {
    btn.style.color = 'var(--gold)';
    panel.style.display = 'flex';
    _startMetronomo();
  } else {
    btn.style.color = '';
    panel.style.display = 'none';
    clearInterval(_apMetroInterval);
  }
}

function _startMetronomo() {
  const speedInput = document.getElementById('ap-speed');
  const infoEl = document.getElementById('ap-metro-info');
  const beat = document.getElementById('ap-metro-beat');
  const bpmInput = document.getElementById('ap-bpm-input');
  const bpm = bpmInput ? parseInt(bpmInput.value)||80 : 80;
  const ms = Math.round(60000 / bpm);
  if(infoEl) infoEl.textContent = bpm + ' BPM';
  clearInterval(_apMetroInterval);
  _apMetroInterval = setInterval(() => {
    if(beat) { beat.classList.add('pulse'); setTimeout(()=>beat.classList.remove('pulse'), 100); }
    try {
      const ctx = new (window.AudioContext||window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880; gain.gain.value = 0.3;
      osc.start(); osc.stop(ctx.currentTime + 0.05);
    } catch(e) {}
  }, ms);
}

function apKeyHandler(e) {
  if(e.key === 'Escape') closeApresentacao();
  if(e.key === ' ') { e.preventDefault(); toggleAutoScroll(); }
  if(e.key === 'ArrowUp')   { const b=document.getElementById('ap-body'); if(b) b.scrollTop -= 80; }
  if(e.key === 'ArrowDown') { const b=document.getElementById('ap-body'); if(b) b.scrollTop += 80; }
}

function closeApresentacao() {
  clearInterval(_apScrollInterval); clearInterval(_apMetroInterval);
  _apScrollActive=false; _apMetroActive=false;
  document.removeEventListener('keydown', apKeyHandler);
  document.getElementById('ap-root')?.remove();
}

// ── Stats ──────────────────────────────────────────────────────────────
async function renderStats() {
  const stats = await api.get('/api/stats');
  const horas = Math.floor(stats.duracao_total_min/60);
  const mins  = Math.round(stats.duracao_total_min % 60);
  const durStr = stats.duracao_total_min > 0 ? (horas > 0 ? `${horas}h ${mins}min` : `${mins}min`) : '—';

  document.getElementById('app-main').innerHTML = `
    <div class="bento-card page-header">
      <div>
        <div class="page-title">Estatísticas</div>
        <div class="page-sub">Visão geral da sua biblioteca</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="bento-card stat-card">
        <div class="stat-num">${stats.total_musicas}</div>
        <div class="stat-label">Músicas</div>
      </div>
      <div class="bento-card stat-card">
        <div class="stat-num">${stats.total_favoritas}</div>
        <div class="stat-label">Favoritas ⭐</div>
      </div>
      <div class="bento-card stat-card">
        <div class="stat-num">${stats.total_repertorios}</div>
        <div class="stat-label">Repertórios</div>
      </div>
      <div class="bento-card stat-card">
        <div class="stat-num">${durStr}</div>
        <div class="stat-label">Duração total</div>
      </div>
    </div>

    <div class="stats-row">
      <div class="bento-card" style="flex:1">
        <div class="col-title">Top Artistas</div>
        ${stats.top_artistas.map(a=>`
          <div class="stat-bar-row">
            <span class="stat-bar-label">${a.artista}</span>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.round(a.n/stats.top_artistas[0].n*100)}%"></div></div>
            <span class="stat-bar-val">${a.n}</span>
          </div>`).join('') || '<div style="color:var(--text-dim);font-size:13px">Nenhum dado ainda</div>'}
      </div>
      <div class="bento-card" style="flex:1">
        <div class="col-title">Por Tom</div>
        ${stats.por_tom.map(t=>`
          <div class="stat-bar-row">
            <span class="stat-bar-label" style="color:var(--gold);font-family:var(--font-m)">${t.tom}</span>
            <div class="stat-bar-wrap"><div class="stat-bar" style="width:${Math.round(t.n/stats.por_tom[0].n*100)}%;background:rgba(212,168,83,.5)"></div></div>
            <span class="stat-bar-val">${t.n}</span>
          </div>`).join('') || '<div style="color:var(--text-dim);font-size:13px">Nenhum dado ainda</div>'}
      </div>
    </div>

    ${stats.top_tags.length ? `
    <div class="bento-card">
      <div class="col-title">Estilos na Biblioteca</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding-top:4px">
        ${stats.top_tags.map(t=>`<span class="tag tag-style" style="font-size:14px;padding:6px 14px">${t.tag} <span style="color:var(--text-dim);font-size:11px">(${t.n})</span></span>`).join('')}
      </div>
    </div>` : ''}
  `;
}

// ══════════════════════════════════════════════════════════════════════
// REPERTÓRIOS
// ══════════════════════════════════════════════════════════════════════
let allReps = [];

async function renderRepertorios() {
  allReps = await api.get('/api/repertorios');
  document.getElementById('app-main').innerHTML = `
    <div class="bento-card page-header">
      <div>
        <div class="page-title">Repertórios</div>
        <div class="page-sub">${allReps.length} repertório${allReps.length!==1?'s':''} criado${allReps.length!==1?'s':''}</div>
      </div>
      <button class="btn btn-primary" onclick="openNovoRep()">+ Novo Repertório</button>
    </div>

    ${allReps.length===0 ? `
      <div class="empty">
        <div class="empty-ico">📋</div>
        <h3>Nenhuma lista criada</h3>
        <p>Crie um repertório e organize quais músicas você irá tocar no próximo evento.</p>
        <button class="btn btn-primary" onclick="openNovoRep()">+ Criar Repertório</button>
      </div>
    ` : `
      <div class="bento-grid-large">
        ${allReps.map(r => {
          const songs = r.musicas||[];
          const durTotal = songs.reduce((acc,s)=>acc+(s.duracao_min||0),0);
          const durStr = durTotal > 0 ? (durTotal>=60 ? `${Math.floor(durTotal/60)}h${Math.round(durTotal%60)}min` : `~${Math.round(durTotal)}min`) : '';
          return `
            <div class="bento-card item-card">
              <div class="ic-header">
                <div>
                  <div class="ic-title">${r.nome}</div>
                  <div class="ic-subtitle">${songs.length} música${songs.length!==1?'s':''}${durStr?' · '+durStr:''}</div>
                </div>
                <div style="display:flex;gap:4px">
                  <button class="btn btn-ghost btn-sm btn-icon-only" onclick="openQRCode('${r.id}','${r.nome.replace(/'/g,"\\'")}')">QR</button>
                  <button class="btn btn-ghost btn-sm btn-icon-only" onclick="openEditRep('${r.id}')" title="Gerenciar">✏️</button>
                  <button class="btn btn-ghost btn-danger btn-sm btn-icon-only" onclick="delRep('${r.id}','${r.nome.replace(/'/g,"\\'")}')">🗑️</button>
                </div>
              </div>
              <div class="rep-list-preview">
                ${songs.slice(0,5).map((s,i)=>`
                  <div class="rep-song-row"><span class="num">${String(i+1).padStart(2,'0')}.</span><span class="name">${s.titulo}</span><span class="artist">— ${s.artista}</span></div>
                `).join('')}
                ${songs.length>5 ? `<div style="font-size:12px;color:var(--gold);text-align:center;padding:4px 0;">+ ${songs.length-5} a mais…</div>` : ''}
                ${songs.length===0 ? `<div style="color:var(--text-dim);font-size:13px;padding:24px 0;text-align:center;background:rgba(0,0,0,0.2);border-radius:12px">Adicione músicas aqui</div>` : ''}
              </div>
              <div class="ic-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditRep('${r.id}')" style="flex:1">Ajustar Setup</button>
                <button class="btn btn-green btn-sm" onclick="gerarPDF('${r.id}','${r.nome.replace(/'/g,"\\'")}')" style="flex:1">📄 PDF</button>
              </div>
            </div>`;
        }).join('')}
      </div>
    `}`;
}

function openNovoRep() {
  modal(`
    <div class="modal-header">
      <h3 class="modal-title">Novo Repertório</h3>
      <button class="close-btn" onclick="closeModal()">×</button>
    </div>
    <div class="form-group">
      <label>Nome do Evento / Lista</label>
      <input id="rep-nome" placeholder="Ex: Casamento Especial João e Maria">
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
  const r = await api.post('/api/repertorios', {nome});
  closeModal();
  await renderRepertorios();
  setTimeout(()=>openEditRep(r.id), 200);
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
        <input id="rep-edit-nome" value="${editRep.nome}" style="flex:1">
        <button class="btn btn-ghost" onclick="saveRepNome('${id}')">Salvar</button>
      </div>
    </div>

    <div class="two-col">
      <!-- Músicas selecionadas -->
      <div class="bento-card" style="padding:16px; background:rgba(0,0,0,0.15)">
        <div class="col-title">
          <span>Setlist Atual (${(editRep.musicas||[]).length})</span>
        </div>
        <div class="drag-list" id="drag-selected" ondragover="event.preventDefault()" ondrop="onDrop(event,'selected')">
          ${(editRep.musicas||[]).map((m,i)=>`
            <div class="drag-item" draggable="true" data-id="${m.id}"
              ondragstart="dragSrc=this;this.classList.add('dragging')"
              ondragend="this.classList.remove('dragging')">
              <span class="drag-handle">⠿</span>
              <div class="di-info">
                <div class="di-title">${m.titulo}</div>
                <div class="di-artist">${m.artista} · <span>${m.tom}</span></div>
              </div>
              <button class="btn btn-ghost btn-danger btn-xs btn-icon-only" onclick="removerDaLista('${m.id}')" title="Remover da lista">✕</button>
            </div>
          `).join('') || '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0; border:1px dashed var(--card-border); border-radius:12px;">Setlist vazio. Adicione músicas à direita →</div>'}
        </div>
      </div>

      <!-- Disponíveis -->
      <div class="bento-card" style="padding:16px; background:rgba(0,0,0,0.15)">
        <div class="col-title">Adicionar Novas (${disponiveis.length})</div>
        <input placeholder="Buscar na biblioteca..." style="margin-bottom:16px;" oninput="filtrarDisp(this.value)">
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
  if(!lista.length) return '<div style="color:var(--text-dim);font-size:13px;text-align:center;padding:40px 0; border:1px dashed var(--card-border); border-radius:12px;">Busca não encontrada</div>';
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
  const selIds = getSelectedIds();
  const disp = todas.filter(m=>!selIds.includes(m.id));
  const el = document.getElementById('avail-list');
  if(el) el.innerHTML = renderDisponiveis(disp);
}

function getSelectedIds() {
  return [...document.querySelectorAll('#drag-selected .drag-item')].map(el=>el.dataset.id);
}

async function adicionarNaLista(musicaId) {
  const selIds = getSelectedIds();
  if(selIds.includes(musicaId)) return;
  const novas = [...selIds, musicaId];
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: novas});
  openEditRep(editRep.id);
}

async function removerDaLista(musicaId) {
  const novas = getSelectedIds().filter(id=>id!==musicaId);
  await api.put(`/api/repertorios/${editRep.id}`, {musicas: novas});
  openEditRep(editRep.id);
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
      <img src="/api/repertorios/${rid}/qrcode" alt="QR Code" style="width:220px;height:220px;border-radius:12px;border:4px solid var(--card-border)">
      <div style="margin-top:16px">
        <a href="/api/repertorios/${rid}/qrcode" download="${nome.replace(/\s+/g,'_')}_qr.png" class="btn btn-ghost btn-sm">⬇️ Baixar PNG</a>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
    </div>`, 'modal-sm');
}

// ══════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════
page('musicas');
