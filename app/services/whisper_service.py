import httpx
from typing import Optional

class WhisperService:
    """Service for transcribing audio using the Whisper webservice."""

    def __init__(self, base_url: str = "http://whisper:9000"):
        self.base_url = base_url.rstrip("/")

    async def transcribe(self, audio: bytes, filename: str, content_type: str,
                          language: Optional[str] = None, task: str = "transcribe") -> str:
        """Send audio to the Whisper service and return the transcribed text."""
        params = {"task": task, "output": "txt"}
        if language:
            params["language"] = language

        files = {"audio_file": (filename, audio, content_type)}
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(f"{self.base_url}/asr", params=params, files=files)
            if response.status_code != 200:
                raise Exception(f"Whisper API error: {response.status_code} - {response.text}")
            return response.text.strip()


whisper_service = WhisperService()
