# BAYMAX — Camera activity monitor

The current app focuses on feature 1: a real webcam preview, browser-local YOLO11 pose + object inference, activity evidence scores, and possible-fall review after **more than 15 continuous seconds lying down**. No Python backend, API key, speech, calendar, Care Kit, or remote visual model is used by this screen.

## Run this feature

```powershell
cd "C:\Users\sacha\OneDrive\Desktop\AI Projects\BAYMAX\baymax-agent\frontend"
npm install
npm run dev
```

Open http://127.0.0.1:5173 and allow camera access. Keep the terminal open. If port 5173 is occupied, use the existing running frontend or stop it with Ctrl+C first. The port is strict to avoid silently starting a second instance.

The webcam starts on page load and remains visible while models initialize. Use **Start camera** to retry permissions, **Stop** to release the camera, or the selector to change cameras. **Test a video** analyzes a local clip with the same detector; it switches off the webcam until Start camera is clicked. Clips do not loop, and source changes reset all activity history. Video inference uses clip time for the lying timer. Hidden tabs reset observation continuity. The optional skeleton aligns with the camera aspect ratio.

## Browser runtime assets

`public/runtime/` contains a matched ort-web 1.30.0 distribution used by the pinned `@ultralytics/yolo` wrapper. Both the CPU and WebGPU paths need their matching `.mjs` / `.wasm` modules, including `ort-wasm-simd-threaded.asyncify.{mjs,wasm}`. Do not mix arbitrary npm ONNX Runtime versions with this wrapper's bridge. Restore all eight assets with `npm run runtime:sync` (requires network access). Vite serves them directly at `/runtime/` and excludes ONNX Runtime and the YOLO wrapper from dependency prebundling. Production builds copy the same directory to `dist/runtime/`.

If a tab previously failed WASM initialization, hard-refresh it with Ctrl+Shift+R after updating the assets; a failed runtime remains cached in that page's JavaScript state. Browser tests run with GPU disabled and GPU allowed, verify automatic CPU fallback if no adapter is available, and verify that runtime URLs return real assets rather than Vite's HTML fallback. A separate test loads the WebGPU JS distribution and performs YOLO inference through its asyncify WASM backend even without a GPU adapter.

## Focus modes

Buttons above the feed select **Full Body**, **Arm / Hand**, or **Face / Head**. The active mode and current action score appear on the video. Mode/source changes reset histories; the camera stays running during mode changes. Fall review only runs in Full Body mode.

- **Full Body:** existing actions plus `SITTING_HEAD_DOWN` after a seated person's visible nose/ears remain near or below shoulder height and stationary for >3 seconds. `LIMPING` uses left/right ankle-to-hip vertical excursion asymmetry in a rolling 2.5-second window, requires walking evidence and enough visible samples. It describes a movement pattern, not an injury diagnosis.
- **Arm / Hand:** shoulder/elbow/wrist overlay; `GUARDING_ARM` after a visible wrist remains near the chest/torso for >1.5 seconds, plus `ARM_RAISED`, `ARMS_RELAXED`, and explicit unclear states. Hips and legs are not required. YOLO pose has wrist landmarks, not individual finger landmarks.
- **Face / Head:** lazily loads local MediaPipe FaceLandmarker with blendshapes enabled. `EYES_CLOSED` requires both blink scores >0.6 continuously for >1.5 seconds. The expression estimate is `HAPPY` for dominant smile, `SAD` for dominant frown/inner-brow evidence, otherwise `NEUTRAL`. The HUD displays expression and heuristic confidence separately from eye closure. These describe facial appearance, not a person's internal mood. Missing face/blendshapes or observation gaps reset the eye timer.

MediaPipe uses a pinned npm version and bundled `face_landmarker.task`; matching WASM assets copy from the installed package on install/build. Everything runs locally without an API key. Face inference is only active in Face / Head mode; its model is cached for later switches.

## What it detects

