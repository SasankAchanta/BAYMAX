import os
from datetime import datetime, timedelta, timezone
import httpx

CATALOG = {
    "tissues": {"name": "Soft facial tissues", "price": 2.99, "guidance": "Single use; dispose after use and wash hands."},
    "bandages": {"name": "Sterile adhesive bandages", "price": 4.99, "guidance": "For small superficial cuts; follow package directions."},
    "saline": {"name": "Sterile saline wound wash", "price": 6.49, "guidance": "External use; follow the product label."},
    "cold pack": {"name": "Reusable cold pack", "price": 8.99, "guidance": "Wrap in a cloth; avoid direct contact with skin."},
    "thermometer": {"name": "Digital thermometer", "price": 9.99, "guidance": "Use according to manufacturer instructions."},
}

class Tools:
    def __init__(self, emit, vision):
        self.emit, self.vision = emit, vision
        self.items = []

    async def trigger_emergency_alert(self, reason):
        result = {"mode": "simulated", "reason": reason, "message": "DUMMY EMERGENCY TRIGGERED — no emergency services contacted"}
        if os.getenv("ENABLE_REAL_ALERTS", "false").lower() == "true":
            sid, token, sender, recipient = [os.getenv(k) for k in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER", "DEMO_EMERGENCY_PHONE")]
            if not all((sid, token, sender, recipient)):
                result["error"] = "Demo SMS configuration incomplete; nothing sent."
            else:
                try:
                    async with httpx.AsyncClient(timeout=15) as client:
                        response = await client.post(f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json", auth=(sid, token), data={"From": sender, "To": recipient, "Body": f"BAYMAX DEMO safety alert: {reason}. This is a prototype test."})
                        response.raise_for_status()
                    result.update(mode="demo_sms", message="Demo SMS sent to configured contact")
                except Exception:
                    result["error"] = "SMS delivery failed; no delivery confirmed."
        await self.emit("alert", result)
        return result

    async def fetch_care_kit_items(self, symptom, items):
        selected = []
        for key in items[:8]:
            if key.lower() in CATALOG:
                selected.append({"id": key.lower(), **CATALOG[key.lower()], "currency": "USD", "price_source": "illustrative mock catalog", "dosage": "Not applicable — non-drug supply", "url": "https://www.fda.gov/consumers/consumer-updates", "order_executed": False})
        self.items = selected
        result = {"symptom": symptom, "items": selected, "order_executed": False}
        await self.emit("care_kit", result)
        return result

    async def schedule_doctor_followup(self, urgency, notes):
        result = {"mock": True, "title": "Doctor follow-up", "suggested_start": (datetime.now(timezone.utc)+timedelta(days=1)).isoformat(), "urgency": urgency, "notes": notes, "booked": False}
        await self.emit("followup", result)
        return result

    async def inspect_user_visually(self, question):
        frame = self.vision.get_current_frame_base64()
        if not frame:
            return {"error": "No camera frame available. Enable the camera first."}
        if not os.getenv("NVIDIA_API_KEY") or not os.getenv("NVIDIA_VISION_MODEL"):
            return {"error": "Configure NVIDIA_API_KEY and NVIDIA_VISION_MODEL to enable visual inspection."}
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=os.environ["NVIDIA_API_KEY"], base_url=os.getenv("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1"), timeout=30)
        try:
            response = await client.chat.completions.create(model=os.environ["NVIDIA_VISION_MODEL"], messages=[{"role": "user", "content": [{"type": "text", "text": "Describe only visible observations, not diagnoses. " + question}, {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,"+frame}}]}], max_tokens=300)
            return {"observation": response.choices[0].message.content}
        finally:
            await client.close()

SCHEMAS = [
    {"type": "function", "function": {"name": name, "description": desc, "parameters": {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}}}
    for name, desc, props in [
        ("fetch_care_kit_items", "Display review-only mock non-drug supplies. Never order.", {"symptom": {"type": "string"}, "items": {"type": "array", "items": {"type": "string", "enum": list(CATALOG)}}}),
        ("schedule_doctor_followup", "Suggest a mock follow-up; no actual booking.", {"urgency": {"type": "string"}, "notes": {"type": "string"}}),
        ("inspect_user_visually", "Inspect the latest camera image; only if user requests visual inspection.", {"question": {"type": "string"}}),
    ]
]
