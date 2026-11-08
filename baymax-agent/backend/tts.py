"""A single local Chatterbox model, serialized inference and browser fallback."""
import asyncio
import io
import logging
import os
from pathlib import Path
from threading import Lock
from contextlib import asynccontextmanager
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
BACKEND = Path(__file__).resolve().parent

class TTSService:
    def __init__(self):
        self.model = None
        self.status = 'not_started'
        self.device = None
        self.error = None
        self.load_lock = Lock()
        self.inference_lock = Lock()
        self.reference = BACKEND / 'baymax_ref.wav'

    def load(self):
        with self.load_lock:
            if self.status != 'not_started':
                return
            if os.getenv('ENABLE_CHATTERBOX', 'true').lower() != 'true':
                self.status = 'disabled'
                return
            self.status = 'loading'
            try:
                import torch
                os.environ.setdefault('HF_HOME', str(BACKEND / '.model-cache'))
                from chatterbox.tts_turbo import ChatterboxTurboTTS
                self.reference = Path(os.getenv('TTS_REFERENCE_PATH') or str(self.reference)).resolve()
                if not self.reference.is_file():
                    raise FileNotFoundError('Voice reference is missing.')
                self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
                self.model = ChatterboxTurboTTS.from_pretrained(device=self.device)
                self.status = 'ready'
                logger.info('Chatterbox Turbo ready on %s', self.device)
            except Exception as exc:
                self.model = None
                self.status = 'unavailable'
                self.error = type(exc).__name__
                logger.warning('Chatterbox could not load (%s); browser speech fallback enabled.', self.error)

    def generate(self, text):
        if self.model is None or self.status != 'ready':
            return None
        # Never queue multiple utterances behind a slow CPU generation.
        if not self.inference_lock.acquire(blocking=False):
            return None
        try:
            import torch
            import torchaudio
            with torch.inference_mode():
                wav = self.model.generate(text, audio_prompt_path=str(self.reference))
            wav = wav.detach().cpu()
            if wav.ndim == 1:
                wav = wav.unsqueeze(0)
            if wav.ndim != 2 or wav.shape[-1] == 0 or not torch.isfinite(wav).all():
                raise ValueError('Invalid generated waveform')
            output = io.BytesIO()
            torchaudio.save(output, wav.clamp(-1, 1), self.model.sr, format='wav', backend='soundfile', encoding='PCM_S', bits_per_sample=16)
            return output.getvalue()
        except Exception as exc:
            logger.warning('Chatterbox generation failed (%s); browser speech fallback enabled.', type(exc).__name__)
            return None
        finally:
            self.inference_lock.release()

service = TTSService()
router = APIRouter()
class SpeechRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)

@router.get('/api/tts/status')
async def tts_status():
    return {'engine': 'chatterbox-turbo', 'status': service.status, 'device': service.device, 'fallback': 'browser', 'error': service.error}

@router.post('/api/tts')
async def tts(request: SpeechRequest):
    if not request.text.strip():
        raise HTTPException(422, 'Text cannot be blank.')
    audio = await asyncio.to_thread(service.generate, request.text.strip())
    if audio:
        return Response(audio, media_type='audio/wav', headers={'Cache-Control': 'no-store', 'X-TTS-Engine': 'chatterbox-turbo'})
    return JSONResponse({'fallback': 'browser', 'reason': service.status if service.status != 'ready' else 'generation_failed_or_busy'}, headers={'Cache-Control': 'no-store'})

@asynccontextmanager
async def tts_lifespan(app):
    # Start once, off the event loop; API remains available while weights load.
    task = asyncio.create_task(asyncio.to_thread(service.load))
    try:
        yield
    finally:
        if not task.done():
            task.cancel()
        await asyncio.gather(task, return_exceptions=True)