- **Standing / sitting:** torso and knee geometry from YOLO11 COCO pose keypoints. Show the full body for useful posture labels. Missing joints produce “Unclear / other.”
- **Walking:** hip translation and/or changing foot positions across a short temporal window. Camera movement can affect this heuristic.
- **Using an object:** a portable COCO object (such as a sports ball, cup, phone or book) near a visible wrist for at least 0.4 seconds. This is a proximity inference, not proof of grasping. The object box/name appears on the feed.
- **Lying / resting:** the torso is horizontal. The timer resets when the person stands/sits, disappears, key torso joints are missing, or observations have a >2.5 second gap. A large position/size jump resets person history. This prototype follows the largest visible person; it has no multi-person identity tracking.
- **Possible fall · review:** lying persists for >15 seconds. This does not claim to have witnessed a fall and never calls anyone.
- **Sleep:** not directly classified; lying/resting may include sleep. Pose alone cannot reliably confirm whether a person is asleep.

Scores are deterministic **heuristic evidence scores**, derived from model confidence, joint visibility and motion rules; they are not a trained action model's calibrated probabilities and need not sum to 100. Showing a ball near a hand does not teach YOLO a general-purpose activity vocabulary. Custom actions would require a temporal action model / training data.

Official YOLO11n pose and detection ONNX models are bundled under `frontend/public/models/`. Browser inference runs through `@ultralytics/yolo`; runtime assets are bundled under `public/runtime/` (ort-web 1.30.0), so no CDN calls are needed while the app runs. Frames stay in the browser. Models/runtime retain their upstream licenses; see `frontend/THIRD_PARTY.md`.

## Verify

```powershell
npm test
npm run build
npm run test:browser
```

Browser tests require installed Chrome. They use Chrome's synthetic webcam (not your real camera), then run both real YOLO models on a bundled person-image fixture. They check camera initialization, model inference, detection, stop/restart, and JavaScript errors. Timing and activity rules have separate deterministic tests. Real-world accuracy still requires testing with your actual camera and representative video.


## Previous full-stack prototype (optional, not used by the activity monitor)

# BAYMAX

A local health and safety companion prototype: React HUD, FastAPI/WebSockets, a timed check-in state machine, optional YOLO11 pose monitoring, and NVIDIA Nemotron tool calling. Runs without credentials in clearly labeled demo mode.

## Run locally

Use Python 3.11+ and Node 20+. From the repository root:

```powershell
cd baymax-agent
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
.\.venv\Scripts\python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd baymax-agent/frontend
npm install
npm run dev
```

Open http://localhost:5173. Keep both servers running. Backend API docs: http://127.0.0.1:8000/docs. The UI reconnects automatically. Use `127.0.0.1` or `localhost` on port 5173 (the allowed browser origins).

## Demo walkthrough

1. Click **Simulate fall**: check-in starts with a 15-second countdown. Click **I'm okay** to cancel.
2. Simulate again and wait: an explicitly simulated alert appears in the activity log. Reset to resume monitoring.
3. Type `I have a small cut`: the demo agent asks clarifying questions and displays bandages and saline in the review-only Care Kit.
4. Ask for a doctor follow-up: the log shows a mock suggestion; no appointment is booked.
5. Click **Hey Baymax** for browser push-to-talk. Browser permission and speech recognition support are required; typed input is always available. Speech playback uses browser speech synthesis. Browser speech recognition may process audio through the browser provider; this is not an offline Whisper implementation. No always-listening wake-word loop is enabled.

## Optional integrations

Edit `baymax-agent/backend/.env`, then restart the backend:

