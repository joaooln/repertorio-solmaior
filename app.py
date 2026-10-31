"""
Repertório Sol Maior — Backend Flask + SQLite
"""
import os, json, re, subprocess, sys, psycopg2, io, unicodedata, base64
from contextlib import contextmanager
from psycopg2.extras import RealDictCursor
from datetime import datetime
from flask import Flask, request, jsonify, render_template, send_file
from werkzeug.exceptions import HTTPException
import google.generativeai as genai
import requests
from bs4 import BeautifulSoup

app = Flask(__name__)
DATABASE_URL = os.environ.get("DATABASE_URL")

from functools import wraps

ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "solmaior123")

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        pw = request.headers.get("X-Admin-Password")
        if not pw or pw != ADMIN_PASSWORD:
            return jsonify({'erro': 'Senha de administrador inválida ou não fornecida'}), 401
        return f(*args, **kwargs)
    return decorated_function


# ─── Banco de dados ────────────────────────────────────────────────────────────
@contextmanager
def get_db():
    # Supabase/PostgreSQL na nuvem geralmente exige SSL
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor, sslmode='require')
    try:
        yield conn
    finally:
        conn.close()

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
            # Migração: adiciona colunas novas se ainda não existirem
            for col_sql in [
                "ALTER TABLE musicas ADD COLUMN IF NOT EXISTS favorito BOOLEAN DEFAULT FALSE",
                "ALTER TABLE musicas ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]'",
                "ALTER TABLE musicas ADD COLUMN IF NOT EXISTS bpm INTEGER",
                "ALTER TABLE musicas ADD COLUMN IF NOT EXISTS duracao_min FLOAT",
                "ALTER TABLE musicas ADD COLUMN IF NOT EXISTS notas TEXT DEFAULT ''",
            ]:
                cur.execute(col_sql)
        conn.commit()

def gen_id():
    import uuid
    return str(uuid.uuid4())[:8]

def now_iso():
    return datetime.utcnow().isoformat()

# ─── Helpers ───────────────────────────────────────────────────────────────────
def remove_acentos(texto):
    if not texto: return ''
    return ''.join(c for c in unicodedata.normalize('NFD', str(texto)) if unicodedata.category(c) != 'Mn')

def sanitizar_pdf(texto):
    if not texto: return ''
    return str(texto).replace('♭', 'b').replace('♯', '#')

NOTAS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
ENHAR = {'Db':'C#','Eb':'D#','Fb':'E','Gb':'F#','Ab':'G#','Bb':'A#','Cb':'B'}

def texto_pdf(texto):
    t = str(texto).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    return t.replace(' ', '&nbsp;')

def normaliza(n):
    if not n: return ''
    clean = str(n).replace('♭', 'b').replace('♯', '#')
    return ENHAR.get(clean, clean)

def transpoe_acorde(acorde, st):
    if st == 0: return acorde
    if '/' in acorde:
        return '/'.join(transpoe_acorde(p, st) for p in acorde.split('/'))
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

