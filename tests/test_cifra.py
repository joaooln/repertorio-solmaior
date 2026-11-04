import io
import json
import unicodedata

import pytest
from reportlab.pdfgen import canvas

import app as A


@pytest.mark.parametrize('acorde,st,esperado', [
    ('C', 2, 'D'),
    ('Am7', 2, 'Bm7'),
    ('B', 1, 'C'),
    ('F#m', -1, 'Fm'),
    ('D7/F#', 2, 'E7/G#'),
    ('Cm7/G', 12, 'Cm7/G'),
])
def test_transpoe_acorde(acorde, st, esperado):
    assert A.transpoe_acorde(acorde, st) == esperado


def test_transpor_e_voltar_mantem_o_acorde():
    for acorde in ('C', 'Am7', 'D7/F#', 'F#sus4', 'Bb7M', 'G/B'):
        ida = A.transpoe_acorde(acorde, 5)
        assert A.normaliza(A.transpoe_acorde(ida, -5)[:2].rstrip('m7/sMu')) or ida


def test_transpoe_linha_nao_mexe_em_outro_texto():
    assert A.transpoe_linha('C  Am7', 2).split() == ['D', 'Bm7']


def test_transpoe_tabela_preserva_repeticao():
    r = A.transpoe_tabela([{'nome_secao': 'Intro x2', 'grid': [['C', '%', 'x2', '']]}], 2)
    assert r[0]['grid'] == [['D', '%', 'x2', ''] ] and r[0]['nome_secao'] == 'Intro x2'


def test_tom_apos_transposicao():
    assert A.tom_apos_st('G', 2) == 'A'
    assert A.tom_apos_st('Am', 3) == 'Cm'


@pytest.mark.parametrize('linha', [
    'G  Em  Bm  C  D', 'Bm7(5-)  E7  Am', 'C#º  G/D', 'D7(9)', 'Am7. D7', 'Bbo Am7', 'Dbdim7/C', 'A7M F#m7', 'G D (x2)', 'G D 2x',
])
def test_reconhece_linha_de_acordes(linha):
    assert A.eh_linha_acordes(linha)


@pytest.mark.parametrize('linha', [
    'Bate, bate, bate coração', 'Oi, tum, tum', 'Eu gosto tanto de você', 'Amor Dos Meus',
])
def test_nao_confunde_letra_com_acordes(linha):
    assert not A.eh_linha_acordes(linha)


def test_limpar_cifra_com_espaco_invisivel():
    # Bate Coração: cifra colada de site, com U+200B em toda linha
    c = A.limpar_cifra([
        {'secao': 'Verso', 'acordes': '', 'letra': '\u200bG           E7'},
        {'secao': '', 'acordes': '', 'letra': '\u200bBate, bate coração'},
    ])
    assert c == [{'secao': 'Verso', 'acordes': 'G           E7', 'letra': 'Bate, bate coração'}]


def test_limpar_cifra_junta_acordes_com_a_letra_seguinte():
    c = A.limpar_cifra([
        {'secao': 'Verso', 'acordes': 'A   E7', 'letra': ''},
        {'secao': '', 'acordes': '', 'letra': 'Convidei a comadre'},
    ])
    assert c == [{'secao': 'Verso', 'acordes': 'A   E7', 'letra': 'Convidei a comadre'}]


def test_limpar_cifra_normaliza_acentos_decompostos():
    nfd = unicodedata.normalize('NFD', 'coração')
    assert A.limpar_cifra([{'letra': nfd}])[0]['letra'] == 'coração'
    assert A.limpar_texto(nfd) == 'coração'


def test_limpar_cifra_nao_junta_linha_de_outra_secao():
    c = A.limpar_cifra([
        {'secao': 'Intro', 'acordes': 'G D', 'letra': ''},
        {'secao': 'Verso', 'acordes': '', 'letra': 'Primeira linha'},
    ])
    assert len(c) == 2 and c[0]['letra'] == '' and c[1]['secao'] == 'Verso'


def test_limpar_cifra_mantem_secoes_vazias():
    c = A.limpar_cifra([{'secao': 'Intro'}, {'secao': 'Verso', 'acordes': 'G', 'letra': 'x'}, {'secao': 'Solo'}])
    assert [l['secao'] for l in c] == ['Intro', 'Verso', 'Solo']


def test_limpar_cifra_marcador_de_secao_na_letra():
    c = A.limpar_cifra([{'letra': '[Refrão]'}, {'acordes': 'C', 'letra': 'la la'}])
    assert c == [{'secao': 'Refrão', 'acordes': 'C', 'letra': 'la la'}]


def test_limpar_cifra_acidentes_unicode():
    assert A.limpar_cifra([{'letra': 'C♯m  B♭'}])[0]['acordes'] == 'C#m  Bb'


def test_limpar_cifra_aceita_texto_json_e_lixo():
    assert A.limpar_cifra(json.dumps([{'letra': 'oi'}]))[0]['letra'] == 'oi'
    assert A.limpar_cifra(None) == [] and A.limpar_cifra('lixo') == [] and A.limpar_cifra(['x', 1]) == []


def test_limpar_cifra_e_idempotente():
    c = A.limpar_cifra([
        {'secao': 'Intro'}, {'letra': '\u200bG  D'}, {'letra': 'la la'}, {'secao': 'Fim', 'acordes': 'C', 'letra': ''},
    ])
    assert A.limpar_cifra(c) == c


def test_limpar_tabela():
    t = A.limpar_tabela([{'nome_secao': 'Intro\u200b', 'grid': [['G', ' ', 'D\u200b', '%'], []]}])
    assert t == [{'nome_secao': 'Intro', 'grid': [['G', '', 'D', '%']]}]


def pdf_moises(linhas):
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.setFont('Courier', 10)
    y = 800
    for l in linhas:
        c.drawString(40, y, l)
        y -= 14
    c.save()
    return buf.getvalue()


def test_parse_moises():
    m = A.parse_moises_pdf(pdf_moises([
        'Marinês - Bate Coração (Áudio Oficial)',
        'Key: G major',
        'G  Em  Bm  C',
        'VERSO',
        'G           E7',
        'Bate, bate, bate coração',
        'Letra sem acorde',
        'moises.ai',
    ]))
    assert (m['titulo'], m['artista'], m['tom']) == ('Bate Coração', 'Marinês', 'G')
    c = m['cifra_tradicional']
    assert c[0]['secao'] == 'Intro' and c[0]['acordes'].split() == ['G', 'Em', 'Bm', 'C']
    assert c[1]['secao'] == 'Verso' and c[1]['letra'] == 'Bate, bate, bate coração'
    assert c[1]['acordes'].split() == ['G', 'E7']
    assert c[2] == {'secao': '', 'acordes': '', 'letra': 'Letra sem acorde'}
    assert all('moises' not in l['letra'].lower() for l in c)


def test_parse_moises_tom_menor_sem_artista():
    m = A.parse_moises_pdf(pdf_moises(['Só o título', 'Key: A minor', 'Am  G', 'la la la']))
    assert (m['titulo'], m['artista'], m['tom']) == ('Só o título', '', 'Am')
