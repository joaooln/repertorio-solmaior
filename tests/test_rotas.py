import base64
import io
import json

from pypdf import PdfReader

from conftest import ADMIN
from test_cifra import pdf_moises

CIFRA = [{'secao': 'Verso', 'acordes': 'G   D', 'letra': 'Bate coração'}]


def repertorio(cliente, nome='Show', musicas=()):
    rid = cliente.post('/api/repertorios', json={'nome': nome}, headers=ADMIN).get_json()['id']
    cliente.put(f'/api/repertorios/{rid}', json={'musicas': list(musicas)}, headers=ADMIN)
    return rid


def musicas_do_rep(cliente, rid):
    reps = cliente.get('/api/repertorios').get_json()
    return [m['id'] for m in next(r for r in reps if r['id'] == rid)['musicas']]


def test_escrita_exige_senha(cliente):
    assert cliente.post('/api/musicas', json={'titulo': 'x', 'artista': 'y'}).status_code == 401
    assert cliente.post('/api/backups', json={}).status_code == 401
    assert cliente.post('/api/biblioteca/limpar', json={}).status_code == 401


def test_criar_com_mesmo_id_nao_duplica(cliente, criar):
    for _ in range(3):
        criar('Cajueiro', id='abc12345')
    assert len(cliente.get('/api/musicas').get_json()) == 1


def test_salvar_limpa_a_cifra(cliente, criar):
    mid = criar('Corac\u0327a\u0303o', cifra_tradicional=[{'secao': '', 'acordes': '', 'letra': '\u200bG  D'}])
    m = cliente.get(f'/api/musicas/{mid}').get_json()
    assert m['titulo'] == 'Coração' and m['cifra_tradicional'][0]['acordes'] == 'G  D'
    cliente.put(f'/api/musicas/{mid}', json={'cifra_tradicional': [{'letra': '\u200bC  A'}]}, headers=ADMIN)
    assert cliente.get(f'/api/musicas/{mid}').get_json()['cifra_tradicional'][0]['acordes'] == 'C  A'


def test_transpor_e_restaurar_tom(cliente, criar):
    mid = criar(cifra_tradicional=CIFRA, tabela=[{'nome_secao': 'V', 'grid': [['G', '%']]}])
    r = cliente.post(f'/api/musicas/{mid}/transpor', json={'semitones': 2}, headers=ADMIN).get_json()
    m = cliente.get(f'/api/musicas/{mid}').get_json()
    assert r['novo_tom'] == 'A' and m['cifra_tradicional'][0]['acordes'].split() == ['A', 'E']
    assert m['tabela'][0]['grid'] == [['A', '%']] and m['tom_original'] == 'G'
    cliente.post(f'/api/musicas/{mid}/transpor', json={'reset': True}, headers=ADMIN)
    m = cliente.get(f'/api/musicas/{mid}').get_json()
    assert m['tom'] == 'G' and m['cifra_tradicional'][0]['acordes'].split() == ['G', 'D']


def test_limpar_biblioteca_simula_antes_e_guarda_copia(cliente, criar, banco):
    mid = criar('Suja')
    sujo = json.dumps([{'secao': '', 'acordes': '', 'letra': '\u200bG  D'}])
    banco.execute('UPDATE musicas SET cifra_json=? WHERE id=?', (sujo, mid))
    banco.commit()

    sim = cliente.post('/api/biblioteca/limpar', json={'simular': True}, headers=ADMIN).get_json()
    assert sim['alteradas'] == 1 and sim['titulos'] == ['Suja']
    assert json.loads(banco.execute('SELECT cifra_json FROM musicas').fetchone()['cifra_json'])[0]['acordes'] == ''
    assert cliente.get('/api/backups').get_json() == []

    assert cliente.post('/api/biblioteca/limpar', json={}, headers=ADMIN).get_json()['alteradas'] == 1
    assert cliente.get(f'/api/musicas/{mid}').get_json()['cifra_tradicional'][0]['acordes'] == 'G  D'
    assert [b['motivo'] for b in cliente.get('/api/backups').get_json()] == ['antes da limpeza']
    assert cliente.post('/api/biblioteca/limpar', json={}, headers=ADMIN).get_json()['alteradas'] == 0


def test_backup_diario_so_uma_vez_por_dia(cliente, criar):
    criar()
    for _ in range(3):
        assert cliente.get('/health').status_code == 200
    assert [(b['motivo'], b['musicas']) for b in cliente.get('/api/backups').get_json()] == [('diário', 1)]


def test_mantem_15_copias(cliente):
    for _ in range(18):
        cliente.post('/api/backups', json={}, headers=ADMIN)
    assert len(cliente.get('/api/backups').get_json()) == 15


def test_baixar_backup(cliente, criar):
    criar('Guardada')
    cliente.post('/api/backups', json={}, headers=ADMIN)
    bid = cliente.get('/api/backups').get_json()[0]['id']
    r = cliente.get(f'/api/backups/{bid}')
    assert 'backup_solmaior_' in r.headers['Content-Disposition']
    assert json.loads(r.data)['musicas'][0]['titulo'] == 'Guardada'
    assert cliente.get('/api/backups/naoexiste').status_code == 404