def _fetch_direct(url):
    """Busca direta — funciona local e em sites sem proteção anti-bot."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
    }
    resp = requests.get(url, headers=headers, timeout=15, allow_redirects=True)
    resp.raise_for_status()
    resp.encoding = resp.apparent_encoding or 'utf-8'

    # Se foi bloqueado por Cloudflare ou similar (mesmo retornando status 200)
    text_lower = resp.text.lower()
    if any(marker in text_lower for marker in ['cloudflare', 'ray id', 'captcha', 'verify you are human', 'checking your browser', 'ddos-guard', 'unusual activity']):
        mock_resp = requests.Response()
        mock_resp.status_code = 403
        raise requests.HTTPError("Bloqueio anti-bot Cloudflare detectado na requisição direta", response=mock_resp)

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Para o Cifra Club, valida se contêiner de cifra existe na página obtida
    if 'cifraclub.com.br' in url:
        has_cifra = (
            soup.find('div', class_='cifra_cnt') or 
            soup.find('div', id='cifra_cnt') or 
            soup.find('pre') or 
            soup.find('article', class_='cifra')
        )
        if not has_cifra:
            mock_resp = requests.Response()
            mock_resp.status_code = 403
            raise requests.HTTPError("Contêiner de cifra do Cifra Club não localizado na página direta", response=mock_resp)

    for s in soup(['script', 'style', 'header', 'footer', 'nav', 'aside', 'iframe', 'noscript']):
        s.decompose()
    candidates = [
        soup.find('div', class_='cifra_cnt'),
        soup.find('div', id='cifra_cnt'),
        soup.find('article', class_='cifra'),
        soup.find('pre'),
        soup.find('div', class_=re.compile(r'cifra|chord|lyric', re.I)),
        soup.find('main'),
        soup.find('article'),
    ]
    main_content = next((c for c in candidates if c), soup.find('body') or soup)
    return main_content.get_text(separator='\n', strip=True)[:20000]

class ProxyFetchError(Exception):
    """Erro vindo do proxy de fallback (Jina), não do site original."""
    def __init__(self, status_code, message):
        self.status_code = status_code
        super().__init__(message)

def _fetch_jina(url):
    """Fallback via Jina Reader (r.jina.ai) — proxy gratuito que renderiza a página
    e devolve texto limpo. Bypassa Cloudflare e similar.
    Retry com backoff em 503/429 (rate limit ou origem temporariamente indisponível)."""
    proxy_url = f"https://r.jina.ai/{url}"
    headers = {
        'Accept': 'text/plain',
        'User-Agent': 'Mozilla/5.0',
        'X-Return-Format': 'text',
    }
    api_key = os.environ.get('JINA_API_KEY')
    if api_key:
        headers['Authorization'] = f'Bearer {api_key}'

    import time
    delays = [0, 2, 5]  # 3 tentativas
    last_status = None
    for i, delay in enumerate(delays):
        if delay:
            time.sleep(delay)
        try:
            resp = requests.get(proxy_url, headers=headers, timeout=30)
            if resp.status_code in (429, 503) and i < len(delays) - 1:
                last_status = resp.status_code
                print(f"Jina retornou {resp.status_code}, tentativa {i+1}/{len(delays)}…")
                continue
            resp.raise_for_status()
            return resp.text[:20000]
        except requests.HTTPError as e:
            sc = e.response.status_code if e.response is not None else None
            raise ProxyFetchError(sc, f"Jina Reader retornou HTTP {sc}") from e
    raise ProxyFetchError(last_status, f"Jina Reader continuou retornando {last_status} após retries")

def get_web_content(url):
    try:
        return _fetch_direct(url)
    except requests.HTTPError as e:
        sc = e.response.status_code if e.response is not None else None
        # Cloudflare / WAF típicos: tenta fallback via Jina Reader
        if sc in (401, 403, 429, 503):
            print(f"Direto retornou {sc}, tentando via Jina Reader…")
            return _fetch_jina(url)
        raise

@app.errorhandler(Exception)
def handle_exception(e):
    # Deixa 404, 405, etc. passarem com seu status correto
    if isinstance(e, HTTPException):
        return jsonify({"erro": e.description, "tipo": e.name}), e.code
    # Retorna o erro em JSON para facilitar o debug no Vercel
    return jsonify({"erro": str(e), "tipo": type(e).__name__}), 500

@app.route('/favicon.ico')
def favicon():
    from flask import send_from_directory
    return send_from_directory('static', 'favicon.svg', mimetype='image/svg+xml')

# ─── Rotas: Músicas ────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/sw.js')
def service_worker():
    from flask import send_from_directory
    resp = send_from_directory('static', 'sw.js', mimetype='application/javascript')
    resp.headers['Service-Worker-Allowed'] = '/'
    resp.headers['Cache-Control'] = 'no-cache'
    return resp

@app.route('/api/musicas', methods=['GET'])
def listar_musicas():
    q        = request.args.get('q', '')
    favorito = request.args.get('favorito', '')
    tom      = request.args.get('tom', '')
    tag      = request.args.get('tag', '')
    conditions, params = [], []
    if favorito == '1':
        conditions.append("favorito = TRUE")
    if tom:
        conditions.append("tom = %s")
        params.append(tom)
    where = ('WHERE ' + ' AND '.join(conditions)) if conditions else ''
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM musicas {where} ORDER BY titulo", params)
            rows = cur.fetchall()
            result = []
            q_norm = remove_acentos(q).lower() if q else ''
            for r in rows:
                m = dict(r)
                m['tags'] = json.loads(m.get('tags') or '[]')
                if tag and tag not in m['tags']:
                    continue
                if q_norm:
                    tit_norm = remove_acentos(m.get('titulo','')).lower()
                    art_norm = remove_acentos(m.get('artista','')).lower()
                    tom_norm = remove_acentos(m.get('tom','')).lower()
                    if q_norm not in tit_norm and q_norm not in art_norm and q_norm not in tom_norm:
                        continue
                result.append(m)
            return jsonify(result)

@app.route('/api/musicas', methods=['POST'])
@admin_required
def criar_musica():
    d = request.json
    mid = d.get('id') or gen_id()
    n = now_iso()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO musicas (id, titulo, artista, tom, tom_original, cifra_json, tabela_json,
                       url_origem, favorito, tags, bpm, duracao_min, notas, criado_em, atualizado_em)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (id) DO NOTHING""",
                (mid, d['titulo'], d['artista'], d.get('tom','C'), d.get('tom_original') or d.get('tom','C'),
                 json.dumps(d.get('cifra_tradicional', []), ensure_ascii=False),
                 json.dumps(d.get('tabela', []), ensure_ascii=False),
                 d.get('url_origem'), d.get('favorito', False),
                 json.dumps(d.get('tags', []), ensure_ascii=False),
                 d.get('bpm'), d.get('duracao_min'), d.get('notas', ''), n, n)
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
            m['tags'] = json.loads(m['tags'] or '[]')
            return jsonify(m)

