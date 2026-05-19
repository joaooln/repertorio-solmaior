# CLAUDE.md

Guia para Claude Code trabalhar neste repositório. O README é a documentação do produto — este arquivo cobre o que não é óbvio só lendo o código.

## O que é

**Repertório Sol Maior** — app web (PWA) para gerenciar cifras de cavaquinho e montar repertórios de show. Single-user, sem autenticação. Veja README.md para a lista completa de funcionalidades.

## Arquitetura em 30 segundos

- **Backend:** um único arquivo `app.py` (Flask) com todas as rotas, helpers de transposição, importação via Gemini, geração de PDF (ReportLab) e QR code. ~940 linhas.
- **Frontend:** `static/app.js` (vanilla JS, ~66 KB) renderiza tudo dinamicamente no `<div id="app-main">`. Sem build step, sem framework, sem bundler.
- **Camada offline:** `static/idb.js` é o wrapper IndexedDB; `static/sw.js` é o Service Worker (cache-first para shell, passa direto para `/api/*`).
- **Banco:** PostgreSQL (Supabase). Três tabelas: `musicas`, `repertorios`, `repertorio_musicas`. Migrações via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` dentro de `init_db()`.
- **IDs:** `gen_id()` retorna os 8 primeiros chars de um UUID4 — IDs curtos em todo lugar (musicas, repertorios).
- **Deploy:** Vercel (`vercel.json` aponta tudo para `app.py`) + cron diário em `/health` para keep-alive do Supabase free tier. Procfile existe para Heroku-like (`gunicorn app:app`).

## Convenções

- **Idioma:** identificadores, rotas e mensagens em **português** (`musicas`, `repertorios`, `transpor`, `criar_musica`, `cifra_tradicional`, `tom_original`). Mantenha o padrão ao adicionar código.
- **JSON em colunas TEXT:** `cifra_json`, `tabela_json`, `tags` são strings JSON serializadas. Sempre `json.dumps(..., ensure_ascii=False)` na escrita e `json.loads(...)` na leitura.
- **Datas:** `now_iso()` (`datetime.utcnow().isoformat()`) é a única fonte de timestamps. Sempre UTC, sempre string ISO.
- **Sem comentários óbvios.** O estilo do código é enxuto; siga o tom.
- **Sem testes.** Não há suíte de testes; mudanças são verificadas rodando o app localmente (`python start.py`).

## Coisas que mordem

- **PostgreSQL é obrigatório** mesmo em dev — não há fallback para SQLite. Sem `DATABASE_URL` o app quebra no boot (mas o `try/except` em `init_db()` no fim do arquivo só loga aviso).
- **`sslmode='require'`** está hardcoded em `get_db()`. Se for usar Postgres local sem SSL, vai precisar ajustar.
- **Modelos Gemini:** `GEMINI_PREFERRED` é uma lista ordenada por preferência (free tier primeiro). `call_gemini()` faz fallback automático em 429/404. Ao adicionar modelos novos, coloque na ordem certa.
- **Transposição:** acontece tanto no backend (`/api/musicas/<id>/transpor`) quanto no frontend (modo apresentação). O regex em `transpoe_linha` cobre acordes complexos (`Cm7/G`, `F#sus4`, etc.) — mexer com cuidado.
- **Service Worker:** ao mudar assets do shell, **incrementar `CACHE_NAME`** em `static/sw.js` (`solmaior-shell-vN`) ou os usuários ficam com a versão antiga em cache.
- **Service Worker NÃO cacheia `/api/*`** — quem cuida do offline para API é o `idb.js` no app.
- **Handler global de exceção** em `app.py` (`handle_exception`) devolve `{"erro": ..., "tipo": ...}` JSON com status 500 — útil para debug no Vercel, mas significa que qualquer exception virou JSON, não 500 HTML.
- **`init_db()` roda no import** do `app.py` (final do arquivo). É necessário porque o Vercel não chama `start.py`. Em dev, `start.py` também chama.
- **Importação em lote** vem do frontend — o backend tem só `/api/musicas/importar` (uma URL por vez). O loop é JS.

## Tarefas comuns

| O que | Onde |
|-------|------|
| Adicionar coluna em `musicas` | `init_db()` em `app.py` — incluir `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` e atualizar INSERT/UPDATE/export |
| Nova rota de API | `app.py` (toda a lógica está lá; siga o padrão `RealDictCursor` + `jsonify`) |
| Mudar layout/estilo | `static/style.css` e/ou `templates/index.html` (shell estático mínimo) |
| Mudar UI dinâmica | `static/app.js` — funções `render*` e `page(nome)` |
| Mudar PDF | rotas `/api/repertorios/<id>/pdf` e `/api/musicas/<id>/pdf` em `app.py` (modos: `completo`, `cifra`, `tabela`, `setlist`) |
| Mexer no modo apresentação/palco | `openApresentacao` e `openPalcoRep` em `static/app.js` (~linha 961+) |

## Rodando localmente

```bash
export DATABASE_URL=postgresql://...   # obrigatório
export GEMINI_API_KEY=AIza...          # opcional (só para importação)
python start.py                         # ou: python app.py
```

`start.py` instala dependências automaticamente, pede a chave Gemini interativamente se faltar, abre o navegador em `http://localhost:5000`.