def test_recuperar_nao_desfaz_edicao_e_devolve_ao_repertorio(cliente, criar):
    a, b, c = criar('A', cifra_tradicional=CIFRA), criar('B', cifra_tradicional=CIFRA), criar('C', cifra_tradicional=CIFRA)
    rid = repertorio(cliente, musicas=[a, b, c])
    cliente.post('/api/backups', json={}, headers=ADMIN)
    bid = cliente.get('/api/backups').get_json()[0]['id']

    cliente.delete(f'/api/musicas/{b}', headers=ADMIN)
    cliente.put(f'/api/musicas/{a}', json={'notas': 'editada'}, headers=ADMIN)
    cliente.put(f'/api/repertorios/{rid}', json={'musicas': [a]}, headers=ADMIN)

    r = cliente.post(f'/api/backups/{bid}/restaurar', json={}, headers=ADMIN).get_json()
    assert r['importadas'] == 1
    assert cliente.get(f'/api/musicas/{a}').get_json()['notas'] == 'editada'
    # B volta porque foi recuperada; C foi tirada de propósito e continua fora
    assert musicas_do_rep(cliente, rid) == [a, b]


def test_restaurar_preenche_repertorio_e_cifra_vazios(cliente, criar):
    a = criar('A', cifra_tradicional=CIFRA)
    b = criar('B')
    rid = repertorio(cliente)
    arquivo = {
        'musicas': [
            {'id': a, 'titulo': 'A', 'artista': 'X', 'cifra_json': json.dumps([{'letra': 'não sobrescreve'}])},
            {'id': b, 'titulo': 'B', 'artista': 'X', 'cifra_json': json.dumps(CIFRA)},
        ],
        'repertorios': [{'id': rid, 'nome': 'Show', 'musicas': [{'id': b, 'posicao': 0}, {'id': a, 'posicao': 1}]}],
    }
    r = cliente.post('/api/biblioteca/import', json=arquivo, headers=ADMIN).get_json()
    assert (r['importadas'], r['restauradas'], r['puladas'], r['repertorios_restaurados']) == (0, 1, 1, 1)
    assert musicas_do_rep(cliente, rid) == [b, a]
    assert cliente.get(f'/api/musicas/{a}').get_json()['cifra_tradicional'] == CIFRA
    assert cliente.get(f'/api/musicas/{b}').get_json()['cifra_tradicional'] == CIFRA

    r = cliente.post('/api/biblioteca/import', json=arquivo, headers=ADMIN).get_json()
    assert (r['restauradas'], r['repertorios_restaurados']) == (0, 0)


def test_juntar_duplicadas(cliente, criar):
    manter = criar('Igual')
    outra = criar('Igual', cifra_tradicional=CIFRA, tabela=[{'nome_secao': 'V', 'grid': [['G']]}])
    x = criar('Outra')
    rid = repertorio(cliente, musicas=[x, outra])

    r = cliente.post(f'/api/musicas/{manter}/juntar', json={'ids': [outra, manter]}, headers=ADMIN).get_json()
    assert r['juntadas'] == 1
    m = cliente.get(f'/api/musicas/{manter}').get_json()
    assert m['cifra_tradicional'] == CIFRA and m['tabela'][0]['grid'] == [['G']]
    assert cliente.get(f'/api/musicas/{outra}').status_code == 404
    assert musicas_do_rep(cliente, rid) == [x, manter]
    assert cliente.get('/api/backups').get_json()[0]['motivo'] == 'antes de juntar duplicadas'


def test_juntar_alvo_inexistente(cliente):
    assert cliente.post('/api/musicas/nada/juntar', json={'ids': ['x']}, headers=ADMIN).status_code == 404


def test_pdf_da_musica_com_acentos_e_acordes(cliente, criar):
    mid = criar('Corac\u0327a\u0303o', cifra_tradicional=[
        {'secao': 'Verso', 'acordes': '', 'letra': '\u200bG  Am7.'},
        {'secao': '', 'acordes': '', 'letra': 'Bate corac\u0327a\u0303o'},
    ])
    r = cliente.get(f'/api/musicas/{mid}/pdf?modo=cifra')
    assert r.status_code == 200 and r.data.startswith(b'%PDF')
    texto = ''.join(p.extract_text() for p in PdfReader(io.BytesIO(r.data)).pages)
    assert 'coração' in texto.lower() and 'Am7.' in texto and '■' not in texto


def test_importar_pdf_devolve_sem_gravar(cliente):
    dados = pdf_moises(['Marinês - Bate Coração', 'Key: G major', 'G  D', 'Bate coração'])
    r = cliente.post('/api/musicas/importar-pdf', json={'conteudo': base64.b64encode(dados).decode()}, headers=ADMIN)
    assert r.get_json()['titulo'] == 'Bate Coração'
    assert cliente.get('/api/musicas').get_json() == []


def test_importar_pdf_rejeita_outro_arquivo(cliente):
    r = cliente.post('/api/musicas/importar-pdf', json={'conteudo': base64.b64encode(b'nao e pdf').decode()}, headers=ADMIN)
    assert r.status_code == 400
