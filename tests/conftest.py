import os, re, sqlite3, sys
from contextlib import contextmanager

import pytest

os.environ['DATABASE_URL'] = 'postgresql://teste@127.0.0.1:1/teste'
os.environ['ADMIN_PASSWORD'] = 'senha-de-teste'
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import app as A

ADMIN = {'X-Admin-Password': 'senha-de-teste'}


class Cursor:
    def __init__(self, db):
        self.c = db.cursor()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass

    def execute(self, sql, params=()):
        sql = sql.replace('ADD COLUMN IF NOT EXISTS', 'ADD COLUMN').replace('%s', '?')
        if sql.strip().rstrip(';').count(';'):
            self.c.executescript(sql)
            return
        try:
            self.c.execute(sql, tuple(params))
        except sqlite3.OperationalError as e:
            if 'duplicate column' not in str(e):
                raise

    def fetchone(self):
        return self.c.fetchone()

    def fetchall(self):
        return self.c.fetchall()


@pytest.fixture
def banco(monkeypatch):
    """SQLite em memória no lugar do Postgres; as consultas do app são SQL padrão."""
    db = sqlite3.connect(':memory:')
    db.row_factory = lambda c, r: {d[0]: r[i] for i, d in enumerate(c.description)}
    db.execute('PRAGMA foreign_keys=ON')

    class Conn:
        def cursor(self):
            return Cursor(db)

        def commit(self):
            db.commit()

    @contextmanager
    def get_db():
        yield Conn()

    monkeypatch.setattr(A, 'get_db', get_db)
    A.init_db()
    yield db
    db.close()


@pytest.fixture
def cliente(banco):
    return A.app.test_client()


@pytest.fixture
def criar(cliente):
    def _criar(titulo='Música', **campos):
        d = {'titulo': titulo, 'artista': 'Artista', 'tom': 'G', **campos}
        r = cliente.post('/api/musicas', json=d, headers=ADMIN)
        assert r.status_code == 200
        return r.get_json()['id']
    return _criar
