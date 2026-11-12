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
