# Repertório Sol Maior

Sistema completo de gerenciamento de cifras e repertórios para cavaquinho — com suporte offline, modo apresentação, metrônomo e geração de PDF.

---

## Requisitos

- **Python 3.11+** ([python.org](https://python.org))
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
| **Importar PDF (Moises)** | Envie um ou vários PDFs de acordes do Moises.ai — cada música abre no editor para revisão antes de salvar (não usa IA) |
| **Editor de cifra** | Prévia ao vivo com acordes alinhados à letra, botões de seção, transposição que preserva o alinhamento, grade gerada a partir da cifra, `Ctrl/⌘+S` para salvar |
| **Adicionar manual** | Crie músicas do zero preenchendo título, artista e tom |
| **Editar** | Título, artista, tom, cifra tradicional, grade de acordes |
| **Transpor** | +1/−1 semitom em toda a cifra e tabela ao mesmo tempo |
| **Favoritas** | Marque músicas com estrela e filtre rapidamente |
| **Tags / estilos** | Categorize por Samba, Forró, Choro, MPB, etc. com chips editáveis |
| **BPM e duração** | Registre o andamento e tempo de cada música |
| **Notas internas** | Campo livre por música para anotações de performance |
| **Busca e filtros** | Filtre por texto, tom, estilo ou favoritas |
| **Duplicadas** | Aviso quando o mesmo título aparece mais de uma vez; escolha a cópia que fica e as outras são juntadas nela (lugar nos repertórios e cifra/grade que faltar) |
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

- **Auto-scroll** ajustável por velocidade (barra de range); para sozinho no fim da música
- **Fonte e velocidade lembradas por música** (guardadas no aparelho)
- **Metrônomo integrado** com clique sonoro (Web Audio API) e indicador visual pulsante
- **Tela sempre acesa** enquanto o modo está aberto
- **Controles por teclado:** Espaço = play/pause scroll · ↑↓ = scroll manual · Esc = fechar

### Modo Palco (Repertório)

Botão **▶ Palco** em cada repertório abre o Modo Apresentação na primeira música e adiciona uma navegação **◀ N/Total ▶** na barra superior para pular entre as músicas do show sem sair da tela cheia.

- **Próxima música** aparece no fim de cada cifra; um toque abre
- **Celular:** deslize para a esquerda/direita para trocar de música
- **Pedal Bluetooth:** PageDown rola a cifra e, no fim dela, passa para a próxima música; ←/→ trocam de música

### Backup

- **Exportar:** baixa toda a biblioteca (músicas + repertórios) como `backup_solmaior.json`
- **Importar:** restaura a partir de um arquivo exportado anteriormente; itens existentes não são sobrescritos (só cifras, grades e repertórios vazios são preenchidos)
- **Cópias automáticas:** o servidor guarda uma cópia por dia (cron do Vercel em `/health`) e outra antes de limpar ou juntar duplicadas, mantendo as 15 mais recentes. Cada uma pode ser baixada ou usada para **Recuperar** músicas e repertórios apagados sem desfazer edições
- **Limpar cifras:** corrige acentos, caracteres invisíveis copiados de sites e linhas de acordes salvas como letra em toda a biblioteca (mostra quais músicas mudam antes de aplicar)

### Estatísticas

Aba dedicada com:
- Totais de músicas, favoritas, repertórios e duração acumulada
- Ranking dos artistas mais cadastrados
- Distribuição de músicas por tom
- Nuvem de tags/estilos

---

## Interface

Layout em duas colunas: **sidebar fixa** (Músicas · Repertórios · Estatísticas + indicador de conexão) e **área principal rolável**. Tema visual com paleta âmbar/midnight, fontes Fraunces (display), DM Sans (corpo) e JetBrains Mono (acordes).

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
| IA | Google Gemini API (extração de cifras) com fallback automático entre modelos |
| PDF | ReportLab |
| Scraping | BeautifulSoup + Requests |
| Frontend | Vanilla JS · IndexedDB · Web Audio API |
| Offline | Service Worker · Cache API |
| Deploy | Vercel (com cron diário em `/health` para keep-alive) |

---

## Variáveis de ambiente

| Variável | Obrigatória | Para quê |
|----------|-------------|----------|
| `DATABASE_URL` | sim | String de conexão PostgreSQL (Supabase) — SSL é forçado |
| `GEMINI_API_KEY` | só para importar via link | Chave do Google AI Studio para a extração de cifras |