@app.route('/api/musicas/<mid>', methods=['PUT'])
@admin_required
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
                    cifra_json=%s, tabela_json=%s, url_origem=%s,
                    favorito=%s, tags=%s, bpm=%s, duracao_min=%s, notas=%s,
                    atualizado_em=%s
                WHERE id=%s
            """, (
                d.get('titulo', row['titulo']),
                d.get('artista', row['artista']),
                d.get('tom', row['tom']),
                d.get('tom_original', row['tom_original']),
                json.dumps(d.get('cifra_tradicional', json.loads(row['cifra_json'])), ensure_ascii=False),
                json.dumps(d.get('tabela', json.loads(row['tabela_json'])), ensure_ascii=False),
                d.get('url_origem', row['url_origem']),
                d.get('favorito', row.get('favorito', False)),
                json.dumps(d.get('tags', json.loads(row.get('tags') or '[]')), ensure_ascii=False),
                d.get('bpm', row.get('bpm')),
                d.get('duracao_min', row.get('duracao_min')),
                d.get('notas', row.get('notas', '')),
                n, mid
            ))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/musicas/<mid>', methods=['DELETE'])
@admin_required
def deletar_musica(mid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repertorio_musicas WHERE musica_id=%s", (mid,))
            cur.execute("DELETE FROM musicas WHERE id=%s", (mid,))
        conn.commit()
    return jsonify({'ok': True})

@app.route('/api/musicas/<mid>/transpor', methods=['POST'])
@admin_required
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

def call_gemini(prompt, use_search=False):
    """Tenta cada modelo disponível em ordem de preferência, com fallback em 429/404.
    Se use_search=True, tenta ativar Grounding com Google Search para buscar dados reais na web."""
    models = get_gemini_models()
    last_err = None
    for model_name in models:
        try:
            if use_search:
                try:
                    m = genai.GenerativeModel(model_name, tools='google_search_retrieval')
                    response = m.generate_content(prompt)
                    print(f"Modelo usado com Google Search: {model_name}")
                    return response.text
                except Exception as tool_err:
                    print(f"Aviso: Google Search não suportado por {model_name} ({tool_err}), tentando sem search...")
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

def extrair_prompt_youtube(url):
    """Consulta o microserviço BTC ou metadados oEmbed e monta o prompt do Gemini para YouTube."""
    chord_detector_url = os.environ.get("CHORD_DETECTOR_URL")
    audio_data = None

    if chord_detector_url:
        try:
            print(f"Chamando microserviço BTC em {chord_detector_url}...")
            resp = requests.post(
                f"{chord_detector_url.rstrip('/')}/predict_youtube",
                json={"url": url},
                timeout=120
            )
            if resp.ok:
                audio_data = resp.json()
                print("Acordes detectados pelo microserviço BTC com sucesso!")
            else:
                print(f"Microserviço BTC retornou status {resp.status_code}: {resp.text[:200]}")
        except Exception as e:
            print(f"Aviso: Não foi possível conectar ao microserviço BTC ({e}).")

    if audio_data and audio_data.get("ok"):
        titulo = audio_data.get("titulo", "Música do YouTube")
        artista = audio_data.get("artista", "Artista")
        tom_est = audio_data.get("tom_estimado", "C")
        acordes_usados = audio_data.get("acordes_usados", [])
        timeline = audio_data.get("timeline", [])
        linhas_timeline = [f"{item['inicio']}s a {item['fim']}s: {item['acorde']}" for item in timeline[:80]]
        texto_timeline = "\n".join(linhas_timeline)

        return f"""Você é especialista em harmonia e cifras brasileiras para cavaquinho.
O modelo de áudio neural BTC analisou a gravação do YouTube '{titulo}' ({artista}) e detectou a seguinte sequência temporal de acordes REAIS tocados na gravação:

ACORDES REAIS DETECTADOS NO ÁUDIO:
{texto_timeline}

Tom estimado da gravação: {tom_est}
Acordes utilizados: {', '.join(acordes_usados)}

Com base nesses acordes reais tocados na gravação, estruture a música completa para cavaquinho no formato JSON do Sol Maior:
1. Em 'cifra_tradicional': pesquise a letra real oficial em português da música e sincronize os acordes detectados acima das respectivas frases da letra.
2. Em 'tabela': monte a grade de 4 colunas com a sequência harmônica por compassos (estilo Victor Cazzoli), separando em seções (Intro, Verso, Refrão, etc.).
3. Em 'tom': defina o tom principal ({tom_est} ou o tom correto correspondente).

