// Screen components — Músicas, Repertórios, Stats, Importar

const { useState, useMemo, useEffect, useRef } = React;

// ─────────────────────── MUSICAS ───────────────────────
function MusicasScreen({ musicas, onOpen, onTogglefav, onPlay }) {
  const [q, setQ] = useState('');
  const [filt, setFilt] = useState('all'); // all | fav | tag:Samba ...
  const tags = ['Samba','Choro','MPB','Pagode','Bossa','Forró'];

  const list = useMemo(() => {
    return musicas.filter(m => {
      if (filt === 'fav' && !m.fav) return false;
      if (filt.startsWith('tag:') && !m.tags.includes(filt.slice(4))) return false;
      if (q && !(m.titulo+' '+m.artista).toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [musicas, q, filt]);

  return (
    <>
      <div className="page-bar">
        <div className="page-title-block">
          <div className="page-title">Banco de <em>músicas</em></div>
          <div className="page-sub">{musicas.length} cifras na biblioteca · {musicas.filter(m=>m.fav).length} favoritas</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={()=>window.__nav('importar')}><Icon name="sparkle" size={14}/> Importar via link</button>
          <button className="btn btn-primary"><Icon name="plus" size={14}/> Nova música</button>
        </div>
      </div>

      <div className="page-body">
        <div className="searchrow">
          <div className="search">
            <span className="search-ico"><Icon name="search" size={16}/></span>
            <input placeholder="Buscar por título, artista ou tom…" value={q} onChange={e=>setQ(e.target.value)}/>
          </div>
          <button className="btn btn-ghost btn-sm"><Icon name="download" size={13}/> Exportar JSON</button>
        </div>

        <div className="chiprow">
          <button className={"chip "+(filt==='all'?'on':'')} onClick={()=>setFilt('all')}>Todas <span className="chip-count">{musicas.length}</span></button>
          <button className={"chip "+(filt==='fav'?'on':'')} onClick={()=>setFilt('fav')}><Icon name="starfill" size={11}/> Favoritas <span className="chip-count">{musicas.filter(m=>m.fav).length}</span></button>
          <span style={{ width: 1, height: 16, background: 'var(--line)', margin: '0 4px' }}/>
          {tags.map(t => {
            const n = musicas.filter(m=>m.tags.includes(t)).length;
            return <button key={t} className={"chip "+(filt==='tag:'+t?'on':'')} onClick={()=>setFilt('tag:'+t)}>{t} <span className="chip-count">{n}</span></button>;
          })}
        </div>

        <div className="songlist">
          <div className="songlist-head">
            <div></div>
            <div>Título · Artista</div>
            <div>Estilos</div>
            <div>Tom</div>
            <div>BPM · Duração</div>
            <div></div>
            <div></div>
          </div>
          {list.map(m => (
            <div key={m.id} className="songrow" onClick={()=>onOpen(m)}>
              <div className={"song-fav "+(m.fav?'on':'')} onClick={e=>{e.stopPropagation(); onTogglefav(m.id);}}>
                <Icon name={m.fav?'starfill':'star'} size={16}/>
              </div>
              <div>
                <div className="song-title">{m.titulo}</div>
                <div className="song-artist">{m.artista}</div>
              </div>
              <div className="song-tags">
                {m.tags.map(t => <span className="song-tag" key={t}>{t}</span>)}
              </div>
              <div className="song-tom">{m.tom}</div>
              <div className="song-meta">
                <span className="bpm">{m.bpm} bpm</span>
                <span className="dur">{m.dur}</span>
              </div>
              <div></div>
              <div className="song-action">
                <button className="song-play" onClick={e=>{e.stopPropagation(); onPlay(m);}}><Icon name="play" size={11}/></button>
              </div>
            </div>
          ))}
          {list.length === 0 && <div className="empty"><h3>Nenhuma música encontrada</h3><p>Tente buscar com outros termos ou limpar os filtros aplicados.</p></div>}
        </div>
      </div>
    </>
  );
}

// ─────────────────────── REPERTORIOS ───────────────────────
function RepertoriosScreen({ repertorios, musicas, onOpen, onPlay }) {
  const songMap = useMemo(() => Object.fromEntries(musicas.map(m=>[m.id, m])), [musicas]);
  function dur(rep) {
    let total = 0;
    rep.songs.forEach(id => {
      const s = songMap[id]; if (!s) return;
      const [m, sec] = s.dur.split(':').map(Number);
      total += m*60 + sec;
    });
    const min = Math.floor(total/60), sec = total%60;
    return min + 'm ' + String(sec).padStart(2,'0') + 's';
  }

  return (
    <>
      <div className="page-bar">
        <div className="page-title-block">
          <div className="page-title">Repertórios <em>do palco</em></div>
          <div className="page-sub">{repertorios.length} repertórios · arraste para reordenar · QR & PDF integrados</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost"><Icon name="upload" size={14}/> Importar backup</button>
          <button className="btn btn-primary"><Icon name="plus" size={14}/> Novo repertório</button>
        </div>
      </div>

      <div className="page-body">
        <div className="repgrid">
          {repertorios.map(r => (
            <div className="rep-card" data-cor={r.cor} key={r.id} onClick={()=>onOpen(r)}>
              <div className="rep-card-bar"/>
              <div>
                <div className="rep-name">{r.nome}</div>
                <div className="rep-desc">{r.descricao}</div>
              </div>
              <div className="rep-songs-mini">
                {r.songs.slice(0,5).map((id,i) => {
                  const s = songMap[id]; if (!s) return null;
                  return (
                    <div className="rep-song-mini" key={id}>
                      <span className="num">{String(i+1).padStart(2,'0')}</span>
                      <span className="nm">{s.titulo}</span>
                      <span className="tm">{s.tom}</span>
                    </div>
                  );
                })}
                {r.songs.length > 5 && <div className="rep-song-mini"><span className="num">···</span><span className="nm" style={{ color: 'var(--text-faint)' }}>+ {r.songs.length - 5} músicas</span></div>}
              </div>
              <div className="rep-foot">
                <div className="rep-stats">
                  <span><b>{r.songs.length}</b> músicas</span>
                  <span><b>{dur(r)}</b></span>
                </div>
                <div style={{ display:'flex', gap: 6 }}>
                  <button className="btn btn-quiet btn-sm" onClick={e=>{e.stopPropagation();}}><Icon name="qr" size={13}/></button>
                  <button className="btn btn-quiet btn-sm" onClick={e=>{e.stopPropagation();}}><Icon name="pdf" size={13}/></button>
                  <button className="btn btn-ghost btn-sm" onClick={e=>{e.stopPropagation(); onPlay(r);}}><Icon name="play" size={11}/> Palco</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─────────────────────── STATS ───────────────────────
function StatsScreen({ stats }) {
  const maxArt = Math.max(...stats.topArtistas.map(a=>a.n));
  const maxTom = Math.max(...stats.tons.map(a=>a.n));
  return (
    <>
      <div className="page-bar">
        <div className="page-title-block">
          <div className="page-title">Estatísticas <em>da biblioteca</em></div>
          <div className="page-sub">Visão geral do acervo, artistas, tons e estilos</div>
        </div>
      </div>
      <div className="page-body">
        <div className="stats-grid">
          <div className="card stat-tile">
            <div className="stat-tile-label">Músicas</div>
            <div className="stat-tile-num">{stats.total}</div>
            <div className="stat-tile-sub">cifras catalogadas</div>
          </div>
          <div className="card stat-tile">
            <div className="stat-tile-label">Favoritas</div>
            <div className="stat-tile-num" style={{ color: 'var(--accent)' }}>{stats.favoritas}</div>
            <div className="stat-tile-sub">{Math.round(stats.favoritas/stats.total*100)}% do acervo</div>
          </div>
          <div className="card stat-tile">
            <div className="stat-tile-label">Repertórios</div>
            <div className="stat-tile-num">{stats.repertorios}</div>
            <div className="stat-tile-sub">prontos para o palco</div>
          </div>
          <div className="card stat-tile">
            <div className="stat-tile-label">Duração total</div>
            <div className="stat-tile-num">{stats.duracaoTotal}</div>
            <div className="stat-tile-sub">somando todo o acervo</div>
          </div>
        </div>

        <div className="stats-cols">
          <div className="card">
            <div className="card-h"><div className="card-title">Artistas mais cadastrados</div></div>
            {stats.topArtistas.map(a => (
              <div className="bar-row" key={a.nome}>
                <div className="bar-label">{a.nome}</div>
                <div className="bar-track"><div className="bar-fill" style={{ width: (a.n/maxArt*100)+'%' }}/></div>
                <div className="bar-val">{a.n}</div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-h"><div className="card-title">Distribuição por tom</div></div>
            <div className="tons-grid">
              {stats.tons.map(t => (
                <div className="tom-cell" key={t.t} style={{ background: `color-mix(in oklab, var(--accent) ${t.n/maxTom*15}%, transparent)` }}>
                  <div className="t">{t.t}</div>
                  <div className="n">{t.n}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-h"><div className="card-title">Nuvem de estilos</div></div>
          <div className="tagcloud">
            {stats.estilos.map(e => (
              <span className="tag-cloud-item" key={e.tag} style={{ fontSize: (12 + e.n*1.4) + 'px' }}>
                {e.tag}<span className="n">{e.n}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────── IMPORTAR ───────────────────────
function ImportarScreen() {
  const [single, setSingle] = useState('https://www.cifraclub.com.br/zeca-pagodinho/verdade/');
  const [batch, setBatch] = useState('https://www.cifraclub.com.br/cartola/o-mundo-e-um-moinho/\nhttps://www.cifraclub.com.br/beth-carvalho/coisinha-do-pai/\nhttps://www.cifras.com.br/cifra/luiz-gonzaga/asa-branca');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState([]);

  function runBatch() {
    const urls = batch.split('\n').map(s=>s.trim()).filter(Boolean);
    setProgress(urls.map(u => ({ url: u, st: 'pendente', state: 'pending' })));
    setRunning(true);
    urls.forEach((u,i) => {
      setTimeout(() => {
        setProgress(p => p.map((x,j)=> j===i ? { ...x, st:'extraindo cifra', state:'run' } : x));
      }, 600 + i*1000);
      setTimeout(() => {
        setProgress(p => p.map((x,j)=> j===i ? { ...x, st: i===2 ? 'erro: link inválido' : 'importada', state: i===2?'err':'ok' } : x));
        if (i === urls.length - 1) setRunning(false);
      }, 1400 + i*1000);
    });
  }

  return (
    <>
      <div className="page-bar">
        <div className="page-title-block">
          <div className="page-title">Importar <em>cifras</em></div>
          <div className="page-sub">A IA extrai cifra, tabela e tom automaticamente do link</div>
        </div>
      </div>
      <div className="page-body">
        <div className="imp-grid">
          <div className="imp-card">
            <h4>Importar único</h4>
            <p>Cole uma URL de Cifra Club ou Cifras.com.br. A IA vai ler a página e extrair a cifra completa.</p>
            <input className="input" value={single} onChange={e=>setSingle(e.target.value)}/>
            <button className="btn btn-primary"><Icon name="sparkle" size={13}/> Importar com IA</button>
          </div>
          <div className="imp-card">
            <h4>Importar em lote</h4>
            <p>Cole múltiplos links (um por linha). O progresso é exibido por linha à direita.</p>
            <textarea className="input" style={{ minHeight: 110, resize: 'vertical' }} value={batch} onChange={e=>setBatch(e.target.value)}/>
            <button className="btn btn-primary" onClick={runBatch} disabled={running}><Icon name={running?'spinner':'sparkle'} size={13}/> {running ? 'Importando…' : 'Importar todos'}</button>
          </div>
        </div>

        {progress.length > 0 && (
          <div className="card">
            <div className="card-h"><div className="card-title">Progresso da importação</div></div>
            <div className="imp-progress">
              {progress.map((p,i) => (
                <div className={"imp-line "+p.state} key={i}>
                  <div className="ico">
                    {p.state==='ok' ? <Icon name="check" size={14}/> : p.state==='err' ? <Icon name="close" size={14}/> : p.state==='run' ? <Icon name="spinner" size={14}/> : <Icon name="clock" size={14}/>}
                  </div>
                  <div className="url">{p.url}</div>
                  <div className="st">{p.st}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-h"><div className="card-title">Sobre o backend</div></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, fontSize: 13 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>API</div>
              <div>Google Gemini extrai cifra, tabela de acordes e tom da página.</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>Scraping</div>
              <div>BeautifulSoup limpa o HTML antes de enviar à IA — economia de tokens.</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--font-m)', fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 6 }}>Cache</div>
              <div>Cifras já existentes são detectadas pela URL e não reimportadas.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { MusicasScreen, RepertoriosScreen, StatsScreen, ImportarScreen });
