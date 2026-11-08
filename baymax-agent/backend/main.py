from .care_database import router as care_database_router
from .checkins import router as checkins_router
from .verification import router as verification_router
import asyncio
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from .state import SafetyState
from .vision import Vision
from .tools import Tools
from .agent import Agent, ProactiveVision, proactive_vision_enabled
from .voice import is_acknowledgement
from .voice_turn import router as voice_router
# The shared TTS lifespan initializes ElevenLabs once for this API.
from .tts import router as tts_router, tts_lifespan

load_dotenv(Path(__file__).with_name('.env'))
clients = set()
logs = []
vision = Vision()
chat_lock = asyncio.Lock()

async def emit(kind, data):
    event = {"type": kind, "data": data, "time": datetime.now(timezone.utc).isoformat()}
    if kind != "pose":
        logs.append(event)
        del logs[:-100]
    for socket in tuple(clients):
        try:
            await asyncio.wait_for(socket.send_json(event), timeout=2)
        except Exception:
            clients.discard(socket)

tools = Tools(emit, vision)
safety = SafetyState(emit, tools.trigger_emergency_alert, float(os.getenv("CHECK_IN_SECONDS", "15")))
agent = Agent(tools, emit)

async def vision_event(pose):
    await emit("pose", {k: v for k, v in pose.items() if k != "event"})
    event = pose.get("event")
    if event == "STANDING":
        if safety.state == "CHECK_IN":
            await safety.reset()
    elif event:
        await safety.anomaly(event)

async def proactive_checkin(observation):
    # Health observations start a conversation, not the fall emergency timer.
    if safety.state != "MONITORING" or chat_lock.locked():
        return False
    safety.state = "INTERACTIVE_CHECKUP"
    await emit("state", safety.snapshot())
    action = observation["action"]
    supplies = {"visible_wound": ["bandages", "saline"], "coughing": ["thermometer", "tissues"], "looking_sick": ["thermometer"]}
    questions = {
        "visible_wound": "I may have noticed a visible wound. Are you hurt, and is it bleeding?",
        "coughing": "It looks like you may be coughing. How are you feeling, and when did it start?",
        "looking_sick": "You look like you may be feeling unwell. What symptoms are you experiencing?",
    }
    message = questions[action] + " I've added supplies for review. This is an observation, not a diagnosis."
    if observation["is_dangerous"]:
        message += " If you are in immediate danger, contact local emergency services or someone nearby."
    agent.history.append({"role": "assistant", "content": message})
    await emit("speech", {"text": message})
    await tools.fetch_care_kit_items(action, supplies[action])
    return True

proactive = ProactiveVision(vision, emit, proactive_checkin)

@asynccontextmanager
async def lifespan(app):
    loop = asyncio.get_running_loop()
    task = None
    if os.getenv("ENABLE_CAMERA", "false").lower() == "true":
        def publish(pose):
            # Backpressure prevents unbounded per-frame tasks on a slow client.
            future = asyncio.run_coroutine_threadsafe(vision_event(pose), loop)
            try:
                future.result(timeout=3)
            except Exception:
                future.cancel()
        vision.start(publish, int(os.getenv("CAMERA_INDEX", "0")))
    if proactive_vision_enabled():
        task = asyncio.create_task(proactive.run())
    try:
        async with tts_lifespan(app):
            yield
    finally:
        vision.stop()
        pending = [t for t in (task, safety.task) if t]
        for t in pending:
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


app = FastAPI(title="Baymax safety companion", lifespan=lifespan)
app.include_router(voice_router)
app.include_router(tts_router)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["GET", "POST"], allow_headers=["*"])

@app.get('/health')
async def health():
    return {"ok": True, "agent": "nemotron" if os.getenv("NVIDIA_API_KEY") else "demo", "vision": vision.status, "pose": vision.classification, "proactive_vision": proactive_vision_enabled(), "alerts": "demo_sms" if os.getenv("ENABLE_REAL_ALERTS", "false").lower()=="true" else "simulated", **safety.snapshot()}

@app.get('/video_feed')
async def video_feed():
    async def stream():
        while True:
            with vision.lock:
                frame = vision.jpeg
            if frame:
                yield b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + frame + b'\r\n'
            await asyncio.sleep(.05)
    return StreamingResponse(stream(), media_type='multipart/x-mixed-replace; boundary=frame')

async def chat(text):
    async with chat_lock:
        if safety.state in ("CHECK_IN", "EMERGENCY"):
            if is_acknowledgement(text):
                await safety.reset()
                await emit("speech", {"text": "Thank you for letting me know. I'm here if you need me."})
            else:
                await emit("speech", {"text": "If you need urgent help, contact local emergency services or someone nearby. Say I'm okay only if you are safe."})
            return
        safety.state = "INTERACTIVE_CHECKUP"
        await emit("state", safety.snapshot())
        await emit("user", {"text": text})
        try:
            await agent.reply(text)
        except Exception:
            await emit("error", {"text": "The agent request failed. Check model access, credentials, and connectivity."})
        finally:
            if safety.state == "INTERACTIVE_CHECKUP":
                await safety.reset()

@app.websocket('/ws')
async def websocket(socket: WebSocket):
    if socket.headers.get('origin') not in ('http://localhost:5173', 'http://127.0.0.1:5173'):
        await socket.close(code=1008)
        return
    await socket.accept()
    clients.add(socket)
    tasks = set()
    await socket.send_json({"type": "snapshot", "data": {**safety.snapshot(), "logs": logs, "items": tools.items, "pose": vision.classification, "visual_observation": proactive.latest}})
    try:
        while True:
            raw = await socket.receive_text()
            if len(raw) > 5000:
                continue
            try:
                msg = json.loads(raw)
                action = msg.get('action')
                if action == 'simulate_fall':
                    await safety.anomaly('POSSIBLE_FALL')
                elif action == 'simulate_slump':
                    await safety.anomaly('SLEEPING_AT_DESK')
                elif action in ('reset', 'acknowledge'):
                    await safety.reset()
                elif action == 'chat' and isinstance(msg.get('text'), str) and msg['text'].strip():
                    if len(tasks) >= 2:
                        continue
                    task = asyncio.create_task(chat(msg['text'][:2000]))
                    tasks.add(task)
                    task.add_done_callback(tasks.discard)
            except (ValueError, AttributeError):
                await socket.send_json({"type": "error", "data": {"text": "Invalid message"}})
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(socket)
        for task in tasks:
            task.cancel()

app.include_router(verification_router)

app.include_router(checkins_router)

app.include_router(care_database_router)
