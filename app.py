"""
Repertório Sol Maior — Backend Flask + SQLite
"""
import os, json, re, subprocess, sys, psycopg2
from psycopg2.extras import RealDictCursor
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
import google.generativeai as genai
import requests
from bs4 import BeautifulSoup

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
        r'\b([A-G][b#]?(?:m|maj|min|dim|aug|sus|add|M|7M|\+)?[0-9]?(?:/[A-G][b#]?)?)(?![A-Za-z0-9#])',
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

def get_web_content(url):
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        }
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        resp.encoding = resp.apparent_encoding or 'utf-8'
        soup = BeautifulSoup(resp.text, 'html.parser')

        # Remove elementos irrelevantes
        for s in soup(['script', 'style', 'header', 'footer', 'nav', 'aside', 'iframe', 'noscript']):
            s.decompose()

        # Seletores em ordem de prioridade — do mais específico ao mais genérico
        candidates = [
            soup.find('div', class_='cifra_cnt'),            # Cifra Club (principal)
            soup.find('div', id='cifra_cnt'),
            soup.find('article', class_='cifra'),
            soup.find('pre'),                                 # Muitos sites colocam a cifra em <pre>
            soup.find('div', class_=re.compile(r'cifra|chord|lyric', re.I)),
            soup.find('main'),
            soup.find('article'),
        ]
        main_content = next((c for c in candidates if c), soup.find('body') or soup)

        text = main_content.get_text(separator='\n', strip=True)
        return text[:20000]
    except Exception as e:
        print(f"Erro ao buscar web: {e}")
        return ""

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

# ─── Importar via Link (Gemini API) ───────────────────────────────────────────
# Preferência de modelos — o primeiro disponível e com cota será usado
GEMINI_PREFERRED = [
    # 500 RPD — melhor para free tier
    'gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview',
    # 20 RPD
    'gemini-3.0-flash', 'gemini-3-flash',
    'gemini-2.5-flash-lite', 'gemini-2.5-flash-lite-preview',
    'gemini-2.5-flash', 'gemini-2.5-flash-preview',
    # fallbacks
    'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    'gemini-1.5-flash', 'gemini-1.5-flash-8b',
]

_gemini_models_cache = None  # descobertos uma vez por processo

def get_gemini_models():
    global _gemini_models_cache
    if _gemini_models_cache is None:
        try:
            available = {
                m.name.replace('models/', '')
                for m in genai.list_models()
                if 'generateContent' in m.supported_generation_methods
            }
            # mantém a ordem de preferência, filtrando pelos disponíveis
            _gemini_models_cache = [m for m in GEMINI_PREFERRED if m in available]
            if not _gemini_models_cache:
                _gemini_models_cache = list(available)  # usa qualquer um
            print(f"Modelos Gemini disponíveis (em ordem): {_gemini_models_cache}")
        except Exception as e:
            print(f"Erro ao listar modelos Gemini: {e}")
            _gemini_models_cache = GEMINI_PREFERRED  # tenta a lista padrão
    return _gemini_models_cache

def call_gemini(prompt):
    """Tenta cada modelo disponível em ordem de preferência, com fallback em 429/404."""
    models = get_gemini_models()
    last_err = None
    for model_name in models:
        try:
            response = genai.GenerativeModel(model_name).generate_content(prompt)
            print(f"Modelo usado: {model_name}")
            return response.text
        except Exception as e:
            err_str = str(e)
            if any(x in err_str for x in ('429', '404', 'quota', 'exhausted', 'not found')):
                print(f"Modelo {model_name} indisponível ({err_str[:80]}), tentando próximo...")
                last_err = e
                continue
            raise
    raise last_err