ESTRUTURA DO JSON:
{{
  "titulo": "{titulo}",
  "artista": "{artista}",
  "tom": "{tom_est}",
  "cifra_tradicional": [
    {{"secao": "Intro", "acordes": "Am G C D", "letra": ""}},
    {{"secao": "Verso 1", "acordes": "Am    G", "letra": "Linha da letra aqui"}},
    {{"secao": "", "acordes": "C     D", "letra": "Próxima linha"}}
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
Retorne SOMENTE o JSON válido, sem markdown e sem texto adicional."""

    # Fallback caso o microserviço BTC ainda não esteja configurado
    # Limpa parâmetros como ?list=... para extrair os dados limpos do vídeo
    video_id_match = re.search(r'(?:v=|youtu\.be/|shorts/)([a-zA-Z0-9_-]{11})', url)
    video_id = video_id_match.group(1) if video_id_match else None
    clean_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else url

    titulo = "Música do YouTube"
    artista = "Artista"
    try:
        r = requests.get(f"https://www.youtube.com/oembed?url={requests.utils.quote(clean_url)}&format=json", timeout=10)
        if r.ok:
            d = r.json()
            titulo = d.get("title", titulo)
            artista = d.get("author_name", artista)
            print(f"Metadados YouTube obtidos: '{titulo}' por '{artista}'")
    except Exception as e:
        print(f"Erro no oEmbed do YouTube: {e}")

    return f"""Você é um pesquisador e arranjador musical especialista em música brasileira e cavaquinho.
O usuário quer a cifra para cavaquinho da seguinte música do YouTube:
URL: {clean_url}
Título do vídeo: {titulo}
Artista / Canal: {artista}

REGRAS OBRIGATÓRIAS DE LETRA E HARMÔNIA:
1. LETRA REAL E COMPLETA: Use a letra REAL oficial gravada por este artista e composta pelos autores.
   - NUNCA invente versos, rimas falsas ou repetições genéricas.
   - Se for 'Peba na Pimenta', a letra REAL oficial é de João do Vale / Marinês e começa exatamente com:
     'Seu Malaquias preparou / Cinco peba na pimenta / Só do povo de Campinas / Seu Malaquias convidou mais de quarenta...'
     Seguida por: 'Entre todos os convidados / Pra comer peba, foi também Maria Benta... / Ai, ai, ai, seu Malaquias / Ai, ai, você disse que não ardia...'.
2. CIFRA DE CAVAQUINHO: Coloque os acordes reais correspondentes para cavaquinho (com passagens harmônicas, dominantes secundários e preparações típicas do forró/samba).
3. GRADE DE COMPASSOS: Monte a 'tabela' de 4 colunas com a sequência dos compassos (estilo Victor Cazzoli), '% ' indica repetição do acorde anterior.

ESTRUTURA DO JSON:
{{
  "titulo": "{titulo.split('-')[0].strip() if '-' in titulo else titulo}",
  "artista": "{artista}",
  "tom": "Tom da música (ex: Am, G, Dm)",
  "cifra_tradicional": [
    {{"secao": "Intro", "acordes": "Am G C D", "letra": ""}},
    {{"secao": "Verso 1", "acordes": "Am    G", "letra": "Linha da letra real oficial aqui"}},
    {{"secao": "", "acordes": "C     D", "letra": "Próxima linha da letra real"}}
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
Retorne SOMENTE o JSON válido, sem texto explicativo e sem markdown."""

@app.route('/api/musicas/importar', methods=['POST'])
@admin_required
def importar_musica():
    url = request.json.get('url', '').strip()
    substituir = request.json.get('substituir', False)
    if not url:
        return jsonify({'erro': 'URL inválida'}), 400

    # Verifica duplicata por URL antes de chamar a IA
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, titulo, artista FROM musicas WHERE url_origem = %s", (url,))
            existente = cur.fetchone()

    if existente and not substituir:
        return jsonify({'duplicada': True, 'id': existente['id'],
                        'titulo': existente['titulo'], 'artista': existente['artista']})

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return jsonify({'erro': 'Chave GEMINI_API_KEY não configurada'}), 400

    genai.configure(api_key=api_key)

    is_yt = bool(re.search(r'(youtube\.com/(watch\?v=|shorts/)|youtu\.be/)', url.lower()))
    if is_yt:
        prompt = extrair_prompt_youtube(url)
    else:
        try:
            conteudo_web = get_web_content(url)
        except ProxyFetchError as e:
            print(f"ProxyFetchError ao buscar {url}: {e.status_code}")
            if e.status_code in (429, 503):
                return jsonify({'erro': f'O proxy de leitura (Jina Reader) está temporariamente sobrecarregado (HTTP {e.status_code}). Aguarde alguns segundos e tente de novo, ou configure JINA_API_KEY pra ter limite maior.'}), 429
            return jsonify({'erro': f'O proxy de leitura falhou (HTTP {e.status_code}). Tente novamente.'}), 502
        except requests.HTTPError as e:
            sc = e.response.status_code if e.response is not None else '?'
            print(f"HTTPError ao buscar {url}: {sc}")
            return jsonify({'erro': f'O site bloqueou a requisição (HTTP {sc}). Cifra Club costuma bloquear IPs de servidores cloud; tente rodar localmente ou adicione manualmente.'}), 400
        except requests.RequestException as e:
            print(f"RequestException ao buscar {url}: {e}")
            return jsonify({'erro': f'Falha de rede ao acessar a URL: {e}'}), 400
        except Exception as e:
            print(f"Erro inesperado ao buscar {url}: {e}")
            return jsonify({'erro': f'Erro inesperado: {e}'}), 500

        if not conteudo_web:
            return jsonify({'erro': 'Página carregou mas não foi possível extrair conteúdo dela.'}), 400

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
        raw_text = call_gemini(prompt, use_search=is_yt).strip()
        # Extrai bloco JSON se estiver dentro de markdown ```json ... ```
        match_block = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw_text)
        text = match_block.group(1).strip() if match_block else raw_text

        # Fallback: extrai do primeiro '{' até o último '}'
        if not text.startswith('{') and '{' in text and '}' in text:
            text = text[text.find('{'):text.rfind('}')+1]

        try:
            dados = json.loads(text)
        except json.JSONDecodeError:
            print(f"JSON inválido recebido do Gemini: {raw_text[:500]}")
            return jsonify({'erro': 'A IA retornou um formato inválido. Tente novamente ou adicione a cifra manualmente.'}), 500

        # Valida campos obrigatórios
        titulo = dados.get('titulo', '').strip() or 'Sem título'
        artista = dados.get('artista', '').strip() or 'Desconhecido'
        tom = dados.get('tom', 'C').strip() or 'C'
        cifra = dados.get('cifra_tradicional', [])
        tabela = dados.get('tabela', [])

        if not cifra and not tabela:
            return jsonify({'erro': 'A IA não conseguiu extrair a cifra desta página. Tente outra URL ou adicione manualmente.'}), 400

        n = now_iso()
        with get_db() as conn:
            with conn.cursor() as cur:
                if existente and substituir:
                    mid = existente['id']
                    cur.execute("""
                        UPDATE musicas SET titulo=%s, artista=%s, tom=%s, tom_original=%s,
                            cifra_json=%s, tabela_json=%s, url_origem=%s, atualizado_em=%s
                        WHERE id=%s""",
                        (titulo, artista, tom, tom,
                         json.dumps(cifra, ensure_ascii=False),
                         json.dumps(tabela, ensure_ascii=False),
                         url, n, mid))
                else:
                    mid = gen_id()
                    cur.execute(
                        """INSERT INTO musicas (id, titulo, artista, tom, tom_original, cifra_json, tabela_json, url_origem, criado_em, atualizado_em)
                           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (mid, titulo, artista, tom, tom,
                         json.dumps(cifra, ensure_ascii=False),
                         json.dumps(tabela, ensure_ascii=False),
                         url, n, n))
            conn.commit()
        return jsonify({'ok': True, 'id': mid, 'titulo': titulo})
    except Exception as e:
        print(f"Erro na importação: {e}")
        return jsonify({'erro': str(e)}), 500

# ─── Importar PDF (Moises.ai) ─────────────────────────────────────────────────
ACORDE_RE = re.compile(
    r'^[A-G][#b]?(?:maj|min|dim|aug|sus|add|m|M|º|°|\+)?'
    r'(?:[0-9]{1,2}|M|[#b+-][0-9]{1,2}|sus[0-9]?|add[0-9]{1,2}|dim|\([^)]*\))*'
    r'(?:/[A-G][#b]?)?$'
)
SECOES_PDF = {
    'INTRO': 'Intro', 'INTRODUÇÃO': 'Intro', 'VERSO': 'Verso', 'VERSE': 'Verso',
    'PRÉ-REFRÃO': 'Pré-Refrão', 'PRE-REFRÃO': 'Pré-Refrão', 'PRE-CHORUS': 'Pré-Refrão',
    'REFRÃO': 'Refrão', 'CHORUS': 'Refrão', 'PONTE': 'Ponte', 'BRIDGE': 'Ponte',
    'SOLO': 'Solo', 'INSTRUMENTAL': 'Instrumental', 'OUTRO': 'Final', 'FINAL': 'Final',
}
LIXO_TITULO_RE = re.compile(
    r'\s*[\(\[][^)\]]*(oficial|official|clipe|lyric|v[ií]deo|[áa]udio|visualizer|ao vivo|live|\bhd\b|4k)[^)\]]*[\)\]]',
    re.I
)

def eh_linha_acordes(t):
    tokens = t.split()
    return bool(tokens) and all(
        ACORDE_RE.match(tk) or tk in ('|', '%', '-') or re.match(r'^\(?x\d+\)?$', tk, re.I)
        for tk in tokens
    )

def eh_secao(t):
    return len(t) <= 25 and t == t.upper() and bool(re.match(r'^[A-ZÀ-Ý][A-ZÀ-Ý \-]*\d*$', t))

def nome_secao(t):
    return SECOES_PDF.get(t, t.title())

def indent(l):
    return len(l) - len(l.lstrip(' '))

def parse_moises_pdf(dados):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(dados))
    linhas = []
    for p in reader.pages:
        linhas.extend((p.extract_text(extraction_mode='layout') or '').split('\n'))
    linhas = [l.rstrip().replace('\t', '    ') for l in linhas if 'moises.ai' not in l.lower()]

    titulo_pdf, tom, corpo = '', 'C', []
    for l in linhas:
        t = l.strip()
        if not t and not corpo: continue
        mk = re.match(r'^(?:key|tom|tonalidade)\s*:\s*([A-G][#b]?)\s*(\w+)?', t, re.I)
        if mk and tom == 'C' and not corpo:
            tom = mk.group(1) + ('m' if (mk.group(2) or '').lower() in ('minor', 'menor') else '')
        elif not titulo_pdf:
            titulo_pdf = t
        else:
            corpo.append(l)

    nome = LIXO_TITULO_RE.sub('', titulo_pdf).strip(' -|')
    partes = [p.strip() for p in re.split(r'\s+[-–—|]\s+', nome, maxsplit=1) if p.strip()]
    artista, titulo = (partes[0], partes[1]) if len(partes) == 2 else ('', nome)

    cifra, secao, pendente, teve_secao = [], '', None, False

    def push(acordes, letra):
        nonlocal secao
        cifra.append({'secao': secao or ('' if teve_secao or cifra or letra else 'Intro'),
                      'acordes': acordes, 'letra': letra})
        secao = ''

    def so_acordes(l):
        return '  '.join(l.split())

    for l in corpo:
        t = l.strip()
        if not t: continue
        if eh_linha_acordes(t):
            if pendente is not None: push(so_acordes(pendente), '')
            pendente = l
        elif eh_secao(t):
            if pendente is not None: push(so_acordes(pendente), '')
            pendente, secao, teve_secao = None, nome_secao(t), True
        elif pendente is not None:
            ind = min(indent(pendente), indent(l))
            push(pendente[ind:].rstrip(), l[ind:].rstrip())
            pendente = None
        else:
            push('', t)
    if pendente is not None: push(so_acordes(pendente), '')

    return {'titulo': titulo or 'Sem título', 'artista': artista, 'tom': tom,
            'titulo_pdf': titulo_pdf, 'cifra_tradicional': cifra}

@app.route('/api/musicas/importar-pdf', methods=['POST'])
@admin_required
def importar_pdf():
    conteudo = (request.json or {}).get('conteudo', '')
    if not conteudo:
        return jsonify({'erro': 'Nenhum arquivo enviado'}), 400
    try:
        dados = base64.b64decode(conteudo.split(',')[-1])
    except Exception:
        return jsonify({'erro': 'Arquivo inválido'}), 400
    if not dados.startswith(b'%PDF'):
        return jsonify({'erro': 'O arquivo não é um PDF'}), 400
    try:
        musica = parse_moises_pdf(dados)
    except Exception as e:
        print(f"Erro lendo PDF: {e}")
        return jsonify({'erro': f'Não foi possível ler o PDF: {e}'}), 400
    if not musica['cifra_tradicional']:
        return jsonify({'erro': 'Nenhuma cifra encontrada no PDF. Ele foi gerado pelo Moises?'}), 400
    return jsonify(musica)

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
@admin_required
def criar_repertorio():
    d = request.json
    rid = d.get('id') or gen_id()
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
@admin_required
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
@admin_required
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
    acorde_mono_st = ParagraphStyle('ACM', parent=acorde_st, fontName='Courier-Bold')
    letra_mono_st  = ParagraphStyle('LM',  parent=letra_st,  fontName='Courier')
    tab_sec_st = ParagraphStyle('TS', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceBefore=12, spaceAfter=8)
    indice_h   = ParagraphStyle('IH', parent=styles['Normal'], fontSize=16, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=16)
    link_st    = ParagraphStyle('LK', parent=styles['Normal'], fontSize=11, fontName='Helvetica', leading=20, textColor=DARK)

    def make_tabela(linhas):
        clean_linhas = [[sanitizar_pdf(cell) for cell in row] for row in linhas]
        col_w = (A4[0] - 4*cm) / 4
        t = Table(clean_linhas, colWidths=[col_w]*4, rowHeights=32)
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
            mono = bool(acordes and letra)
            if acordes:
                story.append(Paragraph(texto_pdf(sanitizar_pdf(acordes)), acorde_mono_st if mono else acorde_st))
            if letra:
                story.append(Paragraph(texto_pdf(letra) if mono else letra, letra_mono_st if mono else letra_st))
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

# ─── PDF de música individual ─────────────────────────────────────────────────
@app.route('/api/musicas/<mid>/pdf', methods=['GET'])
def pdf_musica(mid):
    modo = request.args.get('modo', 'completo')
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM musicas WHERE id=%s", (mid,))
            row = cur.fetchone()
            if not row: return jsonify({'erro': 'Não encontrada'}), 404
    m = dict(row)
    m['cifra_tradicional'] = json.loads(m['cifra_json'])
    m['tabela'] = json.loads(m['tabela_json'])

    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable)
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix='.pdf', delete=False)
    output_path = tmp.name; tmp.close()

    styles = getSampleStyleSheet()
    GOLD = colors.HexColor('#d4a853'); DARK = colors.HexColor('#1a1815')
    MUTED = colors.HexColor('#757067'); GREY_LINE = colors.HexColor('#e8e5df')
    GOLD_LIGHT = colors.HexColor('#fbf8f1')

    titulo_st  = ParagraphStyle('T',  parent=styles['Normal'], fontSize=20, fontName='Helvetica-Bold', textColor=DARK, spaceAfter=8, leading=26)
    artista_st = ParagraphStyle('A',  parent=styles['Normal'], fontSize=11, fontName='Helvetica', textColor=MUTED, spaceAfter=16, leading=14)
    secao_st   = ParagraphStyle('S',  parent=styles['Normal'], fontSize=9,  fontName='Helvetica-Bold', textColor=GOLD, spaceBefore=10, spaceAfter=4, leading=12)
    acorde_st  = ParagraphStyle('AC', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=DARK, spaceBefore=4, leading=12)
    letra_st   = ParagraphStyle('L',  parent=styles['Normal'], fontSize=10, fontName='Helvetica', textColor=DARK, spaceAfter=4, leading=14)
    acorde_mono_st = ParagraphStyle('ACM', parent=acorde_st, fontName='Courier-Bold')
    letra_mono_st  = ParagraphStyle('LM',  parent=letra_st,  fontName='Courier')
    tab_sec_st = ParagraphStyle('TS', parent=styles['Normal'], fontSize=10, fontName='Helvetica-Bold', textColor=DARK, alignment=TA_CENTER, spaceBefore=12, spaceAfter=8)

    doc = SimpleDocTemplate(output_path, pagesize=A4,
        rightMargin=2*cm, leftMargin=2*cm, topMargin=2.5*cm, bottomMargin=2*cm)
    story = []
    story.append(Paragraph(m['titulo'], titulo_st))
    story.append(Paragraph(f"{m['artista']} &nbsp; • &nbsp; Tom: <b><font color='#d4a853'>{m['tom']}</font></b>", artista_st))
    story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_LINE, spaceAfter=12))

    if modo != 'tabela' and m['cifra_tradicional']:
        secao_atual = ''
        for linha in m['cifra_tradicional']:
            secao = linha.get('secao', ''); acordes = linha.get('acordes', ''); letra = linha.get('letra', '')
            if secao and secao != secao_atual:
                secao_atual = secao; story.append(Paragraph(secao, secao_st))
            mono = bool(acordes and letra)
            if acordes: story.append(Paragraph(texto_pdf(sanitizar_pdf(acordes)), acorde_mono_st if mono else acorde_st))
            if letra:   story.append(Paragraph(texto_pdf(letra) if mono else letra, letra_mono_st if mono else letra_st))
        if modo == 'completo' and m['tabela']:
            story.append(Spacer(1, 0.5*cm))
            story.append(HRFlowable(width="100%", thickness=0.5, color=GREY_LINE, spaceAfter=12))

    if modo != 'cifra' and m['tabela']:
        col_w = (A4[0] - 4*cm) / 4
        for secao in m['tabela']:
            story.append(Paragraph(secao['nome_secao'].upper(), tab_sec_st))
            if secao.get('grid'):
                t = Table(secao['grid'], colWidths=[col_w]*4, rowHeights=32)
                t.setStyle(TableStyle([
                    ('GRID', (0,0), (-1,-1), 0.5, GREY_LINE),
                    ('BACKGROUND', (0,0), (-1,-1), colors.white),
                    ('ALIGN', (0,0), (-1,-1), 'CENTER'), ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                    ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'), ('FONTSIZE', (0,0), (-1,-1), 11),
                    ('TEXTCOLOR', (0,0), (-1,-1), DARK),
                    ('ROWBACKGROUNDS', (0,0), (-1,-1), [colors.white, GOLD_LIGHT]),
                ]))
                story.append(t)
            story.append(Spacer(1, 0.3*cm))

    doc.build(story)
    nome_arquivo = f"{m['titulo'].replace(' ','_')}_{modo}.pdf"
    return send_file(output_path, as_attachment=True, download_name=nome_arquivo, mimetype='application/pdf')

