"""Browser-native speech is used for playback and optional push-to-talk.
No microphone is opened on the server. Transcripts arrive over WebSocket.
"""
import re

def is_acknowledgement(text):
    text = text.lower().replace("’", "'").strip()
    return bool(re.fullmatch(r"(?:i'm|i am|im) (?:okay|ok|fine|safe)[.!]?|(?:yes[, ]+)?(?:i'm|i am) okay[.!]?", text))
