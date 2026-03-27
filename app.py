"""
Repertório Sol Maior — Backend Flask + SQLite
"""
import os, json, re, subprocess, sys, psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from anthropic import Anthropic

app = Flask(__name__)
DATABASE_URL = os.environ.get("DATABASE_URL")

# ─── Banco de dados ────────────────────────────────────────────────────────────
def get_db():
    # Supabase/PostgreSQL na nuvem geralmente exige SSL
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor, sslmode='require')
    return conn

def init_db():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("""
            CREATE TABLE IF NOT EXISTS musicas (
                id          TEXT PRIMARY KEY,
                titulo      TEXT NOT NULL,
                artista     TEXT NOT NULL,
                tom         TEXT NOT NULL DEFAULT 'C',
                tom_original TEXT NOT NULL DEFAULT 'C',
                cifra_json  TEXT NOT NULL DEFAULT '[]',
                tabela_json TEXT NOT NULL DEFAULT '[]',
                url_origem  TEXT,
                criado_em   TEXT NOT NULL,
                atualizado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS repertorios (
                id        TEXT PRIMARY KEY,
                nome      TEXT NOT NULL,
                criado_em TEXT NOT NULL,
                atualizado_em TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS repertorio_musicas (
                repertorio_id TEXT NOT NULL,
                musica_id     TEXT NOT NULL,
                posicao       INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (repertorio_id, musica_id),
                FOREIGN KEY (repertorio_id) REFERENCES repertorios(id) ON DELETE CASCADE,
                FOREIGN KEY (musica_id)     REFERENCES musicas(id)      ON DELETE CASCADE
            );
            """)
        conn.commit()

def gen_id():
    import uuid
    return str(uuid.uuid4())[:8]

def now_iso():
    return datetime.utcnow().isoformat()

# ─── Helpers ───────────────────────────────────────────────────────────────────
NOTAS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
ENHAR = {'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B'}

def normaliza(n):
    return ENHAR.get(n, n)

def transpoe_acorde(acorde, st):
    if st == 0: return acorde
    m = re.match(r'^([A-G][b#]?)(.*)$', acorde)
    if not m: return acorde
    raiz, suf = m.group(1), m.group(2)
    raiz = normaliza(raiz)
    if raiz not in NOTAS: return acorde
    idx = (NOTAS.index(raiz) + st) % 12
    return NOTAS[idx] + suf

def transpoe_linha(linha, st):
    return re.sub(
        r'\b([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|M|7M|\+)?[0-9]?(?:/[A-G][b#]?)?)\b',
        lambda m: transpoe_acorde(m.group(0), st),
        linha
    )

def transpoe_cifra(cifra, st):
    return [
        {**c, 'acordes': transpoe_linha(c.get('acordes',''), st)}
        for c in cifra
    ]

def transpoe_tabela(tabela, st):
    resultado = []
    for s in tabela:
        novo_grid = [
            [cell if cell == '%' else transpoe_acorde(cell, st) for cell in row]
            for row in s.get('grid', [])
        ]
        resultado.append({**s, 'grid': novo_grid})
    return resultado

def tom_apos_st(tom, st):
    m = re.match(r'^([A-G][b#]?)(.*)', tom)
    if not m: return tom
    raiz = normaliza(m.group(1))
    if raiz not in NOTAS: return tom
    idx = (NOTAS.index(raiz) + st) % 12
    return NOTAS[idx] + m.group(2)

@app.errorhandler(Exception)
def handle_exception(e):
    # Retorna o erro em JSON para facilitar o debug no Vercel
    return jsonify({"erro": str(e), "tipo": type(e).__name__}), 500

# ─── Rotas: Músicas ────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/musicas', methods=['GET'])
def listar_musicas():
    q = request.args.get('q', '')
    with get_db() as conn:
        with conn.cursor() as cur:
            if q:
                cur.execute(
                    "SELECT * FROM musicas WHERE titulo ILIKE %s OR artista ILIKE %s ORDER BY titulo",
                    (f'%{q}%', f'%{q}%')
                )
            else:
                cur.execute("SELECT * FROM musicas ORDER BY titulo")
            rows = cur.fetchall()
            return jsonify([dict(r) for r in rows])

