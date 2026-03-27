# 🎸 Repertório Sol Maior

Sistema completo de gerenciamento de cifras e repertórios para cavaquinho.

---

## ✅ Requisitos

- **Python 3.8+** instalado ([python.org](https://python.org))
- **Chave da API Anthropic** (para importar cifras via link)
  - Crie em: [console.anthropic.com](https://console.anthropic.com)

---

## 🚀 Como rodar

### Opção 1 — Script automático (recomendado)

```bash
python start.py
```

O script instala as dependências automaticamente, pede a chave da API e abre o navegador.

---

### Opção 2 — Manual

**1. Instalar dependências:**
```bash
pip install flask anthropic reportlab requests beautifulsoup4 lxml
```

**2. Definir a chave da API:**

- **Windows:**
  ```cmd
  set ANTHROPIC_API_KEY=sk-ant-...
  ```
- **Mac/Linux:**
  ```bash
  export ANTHROPIC_API_KEY=sk-ant-...
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

## 📁 Estrutura de arquivos

```
solmaior/
├── app.py              ← Backend (Flask + SQLite)
├── start.py            ← Script de inicialização
├── solmaior.db         ← Banco de dados (criado automaticamente)
├── templates/
│   └── index.html      ← Interface do sistema
└── README.md
```

O banco de dados `solmaior.db` é criado automaticamente na primeira execução.  
Todos os seus dados (músicas e repertórios) ficam guardados nele.

---

## 🎵 Funcionalidades

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

## 💡 Dica de uso

Para importar, use links no formato:
- `https://www.cifraclub.com.br/artista/musica/`
- `https://www.cifras.com.br/cifra/artista/musica`

---

## 🔒 Seus dados

Todos os dados ficam salvos localmente no arquivo `solmaior.db`.  
Nada é enviado para nuvem (exceto os pedidos à API Anthropic para importar cifras).
