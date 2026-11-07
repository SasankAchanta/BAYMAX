import base64
import threading
import time
from collections import deque

class PoseHeuristic:
    def __init__(self):
        self.history = deque()
        self.classification = {"action": None, "confidence": 0, "available": False}
        self.horizontal_since = None
        self.slump_since = None
        self.fall_until = 0
        self.fallen = False

    def update(self, now, box, points):
        # COCO: nose 0, shoulders 5/6, hips 11/12. Coordinates normalized to frame.
        if any(points[i][2] < .5 for i in (0, 5, 6, 11, 12)):
            self.clear()
            return None
        hip = (points[11][1]+points[12][1])/2
        shoulder = (points[5][1]+points[6][1])/2
        self.history.append((now, hip, float(points[0][1])))
        while self.history and now-self.history[0][0] > 1.5:
            self.history.popleft()
        if self.history and hip-min(p[1] for p in self.history) > .18:
            self.fall_until = now+3
        horizontal = (box[2]-box[0]) > 1.2*(box[3]-box[1])
        self.horizontal_since = (self.horizontal_since if self.horizontal_since is not None else now) if horizontal else None
        confidence = round(min(float(points[i][2]) for i in (0, 5, 6, 11, 12))*100)
        self.classification = {"action": "SITTING", "confidence": confidence, "available": True}
        if not horizontal:
            self.fallen = False
        if self.horizontal_since is not None and now-self.horizontal_since >= 2 and (now < self.fall_until or self.fallen):
            self.fallen = True
            self.classification["action"] = "FALL_DETECTED"
            return "POSSIBLE_FALL"
        stationary = len(self.history)>2 and max(p[2] for p in self.history)-min(p[2] for p in self.history)<.025
        slumped = points[0][1] >= shoulder-.02 and stationary
        self.slump_since = (self.slump_since if self.slump_since is not None else now) if slumped else None
        if self.slump_since is not None and now-self.slump_since >= 10:
            self.classification["action"] = "SLUMPED_AT_DESK"
            return "SLEEPING_AT_DESK"
        # Standing requires visible, extended hip-knee-ankle chains. A torso
        # alone cannot distinguish a seated person from a standing person.
        legs_visible = all(points[i][2] >= .5 for i in (13,14,15,16))
        extended = legs_visible and all(
            points[ankle][1] > points[knee][1] > points[hip_i][1]
            and abs(points[knee][0]-points[hip_i][0]) < .10
            and (points[ankle][1]-points[hip_i][1]) > .20
            for hip_i,knee,ankle in ((11,13,15),(12,14,16)))
        standing = not horizontal and points[0][1] < shoulder-.06 and extended
        if standing:
            self.classification["action"] = "STANDING"
            self.classification["confidence"] = round(min(float(points[i][2]) for i in (0,5,6,11,12,13,14,15,16))*100)
        elif not legs_visible or horizontal:
            self.classification["confidence"] = min(confidence, 49)
        return "STANDING" if standing else None

    def clear(self):
        self.classification = {"action": None, "confidence": 0, "available": False}
        self.history.clear()
        self.horizontal_since = self.slump_since = None
        self.fall_until = 0
        self.fallen = False

class Vision:
    def __init__(self):
        self.jpeg = None
        self.raw_jpeg = None
        self.frame_time = 0
        self.classification = {"action": None, "confidence": 0, "available": False}
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.status = "Camera off · demo mode"
        self.thread = None

    def start(self, callback, index=0):
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, args=(callback,index), daemon=True)
        self.thread.start()

    def _run(self, callback, index):
        cap = None
        try:
            import cv2
            from ultralytics import YOLO
            self.status = "Loading YOLO11 pose model"
            model = YOLO("yolo11n-pose.pt")
            cap = cv2.VideoCapture(index)
            if not cap.isOpened():
                raise RuntimeError("Camera unavailable")
            detector = PoseHeuristic()
            self.status = "YOLO11 pose · camera active"
            while not self.stop_event.is_set():
                ok, frame = cap.read()
                if not ok:
                    raise RuntimeError("Camera frame unavailable")
                result = model(frame, verbose=False)[0]
                event = None
                if result.keypoints is not None and len(result.boxes):
                    # Single-person prototype: largest bounding box only.
                    boxes = result.boxes.xyxy.cpu().numpy()
                    idx = max(range(len(boxes)), key=lambda i: (boxes[i][2]-boxes[i][0])*(boxes[i][3]-boxes[i][1]))
                    h,w = frame.shape[:2]
                    points = result.keypoints.data[idx].cpu().numpy().copy()
                    points[:,0] /= w
                    points[:,1] /= h
                    event = detector.update(time.monotonic(), boxes[idx], points)
                else:
                    detector.clear()
                classification = dict(detector.classification)
                classification["confidence"] = max(0, min(100, classification["confidence"]))
                overlay = result.plot()
                label = f"ACTION: {classification['action']} ({classification['confidence']}%)" if classification['available'] else "ACTION: UNAVAILABLE"
                cv2.putText(overlay, label, (15, 60), cv2.FONT_HERSHEY_SIMPLEX, .65, (160,240,190), 2)
                raw_ok, raw = cv2.imencode('.jpg', frame)
                ok, encoded = cv2.imencode('.jpg', overlay)
                if ok:
                    with self.lock:
                        self.jpeg = encoded.tobytes()
                        self.raw_jpeg = raw.tobytes() if raw_ok else None
                        self.frame_time = time.monotonic()
                        self.classification = classification
                callback({**classification, "event": event})
        except Exception as exc:
            self.status = f"Vision unavailable: {type(exc).__name__}. Check camera and optional dependencies."
        finally:
            with self.lock:
                self.jpeg = self.raw_jpeg = None
                self.classification = {"action": None, "confidence": 0, "available": False}
            if cap is not None:
                cap.release()

    def get_current_frame_base64(self):
        with self.lock:
            return base64.b64encode(self.raw_jpeg).decode() if self.raw_jpeg and time.monotonic()-self.frame_time < 3 else None

    def stop(self):
        self.stop_event.set()
