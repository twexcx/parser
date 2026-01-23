from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

app = FastAPI()

app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
def home():
    return FileResponse("index.html")

@app.get("/styles.css")
def css():
    return FileResponse("styles.css")

@app.get("/app.js")
def app_js():
    return FileResponse("app.js")

@app.get("/health")
def health():
    return {"status": "ok"}
