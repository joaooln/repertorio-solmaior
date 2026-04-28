// Editor + Modo Apresentação overlays

const { useState: useState2, useEffect: useEffect2, useRef: useRef2, useMemo: useMemo2 } = React;

// Transpose helper — cycle of fifths simple semitone shift
const NOTE_SCALE = ['A','A#','B','C','C#','D','D#','E','F','F#','G','G#'];
function transposeChord(ch, n) {
  if (!ch) return ch;
  return ch.replace(/([A-G])(#|b)?/g, (m, root, acc) => {
    let note = root + (acc || '');
    if (acc === 'b') {
      const flatTo = { 'Ab':'G#','Bb':'A#','Cb':'B','Db':'C#','Eb':'D#','Fb':'E','Gb':'F#' };
      note = flatTo[note] || note;
    }
    let i = NOTE_SCALE.indexOf(note);
    if (i < 0) return m;
    return NOTE_SCALE[(i + n + 12*4) % 12];
  });
}

function EditorOverlay({ song, onClose, onPlay, accent }) {
  const [tab, setTab] = useState2('cifra');
  const [shift, setShift] = useState2(0);
  const [notas, setNotas] = useState2(song.notas || '');

  const cifra = useMemo2(() => SAMPLE_CIFRA.map(l => l.tipo === 'acordes' ? { ...l, texto: transposeChord(l.texto, shift) } : l), [shift]);
  const grade = useMemo2(() => SAMPLE_GRADE.map(g => ({ ...g, compassos: transposeChord(g.compassos, shift) })), [shift]);
  const tom = transposeChord(song.tom, shift);

  return (
    <div className="editor-overlay">
      <div className="editor-bar">
        <button className="editor-back" onClick={onClose}><Icon name="arrow-left" size={14}/> Voltar</button>
        <div className="editor-title-block">
          <div className="editor-title">{song.titulo}</div>
          <div className="editor-meta"><span>{song.artista}</span><span><b>Tom {tom}</b></span><span>{song.bpm} bpm</span><span>{song.dur}</span></div>
        </div>
        <div className="editor-actions">
          <div className="transp">
            <button className="transp-btn" onClick={()=>setShift(s=>s-1)} title="Transpor -1 semitom"><Icon name="minus" size={14}/></button>
            <div className="transp-tom">{tom}</div>
            <button className="transp-btn" onClick={()=>setShift(s=>s+1)} title="Transpor +1 semitom"><Icon name="plus" size={14}/></button>
          </div>
          <button className="btn btn-ghost btn-sm"><Icon name="pdf" size={13}/> PDF</button>
          <button className="btn btn-primary btn-sm" onClick={()=>onPlay(song)}><Icon name="play" size={11}/> Modo Palco</button>
        </div>
      </div>

      <div className="editor-tabs">
        <button className={"etab "+(tab==='cifra'?'active':'')} onClick={()=>setTab('cifra')}>Cifra</button>
        <button className={"etab "+(tab==='grade'?'active':'')} onClick={()=>setTab('grade')}>Grade</button>
        <button className={"etab "+(tab==='detalhes'?'active':'')} onClick={()=>setTab('detalhes')}>Detalhes</button>
      </div>

      <div className="editor-body">
        <div className="editor-pane">
          <div className="pane-h">
            <div className="pane-title">{tab === 'grade' ? 'Grade Harmônica' : tab === 'detalhes' ? 'Cifra (referência)' : 'Cifra Tradicional'}</div>
            <div style={{ fontFamily: 'var(--font-m)', fontSize: 11, color: 'var(--text-faint)' }}>
              {shift === 0 ? 'tom original' : (shift > 0 ? '+' : '') + shift + ' semitom' + (Math.abs(shift)>1?'s':'')}
            </div>
          </div>

          {tab !== 'grade' && (
            <div className="cifra">
              {cifra.map((l, i) => {
                if (l.tipo === 'secao') return <div className="secao" key={i}>{l.texto}</div>;
                if (l.tipo === 'acordes') return <div className="acordes" key={i}>{l.texto}</div>;
                return <div className="letra" key={i}>{l.texto}</div>;
              })}
            </div>
          )}

          {tab === 'grade' && (
            <table className="grade-table">
              <thead><tr><th>Seção</th><th>Compassos</th></tr></thead>
              <tbody>
                {grade.map((g,i) => <tr key={i}><td>{g.secao}</td><td>{g.compassos}</td></tr>)}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="editor-pane">
            <div className="pane-h"><div className="pane-title">Metadados</div></div>
            <div className="kvlist">
              <div className="kv"><div className="k">Título</div><div className="v"><input defaultValue={song.titulo}/></div></div>
              <div className="kv"><div className="k">Artista</div><div className="v"><input defaultValue={song.artista}/></div></div>
              <div className="kv"><div className="k">Tom</div><div className="v" style={{ color: 'var(--accent)', fontFamily: 'var(--font-m)', fontWeight: 700 }}>{tom}</div></div>
              <div className="kv"><div className="k">BPM</div><div className="v"><input defaultValue={song.bpm} style={{ fontFamily: 'var(--font-m)' }}/></div></div>
              <div className="kv"><div className="k">Duração</div><div className="v"><input defaultValue={song.dur} style={{ fontFamily: 'var(--font-m)' }}/></div></div>
              <div className="kv">
                <div className="k">Estilos</div>
                <div className="v" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {song.tags.map(t => <span className="song-tag" key={t}>{t}</span>)}
                  <button className="chip" style={{ padding: '2px 8px', fontSize: 11 }}>+ adicionar</button>
                </div>
              </div>
            </div>
          </div>

          <div className="editor-pane">
            <div className="pane-h"><div className="pane-title">Notas internas</div></div>
            <textarea className="notes-textarea" value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Anotações de performance, intros, voltas, observações…"/>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────── Modo Apresentação ───────────────────────
function ApresentacaoOverlay({ song, onClose, framed }) {
  const [shift, setShift] = useState2(0);
  const [scrolling, setScrolling] = useState2(false);
  const [speed, setSpeed] = useState2(1.2);
  const [metroOn, setMetroOn] = useState2(true);
  const [beat, setBeat] = useState2(0);
  const stageRef = useRef2(null);

  const cifra = useMemo2(() => SAMPLE_CIFRA.map(l => l.tipo === 'acordes' ? { ...l, texto: transposeChord(l.texto, shift) } : l), [shift]);
  const tom = transposeChord(song.tom, shift);

  // Auto-scroll
  useEffect2(() => {
    if (!scrolling) return;
    const id = setInterval(() => {
      if (stageRef.current) stageRef.current.scrollTop += speed;
    }, 30);
    return () => clearInterval(id);
  }, [scrolling, speed]);

  // Metronome
  useEffect2(() => {
    if (!metroOn) return;
    const interval = 60000 / song.bpm;
    const id = setInterval(() => setBeat(b => (b+1) % 4), interval);
    return () => clearInterval(id);
  }, [metroOn, song.bpm]);

  // Keyboard
  useEffect2(() => {
    function k(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === ' ') { e.preventDefault(); setScrolling(s=>!s); }
    }
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const overlay = (
    <div className={"ap-overlay"+(framed?' framed':'')}>
      <div className="ap-bar">
        <button className="ap-back" onClick={onClose}><Icon name="close" size={16}/></button>
        <div className="ap-titles">
          <div className="ap-title">{song.titulo}</div>
          <div className="ap-artist">{song.artista}</div>
        </div>
        <div className="ap-tom-large">{tom}</div>
        <div className="transp">
          <button className="transp-btn" onClick={()=>setShift(s=>s-1)}><Icon name="minus" size={14}/></button>
          <button className="transp-btn" onClick={()=>setShift(s=>s+1)}><Icon name="plus" size={14}/></button>
        </div>
        <div className="ap-controls">
          <div className="ap-speed">
            <span>vel.</span>
            <input type="range" min="0.3" max="3.5" step="0.1" value={speed} onChange={e=>setSpeed(parseFloat(e.target.value))}/>
            <span>{speed.toFixed(1)}×</span>
          </div>
          <button className={"ap-btn "+(metroOn?'on':'')} onClick={()=>setMetroOn(m=>!m)} title="Metrônomo"><Icon name="metro" size={16}/></button>
          <button className={"ap-btn "+(scrolling?'on':'')} onClick={()=>setScrolling(s=>!s)} title="Auto-scroll (espaço)">
            <Icon name={scrolling?'pause':'play'} size={14}/>
          </button>
        </div>
      </div>

      <div className="ap-stage" ref={stageRef}>
        <div className="ap-content">
          {cifra.map((l, i) => {
            if (l.tipo === 'secao') return <div className="ap-secao-l" key={i}>{l.texto}</div>;
            if (l.tipo === 'acordes') return <div className="ap-acorde-l" key={i}>{l.texto}</div>;
            return <div className="ap-letra-l" key={i}>{l.texto}</div>;
          })}
        </div>
      </div>

      {metroOn && (
        <div className="metro">
          <div className="metro-beats">
            {[0,1,2,3].map(i => <div key={i} className={"metro-dot "+(i===0?'first ':'')+(beat===i?'on':'')}/>)}
          </div>
          <div>
            <div className="metro-bpm">{song.bpm}</div>
            <div className="metro-bpm-sub">bpm</div>
          </div>
          <button className={"metro-toggle "+(metroOn?'':'off')} onClick={()=>setMetroOn(m=>!m)}>
            <Icon name={metroOn?'pause':'play'} size={12}/>
          </button>
        </div>
      )}

      {!framed && (
        <div style={{ position: 'absolute', bottom: 18, left: 24, display: 'flex', gap: 12, color: 'var(--text-faint)', fontSize: 11, fontFamily: 'var(--font-m)', zIndex: 10 }}>
          <span><span className="kbd">␣</span> play/pause</span>
          <span><span className="kbd">↑↓</span> scroll</span>
          <span><span className="kbd">esc</span> sair</span>
        </div>
      )}
    </div>
  );

  if (framed) {
    return (
      <div style={{ position:'fixed', inset:0, zIndex:200, background:'#040506' }}>
        <div style={{ position:'absolute', top:14, left:18, display:'flex', alignItems:'center', gap:10, zIndex: 220, color:'var(--text-dim)', fontSize:12, fontFamily:'var(--font-m)' }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Icon name="arrow-left" size={13}/> Sair</button>
          <span style={{ letterSpacing:'0.16em', textTransform:'uppercase', color:'var(--text-faint)' }}>iPad · Modo Palco</span>
        </div>
        <div className="tablet-stage">
          <div className="tablet-frame">
            {overlay}
          </div>
        </div>
      </div>
    );
  }
  return overlay;
}

// ─────────────────────── Repertorio detail (drag-list) ───────────────────────
function RepertorioDetailOverlay({ rep, musicas, onClose, onPlay }) {
  const songMap = useMemo2(()=> Object.fromEntries(musicas.map(m=>[m.id,m])), [musicas]);
  const [order, setOrder] = useState2(rep.songs);
  const [dragIdx, setDragIdx] = useState2(null);

  function handleDrop(i) {
    if (dragIdx === null || dragIdx === i) return;
    const next = order.slice();
    const [removed] = next.splice(dragIdx, 1);
    next.splice(i, 0, removed);
    setOrder(next);
    setDragIdx(null);
  }

  let totalSec = 0;
  order.forEach(id => {
    const s = songMap[id]; if (!s) return;
    const [m, sec] = s.dur.split(':').map(Number);
    totalSec += m*60 + sec;
  });
  const totalMin = Math.floor(totalSec/60);

  return (
    <div className="editor-overlay">
      <div className="editor-bar">
        <button className="editor-back" onClick={onClose}><Icon name="arrow-left" size={14}/> Voltar</button>
        <div className="editor-title-block">
          <div className="editor-title">{rep.nome}</div>
          <div className="editor-meta">
            <span>{rep.descricao}</span>
            <span><b>{order.length}</b> músicas</span>
            <span><b>{totalMin}m {String(totalSec%60).padStart(2,'0')}s</b></span>
          </div>
        </div>
        <div className="editor-actions">
          <button className="btn btn-ghost btn-sm"><Icon name="qr" size={13}/> QR Code</button>
          <button className="btn btn-ghost btn-sm"><Icon name="pdf" size={13}/> PDF</button>
          <button className="btn btn-primary btn-sm" onClick={()=>onPlay(songMap[order[0]])}><Icon name="play" size={11}/> Iniciar palco</button>
        </div>
      </div>

      <div className="editor-body" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="editor-pane">
          <div className="pane-h">
            <div className="pane-title">Setlist · arraste para reordenar</div>
            <button className="btn btn-quiet btn-sm"><Icon name="plus" size={12}/> Adicionar música</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {order.map((id, i) => {
              const s = songMap[id]; if (!s) return null;
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={()=>setDragIdx(i)}
                  onDragOver={e=>e.preventDefault()}
                  onDrop={()=>handleDrop(i)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '20px 30px 1fr 60px 70px 32px',
                    gap: 12,
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: dragIdx===i ? 'color-mix(in oklab, var(--accent) 8%, transparent)' : 'rgba(255,255,255,0.025)',
                    border: '1px solid var(--line)',
                    borderRadius: 10,
                    cursor: 'grab',
                  }}
                >
                  <div style={{ color: 'var(--text-faint)', cursor: 'grab' }}><Icon name="drag" size={14}/></div>
                  <div style={{ fontFamily: 'var(--font-m)', fontWeight: 700, color: 'var(--accent)', fontSize: 13 }}>{String(i+1).padStart(2,'0')}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{s.titulo}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.artista}</div>
                  </div>
                  <div className="song-tom">{s.tom}</div>
                  <div style={{ fontFamily: 'var(--font-m)', fontSize: 11, color: 'var(--text-faint)', textAlign: 'right' }}>{s.dur}</div>
                  <button className="btn btn-quiet btn-sm" style={{ padding: 4 }} onClick={()=>setOrder(o=>o.filter(x=>x!==id))}><Icon name="close" size={12}/></button>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="editor-pane">
            <div className="pane-h"><div className="pane-title">Detalhes do repertório</div></div>
            <div className="kvlist">
              <div className="kv"><div className="k">Nome</div><div className="v"><input defaultValue={rep.nome}/></div></div>
              <div className="kv"><div className="k">Descrição</div><div className="v"><input defaultValue={rep.descricao}/></div></div>
              <div className="kv"><div className="k">Duração</div><div className="v" style={{ fontFamily: 'var(--font-m)', color: 'var(--accent)' }}>{totalMin}m {String(totalSec%60).padStart(2,'0')}s</div></div>
              <div className="kv"><div className="k">Tons únicos</div><div className="v" style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {[...new Set(order.map(id => songMap[id]?.tom).filter(Boolean))].map(t => <span className="song-tom" key={t} style={{ padding: '3px 8px' }}>{t}</span>)}
              </div></div>
            </div>
          </div>

          <div className="editor-pane">
            <div className="pane-h"><div className="pane-title">Exportar</div></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 14 }}><Icon name="pdf" size={14}/> PDF Completo · cifras + grade</button>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 14 }}><Icon name="pdf" size={14}/> PDF Só Cifras</button>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 14 }}><Icon name="pdf" size={14}/> PDF Só Grade</button>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 14 }}><Icon name="list" size={14}/> Lista de Palco · 1 página</button>
              <button className="btn btn-ghost" style={{ justifyContent: 'flex-start', padding: 14 }}><Icon name="qr" size={14}/> QR Code · compartilhar setlist</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { EditorOverlay, ApresentacaoOverlay, RepertorioDetailOverlay, transposeChord });
