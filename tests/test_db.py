"""get_db de verdade (sem a troca por SQLite), com um psycopg2 falso contando conexões."""
import psycopg2
import pytest

import app as A

GET_DB = A.get_db


class Conexao:
    def __init__(self):
        self.closed = False
        self.rollbacks = 0
        self.morta = False

    def cursor(self):
        conn = self

        class Cur:
            def __enter__(self): return self
            def __exit__(self, *a): pass
            def execute(self, sql, params=()):
                if conn.morta: raise psycopg2.OperationalError('conexão caiu')
        return Cur()

    def rollback(self): self.rollbacks += 1
    def commit(self): pass
    def close(self): self.closed = True


@pytest.fixture
def conexoes(monkeypatch):
    abertas = []

    def conectar():
        abertas.append(Conexao())
        return abertas[-1]

    monkeypatch.setattr(A, 'conectar_db', conectar)
    A.descartar_db()
    yield abertas
    A.descartar_db()


def test_reaproveita_a_conexao_e_faz_rollback(conexoes):
    for _ in range(3):
        with GET_DB() as conn:
            pass
    assert len(conexoes) == 1 and conn.rollbacks == 3 and not conn.closed


def test_erro_na_rota_descarta_a_conexao(conexoes):
    with pytest.raises(ValueError):
        with GET_DB():
            raise ValueError('falhou no meio')
    with GET_DB():
        pass
    assert len(conexoes) == 2 and conexoes[0].closed


def test_conexao_ociosa_que_caiu_e_trocada(conexoes, monkeypatch):
    with GET_DB():
        pass
    conexoes[0].morta = True
    with GET_DB():
        pass  # usada há pouco: não testa de novo
    assert len(conexoes) == 1
    monkeypatch.setattr(A, 'DB_OCIOSA_S', -1)
    with GET_DB() as conn:
        pass
    assert len(conexoes) == 2 and conn is conexoes[1] and conexoes[0].closed


def test_conexao_ociosa_viva_continua(conexoes, monkeypatch):
    monkeypatch.setattr(A, 'DB_OCIOSA_S', -1)
    for _ in range(3):
        with GET_DB():
            pass
    assert len(conexoes) == 1


def test_conexao_fechada_e_reaberta(conexoes):
    with GET_DB():
        pass
    conexoes[0].closed = True
    with GET_DB() as conn:
        pass
    assert conn is conexoes[1]


def test_urls_do_pooler_para_host_direto_do_supabase(monkeypatch):
    monkeypatch.delenv('SUPABASE_REGION', raising=False)
    urls = A.urls_pooler('postgresql://postgres:s3nh%40@db.abcdefgh.supabase.co:5432/postgres')
    assert urls == [
        'postgresql://postgres.abcdefgh:s3nh%40@aws-0-us-west-2.pooler.supabase.com:6543/postgres',
        'postgresql://postgres.abcdefgh:s3nh%40@aws-1-us-west-2.pooler.supabase.com:6543/postgres',
    ]
    assert A.urls_pooler('postgresql://u:p@aws-0-us-west-2.pooler.supabase.com:6543/postgres') == []
    assert A.urls_pooler('postgresql://u:p@localhost/x') == [] and A.urls_pooler(None) == []


def test_cai_para_o_pooler_quando_o_host_direto_falha(monkeypatch):
    tentativas = []

    def connect(url, **k):
        tentativas.append(url)
        if 'aws-1' not in url: raise psycopg2.OperationalError('sem rota: ' + url.split('@')[1])
        return Conexao()

    monkeypatch.setattr(A, 'DATABASE_URL', 'postgresql://postgres:x@db.abcdefgh.supabase.co:5432/postgres')
    monkeypatch.setattr(A, '_db_url_ok', None)
    monkeypatch.setattr(A.psycopg2, 'connect', connect)
    A.conectar_db()
    assert [u.split('@')[1].split('.')[0] for u in tentativas] == ['db', 'aws-0-us-west-2', 'aws-1-us-west-2']
    A.conectar_db()
    assert len(tentativas) == 4 and 'aws-1' in tentativas[-1]

    monkeypatch.setattr(A, '_db_url_ok', None)
    monkeypatch.setattr(A.psycopg2, 'connect', lambda url, **k: (_ for _ in ()).throw(psycopg2.OperationalError('caiu ' + url.split('@')[1])))
    with pytest.raises(psycopg2.OperationalError, match='db.abcdefgh'):
        A.conectar_db()
