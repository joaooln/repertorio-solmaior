import os
import re
import tempfile
import yt_dlp
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Sol Maior - Detector de Acordes BTC", description="Serviço de reconhecimento automático de acordes a partir de áudio/YouTube")

# Lazy loading do modelo BTC para inicialização rápida
_model = None

def get_model():
    global _model
    if _model is None:
        print("Carregando modelo BTC (puar-playground/btc-chord)...")
        from transformers import AutoModel
        _model = AutoModel.from_pretrained("puar-playground/btc-chord", trust_remote_code=True)
        print("Modelo BTC carregado com sucesso!")
    return _model

def harte_para_cifra(harte_chord: str) -> str:
    """Converte a notação Harte do modelo BTC para o formato popular brasileiro de cifras."""
    if not harte_chord or harte_chord in ("N", "X"):
        return ""
    
    parts = harte_chord.split(":")
    root = parts[0]
    suffix = parts[1] if len(parts) > 1 else ""

    # Mapeamento dos sufixos Harte mais comuns
    suffix_map = {
        "": "",
        "maj": "",
        "min": "m",
        "7": "7",
        "min7": "m7",
        "maj7": "7M",
        "minmaj7": "m(7M)",
        "6": "6",
        "min6": "m6",
        "dim": "°",
        "dim7": "°",
        "hdim7": "m7(b5)",
        "aug": "aug",
        "sus2": "sus2",
        "sus4": "sus4",
        "7sus4": "7sus4",
        "9": "9",
        "min9": "m9",
        "maj9": "7M(9)",
    }

    mod_suffix = suffix_map.get(suffix, suffix)
    return f"{root}{mod_suffix}"

def simplificar_timeline(raw_chords, min_duration=0.3):
    """Filtra ruídos temporais e mescla acordes idênticos consecutivos."""
    if not raw_chords:
        return []

    processed = []
    for item in raw_chords:
        chord_pt = harte_para_cifra(item.get("chord", ""))
        start = round(float(item.get("start", 0)), 2)
        end = round(float(item.get("end", 0)), 2)
        dur = round(end - start, 2)
        
        # Ignora transições imperceptíveis
        if dur < min_duration:
            continue

        if processed and processed[-1]["acorde"] == chord_pt:
            processed[-1]["fim"] = end
            processed[-1]["duracao"] = round(end - processed[-1]["inicio"], 2)
        else:
            processed.append({
                "inicio": start,
                "fim": end,
                "duracao": dur,
                "acorde": chord_pt or "(intro/pausa)"
            })
    return processed

def estimar_tom(timeline):
    """Estima o tom principal com base no acorde mais frequente ou inicial/final."""
    contagem = {}
    for item in timeline:
        ac = item.get("acorde")
        if ac and ac != "(intro/pausa)":
            contagem[ac] = contagem.get(ac, 0) + item.get("duracao", 1)
    if not contagem:
        return "C"
    # Acorde que mais durou ao longo da música
    return max(contagem.items(), key=lambda x: x[1])[0]

class YouTubeRequest(BaseModel):
    url: str

@app.get("/")
def health_check():
    return {
        "status": "online",
        "servico": "Sol Maior - Detector de Acordes BTC",
        "modelo": "puar-playground/btc-chord"
    }

@app.post("/predict_youtube")
def predict_youtube(req: YouTubeRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL inválida")

    with tempfile.TemporaryDirectory() as tmpdir:
        audio_out = os.path.join(tmpdir, "audio.wav")
        
        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': os.path.join(tmpdir, 'download.%(ext)s'),
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'wav',
                'preferredquality': '192',
            }],
            'noplaylist': True,
            'max_filesize': 50 * 1024 * 1024, # máx 50MB
            'quiet': True
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = info.get('title', 'Música do YouTube')
                artist = info.get('artist') or info.get('uploader') or info.get('channel') or 'Artista'
                duration = info.get('duration', 0)

                # Localiza o arquivo .wav gerado
                wav_files = [os.path.join(tmpdir, f) for f in os.listdir(tmpdir) if f.endswith('.wav')]
                if not wav_files:
                    raise Exception("Falha na conversão do áudio para WAV")
                audio_file = wav_files[0]

        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Erro ao baixar áudio do YouTube: {str(e)}")

        # Executa inferência do modelo BTC
        try:
            model = get_model()
            raw_segments = model.predict(audio_file)
            timeline = simplificar_timeline(raw_segments)
            tom = estimar_tom(timeline)
            
            # Lista única de acordes utilizados
            acordes_unicos = []
            for item in timeline:
                ac = item["acorde"]
                if ac != "(intro/pausa)" and ac not in acordes_unicos:
                    acordes_unicos.append(ac)

            return {
                "ok": True,
                "titulo": title,
                "artista": artist,
                "duracao_segundos": duration,
                "tom_estimado": tom,
                "acordes_usados": acordes_unicos,
                "timeline": timeline
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Erro na análise de acordes pelo modelo: {str(e)}")