@app.route('/api/musicas', methods=['POST'])
def criar_musica():
    d = request.json
    mid = gen_id()
    n = now_iso()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO musicas (id, titulo, artista, tom, tom_original, cifra_json, tabela_json, url_origem, criado_em, atualizado_em)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (mid, d['titulo'], d['artista'], d.get('tom','C'), d.get('tom','C'),
                 json.dumps(d.get('cifra_tradicional', []), ensure_ascii=False),
                 json.dumps(d.get('tabela', []), ensure_ascii=False),
                 d.get('url_origem'), n, n)
            )
        conn.commit()
    return jsonify({'id': mid, 'ok': True})

@app.route('/api/musicas/<mid>', methods=['GET'])
def get_musica(mid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM musicas WHERE id=%s", (mid,))
            row = cur.fetchone()
            if not row: return jsonify({'erro': 'Não encontrada'}), 404
            m = dict(row)
            m['cifra_tradicional'] = json.loads(m['cifra_json'])
            m['tabela'] = json.loads(m['tabela_json'])
            return jsonify(m)

@app.route('/api/musicas/<mid>', methods=['PUT'])
def atualizar_musica(mid):
    d = request.json
    n = now_iso()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM musicas WHERE id=%s", (mid,))
            row = cur.fetchone()
            if not row: return jsonify({'erro': 'Não encontrada'}), 404
            cur.execute("""
                UPDATE musicas SET
                    titulo=%s, artista=%s, tom=%s, tom_original=%s,
                    cifra_json=%s, tabela_json=%s, url_origem=%s, atualizado_em=%s
                WHERE id=%s
            """, (
                d.get('titulo', row['titulo']),
                d.get('artista', row['artista']),
                d.get('tom', row['tom']),
                d.get('tom_original', row['tom_original']),
                json.dumps(d.get('cifra_tradicional', json.loads(row['cifra_json'])), ensure_ascii=False),
                json.dumps(d.get('tabela', json.loads(row['tabela_json'])), ensure_ascii=False),
                d.get('url_origem', row['url_origem']),
                n, mid
            ))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/musicas/<mid>', methods=['DELETE'])
def deletar_musica(mid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repertorio_musicas WHERE musica_id=%s", (mid,))
            cur.execute("DELETE FROM musicas WHERE id=%s", (mid,))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/musicas/<mid>/transpor', methods=['POST'])
def transpor_musica(mid):
    d = request.json
    st = int(d.get('semitones', 0))
    reset = d.get('reset', False)
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM musicas WHERE id=%s", (mid,))
            row = cur.fetchone()
            if not row: return jsonify({'erro': 'Não encontrada'}), 404
            cifra = json.loads(row['cifra_json'])
            tabela = json.loads(row['tabela_json'])
            tom_orig = row['tom_original']

            if reset:
                # Calcula semitones de volta
                tom_atual = row['tom']
                ra = re.match(r'^([A-G][b#]?)', normaliza(tom_atual))
                ro = re.match(r'^([A-G][b#]?)', normaliza(tom_orig))
                if ra and ro and ra.group(1) in NOTAS and ro.group(1) in NOTAS:
                    st_back = (NOTAS.index(normaliza(ro.group(1))) - NOTAS.index(normaliza(ra.group(1)))) % 12
                    if st_back > 6: st_back -= 12
                    cifra = transpoe_cifra(cifra, st_back)
                    tabela = transpoe_tabela(tabela, st_back)
                novo_tom = tom_orig
            else:
                cifra = transpoe_cifra(cifra, st)
                tabela = transpoe_tabela(tabela, st)
                novo_tom = tom_apos_st(row['tom'], st)

            cur.execute(
                "UPDATE musicas SET tom=%s, cifra_json=%s, tabela_json=%s, atualizado_em=%s WHERE id=%s",
                (novo_tom, json.dumps(cifra, ensure_ascii=False),
                 json.dumps(tabela, ensure_ascii=False), now_iso(), mid)
            )
        conn.commit()
    return jsonify({'ok': True, 'novo_tom': novo_tom})

# ─── Importar via Link (Claude API) ───────────────────────────────────────────
@app.route('/api/musicas/importar', methods=['POST'])
def importar_musica():
    url = request.json.get('url', '').strip()
    if not url:
        return jsonify({'erro': 'URL inválida'}), 400

    client = Anthropic()
    prompt = f"""Você é especialista em cifras musicais brasileiras. Conheça muito bem o Cifra Club e Cifras.com.br.

URL solicitada: {url}

Com base na URL e seu conhecimento, retorne APENAS um JSON válido (sem markdown) com esta estrutura:

{{
  "titulo": "Nome da música",
  "artista": "Nome do artista",
  "tom": "Tom original ex: Am",
  "cifra_tradicional": [
    {{"secao": "Intro", "acordes": "Am G C D", "letra": ""}},
    {{"secao": "Verso 1", "acordes": "Am", "letra": "Primeira linha da letra"}},
    {{"secao": "", "acordes": "G C", "letra": "Segunda linha"}},
    {{"secao": "Refrão", "acordes": "F G Am E", "letra": "Letra do refrão"}}
  ],
  "tabela": [
    {{
      "nome_secao": "Verso (primeiros versos...)",
      "grid": [
        ["Am", "%", "G", "C"],
        ["F", "G", "%", "Am"]
      ]
    }}
  ]
}}

Inclua TODAS as seções: Intro, Verso(s), Pré-Refrão, Refrão, Ponte, Solo, Final.
Na tabela: 4 colunas, cada célula = 2 tempos, % = repetir acorde anterior.
Retorne SOMENTE o JSON, sem nenhum texto extra."""

    try:
        msg = client.messages.create(
            model="claude-opus-4-5",
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}]
        )
        text = msg.content[0].text.strip()
        text = re.sub(r'^```(?:json)?\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
        dados = json.loads(text)

        mid = gen_id()
        n = now_iso()
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO musicas (id, titulo, artista, tom, tom_original, cifra_json, tabela_json, url_origem, criado_em, atualizado_em)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (mid, dados['titulo'], dados['artista'],
                     dados.get('tom','C'), dados.get('tom','C'),
                     json.dumps(dados.get('cifra_tradicional',[]), ensure_ascii=False),
                     json.dumps(dados.get('tabela',[]), ensure_ascii=False),
                     url, n, n)
                )
            conn.commit()
        return jsonify({'ok': True, 'id': mid, 'titulo': dados['titulo']})
    except Exception as e:
        return jsonify({'erro': str(e)}), 500

