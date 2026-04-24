# Repertório Sol Maior

Sistema completo de gerenciamento de cifras e repertórios para cavaquinho — com suporte offline, modo apresentação, metrônomo e geração de PDF.

---

## Requisitos

- **Python 3.8+** ([python.org](https://python.org))
- **Chave da API Gemini** para importar cifras via link ([aistudio.google.com](https://aistudio.google.com/app/apikey))
- **Banco de dados PostgreSQL** (ex: [Supabase](https://supabase.com))

---

## Como rodar

### Opção 1 — Script automático (recomendado)

```bash
python start.py
```

Instala dependências automaticamente, pede as credenciais e abre o navegador.

---

### Opção 2 — Manual

```bash
# 1. Instalar dependências
pip install -r requirements.txt

# 2. Definir variáveis de ambiente (Mac/Linux)
export GEMINI_API_KEY=AIza...
export DATABASE_URL=postgresql://...

# Windows
set GEMINI_API_KEY=AIza...
set DATABASE_URL=postgresql://...

# 3. Iniciar
python app.py
```

Acesse em `http://localhost:5000`.

---

## Estrutura de arquivos

```
solmaior/
├── app.py                ← Backend Flask + PostgreSQL
├── start.py              ← Script de inicialização automática
├── requirements.txt      ← Dependências Python
├── vercel.json           ← Configuração de deploy (Vercel)
├── Procfile              ← Configuração Gunicorn
├── templates/
│   └── index.html        ← Shell da aplicação (PWA)
└── static/
    ├── app.js            ← Lógica do frontend
    ├── idb.js            ← Wrapper IndexedDB (cache offline)
    ├── sw.js             ← Service Worker
    ├── manifest.json     ← Manifesto PWA (instalável)
    └── style.css         ← Estilos
```

---

## Funcionalidades

### Banco de Músicas

| Função | Descrição |
|--------|-----------|
| **Importar via link** | Cole uma URL do Cifra Club ou Cifras.com.br — a IA extrai cifra, tabela e tom automaticamente |
| **Importar em lote** | Cole múltiplos links de uma vez; progresso exibido por linha |
| **Adicionar manual** | Crie músicas do zero preenchendo título, artista e tom |
| **Editar** | Título, artista, tom, cifra tradicional, grade de acordes |
| **Transpor** | +1/−1 semitom em toda a cifra e tabela ao mesmo tempo |
| **Favoritas** | Marque músicas com estrela e filtre rapidamente |
| **Tags / estilos** | Categorize por Samba, Forró, Choro, MPB, etc. com chips editáveis |
| **BPM e duração** | Registre o andamento e tempo de cada música |
| **Notas internas** | Campo livre por música para anotações de performance |
| **Busca e filtros** | Filtre por texto, tom, estilo ou favoritas |
| **PDF individual** | Gere PDF de uma única música (cifra, tabela ou completo) |

### Repertórios

| Função | Descrição |
|--------|-----------|
| **Criar e editar** | Monte quantos repertórios quiser (um por evento, por exemplo) |
| **Reordenar** | Arraste as músicas para definir a ordem do show |
| **Duração estimada** | Soma automática do tempo de todas as músicas do repertório |
| **QR Code** | Gera uma imagem PNG com a lista completa para compartilhar |
| **PDF do repertório** | Quatro modos: Completo, Só Cifras, Só Grade e Lista de Palco |

### Modo Apresentação

Aberto a partir de qualquer música, ocupa a tela toda com fonte grande — ideal para usar no palco.

- **Auto-scroll** ajustável por velocidade (barra de range)
- **Metrônomo integrado** com clique sonoro (Web Audio API) e indicador visual pulsante
- **Controles por teclado:** Espaço = play/pause scroll · ↑↓ = scroll manual · Esc = fechar

### Backup

- **Exportar:** baixa toda a biblioteca (músicas + repertórios) como `backup_solmaior.json`
- **Importar:** restaura a partir de um arquivo exportado anteriormente; itens já existentes são pulados automaticamente

### Estatísticas

Aba dedicada com:
- Totais de músicas, favoritas, repertórios e duração acumulada
- Ranking dos artistas mais cadastrados
- Distribuição de músicas por tom
- Nuvem de tags/estilos

---

## Uso Offline (PWA)

O app funciona **sem internet** depois da primeira visita:

1. **Service Worker** faz cache do HTML, CSS e JS — o shell carrega offline imediatamente.
2. **IndexedDB** espelha os dados do servidor localmente — músicas e repertórios ficam disponíveis sem conexão.
3. **Edições offline** (transpor, salvar notas, reordenar) são salvas localmente e sincronizadas automaticamente quando a conexão é restaurada.
4. **Instalável:** navegadores modernos permitem "Adicionar à tela inicial" no iOS/Android ou "Instalar app" no desktop.

> **Limitações offline:** importação via IA e criação de novas músicas requerem internet (o servidor gera os IDs e chama a API Gemini).

---

## Importar cifras

URLs suportadas para importação automática:
```
https://www.cifraclub.com.br/artista/musica/
https://www.cifras.com.br/cifra/artista/musica
```

Se uma música com a mesma URL já existir na biblioteca, o app pergunta se deseja substituir antes de chamar a IA.

---

## Stack técnica

| Camada | Tecnologia |
|--------|-----------|
| Backend | Python · Flask · Gunicorn |
| Banco de dados | PostgreSQL (Supabase) |
| IA | Google Gemini API (extração de cifras) |
| PDF | ReportLab |
| Scraping | BeautifulSoup + Requests |
| Frontend | Vanilla JS · IndexedDB · Web Audio API |
| Offline | Service Worker · Cache API |
| Deploy | Vercel |
