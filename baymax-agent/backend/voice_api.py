"""Voice-only FastAPI entry point; the browser owns camera and microphone."""
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .voice_turn import router
load_dotenv(Path(__file__).with_name('.env'))
app = FastAPI(title='Baymax voice API')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['POST'],allow_headers=['Content-Type'])
app.include_router(router)