# ─── Stats ─────────────────────────────────────────────────────────────────────
@app.route('/api/stats', methods=['GET'])
def get_stats():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) as total FROM musicas")
            total = cur.fetchone()['total']
            cur.execute("SELECT COUNT(*) as total FROM musicas WHERE favorito = TRUE")
            favoritas = cur.fetchone()['total']
            cur.execute("SELECT COUNT(*) as total FROM repertorios")
            total_reps = cur.fetchone()['total']
            cur.execute("SELECT artista, COUNT(*) as n FROM musicas GROUP BY artista ORDER BY n DESC LIMIT 5")
            top_artistas = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT tom, COUNT(*) as n FROM musicas GROUP BY tom ORDER BY n DESC LIMIT 8")
            por_tom = [dict(r) for r in cur.fetchall()]
            cur.execute("SELECT tags FROM musicas WHERE tags IS NOT NULL AND tags != '[]'")
            tag_count = {}
            for row in cur.fetchall():
                for t in json.loads(row['tags'] or '[]'):
                    tag_count[t] = tag_count.get(t, 0) + 1
            top_tags = sorted(tag_count.items(), key=lambda x: -x[1])[:10]
            cur.execute("SELECT SUM(duracao_min) as total FROM musicas WHERE duracao_min IS NOT NULL")
            dur = cur.fetchone()['total']
    return jsonify({
        'total_musicas': total,
        'total_favoritas': favoritas,
        'total_repertorios': total_reps,
        'top_artistas': top_artistas,
        'por_tom': por_tom,
        'top_tags': [{'tag': t, 'n': n} for t, n in top_tags],
        'duracao_total_min': float(dur) if dur else 0,
    })

