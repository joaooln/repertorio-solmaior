"""Usa o pacote google-genai de verdade contra um servidor HTTP local que imita a API."""
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import app as A


class ApiFalsa:
    def __init__(self):
        self.modelos = ['gemini-2.5-flash', 'gemini-2.0-flash', 'embedding-001']
        self.respostas = {}  # modelo -> (status, texto)
        self.pedidos = []


@pytest.fixture
def api(monkeypatch):
    estado = ApiFalsa()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def responder(self, status, corpo):
            dados = json.dumps(corpo).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)

        def do_GET(self):
            self.responder(200, {'models': [
                {'name': f'models/{m}',
                 'supportedGenerationMethods': ['embedContent'] if 'embedding' in m else ['generateContent']}
                for m in estado.modelos]})

        def do_POST(self):
            corpo = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            modelo = self.path.split('/models/')[1].split(':')[0]
            estado.pedidos.append((modelo, corpo))
            status, texto = estado.respostas.get(modelo, (200, 'resposta'))
            if status != 200:
                self.responder(status, {'error': {'code': status, 'message': texto, 'status': 'ERRO'}})
            else:
                parts = [{'text': texto}] if texto else []
                self.responder(200, {'candidates': [{'content': {'role': 'model', 'parts': parts}}]})

    srv = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setenv('GEMINI_API_KEY', 'chave-falsa')
    monkeypatch.setenv('GOOGLE_GEMINI_BASE_URL', f'http://127.0.0.1:{srv.server_port}')
    monkeypatch.setattr(A, '_gemini_client', None)
    monkeypatch.setattr(A, '_gemini_models_cache', None)
    yield estado
    srv.shutdown()


def test_descobre_modelos_na_ordem_de_preferencia(api):
    assert A.get_gemini_models() == ['gemini-2.5-flash', 'gemini-2.0-flash']


def test_chamada_simples_sem_busca(api):
    assert A.call_gemini('oi') == 'resposta'
    modelo, corpo = api.pedidos[0]
    assert modelo == 'gemini-2.5-flash'
    assert corpo['contents'][0]['parts'][0]['text'] == 'oi' and 'tools' not in corpo


def test_busca_do_google_vai_no_pedido(api):
    assert A.call_gemini('oi', use_search=True) == 'resposta'
    assert api.pedidos[0][1]['tools'] == [{'googleSearch': {}}]


def test_busca_recusada_tenta_sem_busca_no_mesmo_modelo(api):
    respostas = iter([(400, 'tool not supported'), (200, 'sem busca')])
    orig = api.respostas

    class Sequencia(dict):
        def get(self, modelo, padrao=None):
            return next(respostas)

    api.respostas = Sequencia(orig)
    assert A.call_gemini('oi', use_search=True) == 'sem busca'
    assert [m for m, _ in api.pedidos] == ['gemini-2.5-flash'] * 2
    assert 'tools' in api.pedidos[0][1] and 'tools' not in api.pedidos[1][1]


@pytest.mark.parametrize('status', [429, 503, 404])
def test_troca_de_modelo_sem_cota_ou_inexistente(api, status):
    api.respostas['gemini-2.5-flash'] = (status, 'limite')
    api.respostas['gemini-2.0-flash'] = (200, 'do segundo')
    assert A.call_gemini('oi') == 'do segundo'


def test_resposta_vazia_tenta_o_proximo(api):
    api.respostas['gemini-2.5-flash'] = (200, '')
    api.respostas['gemini-2.0-flash'] = (200, 'do segundo')
    assert A.call_gemini('oi') == 'do segundo'


def test_todos_vazios_da_erro_claro(api):
    api.respostas['gemini-2.5-flash'] = (200, '')
    api.respostas['gemini-2.0-flash'] = (200, '')
    with pytest.raises(ValueError, match='resposta vazia'):
        A.call_gemini('oi')


def test_erro_de_chave_nao_tenta_outros_modelos(api):
    api.respostas['gemini-2.5-flash'] = (403, 'chave inválida')
    with pytest.raises(Exception, match='chave inválida'):
        A.call_gemini('oi')
    assert len(api.pedidos) == 1


def test_importar_por_link_usa_o_gemini(api, cliente, monkeypatch):
    from conftest import ADMIN
    monkeypatch.setattr(A, 'get_web_content', lambda url: 'conteúdo da página')
    api.respostas['gemini-2.5-flash'] = (200, '```json\n' + json.dumps({
        'titulo': 'Bate Coração', 'artista': 'Marinês', 'tom': 'G',
        'cifra_tradicional': [{'secao': 'Verso', 'acordes': 'G  D', 'letra': 'Bate'}], 'tabela': [],
    }) + '\n```')
    r = cliente.post('/api/musicas/importar', json={'url': 'https://exemplo.com/bate'}, headers=ADMIN).get_json()
    assert r['ok'] and cliente.get(f"/api/musicas/{r['id']}").get_json()['cifra_tradicional'][0]['acordes'] == 'G  D'


def test_importar_com_todos_os_modelos_sobrecarregados(api, cliente, monkeypatch):
    from conftest import ADMIN
    monkeypatch.setattr(A, 'get_web_content', lambda url: 'conteúdo da página')
    api.respostas['gemini-2.5-flash'] = (503, 'high demand')
    api.respostas['gemini-2.0-flash'] = (503, 'high demand')
    r = cliente.post('/api/musicas/importar', json={'url': 'https://exemplo.com/x'}, headers=ADMIN)
    assert r.status_code == 503 and 'sobrecarregados' in r.get_json()['erro']
    assert 'UNAVAILABLE' not in r.get_json()['erro'] and len(api.pedidos) == 2


def test_importar_sem_chave(cliente, monkeypatch):
    from conftest import ADMIN
    monkeypatch.delenv('GEMINI_API_KEY', raising=False)
    r = cliente.post('/api/musicas/importar', json={'url': 'https://exemplo.com/x'}, headers=ADMIN)
    assert r.status_code == 400 and 'GEMINI_API_KEY' in r.get_json()['erro']
