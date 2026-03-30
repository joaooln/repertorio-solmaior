# Repertório Sol Maior

Sistema completo de gerenciamento de cifras e repertórios para cavaquinho.

---

## Requisitos

- **Python 3.8+** instalado ([python.org](https://python.org))
- **Chave da API Gemini** (para importar cifras via link)
  - Crie em: [aistudio.google.com](https://aistudio.google.com/app/apikey)
- **Banco de dados PostgreSQL** (via Supabase ou similar)

---

## Como rodar

### Opção 1 — Script automático (recomendado)

```bash
python start.py
```

O script instala as dependências automaticamente, pede a chave da API e abre o navegador.

---

### Opção 2 — Manual

**1. Instalar dependências:**
```bash
pip install flask google-generativeai reportlab requests beautifulsoup4 lxml psycopg2-binary gunicorn
```

**2. Definir as variáveis de ambiente:**

- **Windows:**
  ```cmd
  set GEMINI_API_KEY=AIza...
  set DATABASE_URL=postgresql://...
  ```
- **Mac/Linux:**
  ```bash
  export GEMINI_API_KEY=AIza...
  export DATABASE_URL=postgresql://...
  ```

**3. Iniciar o servidor:**
```bash
python app.py
```

**4. Abrir no navegador:**
```
http://localhost:5000
```

---

## Estrutura de arquivos

```
solmaior/
├── app.py              ← Backend (Flask + PostgreSQL)
├── start.py            ← Script de inicialização
├── requirements.txt    ← Dependências Python
├── vercel.json         ← Configuração de deploy (Vercel)
├── Procfile            ← Configuração de servidor (Gunicorn)
├── templates/
│   └── index.html      ← Shell da aplicação
└── static/
    ├── app.js          ← Lógica do frontend
    └── style.css       ← Estilos
```

---

## Funcionalidades

### Banco de Músicas
- **Importar via link** — Cole uma URL do Cifra Club ou Cifras.com.br e a IA extrai a cifra automaticamente
- **Adicionar manual** — Crie músicas do zero
- **Editar** — Título, artista, tom, cifra tradicional e tabela de acordes
- **Transpor tom** — +1/−1 semitom com atualização automática de todos os acordes (cifra + tabela)

### Repertórios
- Crie quantos repertórios quiser (um por evento, por exemplo)
- Adicione músicas do banco com busca
- **Reordene arrastando** as músicas na lista
- Renomeie a qualquer momento

### Geração de PDF
Cada repertório gera um PDF com:
- **Capa** com nome do repertório
- **Sumário** com links clicáveis para cada música
- Para cada música: **cifra tradicional** (letra + acordes) em uma página, **tabela de acordes** estilo Victor Cazzoli na página seguinte

---

## Dica de uso

Para importar, use links no formato:
- `https://www.cifraclub.com.br/artista/musica/`
- `https://www.cifras.com.br/cifra/artista/musica`

---

## Dados

Os dados ficam armazenados no banco PostgreSQL configurado em `DATABASE_URL`.
A importação via link envia o conteúdo da página para a API Gemini (Google) para extração da cifra.