# ─── Backup export / import ────────────────────────────────────────────────────
@app.route('/api/biblioteca/export', methods=['GET'])
def exportar_biblioteca():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM musicas ORDER BY titulo")
            musicas = []
            for row in cur.fetchall():
                m = dict(row)
                m['cifra_tradicional'] = json.loads(m['cifra_json'])
                m['tabela'] = json.loads(m['tabela_json'])
                m['tags'] = json.loads(m.get('tags') or '[]')
                musicas.append(m)
            cur.execute("SELECT * FROM repertorios ORDER BY nome")
            reps = []
            for r in cur.fetchall():
                rep = dict(r)
                cur.execute("SELECT musica_id, posicao FROM repertorio_musicas WHERE repertorio_id=%s ORDER BY posicao", (r['id'],))
                rep['musicas_ids'] = [row['musica_id'] for row in cur.fetchall()]
                reps.append(rep)
    data = json.dumps({'musicas': musicas, 'repertorios': reps, 'exportado_em': now_iso()},
                      ensure_ascii=False, indent=2)
    buf = io.BytesIO(data.encode('utf-8'))
    return send_file(buf, as_attachment=True, download_name='backup_solmaior.json', mimetype='application/json')

def campo_backup(m, campo, campo_json):
    # Backups do cache offline trazem os campos como string JSON (cifra_json, tabela_json)
    v = m.get(campo)
    if v is None: v = m.get(campo_json)
    if isinstance(v, str):
        try: v = json.loads(v or '[]')
        except ValueError: v = []
    return v or []

