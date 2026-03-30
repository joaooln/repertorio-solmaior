#!/usr/bin/env python3
"""
Script de instalação e inicialização do Repertório Sol Maior.
Execute com: python start.py
"""
import subprocess, sys, os, webbrowser, time

DEPS = ["flask", "google-generativeai", "requests", "beautifulsoup4", "lxml", "reportlab", "psycopg2-binary"]

def install():
    print("📦 Instalando dependências...")
    subprocess.check_call([sys.executable, "-m", "pip", "install"] + DEPS + ["-q"])
    print("✅ Dependências instaladas!\n")

def check_deps():
    try:
        import flask, google.generativeai, reportlab
        return True
    except ImportError:
        return False

if __name__ == "__main__":
    if not check_deps():
        install()

    # Verificar chave da API
    if not os.environ.get("GEMINI_API_KEY"):
        print("━" * 50)
        print("⚠️  ATENÇÃO: Chave da API Gemini não encontrada!")
        print("━" * 50)
        print("Para importar cifras via link, você precisa de uma")
        print("chave da API Gemini (Google AI Studio).")
        print()
        key = input("Cole sua chave aqui (ou ENTER para pular): ").strip()
        if key:
            os.environ["GEMINI_API_KEY"] = key
            print("✅ Chave configurada para esta sessão.\n")
            print("💡 Dica: Defina a variável GEMINI_API_KEY no seu sistema")
            print("   para não precisar digitar toda vez.\n")
        else:
            print("⚠️  Importação via link não funcionará sem a chave.\n")

    print("━" * 50)
    print("🎸 Repertório Sol Maior")
    print("━" * 50)
    print("🌐 Abrindo em http://localhost:5000")
    print("   (Pressione Ctrl+C para encerrar)\n")

    # Abrir navegador após 1.5s
    def open_browser():
        time.sleep(1.5)
        webbrowser.open("http://localhost:5000")

    import threading
    threading.Thread(target=open_browser, daemon=True).start()

    # Iniciar Flask
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from app import app, init_db
    init_db()
    app.run(debug=False, port=5000)