@app.route('/api/musicas/importar', methods=['POST'])
def importar_musica():
    url = request.json.get('url', '').strip()
    if not url:
        return jsonify({'erro': 'URL inválida'}), 400

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({'erro': 'Chave GEMINI_API_KEY não configurada'}), 400

    genai.configure(api_key=api_key)

    conteudo_web = get_web_content(url)
    if not conteudo_web:
        return jsonify({'erro': 'Não foi possível ler o conteúdo do link. Verifique se a URL está correta e acessível.'}), 400

    print(f"Conteúdo extraído ({len(conteudo_web)} chars): {conteudo_web[:300]}")

    prompt = f"""Você é especialista em cifras musicais brasileiras para cavaquinho.
Extraia os dados da música do CONTEÚDO abaixo e retorne SOMENTE um JSON válido, sem markdown, sem texto extra.

URL: {url}

CONTEÚDO DA PÁGINA:
---
{conteudo_web}
---

ESTRUTURA DO JSON:

{{
  "titulo": "Nome da música",
  "artista": "Nome do artista",
  "tom": "Tom original (ex: Am, G, C#m)",
  "cifra_tradicional": [
    {{"secao": "Intro", "acordes": "Am G C D", "letra": ""}},
    {{"secao": "Verso 1", "acordes": "Am    G", "letra": "Linha de letra aqui"}},
    {{"secao": "", "acordes": "C     D", "letra": "Próxima linha de letra"}},
    {{"secao": "Refrão", "acordes": "F  G  Am  E", "letra": "Letra do refrão"}}
  ],
  "tabela": [
    {{
      "nome_secao": "Intro / Verso",
      "grid": [
        ["Am", "%", "G", "C"],
        ["F", "G", "%", "Am"]
      ]
    }}
  ]
}}

REGRAS IMPORTANTES:
- cifra_tradicional: cada objeto é UMA linha. "acordes" fica acima da "letra" correspondente.
- Se uma linha tem só acordes sem letra (ex: intro instrumental), "letra" fica "".
- Se uma linha tem só letra sem acordes, "acordes" fica "".
- Inclua todas as seções presentes: Intro, Verso, Pré-Refrão, Refrão, Ponte, Solo, Outro, Final.
- "secao" só é preenchido na PRIMEIRA linha de cada seção nova; demais linhas da mesma seção ficam "".
- tabela: 4 colunas, cada célula é 1 compasso (ou meio, dependendo do andamento). "%" = repetir acorde anterior.
- Na tabela inclua todas as seções distintas com seus respectivos grids.
- tom: use notação padrão (C, Dm, G#m, Bb, etc.)."""

    try:
        text = call_gemini(prompt).strip()

        # Remove blocos markdown se o modelo incluir mesmo sendo pedido para não
        text = re.sub(r'^```(?:json)?\s*', '', text)
        text = re.sub(r'\s*```$', '', text)
        text = text.strip()

        try:
            dados = json.loads(text)
        except json.JSONDecodeError:
            print(f"JSON inválido recebido do Gemini: {text[:500]}")
            return jsonify({'erro': 'A IA retornou um formato inválido. Tente novamente ou adicione a cifra manualmente.'}), 500

        # Valida campos obrigatórios
        titulo = dados.get('titulo', '').strip() or 'Sem título'
        artista = dados.get('artista', '').strip() or 'Desconhecido'
        tom = dados.get('tom', 'C').strip() or 'C'
        cifra = dados.get('cifra_tradicional', [])
        tabela = dados.get('tabela', [])

        if not cifra and not tabela:
            return jsonify({'erro': 'A IA não conseguiu extrair a cifra desta página. Tente outra URL ou adicione manualmente.'}), 400

        mid = gen_id()
        n = now_iso()
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO musicas (id, titulo, artista, tom, tom_original, cifra_json, tabela_json, url_origem, criado_em, atualizado_em)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (mid, titulo, artista, tom, tom,
                     json.dumps(cifra, ensure_ascii=False),
                     json.dumps(tabela, ensure_ascii=False),
                     url, n, n)
                )
            conn.commit()
        return jsonify({'ok': True, 'id': mid, 'titulo': titulo})
    except Exception as e:
        print(f"Erro na importação: {e}")
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
    modo = request.args.get('modo', 'completo')  # completo | cifra | tabela | setlist

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

    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, PageBreak, HRFlowable)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus.flowables import AnchorFlowable
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    output_path = tmp.name
    tmp.close()

    styles = getSampleStyleSheet()

    GOLD       = colors.HexColor('#d4a853')
    GOLD_LIGHT = colors.HexColor('#fbf8f1')
    DARK       = colors.HexColor('#1a1815')
    MUTED      = colors.HexColor('#757067')
    GREY_LINE  = colors.HexColor('#e8e5df')

    titulo_st  = ParagraphStyle('T',  parent=styles['Normal'], fontSize=20, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=8, leading=26)
    artista_st = ParagraphStyle('A',  parent=styles['Normal'], fontSize=11, fontName='Helvetica', textColor=MUTED, spaceAfter=16, leading=14)
    secao_st   = ParagraphStyle('S',  parent=styles['Normal'], fontSize=9,  fontName='Helvetica-Bold', textColor=GOLD, spaceBefore=10, spaceAfter=4, leading=12)
    acorde_st  = ParagraphStyle('AC', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=DARK, spaceBefore=4, leading=12)
    letra_st   = ParagraphStyle('L',  parent=styles['Normal'], fontSize=10, fontName='Helvetica', textColor=DARK, spaceAfter=4, leading=14)
    tab_sec_st = ParagraphStyle('TS', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceBefore=12, spaceAfter=8)
    indice_h   = ParagraphStyle('IH', parent=styles['Normal'], fontSize=16, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=16)
    link_st    = ParagraphStyle('LK', parent=styles['Normal'], fontSize=11, fontName='Helvetica', leading=20, textColor=DARK)

    def make_tabela(linhas):
        col_w = (A4[0] - 4*cm) / 4
        t = Table(linhas, colWidths=[col_w]*4, rowHeights=32)
        t.setStyle(TableStyle([
            ('GRID',        (0,0), (-1,-1), 0.5, GREY_LINE),
            ('BACKGROUND',  (0,0), (-1,-1), colors.white),
            ('ALIGN',       (0,0), (-1,-1), 'CENTER'),
            ('VALIGN',      (0,0), (-1,-1), 'MIDDLE'),
            ('FONTNAME',    (0,0), (-1,-1), 'Helvetica-Bold'),
            ('FONTSIZE',    (0,0), (-1,-1), 11),
            ('TEXTCOLOR',   (0,0), (-1,-1), DARK),
            ('ROWBACKGROUNDS', (0,0), (-1,-1), [colors.white, GOLD_LIGHT]),
        ]))
        return t

    def add_page_number(canvas, doc):
        page_num = canvas.getPageNumber()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 2*cm, 1*cm, f"Página {page_num}")
        if page_num > 1:
            canvas.setStrokeColor(GREY_LINE)
            canvas.setLineWidth(0.5)
            canvas.line(2*cm, A4[1] - 1.2*cm, A4[0] - 2*cm, A4[1] - 1.2*cm)
            canvas.drawString(2*cm, A4[1] - 1.05*cm, rep['nome'].upper())

    doc = SimpleDocTemplate(output_path, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm, topMargin=2.5*cm, bottomMargin=2*cm)
    story = []

    # ── Helpers reutilizáveis ──────────────────────────────────────────────────
    def add_capa(subtitulo=''):
        story.append(Spacer(1, 6*cm))
        story.append(Paragraph("REPERTÓRIO OFICIAL", ParagraphStyle('SubCapa', parent=styles['Normal'],
            fontSize=10, fontName='Helvetica', textColor=GOLD, alignment=TA_CENTER, spaceAfter=12)))
        story.append(Paragraph(rep['nome'], ParagraphStyle('C', parent=styles['Normal'],
            fontSize=32, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceAfter=14, leading=38)))
        story.append(HRFlowable(width="30%", thickness=1.5, color=GOLD, spaceAfter=20, hAlign='CENTER'))
        info = subtitulo or f"{len(musicas)} música{'s' if len(musicas)!=1 else ''}"
        story.append(Paragraph(info, ParagraphStyle('CS', parent=styles['Normal'],
            fontSize=11, fontName='Helvetica', textColor=MUTED, alignment=TA_CENTER, spaceAfter=6)))
        story.append(PageBreak())

    def add_sumario():
        story.append(Paragraph("Índice de Músicas", indice_h))
        story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_LINE, spaceAfter=16))
        for i, m in enumerate(musicas, 1):
            link = (f'<a href="#musica_{i}" color="#1a1815">{i:02d}. <b>{m["titulo"]}</b></a>'
                    f' <font color="#757067">— {m["artista"]}</font>'
                    f' <font color="#d4a853">&nbsp;[Tom: {m["tom"]}]</font>')
            story.append(Paragraph(link, link_st))
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor('#fcfbf9'), spaceAfter=4, spaceBefore=4))
        story.append(PageBreak())

    def add_cifra(m, i):
        story.append(AnchorFlowable(f'musica_{i}'))
        story.append(Paragraph(m['titulo'], titulo_st))
        info_linha = f"{m['artista']} &nbsp; • &nbsp; Tom: <b><font color='#d4a853'>{m['tom']}</font></b>"
        story.append(Paragraph(info_linha, artista_st))
        story.append(Paragraph("CIFRA COMPLETA", ParagraphStyle('ST1', parent=styles['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=colors.white, spaceAfter=12,
            backColor=DARK, alignment=TA_CENTER)))
        secao_atual = ''
        for linha in m['cifra_tradicional']:
            secao  = linha.get('secao', '')
            acordes = linha.get('acordes', '')
            letra  = linha.get('letra', '')
            if secao and secao != secao_atual:
                secao_atual = secao
                story.append(Paragraph(secao, secao_st))
            if acordes:
                story.append(Paragraph(acordes, acorde_st))
            if letra:
                story.append(Paragraph(letra, letra_st))
            if not acordes and not letra and not secao:
                story.append(Spacer(1, 0.2*cm))
        story.append(PageBreak())

    def add_tabela(m, i):
        story.append(AnchorFlowable(f'musica_{i}'))
        story.append(Paragraph(m['titulo'], titulo_st))
        info_linha = f"{m['artista']} &nbsp; • &nbsp; Tom: <b><font color='#d4a853'>{m['tom']}</font></b>"
        story.append(Paragraph(info_linha, artista_st))
        story.append(Paragraph("MAPA DE ACORDES", ParagraphStyle('ST2', parent=styles['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=colors.white, spaceAfter=12,
            backColor=GOLD, alignment=TA_CENTER)))
        for secao in m['tabela']:
            story.append(Paragraph(secao['nome_secao'].upper(), tab_sec_st))
            if secao.get('grid'):
                story.append(make_tabela(secao['grid']))
            story.append(Spacer(1, 0.3*cm))
        story.append(PageBreak())

    # ── Modos de geração ──────────────────────────────────────────────────────
    if modo == 'setlist':
        # Lista de palco: nome do show, músicas em ordem com número, título, artista e tom em fonte grande
        doc2 = SimpleDocTemplate(output_path, pagesize=A4,
            rightMargin=1.5*cm, leftMargin=1.5*cm, topMargin=2*cm, bottomMargin=2*cm)

        sl_titulo = ParagraphStyle('SLT', parent=styles['Normal'],
            fontSize=28, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceAfter=6, leading=34)
        sl_sub    = ParagraphStyle('SLS', parent=styles['Normal'],
            fontSize=12, fontName='Helvetica', textColor=MUTED, alignment=TA_CENTER, spaceAfter=30)
        sl_num    = ParagraphStyle('SLN', parent=styles['Normal'],
            fontSize=13, fontName='Helvetica-Bold', textColor=GOLD, leading=16)
        sl_song   = ParagraphStyle('SLM', parent=styles['Normal'],
            fontSize=22, fontName='Helvetica-Bold', textColor=DARK, leading=26, spaceAfter=2)
        sl_info   = ParagraphStyle('SLI', parent=styles['Normal'],
            fontSize=14, fontName='Helvetica', textColor=MUTED, leading=18, spaceAfter=0)

        sl_story = []
        sl_story.append(Paragraph(rep['nome'], sl_titulo))
        sl_story.append(Paragraph(f"{len(musicas)} músicas", sl_sub))
        sl_story.append(HRFlowable(width="100%", thickness=1, color=GOLD, spaceAfter=20))

        for i, m in enumerate(musicas, 1):
            sl_story.append(Paragraph(f"{i:02d}.", sl_num))
            sl_story.append(Paragraph(m['titulo'], sl_song))
            sl_story.append(Paragraph(
                f"{m['artista']} &nbsp;&nbsp; <font color='#d4a853'><b>Tom: {m['tom']}</b></font>",
                sl_info))
            sl_story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_LINE,
                spaceBefore=14, spaceAfter=14))

        doc2.build(sl_story)
        sufixo = '_setlist'

    elif modo == 'cifra':
        add_capa('Cifras e letras')
        add_sumario()
        for i, m in enumerate(musicas, 1):
            add_cifra(m, i)
        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
        sufixo = '_cifras'

    elif modo == 'tabela':
        add_capa('Mapa de acordes')
        add_sumario()
        for i, m in enumerate(musicas, 1):
            add_tabela(m, i)
        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
        sufixo = '_tabelas'

    else:  # completo
        add_capa()
        add_sumario()
        for i, m in enumerate(musicas, 1):
            add_cifra(m, i)
            add_tabela(m, i)
        doc.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
        sufixo = '_completo'

    nome_arquivo = rep['nome'].replace(' ', '_') + sufixo + '.pdf'
    return send_file(output_path, as_attachment=True, download_name=nome_arquivo, mimetype='application/pdf')

# ─── Health check & keep-alive ────────────────────────────────────────────────
@app.route('/health')
def health():
    try:
        with get_db() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return jsonify({"status": "ok"}), 200
    except Exception as e:
        return jsonify({"status": "error", "detail": str(e)}), 500

# ──────────────────────────────────────────────────────────────────────────────