@app.route('/api/biblioteca/import', methods=['POST'])
@admin_required
def importar_biblioteca():
    try:
        data = request.json
        musicas = data.get('musicas', [])
        reps    = data.get('repertorios', [])
        n = now_iso()
        imported, skipped, restored = 0, 0, 0
        with get_db() as conn:
            with conn.cursor() as cur:
                for m in musicas:
                    cifra  = campo_backup(m, 'cifra_tradicional', 'cifra_json')
                    tabela = campo_backup(m, 'tabela', 'tabela_json')
                    tags   = campo_backup(m, 'tags', 'tags')
                    cur.execute("SELECT cifra_json, tabela_json FROM musicas WHERE id=%s", (m['id'],))
                    row = cur.fetchone()
                    if row:
                        # Preenche só o que está vazio no banco; nunca sobrescreve edições
                        sets = {}
                        if cifra and not json.loads(row['cifra_json'] or '[]'):
                            sets['cifra_json'] = json.dumps(cifra, ensure_ascii=False)
                        if tabela and not json.loads(row['tabela_json'] or '[]'):
                            sets['tabela_json'] = json.dumps(tabela, ensure_ascii=False)
                        if sets:
                            cur.execute(
                                f"UPDATE musicas SET {', '.join(f'{k}=%s' for k in sets)}, atualizado_em=%s WHERE id=%s",
                                (*sets.values(), n, m['id']))
                            restored += 1
                        else:
                            skipped += 1
                        continue
                    cur.execute("""INSERT INTO musicas
                        (id,titulo,artista,tom,tom_original,cifra_json,tabela_json,url_origem,
                         favorito,tags,bpm,duracao_min,notas,criado_em,atualizado_em)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (m['id'], m['titulo'], m['artista'], m.get('tom','C'), m.get('tom_original') or m.get('tom','C'),
                         json.dumps(cifra, ensure_ascii=False),
                         json.dumps(tabela, ensure_ascii=False),
                         m.get('url_origem'), m.get('favorito', False),
                         json.dumps(tags, ensure_ascii=False),
                         m.get('bpm'), m.get('duracao_min'), m.get('notas',''),
                         m.get('criado_em', n), m.get('atualizado_em', n)))
                    imported += 1
                for r in reps:
                    cur.execute("SELECT id FROM repertorios WHERE id=%s", (r['id'],))
                    if cur.fetchone(): continue
                    cur.execute("INSERT INTO repertorios (id,nome,criado_em,atualizado_em) VALUES (%s,%s,%s,%s)",
                                (r['id'], r['nome'], r.get('criado_em', n), r.get('atualizado_em', n)))
                    ids = r.get('musicas_ids') or [
                        x['id'] for x in sorted(r.get('musicas', []), key=lambda x: x.get('posicao', 0))]
                    for i, mid in enumerate(ids):
                        cur.execute("SELECT id FROM musicas WHERE id=%s", (mid,))
                        if cur.fetchone():
                            cur.execute("""INSERT INTO repertorio_musicas (repertorio_id,musica_id,posicao)
                                VALUES (%s,%s,%s) ON CONFLICT DO NOTHING""", (r['id'], mid, i))
            conn.commit()
        return jsonify({'ok': True, 'importadas': imported, 'restauradas': restored, 'puladas': skipped})
    except Exception as e:
        return jsonify({'erro': str(e)}), 400

# ─── QR Code do repertório ─────────────────────────────────────────────────────
@app.route('/api/repertorios/<rid>/qrcode', methods=['GET'])
def qrcode_repertorio(rid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT nome FROM repertorios WHERE id=%s", (rid,))
            rep = cur.fetchone()
            if not rep: return jsonify({'erro': 'Não encontrado'}), 404
            cur.execute("""SELECT m.titulo, m.artista, m.tom FROM repertorio_musicas rm
                JOIN musicas m ON m.id=rm.musica_id WHERE rm.repertorio_id=%s ORDER BY rm.posicao""", (rid,))
            musicas = cur.fetchall()
    linhas = [rep['nome'].upper(), '─' * 30]
    for i, m in enumerate(musicas, 1):
        linhas.append(f"{i:02d}. {m['titulo']} ({m['tom']})")
        linhas.append(f"    {m['artista']}")
    texto = '\n'.join(linhas)
    import qrcode as qr_lib
    qr = qr_lib.QRCode(version=None, error_correction=qr_lib.constants.ERROR_CORRECT_M, box_size=8, border=3)
    qr.add_data(texto); qr.make(fit=True)
    img = qr.make_image(fill_color='#1a1815', back_color='#fbf8f1')
    buf = io.BytesIO(); img.save(buf, format='PNG'); buf.seek(0)
    return send_file(buf, mimetype='image/png')

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

# ─── Inicialização automática (Vercel e outros ambientes sem start.py) ────────
try:
    init_db()
except Exception as _e:
    print(f"[init_db] aviso: {_e}")

# ──────────────────────────────────────────────────────────────────────────────
