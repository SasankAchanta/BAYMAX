from .care_database import save_recommendations
from .demo_contact import notify as notify_demo_contact
import os
from .decision_log import log_decision
from datetime import datetime, timedelta, timezone
import httpx

from .care import CATALOG, catalog_items

class Tools:
    def __init__(self, emit, vision):
        self.emit, self.vision = emit, vision
        self.items = []

    async def trigger_emergency_alert(self, reason):
        result=await notify_demo_contact('SAFETY_ALERT',reason)
        result['reason']=reason
        log_decision('alert',symptoms=reason,next_steps=result['message'])
        await self.emit('alert',result)
        return result

    async def fetch_care_kit_items(self, symptom, items):
        selected = catalog_items(items)
        self.items = selected
        result = {"symptom": symptom, "items": selected, "order_executed": False}
        log_decision("care_kit", symptoms=symptom, items=[i["name"] for i in selected], next_steps="Review only; no purchase executed.")
        await save_recommendations(result,symptom)
        await self.emit("care_kit", result)
        return result

    async def schedule_doctor_followup(self, urgency, notes):
        result = {"mock": True, "title": "Doctor follow-up", "suggested_start": (datetime.now(timezone.utc)+timedelta(days=1)).isoformat(), "urgency": urgency, "notes": notes, "booked": False}
        log_decision("doctor_visit", symptoms=notes, next_steps=f"{urgency} mock follow-up suggested; no appointment booked.")
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
        ("fetch_care_kit_items", "Display specific review-only OTC or first-aid catalog items. Medicines require label/pharmacist suitability checks. Never order.", {"symptom": {"type": "string"}, "items": {"type": "array", "items": {"type": "string", "enum": list(CATALOG)}}}),
        ("schedule_doctor_followup", "Suggest a mock follow-up; no actual booking.", {"urgency": {"type": "string"}, "notes": {"type": "string"}}),
        ("inspect_user_visually", "Inspect the latest camera image; only if user requests visual inspection.", {"question": {"type": "string"}}),
    ]
]
