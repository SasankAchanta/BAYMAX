# BAYMAX — always-on camera and voice companion

BAYMAX opens directly on **Camera / Activity Monitor**. The webcam and local YOLO11 pose tracking start automatically; allow camera permission in the browser. The right arrow opens the Care Kit database; there is no separate landing dashboard. The cyan/mint interface keeps focus controls, overlays, activity scores, a large live behavior display, a review-only Care Kit and voice controls. The small Baymax icon pulses during speech.

## Run

Use Node 22+ (22.23.4 or newer recommended for SpacetimeDB 2.14) and Python 3.11+ (the supplied environment is Python 3.13).

```powershell
cd "C:\Users\sacha\OneDrive\Desktop\AI Projects\BAYMAX\baymax-agent"
.\.venv\Scripts\python -m pip install -r backend/requirements.txt
.\.venv\Scripts\python -m uvicorn backend.voice_api:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```powershell
cd "C:\Users\sacha\OneDrive\Desktop\AI Projects\BAYMAX\baymax-agent\frontend"
npm install
npm run dev
```

Open http://127.0.0.1:5173. Keep both terminals running. Vite forwards `/api` requests to FastAPI on port 8000. The browser owns the webcam and microphone; the voice-only server does not open them. If a port is occupied, use the existing instance or stop it before restarting. Production hosting must separately route `/api` to FastAPI.

Set these in `baymax-agent/backend/.env` (copy `.env.example` if needed):

```dotenv
NVIDIA_API_KEY=your-key
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b
NVIDIA_VISION_MODEL=nvidia/nemotron-3.5-super-vl-120b-a12b
ENABLE_CHATTERBOX=false
```

Restart FastAPI after configuration changes. Keys remain on the backend and `.env` is excluded from Git. The model IDs must be available to your NVIDIA account. Vision and model assets are local, so ordinary pose tracking still works without API keys; visual verification requires the remote model; local danger check-ins and the demonstration timer work without an API key.

## Care Kit database and shopping links

The **right arrow** in the monitor header opens the saved-items table. The camera, pose analysis and voice loop keep running across navigation. Columns are Name, Price, Reason to buy, and Where to buy. All items and Baymax recommendations can be filtered separately.

The private local **SpacetimeDB 2.14.1** database `baymax-care` is configured and seeded with 15 items, including Tylenol/acetaminophen, ibuprofen/Advil, NyQuil, bandages and walking-boot support. Starter entries are catalog references, not personal treatment recommendations. A cast/boot requires clinician assessment and fitting; medicines retain suitability and ingredient guidance. New care recommendations from `/api/voice-turn` save their reasons automatically, including the initial visual-checkup response. Repeat suggestions update the same item rather than duplicating rows. Separate transactional reducers update recommendation fields and quote fields so a slow shopping request does not overwrite a newer reason.

Keep a third terminal running for the database (the current instance is already running):

```powershell
cd "C:\Users\sacha\OneDrive\Desktop\AI Projects\BAYMAX\baymax-agent"
.\scripts\start-database.ps1
```

The server binds only to `127.0.0.1:3000`; disk data, signing keys, backend identity and CLI configuration stay in the ignored repository `.spacetime/` directory. Tables are private and reducers require the publishing backend identity. The browser uses FastAPI and never receives that token. This is a single-user local prototype; add end-user authentication before exposing FastAPI publicly.

On a fresh checkout, run `scripts/install-database.ps1`, then start the database, then in another terminal:

```powershell
cd spacetimedb
npm ci
cd ..
.\scripts\publish-database.ps1
```

Publishing updates backend `.env` with the local host/database/token; restart FastAPI afterward. Publishing does not clear existing rows. Ordinary restarts only need start-database.ps1 plus FastAPI and Vite. Back up `.spacetime/` if you need to retain the local records and identity.

**Live shopping prices:** the Rainforest API adapter searches Amazon for product names only; symptoms/conversation are not sent. Put a Rainforest key in `baymax-agent/backend/.env`:

```dotenv
RAINFOREST_API_KEY=your-product-search-key
```

Restart FastAPI. New recommendations then trigger background product lookup; **Refresh prices** searches the full catalog. These searches use the provider's credits (up to one search per catalog item on a full refresh); recommendations reuse quotes less than 24 hours old. The table polls for changes and shows matched product title, quote time and direct purchase links. Provider results require a valid USD price, matching item terms and a validated Amazon product identifier. Links open a retailer for manual review; no purchase endpoint exists.

Without a product API account/key, rows show **Price unavailable** with usable Amazon search links. No illustrative catalog price is presented as a live price. Outages preserve prior quotes, mark failed lookups, and expose database connectivity/refresh status. If SpacetimeDB is offline, the UI explicitly shows a catalog preview, and voice responses report unsuccessful database sync rather than pretending the record was saved.

Optional real database verification (creates/removes its own isolated test database):

```powershell
$env:BAYMAX_LIVE_DB_TEST='1'
.\.venv\Scripts\python -m pytest backend/tests/test_spacetime_integration.py -q
Remove-Item Env:BAYMAX_LIVE_DB_TEST
```

API references: [SpacetimeDB HTTP API](https://spacetimedb.com/docs/http/database/), [Rainforest search results](https://docs.trajectdata.com/rainforestapi/product-data-api/results/search).

## Temporal local vision

Only **Upper Body** (default) and **Full Body** are shown. The Current behavior panel includes separate stomach, chest, cough and sneeze rows with observed duration and pending/issue status. Missing wrists produce a framing hint. A 3-second timestamped upper-body joint history measures distances and velocities in torso lengths, using shoulder width × 1.4 when hips are not visible above 0.3 confidence.

- **Chest / abdomen holds:** wrist within 0.35 torso lengths, wrist speed below 0.15 torso lengths/sec, and the requested head/bent-elbow condition, sustained for more than 2 seconds.
- **Sneeze / cough candidates:** hand/elbow near the nose plus a sharp head-motion spike above 1.2 torso lengths/sec. Separated repeated bobs within 3 seconds produce coughing candidates. The hand-to-face episode must persist for more than 2 seconds before verification; these patterns do not establish actual symptoms.
- **Sudden fall:** downward nose and shoulder velocity above 1.8 torso lengths/sec over 0.3–0.6 seconds, completed by immediate keypoint loss or 1 second stationary near the bottom of the frame.
- **Lying timer:** increments when lying evidence is above 20% or torso angle exceeds 55°, decays at 0.15 seconds/sec during uncertainty/occlusion, and resets after 2 seconds continuously upright below 30°. At 15 accumulated seconds it requests verification immediately. Focus switches preserve this timer; camera/source resets and tab suspension clear tracking. Long observation gaps clear motion continuity and slowly decay the lying bucket without counting unseen time.
- **Full-body gait:** the existing 2.5-second hip/ankle window retains limping/hopping detection. Head-down posture is also retained in Full Body mode.

The live video runs at camera frame rate; inference runs continuously at the speed the hardware permits, with one request at a time and no fixed FPS cap. Object detection is sampled roughly every 300 ms to protect pose throughput. CPU inference may be slower than webcam FPS. All confidence scores are heuristic/model evidence scores, not calibrated medical probabilities. Largest-person selection is a single-person prototype, not identity tracking.

## Two-stage verification

1. New upper-body candidates are visible immediately with live timers, but must last more than 2 seconds before verification; LYING_DOWN requires 15 accumulated seconds. These completed temporal events request verification directly. Existing gait/head-down candidates still require a 1.8-second confirmation buffer.
2. The current live webcam frame, action, confidence and concise temporal evidence go to `POST /api/verify-pose`. The VLM must return validated JSON: `action`, `confidence`, `is_dangerous`, `needs_help`, `summary`.
3. Matching actions with >=75% confidence, `is_dangerous=true` and `needs_help=true` confirm the visual candidate. Duplicate check-ins for the same action are suppressed for 60 seconds. Normal/non-dangerous/uncertain results cancel the visual candidate and are logged. Local threshold crossings independently request a brief safety question immediately; they do not wait for the remote model.
4. Source changes, camera stop, tab suspension, recovery from sustained posture candidates, stale results or failed/malformed provider responses do not confirm visual candidates. Local check-ins remain independent. There is at most one request in flight, a 30-second timeout and a per-action cooldown. Provider failures can retry after 15 seconds; completed checks have a 30-second cooldown.

Current behavior shows the active focus mode, large action label, detection confidence and a live description. The compact **Agent Status · Verification** log beneath it shows both stages. Verification events are also available in the browser console. Brief sneeze/cough/drop events may finish while their captured-frame request is pending; they retain their pending check until a response or timeout, unless a new candidate or source change supersedes it. Backend verification outcomes also append to the decision log. A single frame cannot prove a motion pattern or whether someone needs medical assistance; uncertain results remain unconfirmed.

## Voice and noisy-room operation

Idle continuous Web Speech recognition listens for **Hey Baymax** or **Baymax**. Recognition stops during browser speech / optional WAV playback and restarts after playback ends. **Hold Space** to speak and release to send, including after selecting a focus button. Space leaves text inputs, checkboxes and selectors alone. PTT can interrupt Baymax speech but respects Pause / Mute. **End Conversation** returns to wake listening; Pause / Mute stops both speaker and microphone.

Transcripts shorter than two words are ignored unless they are a recognized short answer immediately after a direct yes/no question. The backend repeats this check. Nemotron replies are prompted and bounded to **1–2 spoken sentences**, including the brief disclaimer when used. Speech-recognition permission/service errors are shown instead of repeatedly prompting. Chrome/Edge may require microphone permission or one Resume Voice click before automatic speech/listening can start. Browser speech services may process audio remotely; this is not an offline wake-word engine.

`POST /api/voice-turn` receives the transcript, recent history and current vision context. Symptom-specific checkups may switch focus and capture a fresh frame for visual findings. Frames are not saved. Existing optional Chatterbox `/api/tts` support is parked with ENABLE_CHATTERBOX=false; browser speech remains the default. The local reference WAV and model cache are retained for later and excluded from Git.

## Care Kit and decision log

Practical OTC / first-aid suggestions populate a review-only catalog: wraps, supports, cold packs, saline, bandages, petroleum jelly and conditional OTC options. Medication suitability requires age/allergy/condition/interaction and label/pharmacist checks; no personalized dosing or prescribing. Urgent-care advice is not replaced by routine-care fallbacks. There is no checkout or purchase endpoint.

`baymax_decisions.txt` in the repository root appends timestamped symptoms, visible findings, review items and next steps, including confirmed/cancelled/unavailable visual verification. It uses America/Chicago with timezone offset. This is private local health history and is excluded from Git. Audio, images and private reasoning are not logged. Tests isolate logs in temporary files.

## Verify

```powershell
cd baymax-agent
.\.venv\Scripts\python -m pytest backend/tests -q
cd frontend
npm test
npm run build
npm run test:browser -- --project=cpu
```

Browser tests use a synthetic webcam and controlled speech/provider doubles for pipeline behavior, plus real YOLO inference on public test fixtures. They do not validate clinical accuracy or physical-microphone performance. This prototype is not a medical device or emergency service; do not rely on it for unattended safety or diagnosis.

Runtime assets are bundled under `frontend/public/runtime/` and `public/mediapipe/`. Restore the matched ONNX runtime with `npm run runtime:sync`; MediaPipe assets sync on install/build. See `frontend/THIRD_PARTY.md` for upstream models/libraries. Care references: [FDA OTC safety](https://www.fda.gov/drugs/understanding-over-counter-medicines/safe-use-over-counter-pain-relievers-and-fever-reducers), [NHS sprains](https://www.nhs.uk/conditions/sprains-and-strains/), [AAD minor cuts](https://www.aad.org/public/everyday-care/injured-skin/burns/treat-minor-cuts).


## Sound alerts and one-minute response checks

Web Audio measures microphone RMS in **dBFS** (relative digital amplitude, not calibrated room dB SPL). A two-second background measurement and adaptive floor gate distinct spikes: default absolute threshold -24 dBFS, at least 12 dB over background, 200ms quiet between spikes, and **3 spikes in 10 seconds spanning more than 2 seconds**. The slider adjusts the absolute threshold. A continuous loud sound is one event. Audio samples stay in the browser; only a short sound-event summary is logged. Baymax playback is excluded; muting voice also stops microphone level monitoring. Allow microphone permission and use Enable sound monitoring if browser activation is needed.

Repeated sounds trigger REPEATED_LOUD_SOUNDS, not a definitive sneeze/cough diagnosis. Pose-based cough/sneeze patterns remain available. Crossing a local danger threshold now asks a brief question immediately, even if VLM is unavailable/rejects the visual hypothesis or an ordinary conversation is already in progress. If voice is muted/blocked, the visible check-in and response buttons remain available. Resuming voice repeats the pending question.

The on-screen countdown and `/api/check-ins` backend deadline allow **60 seconds from the danger check-in** for a relevant response. Explicit acknowledgement (yes/no, okay/fine), symptoms or a help request cancel the unanswered-check-in countdown immediately, before a model response. Irrelevant transcripts, muting and End Conversation do not acknowledge a safety question; use the explicit response buttons. Repeated detections cannot extend the deadline. A rejected VLM result does not cancel an already-started local response check.

At timeout, the UI and decision log say **DEMO: authorities-call escalation simulated — no authorities contacted**. There is no emergency dispatch integration and this endpoint never calls Twilio or any other provider. The backend's in-memory deadline continues if the tab is hidden/closed while the API is running; restarting the API loses active deadlines. If the API is unavailable, the browser displays a local demo countdown with a logging warning. No audio recordings are stored.


## Twilio dummy help contact

Database feature work is parked. Safety check-ins can now send a real SMS or place a call **only to your configured dummy help number**. This never dispatches emergency services. Baymax says it will request help from your demo contact, then reports accepted/failed/unconfirmed accurately. Twilio accepting a request does not mean an SMS was delivered or a call was answered.

Set these in `baymax-agent/backend/.env` (not `.env.example`), then restart FastAPI:

```dotenv
ENABLE_REAL_ALERTS=true
TWILIO_ALERT_MODE=sms
TWILIO_ACCOUNT_SID=AC_your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+1_your_twilio_number
DEMO_EMERGENCY_PHONE=+1_your_own_phone_number
```

Use full international E.164 phone numbers (for example a US number is `+1` followed by ten digits). Choose `TWILIO_ALERT_MODE=call` for a voice call that reads a short demo help-request message; no public callback server is required because inline TwiML is sent to Twilio. On a Twilio trial account the recipient usually needs verification, and the sender must support the selected capability. Standard Twilio charges/limits apply.

A danger check-in followed by **60 seconds without a relevant response** triggers the configured contact. A direct **I need help / I'm not okay** response escalates immediately. A safe reply or declining help cancels the unanswered countdown. Saying no to a question about whether you injured a limb is not treated as requesting help. The I need help button uses the same backend pathway; the model is bypassed so its latency does not delay contact. End Conversation or Mute does not acknowledge a pending safety question.

GET `/api/check-ins/config` shows readiness and missing/invalid variable names without exposing credentials or the full destination. One outbound attempt is made per incident. Ambiguous network timeouts are reported as unconfirmed and are not automatically retried. The HUD polls the incident for actual request acceptance/failure. When disabled or credentials are missing, no outbound request is made and Baymax says so. Tests always disable outbound contact by default and mock Twilio for SMS/call checks; no real test call has been placed.
