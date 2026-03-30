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

function confirm_del(msg, cb) {
  modal(`
    <div class="modal-header"><h3 class="modal-title">Confirmar</h3></div>
    <p style="color:var(--text-dim);font-size:15px;margin-bottom:32px">${msg}</p>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger" onclick="closeModal();(${cb.toString()})()">Excluir Definitivamente</button>
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
  else renderRepertorios();
}

// ══════════════════════════════════════════════════════════════════════
// MÚSICAS
// ══════════════════════════════════════════════════════════════════════
let mFilter = '';
let allMusicas = [];

async function renderMusicas() {
  allMusicas = await api.get('/api/musicas' + (mFilter ? `?q=${encodeURIComponent(mFilter)}` : ''));
  const counts = await api.get('/api/musicas');

  document.getElementById('app-main').innerHTML = `
    <div class="bento-card page-header">
      <div>
        <div class="page-title">Músicas</div>
        <div class="page-sub">${counts.length} música${counts.length!==1?'s':''} na biblioteca</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" onclick="openImport()">🔗 Importar Link</button>
        <button class="btn btn-primary" onclick="openAddManual()">+ Adicionar</button>
      </div>
    </div>

    <div class="bento-card search-bento">
      <div class="search-wrap">
        <span class="search-ico">🔍</span>
        <input placeholder="Buscar por título ou artista..." value="${mFilter}"
          oninput="mFilter=this.value; renderMusicas()">
      </div>
    </div>

    ${allMusicas.length===0 ? `
      <div class="empty">
        <div class="empty-ico">🎵</div>
        <h3>${mFilter ? 'Nada encontrado' : 'Biblioteca vazia'}</h3>
        <p>${mFilter ? 'Tente buscar com outras palavras.' : 'A sua caixa de ferramentas está vazia. Adicione uma nova cifra via link ou comece do zero.'}</p>
        ${!mFilter ? `<button class="btn btn-primary" onclick="openImport()">🔗 Importar via Link</button>` : ''}
      </div>
    ` : `
      <div class="bento-grid">
        ${allMusicas.map(m=>`
          <div class="bento-card item-card" onclick="openEdit('${m.id}')">
            <div class="ic-header">
              <div>
                <div class="ic-title">${m.titulo}</div>
                <div class="ic-subtitle">${m.artista}</div>
              </div>
            </div>
            <div class="ic-tags">
              <span class="tag">${m.tom}</span>
              ${m.tom !== m.tom_original ? `<span class="tag danger">orig: ${m.tom_original}</span>` : ''}
              ${m.url_origem ? `<span class="tag" style="background:rgba(41,128,185,.15);border-color:rgba(41,128,185,.3);color:#7fb3d5">🔗 Link</span>` : ''}
            </div>
            <div class="ic-actions" onclick="event.stopPropagation()">
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

async function doImport() {
  const url = document.getElementById('imp-url').value.trim();
  if(!url) { toast('Cole uma URL', 'err'); return; }
  const btn = document.getElementById('btn-imp');
  const msg = document.getElementById('imp-msg');
  btn.disabled = true;
  btn.innerHTML = '<span class="spin spin-sm"></span> Importando...';
  msg.innerHTML = '<span style="color:var(--gold)">Consultando Inteligência Artificial... Isso pode levar alguns segundos.</span>';
  try {
    const r = await api.post('/api/musicas/importar', {url});
    if(r.erro) throw new Error(r.erro);
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
      <div class="form-group">
        <label>Tom Original</label>
        <input id="e-tom-orig" value="${m.tom_original}">
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
      <button class="btn btn-ghost" onclick="closeModal()">Fechar</button>
      <button class="btn btn-primary" onclick="doSave()">💾 Salvar Modificações</button>
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
  if(document.getElementById('e-cifra'))    editM.cifra_tradicional = parseCifra(document.getElementById('e-cifra').value);
  if(document.getElementById('e-tabela'))   editM.tabela   = parseTabela(document.getElementById('e-tabela').value);
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
          return `
            <div class="bento-card item-card">
              <div class="ic-header">
                <div>
                  <div class="ic-title">${r.nome}</div>
                  <div class="ic-subtitle">${songs.length} música${songs.length!==1?'s':''}</div>
                </div>
                <div style="display:flex;gap:4px">
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
                <button class="btn btn-green btn-sm" onclick="gerarPDF('${r.id}','${r.nome.replace(/'/g,"\\'")}')" style="flex:1">📄 Gerar PDF</button>
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
async function gerarPDF(id, nome) {
  loading(`Compilando PDF: ${nome}...`);
  try {
    const resp = await fetch(`/api/repertorios/${id}/pdf`);
    if(!resp.ok) {
      const err = await resp.json();
      throw new Error(err.erro||'Erro desconhecido');
    }
    const blob = await resp.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = nome.replace(/[^a-z0-9]/gi,'_') + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ PDF baixado com sucesso!');
  } catch(e) {
    toast('❌ ' + e.message, 'err');
  } finally {
    unload();
  }
}

// ══════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════
page('musicas');