# ─── Rotas: Repertórios ────────────────────────────────────────────────────────
@app.route('/api/repertorios', methods=['GET'])
def listar_repertorios():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM repertorios ORDER BY nome")
            reps = cur.fetchall()
            result = []
            for r in reps:
                cur.execute("""
                    SELECT m.id, m.titulo, m.artista, m.tom, rm.posicao
                    FROM repertorio_musicas rm
                    JOIN musicas m ON m.id = rm.musica_id
                    WHERE rm.repertorio_id = %s
                    ORDER BY rm.posicao
                """, (r['id'],))
                musicas = cur.fetchall()
                d = dict(r)
                d['musicas'] = [dict(m) for m in musicas]
                result.append(d)
            return jsonify(result)

@app.route('/api/repertorios', methods=['POST'])
def criar_repertorio():
    d = request.json
    rid = gen_id()
    n = now_iso()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO repertorios (id, nome, criado_em, atualizado_em) VALUES (%s,%s,%s,%s)",
                (rid, d['nome'], n, n)
            )
        conn.commit()
    return jsonify({'id': rid, 'ok': True})

@app.route('/api/repertorios/<rid>', methods=['PUT'])
def atualizar_repertorio(rid):
    d = request.json
    with get_db() as conn:
        with conn.cursor() as cur:
            if 'nome' in d:
                cur.execute("UPDATE repertorios SET nome=%s, atualizado_em=%s WHERE id=%s",
                             (d['nome'], now_iso(), rid))
            if 'musicas' in d:
                cur.execute("DELETE FROM repertorio_musicas WHERE repertorio_id=%s", (rid,))
                for i, mid in enumerate(d['musicas']):
                    cur.execute(
                        """INSERT INTO repertorio_musicas (repertorio_id, musica_id, posicao)
                           VALUES (%s,%s,%s)
                           ON CONFLICT (repertorio_id, musica_id) DO UPDATE SET posicao = EXCLUDED.posicao""",
                        (rid, mid, i)
                    )
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/repertorios/<rid>', methods=['DELETE'])
def deletar_repertorio(rid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repertorio_musicas WHERE repertorio_id=%s", (rid,))
            cur.execute("DELETE FROM repertorios WHERE id=%s", (rid,))
        conn.commit()
    return jsonify({'ok': True})

# ─── Gerar PDF ─────────────────────────────────────────────────────────────────
@app.route('/api/repertorios/<rid>/pdf', methods=['GET'])
def gerar_pdf(rid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM repertorios WHERE id=%s", (rid,))
            rep = cur.fetchone()
            if not rep: return jsonify({'erro': 'Não encontrado'}), 404
            cur.execute("""
                SELECT m.* FROM repertorio_musicas rm
                JOIN musicas m ON m.id = rm.musica_id
                WHERE rm.repertorio_id = %s
                ORDER BY rm.posicao
            """, (rid,))
            musicas_rows = cur.fetchall()

    musicas = []
    for row in musicas_rows:
        m = dict(row)
        m['cifra_tradicional'] = json.loads(m['cifra_json'])
        m['tabela'] = json.loads(m['tabela_json'])
        musicas.append(m)

    # Gerar PDF com ReportLab
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, PageBreak, HRFlowable)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    from reportlab.platypus.flowables import AnchorFlowable
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    output_path = tmp.name
    tmp.close()

    styles = getSampleStyleSheet()
    GOLD = colors.HexColor('#d4a853')
    RED  = colors.HexColor('#e63946')
    DARK = colors.HexColor('#1a1a2e')
    BGCARD = colors.HexColor('#fffbee')
    BORDA  = colors.HexColor('#e0a800')

    titulo_st = ParagraphStyle('T', parent=styles['Normal'], fontSize=16, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=4)
    artista_st = ParagraphStyle('A', parent=styles['Normal'], fontSize=11, fontName='Helvetica-Oblique', textColor=colors.HexColor('#555555'), spaceAfter=10)
    secao_st   = ParagraphStyle('S', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', textColor=RED, spaceBefore=8, spaceAfter=4)
    acorde_st  = ParagraphStyle('AC', parent=styles['Normal'], fontSize=9, fontName='Courier-Bold', textColor=RED)
    letra_st   = ParagraphStyle('L', parent=styles['Normal'], fontSize=9, fontName='Courier', textColor=DARK, spaceAfter=6)
    tab_sec_st = ParagraphStyle('TS', parent=styles['Normal'], fontSize=9, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceBefore=8, spaceAfter=4)
    indice_h   = ParagraphStyle('IH', parent=styles['Normal'], fontSize=13, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=12)
    link_st    = ParagraphStyle('LK', parent=styles['Normal'], fontSize=10, fontName='Helvetica', leading=18, textColor=colors.HexColor('#333333'))

    def make_tabela(linhas):
        col_w = (A4[0] - 3.5*cm) / 4
        t = Table(linhas, colWidths=[col_w]*4, rowHeights=28)
        t.setStyle(TableStyle([
            ('GRID', (0,0), (-1,-1), 0.8, BORDA),
            ('BACKGROUND', (0,0), (-1,-1), BGCARD),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 10),
            ('TEXTCOLOR', (0,0), (-1,-1), DARK),
            ('TOPPADDING', (0,0), (-1,-1), 8),
            ('BOTTOMPADDING', (0,0), (-1,-1), 8),
        ]))
        return t

    doc = SimpleDocTemplate(output_path, pagesize=A4,
        rightMargin=1.8*cm, leftMargin=1.8*cm, topMargin=2*cm, bottomMargin=2*cm)
    story = []

    # Capa
    story.append(Spacer(1, 3*cm))
    story.append(Paragraph(rep['nome'], ParagraphStyle('C', parent=styles['Normal'],
        fontSize=28, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceAfter=10)))
    story.append(Paragraph(f"{len(musicas)} músicas · Letra + Tabela de acordes",
        ParagraphStyle('CS', parent=styles['Normal'], fontSize=13, fontName='Helvetica-Oblique',
        textColor=colors.HexColor('#555555'), alignment=TA_CENTER, spaceAfter=6)))
    story.append(HRFlowable(width="100%", thickness=2, color=GOLD, spaceAfter=30))

    # Sumário
    story.append(Paragraph("Sumário", indice_h))
    for i, m in enumerate(musicas, 1):
        link = (f'<a href="#musica_{i}" color="#1a6fc4">{i:02d}. {m["titulo"]}</a>'
                f' — <i>{m["artista"]}</i>'
                f'  <font color="#888888">(Tom: {m["tom"]})</font>')
        story.append(Paragraph(link, link_st))
    story.append(PageBreak())

    # Músicas
    for i, m in enumerate(musicas, 1):
        # ── Cifra tradicional
        story.append(AnchorFlowable(f'musica_{i}'))
        story.append(Paragraph(m['titulo'], titulo_st))
        story.append(Paragraph(f"{m['artista']} &nbsp;|&nbsp; Tom: {m['tom']}", artista_st))
        story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=10))
        story.append(Paragraph("▸ Cifra Tradicional (Letra + Acordes)",
            ParagraphStyle('ST1', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold',
            textColor=DARK, spaceBefore=4, spaceAfter=6,
            backColor=colors.HexColor('#f0f4ff'), leftIndent=4, borderPad=4)))

        secao_atual = ''
        for linha in m['cifra_tradicional']:
            secao = linha.get('secao','')
            acordes = linha.get('acordes','')
            letra = linha.get('letra','')
            if secao and secao != secao_atual:
                secao_atual = secao
                story.append(Paragraph(f"[ {secao} ]", secao_st))
            if acordes:
                story.append(Paragraph(acordes, acorde_st))
            if letra:
                story.append(Paragraph(letra, letra_st))

        story.append(PageBreak())

        # ── Tabela de acordes
        story.append(Paragraph(m['titulo'], titulo_st))
        story.append(Paragraph(f"{m['artista']} &nbsp;|&nbsp; Tom: {m['tom']}", artista_st))
        story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=10))
        story.append(Paragraph("▸ Cifra em Tabela (cada célula = 2 tempos)",
            ParagraphStyle('ST2', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold',
            textColor=DARK, spaceBefore=4, spaceAfter=6,
            backColor=colors.HexColor('#fff8e1'), leftIndent=4, borderPad=4)))

        for secao in m['tabela']:
            story.append(Paragraph(f"✦ {secao['nome_secao']}", tab_sec_st))
            if secao.get('grid'):
                story.append(make_tabela(secao['grid']))
            story.append(Spacer(1, 0.3*cm))

        story.append(PageBreak())

    doc.build(story)

    nome_arquivo = rep['nome'].replace(' ', '_') + '.pdf'
    return send_file(output_path, as_attachment=True,
                     download_name=nome_arquivo, mimetype='application/pdf')

# ──────────────────────────────────────────────────────────────────────────────
# Inicialização automática (importante para Vercel/Serverless)
try:
    if DATABASE_URL:
        init_db()
        print("✅ Banco de dados inicializado com sucesso.")
    else:
        print("⚠️ DATABASE_URL não encontrada. O banco não foi inicializado.")
except Exception as e:
    print(f"❌ Erro ao inicializar banco: {e}")

if __name__ == '__main__':
    print("\n🎸 Repertório Sol Maior rodando em http://localhost:5000\n")
    app.run(debug=True, port=5000)
