"""ElevenLabs MP3 speech shared by both FastAPI entry points; browser fallback."""
import asyncio
import logging
import os
from threading import Lock
from contextlib import asynccontextmanager
from elevenlabs.client import ElevenLabs
from fastapi import APIRouter,HTTPException
from fastapi.responses import JSONResponse,Response
from pydantic import BaseModel,Field

logger=logging.getLogger(__name__)
class TTSService:
    def __init__(self):
        self.client=None;self.status='not_started';self.error=None;self.voice_id=None
        self.load_lock=Lock();self.inference_lock=Lock()
    def load(self):
        with self.load_lock:
            if self.status!='not_started':return
            key=os.getenv('ELEVENLABS_API_KEY','').strip();self.voice_id=os.getenv('ELEVENLABS_VOICE_ID','').strip()
            if not key:self.status='disabled';return
            if not self.voice_id:self.status='not_configured';return
            try:
                self.client=ElevenLabs(api_key=key,timeout=5)
                self.status='ready'
            except Exception as exc:
                self.status='unavailable';self.error=type(exc).__name__
                logger.warning('ElevenLabs initialization unavailable (%s); browser fallback enabled.',self.error)
    def generate(self,text):
        if self.status!='ready' or self.client is None or not self.inference_lock.acquire(blocking=False):return None
        try:
            chunks=self.client.text_to_speech.convert(voice_id=self.voice_id,text=text,model_id='eleven_flash_v2_5',output_format='mp3_44100_128',request_options={'max_retries':0,'timeout_in_seconds':5})
            audio=b''.join(chunks)
            return audio or None
        except Exception as exc:
            logger.warning('ElevenLabs generation unavailable (%s); browser fallback enabled.',type(exc).__name__)
            return None
        finally:self.inference_lock.release()

service=TTSService()
router=APIRouter()
class SpeechRequest(BaseModel):
    text:str=Field(min_length=1,max_length=500)

@router.get('/api/tts/status')
async def tts_status():
    return {'engine':'elevenlabs','model':'eleven_flash_v2_5','status':service.status,'fallback':'browser','error':service.error}

@router.post('/api/tts')
async def tts(request:SpeechRequest):
    if not request.text.strip():raise HTTPException(422,'Text cannot be blank.')
    audio=await asyncio.to_thread(service.generate,request.text.strip())
    if audio:return Response(audio,media_type='audio/mpeg',headers={'Cache-Control':'no-store','X-TTS-Engine':'elevenlabs'})
    return JSONResponse({'fallback':'browser','reason':service.status if service.status!='ready' else 'generation_failed_or_busy'},headers={'Cache-Control':'no-store'})

@asynccontextmanager
async def tts_lifespan(app):
    # Shared by backend.main and backend.voice_api; no local voice-model loading.
    service.load()
    yield
