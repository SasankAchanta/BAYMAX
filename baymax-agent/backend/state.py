import asyncio
import time

class SafetyState:
    def __init__(self, emit, alert, seconds=15):
        self.emit, self.alert, self.seconds = emit, alert, seconds
        self.state = "MONITORING"
        self.deadline = None
        self.task = None
        self.reason = None

    def snapshot(self):
        return {"state": self.state, "remaining": max(0, self.deadline-time.monotonic()) if self.deadline else None}

    async def reset(self):
        if self.task and self.task is not asyncio.current_task():
            self.task.cancel()
        self.task = None
        self.deadline = None
        self.state = "MONITORING"
        await self.emit("state", self.snapshot())

    async def anomaly(self, reason):
        if self.state in ("CHECK_IN", "EMERGENCY"):
            return
        self.state, self.reason = "CHECK_IN", reason
        self.deadline = time.monotonic() + self.seconds
        await self.emit("state", self.snapshot())
        await self.emit("speech", {"text": "I detected a possible fall. Are you okay?" if reason == "POSSIBLE_FALL" else "You seem to have slumped at your desk. Are you okay?"})
        self.task = asyncio.create_task(self._countdown())

    async def _countdown(self):
        try:
            while self.deadline and time.monotonic() < self.deadline:
                await asyncio.sleep(min(.25, max(0, self.deadline-time.monotonic())))
            if self.state == "CHECK_IN":
                self.state, self.deadline = "EMERGENCY", None
                await self.emit("state", self.snapshot())
                await self.alert(self.reason)
        except asyncio.CancelledError:
            pass
