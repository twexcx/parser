from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent

app.mount("/static", StaticFiles(directory=BASE_DIR), name="static")

@app.get("/")
def home():
    return FileResponse(BASE_DIR / "index.html")

@app.get("/styles.css")
def css():
    return FileResponse(BASE_DIR / "styles.css")

@app.get("/app.js")
def app_js():
    return FileResponse(BASE_DIR / "app.js")

@app.get("/health")
def health():
    return {"status": "ok"}
