from .care_database import router as care_database_router
from .checkins import router as checkins_router
from .verification import router as verification_router
"""Voice-only FastAPI entry point; the browser owns camera and microphone."""
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .voice_turn import router
# The shared TTS lifespan initializes ElevenLabs once for this API.
from .tts import router as tts_router, tts_lifespan
load_dotenv(Path(__file__).with_name('.env'))
app = FastAPI(title='Baymax voice API', lifespan=tts_lifespan)
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173','http://127.0.0.1:5173'],allow_methods=['GET','POST'],allow_headers=['Content-Type'])
app.include_router(router)

app.include_router(tts_router)

app.include_router(verification_router)

app.include_router(checkins_router)

app.include_router(care_database_router)

from .decision_log import router as decisions_router
app.include_router(decisions_router)
