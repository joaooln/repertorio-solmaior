# Microserviço de Detecção de Acordes (BTC Model)

Este serviço utiliza o modelo **BTC (Bi-directional Transformer for Chord Recognition)** para analisar o áudio de vídeos do YouTube e extrair a progressão real de acordes segundo a segundo.

## Como hospedar gratuitamente no Hugging Face Spaces:

1. Acesse [huggingface.co/spaces](https://huggingface.co/spaces) e clique em **Create new Space**.
2. Escolha um nome (ex: `solmaior-chord-detector`).
3. Em **Space SDK**, selecione **Docker** (Blank).
4. Em **Space hardware**, deixe o padrão gratuito (**CPU basic · 2 vCPU · 16 GB RAM**).
5. Clique em **Create Space**.
6. Na aba **Files**, suba os 3 arquivos desta pasta:
   - `Dockerfile`
   - `requirements.txt`
   - `app.py`
7. O Hugging Face fará o build do container automaticamente em cerca de 2 minutos.
8. Assim que o status ficar verde (**Running**), copie a URL direta do seu Space (ex: `https://seu-usuario-solmaior-chord-detector.hf.space`).
9. Na **Vercel**, adicione a variável de ambiente:
   - Nome: `CHORD_DETECTOR_URL`
   - Valor: `https://seu-usuario-solmaior-chord-detector.hf.space`
