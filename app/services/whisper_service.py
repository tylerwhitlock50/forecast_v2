import httpx
from typing import Optional

class WhisperService:
    """Client for the Whisper ASR web service"""

    def __init__(self, base_url: str = "http://whisper:9000") -> None:
        self.base_url = base_url.rstrip("/")

    async def transcribe(self, audio_bytes: bytes, language: str = "en") -> str:
        """Transcribe audio bytes using the Whisper service."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
            resp = await client.post(f"{self.base_url}/asr?language={language}", files=files)
            resp.raise_for_status()
            data = resp.json()
            return data.get("text", "")

# Global instance for the application
whisper_service = WhisperService()