- **Nemotron**: set `NVIDIA_API_KEY` and `NVIDIA_MODEL` to a model available to your NVIDIA account that supports tool calls. The specification's model ID is the configurable default, not a guarantee of current availability. Agent tool calls and results are logged; private model reasoning is not displayed.
- **Camera**: install `backend/requirements-vision.txt` and set `ENABLE_CAMERA=true`. YOLO downloads `yolo11n-pose.pt` on first use. The backend opens its local webcam, overlays poses, and streams MJPEG. Camera errors appear in the HUD; no detection is fabricated. Frame rate depends on hardware.
- **Visual inspection**: set an available `NVIDIA_VISION_MODEL` and explicitly ask Baymax to inspect the image. This sends the latest frame to NVIDIA. No frames are saved. Proactive remote visual analysis runs every 6 seconds when `ENABLE_CAMERA=true`, `NVIDIA_API_KEY` and `NVIDIA_VISION_MODEL` are configured. Set `ENABLE_PROACTIVE_VISION=false` to disable it. The configured model must support JSON-object output; invalid responses are rejected and logged without a check-in. Requests run serially, with timeouts and no overlapping calls. Only fresh frames are sent.
- **Demo SMS**: disabled by default. To send test messages only to your configured demo contact, set `ENABLE_REAL_ALERTS=true` plus the Twilio variables. The safety state machine owns alert dispatch; the LLM cannot send an alert. No emergency services are called. Follow-ups are mock only.
- **Care Kit**: structured mock non-drug catalog with illustrative USD prices and general directions; no live pharmacy pricing, personalized doses, purchase endpoint, or actual checkout.

## Validation

```powershell
cd baymax-agent
.\.venv\Scripts\python -m pytest backend/tests -q
cd frontend
npm run build
```

The detector uses COCO keypoint confidence, a rapid hip drop within 1.5 seconds and a horizontal hold longer than 2 seconds, plus a 10-second stationary head/shoulder slump heuristic. Standing or an explicit safe acknowledgement clears a check-in. These are unvalidated heuristics for a single person (largest detected box), and can miss events or generate false alarms. Do not rely on this prototype for medical diagnosis, unattended safety, or emergency response. It does not measure vital signs.

All state is in memory. Run one backend worker on loopback; this local demo has no accounts or durable storage. Camera is off by default. Use the mute control to disable spoken responses. Provider failures are surfaced without claiming a successful result.

Architecture: `backend/state.py` owns escalation; `vision.py` runs camera inference on a worker thread; `agent.py` handles bounded NIM tool loops; `tools.py` exposes review-only care supplies, mock scheduling, visual inspection and demo alerts; `voice.py` checks explicit acknowledgements; `main.py` serves API and event streams. Frontend styles use CSS with responsive layouts.

Integration references: [NVIDIA NIM API](https://docs.nvidia.com/nim/large-language-models/latest/api-reference.html), [YOLO11](https://docs.ultralytics.com/models/yolo11/), [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource).


## Live action classification and proactive observations

Every processed camera frame emits a `pose` WebSocket event with `action`, `confidence` (0–100), and `available`. Labels: `STANDING`, `SITTING`, `SLUMPED_AT_DESK`, `FALL_DETECTED`. No person / insufficient torso keypoints produces `action: null`, `confidence: 0`, `available: false`. The camera overlay and Agent Status show the latest label; the HUD marks it unavailable after three seconds without a pose update. Confidence derives from keypoint visibility and heuristic evidence, **not calibrated action probabilities**. Seated classification with missing legs or ambiguous horizontal posture is capped at 49%. Standing requires visible extended legs.

The optional proactive loop requests JSON with `action`, `confidence`, `is_dangerous`, and `summary`. Supported observations: `coughing`, `sneezing`, `visible_wound`, `looking_sick`, `normal`. A single image cannot reliably establish coughing or illness. At >=75% reported confidence, coughing, looking sick, or a visible wound prompts a symptom question and review-only supplies. This enters `INTERACTIVE_CHECKUP`, not an emergency countdown. It does not interrupt an existing conversation, fall check-in, or emergency. A global 60-second cooldown prevents repeated spoken prompts. `is_dangerous` adds advice to seek urgent help; it does not automatically send SMS. Visual observations appear in the activity panel; pose events do not flood the log. No API key or camera preserves all existing simulation controls.
