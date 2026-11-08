# BAYMAX verification

Run from `baymax-agent`:

- `.\.venv\Scripts\python.exe -m pytest -q --basetemp=.test-tmp-verify`
- In `frontend`: `npm test`, `npm run build`, and `npx playwright test dashboard.spec.js streamlined.spec.js --project=cpu`.

Automated tests mock outbound notifications and model responses. They do not send live SMS or spend model/product-search credits. The optional SpacetimeDB integration test requires its configured environment.

## Repeatable camera checks

At normal browser zoom, try each case in both good and dim lighting and at two camera distances. Record whether a check-in happened, time to trigger, visibility guidance, and visual confirmation result. Do not simulate an actual dangerous fall.

| Scenario | Expected |
|---|---|
| Stand/sit normally for 20s | No distress check-in |
| Reach for an object or adjust clothing for under 2s | No sustained hold alert |
| Hold hand at chest/abdomen with bent arm for over 2s | A local check-in; visual evidence logged independently |
| Raise hand to face with no head snap | No coughing/sneezing trigger |
| Repeated head bobs while covering mouth for over 2s | Possible cough observation, not a diagnosis |
| Slowly recline then lie horizontally for 15s | Prolonged-lying check-in; not a rapid-fall classification |
| Hide wrists / move feet out of frame | Framing guidance; no fabricated visible joints |
| Briefly leave frame | No fall without preceding drop evidence |
| Interrupt Baymax using Space | Playback stops; microphone opens; stale model result cannot play |
| Disconnect backend while talking | Spoken connection notice; listening resumes |
| Say "send a text" | One request to configured dummy contact; never an emergency-services dispatch |
| Say "do not send a text" | No contact request |
| Reload or restart API | Decision history remains; pending check-in deadline is restored |

With Twilio trial, message content remains the fixed template. Accepted is distinct from delivered. Ambiguous requests are never automatically resent. Do not use a real escalation during routine camera checks; use simulation mode or test mocks.

## Offline pose replay

`node scripts/evaluate-pose.mjs trace.json` accepts timestamped keypoints, optional expected actions, and reports missed/unexpected heuristic triggers. It reads an existing file and does not record images/audio. Synthetic regression tests cover scales, timing, occlusions, slow inference, and degenerate keypoints. Real-world accuracy and confidence calibration remain unmeasured without a labeled video set.

## History and dependencies

Care items remain in SpacetimeDB. Structured decisions and check-in recovery snapshots live locally in `baymax_decisions.sqlite3`, alongside the existing `baymax_decisions.txt`. Older text entries are imported into history once; missing metadata is left blank. These private files are ignored by Git. Browser speech may depend on the browser vendor's online service; denied permissions require user action in the browser. WAV playback uses measured output levels where supported; browser speech uses ambient state animation.
