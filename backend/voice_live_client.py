from __future__ import annotations

import asyncio
import base64
import datetime as dt
import json
import logging
import os
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Optional, Set

import websockets  # type: ignore[import]
from azure.identity import DefaultAzureCredential
from websockets import WebSocketClientProtocol  # type: ignore[import]

try:
    from websockets.protocol import State as WebSocketState  # type: ignore[import]
except ImportError:  # pragma: no cover - older websockets versions
    WebSocketState = None  # type: ignore[assignment]

from dotenv import load_dotenv

# Import sentiment analyzer
from sentiment_analyzer import analyze_sentiment

logger = logging.getLogger(__name__)

# Ensure .env from backend root is loaded when module is imported
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)

SYSTEM_INSTRUCTIONS = """
You are an AI Voice Assistant designed to have natural conversations with users. 
You should respond in a friendly, helpful manner and provide accurate information.
When users greet you, respond warmly and ask how you can help them today.
Keep your responses conversational and engaging.

**FORMATTING INSTRUCTIONS:**
- Keep responses natural and conversational for voice interaction
- Avoid overly complex formatting since this is primarily voice-based
- Use clear, well-structured sentences that are easy to understand when spoken
- Be concise but informative in your responses
"""


class VoiceLiveSession:
    """Manage a single Voice Live realtime session and broadcast events to subscribers."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.ws: Optional[WebSocketClientProtocol] = None
        self._listeners: Set[asyncio.Queue] = set()
        self._lock = asyncio.Lock()
        self._receive_task: Optional[asyncio.Task] = None
        self._avatar_future: Optional[asyncio.Future] = None
        self._connected_event = asyncio.Event()
        self._avatar_connected = False  # Track avatar connection state
        self._current_detected_language = None  # Track automatically detected language
        self._language_detection_confidence = 0.0  # Confidence score for language detection
        self._conversation_history = []  # Store conversation for summary generation

        # Configuration from environment variables
        self._endpoint = os.getenv("AZURE_VOICE_LIVE_ENDPOINT")
        self._agent_id = os.getenv("AZURE_VOICE_LIVE_AGENT_ID")
        self._agent_connection_string = os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING")
        self._api_version = os.getenv("AZURE_VOICE_LIVE_API_VERSION")
        
        # Validate required environment variables
        if not self._endpoint:
            raise ValueError("AZURE_VOICE_LIVE_ENDPOINT environment variable is required")
        if not self._agent_id:
            raise ValueError("AZURE_VOICE_LIVE_AGENT_ID environment variable is required")
        if not self._agent_connection_string:
            raise ValueError("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING environment variable is required")
        if not self._api_version:
            raise ValueError("AZURE_VOICE_LIVE_API_VERSION environment variable is required")

        self._session_config = {
            "modalities": ["text", "audio", "avatar"],
            "input_audio_sampling_rate": 24000,
            "turn_detection": {
                "type": "azure_semantic_vad",
                "threshold": 0.3,
                "prefix_padding_ms": 200,
                "silence_duration_ms": 200,
                "remove_filler_words": False,
                "end_of_utterance_detection": {
                    "model": "semantic_detection_v1",
                    "threshold": 0.01,
                    "timeout": 2,
                },
                "auto_language_detection": True,  # Enable automatic language detection
            },
            "input_audio_noise_reduction": {
                "type": "azure_deep_noise_suppression"
            },
            "input_audio_echo_cancellation": {
                "type": "server_echo_cancellation"
            },
            "input_audio_transcription": self._build_transcription_config(),
            "avatar": self._build_avatar_config(),
            "voice": {
                "name": os.getenv("AZURE_TTS_VOICE"),
                "type": "azure-standard",
                "temperature": 0.8,
                "auto_language_matching": True,  # Auto-match voice to detected input language
            },
        }
        
        # Validate TTS voice
        if not self._session_config["voice"]["name"]:
            raise ValueError("AZURE_TTS_VOICE environment variable is required")

    def _ws_is_open(self) -> bool:
        ws = self.ws
        if ws is None:
            return False
        state = getattr(ws, "state", None)
        if state is not None:
            if WebSocketState is not None:
                try:
                    if state == WebSocketState.OPEN:
                        return True
                    if state in {WebSocketState.CLOSING, WebSocketState.CLOSED}:
                        return False
                except TypeError:
                    pass
            state_name = getattr(state, "name", None)
            if isinstance(state_name, str):
                if state_name.upper() == "OPEN":
                    return True
                if state_name.upper() in {"CLOSING", "CLOSED"}:
                    return False
        open_attr = getattr(ws, "open", None)
        if isinstance(open_attr, bool):
            return open_attr
        if callable(open_attr):
            try:
                return bool(open_attr())
            except TypeError:
                pass
        closed_attr = getattr(ws, "closed", None)
        if isinstance(closed_attr, bool):
            return not closed_attr
        if callable(closed_attr):
            try:
                return not bool(closed_attr())
            except TypeError:
                pass
        close_code = getattr(ws, "close_code", None)
        return close_code is None

    async def _ensure_connection(self) -> None:
        if self._ws_is_open():
            return
    def _build_avatar_config(self) -> Dict[str, Any]:
        character = os.getenv("AZURE_VOICE_AVATAR_CHARACTER")
        style = os.getenv("AZURE_VOICE_AVATAR_STYLE")
        video_width_str = os.getenv("AZURE_VOICE_AVATAR_WIDTH")
        video_height_str = os.getenv("AZURE_VOICE_AVATAR_HEIGHT")
        bitrate_str = os.getenv("AZURE_VOICE_AVATAR_BITRATE")
        
        # Validate required avatar configuration
        if not character:
            raise ValueError("AZURE_VOICE_AVATAR_CHARACTER environment variable is required")
        if not style:
            raise ValueError("AZURE_VOICE_AVATAR_STYLE environment variable is required")
        if not video_width_str:
            raise ValueError("AZURE_VOICE_AVATAR_WIDTH environment variable is required")
        if not video_height_str:
            raise ValueError("AZURE_VOICE_AVATAR_HEIGHT environment variable is required")
        if not bitrate_str:
            raise ValueError("AZURE_VOICE_AVATAR_BITRATE environment variable is required")
            
        video_width = int(video_width_str)
        video_height = int(video_height_str)
        bitrate = int(bitrate_str)
        
        config: Dict[str, Any] = {
            "character": character,
            "style": style,
            "customized": False,
            "video": {
                "resolution": {"width": video_width, "height": video_height}, 
                "bitrate": bitrate
            },
        }
        
        ice_urls = os.getenv("AZURE_VOICE_AVATAR_ICE_URLS")
        if ice_urls:
            config["ice_servers"] = [
                {"urls": [url.strip() for url in ice_urls.split(",") if url.strip()]}
            ]
        return config

    def _build_transcription_config(self) -> Dict[str, Any]:
        """
        🌍 Multi-Language Support: Build transcription configuration according to Azure Voice Live API
        Supports three modes:
        1. Automatic multilingual (default) - leave language empty for multilingual model
        2. Single language configuration 
        3. Multilingual configuration with up to 10 defined languages
        """
        # Get language configuration from environment
        languages = os.getenv("AZURE_VOICE_TRANSCRIPTION_LANGUAGES", "")
        transcription_mode = os.getenv("AZURE_VOICE_TRANSCRIPTION_MODE", "auto")  # auto, single, multi
        
        # Extended language mapping including Azure Voice Live supported languages
        language_config = {
            # Multilingual model supported languages (Azure Voice Live default)
            "zh-CN": {"name": "Chinese (China)", "voice": "zh-CN-XiaoxiaoNeural"},
            "en-AU": {"name": "English (Australia)", "voice": "en-AU-NatashaNeural"},
            "en-CA": {"name": "English (Canada)", "voice": "en-CA-ClaraNeural"},
            "en-IN": {"name": "English (India)", "voice": "en-IN-NeerjaNeural"},
            "en-GB": {"name": "English (United Kingdom)", "voice": "en-GB-SoniaNeural"},
            "en-US": {"name": "English (United States)", "voice": "en-US-AriaNeural"},
            "fr-CA": {"name": "French (Canada)", "voice": "fr-CA-SylvieNeural"},
            "fr-FR": {"name": "French (France)", "voice": "fr-FR-DeniseNeural"},
            "de-DE": {"name": "German (Germany)", "voice": "de-DE-KatjaNeural"},
            "hi-IN": {"name": "Hindi (India)", "voice": "hi-IN-SwaraNeural"},
            "it-IT": {"name": "Italian (Italy)", "voice": "it-IT-ElsaNeural"},
            "ja-JP": {"name": "Japanese (Japan)", "voice": "ja-JP-NanamiNeural"},
            "ko-KR": {"name": "Korean (Korea)", "voice": "ko-KR-SunHiNeural"},
            "es-MX": {"name": "Spanish (Mexico)", "voice": "es-MX-DaliaNeural"},
            "es-ES": {"name": "Spanish (Spain)", "voice": "es-ES-ElviraNeural"},
            
            # Additional Indian languages for better regional support
            "ta-IN": {"name": "Tamil (India)", "voice": "ta-IN-PallaviNeural"},
            "te-IN": {"name": "Telugu (India)", "voice": "te-IN-ShrutiNeural"},
            "bn-IN": {"name": "Bengali (India)", "voice": "bn-IN-BashkarNeural"},
            "kn-IN": {"name": "Kannada (India)", "voice": "kn-IN-SapnaNeural"},
            "ml-IN": {"name": "Malayalam (India)", "voice": "ml-IN-SobhanaNeural"},
            "mr-IN": {"name": "Marathi (India)", "voice": "mr-IN-AarohiNeural"},
            "gu-IN": {"name": "Gujarati (India)", "voice": "gu-IN-DhwaniNeural"},
        }
        
        # Build transcription configuration based on mode
        if transcription_mode == "auto" or not languages:
            # Mode 1: Automatic multilingual configuration (default)
            logger.info("🌍 Using automatic multilingual configuration (default)")
            transcription_config = {
                "model": "azure-speech",
                "language": "",  # Empty for automatic multilingual model
                "mode": "automatic_multilingual",
                "supported_languages": [
                    {
                        "code": code,
                        "name": config["name"],
                        "voice": config["voice"]
                    }
                    for code, config in language_config.items()
                    if code in ["zh-CN", "en-AU", "en-CA", "en-IN", "en-GB", "en-US", 
                               "fr-CA", "fr-FR", "de-DE", "hi-IN", "it-IT", "ja-JP", 
                               "ko-KR", "es-MX", "es-ES"]  # Default multilingual model languages
                ]
            }
        else:
            # Parse and validate specified languages
            language_list = [lang.strip() for lang in languages.split(",") if lang.strip()]
            supported_languages = []
            
            # Validate languages (max 10 for multi-language mode)
            if len(language_list) > 10:
                logger.warning("⚠️ Maximum 10 languages supported, truncating list")
                language_list = language_list[:10]
            
            for lang in language_list:
                if lang in language_config:
                    supported_languages.append(lang)
                    logger.info("🌍 Added language support: %s (%s)", 
                              language_config[lang]["name"], lang)
                else:
                    logger.warning("⚠️ Unsupported language code: %s", lang)
            
            # Fallback to default if no valid languages
            if not supported_languages:
                supported_languages = ["en-IN", "hi-IN"]
                logger.info("🌍 No valid languages found, using default: English (India), Hindi (India)")
            
            # Mode 2 or 3: Single or multiple language configuration
            mode = "single_language" if len(supported_languages) == 1 else "multi_language"
            logger.info("🌍 Using %s configuration with %d languages", mode, len(supported_languages))
            
            transcription_config = {
                "model": "azure-speech",
                "language": ",".join(supported_languages),  # Comma-separated for specific languages
                "mode": mode,
                "supported_languages": [
                    {
                        "code": lang,
                        "name": language_config[lang]["name"],
                        "voice": language_config[lang]["voice"]
                    }
                    for lang in supported_languages
                ]
            }
        
        logger.info("🌍 Transcription configured in '%s' mode with %d languages", 
                   transcription_config["mode"], len(transcription_config["supported_languages"]))
        
        return transcription_config

    async def connect(self) -> None:
        async with self._lock:
            if self._ws_is_open():
                return
            
            # Get authentication tokens
            credential = DefaultAzureCredential()
            ai_scopes = "https://ai.azure.com/.default"
            ml_scopes = "https://ml.azure.com/.default"
            
            ai_token = await asyncio.get_event_loop().run_in_executor(
                None, credential.get_token, ai_scopes
            )
            ml_token = await asyncio.get_event_loop().run_in_executor(
                None, credential.get_token, ml_scopes
            )
            
            # Build WebSocket URL  
            logger.info("[%s] Building WebSocket URL from endpoint: %s", self.session_id, self._endpoint)
            logger.info("[%s] API version: %s", self.session_id, self._api_version)
            
            azure_ws_endpoint = self._endpoint.rstrip('/').replace("https://", "wss://")
            logger.info("[%s] WebSocket endpoint: %s", self.session_id, azure_ws_endpoint)
            
            ws_url = (f"{azure_ws_endpoint}/voice-live/realtime"
                     f"?api-version={self._api_version}"
                     f"&agent-connection-string={self._agent_connection_string}"
                     f"&agent-id={self._agent_id}"
                     f"&agent-access-token={ml_token.token}")
            
            logger.info("[%s] Final WebSocket URL: %s", self.session_id, ws_url[:200] + "...")
            
            headers = {
                "x-ms-client-request-id": str(uuid.uuid4()),
                "Authorization": f"Bearer {ai_token.token}"
            }
            
            self.ws = await websockets.connect(ws_url, additional_headers=headers)
            logger.info("[%s] Connected to Azure Voice Live", self.session_id)
            self._receive_task = asyncio.create_task(self._receive_loop())
            
            # Send session update
            await self._send("session.update", {"session": self._session_config}, allow_reconnect=False)
            self._connected_event.set()

    async def disconnect(self) -> None:
        async with self._lock:
            if self._ws_is_open():
                await self.ws.close()
            if self._receive_task:
                self._receive_task.cancel()
            self.ws = None
            self._connected_event.clear()
            logger.info("[%s] Disconnected session", self.session_id)
    
    def get_transcript(self) -> str:
        """
        Get the full conversation transcript as formatted text
        
        Returns:
            Formatted transcript with User/Assistant labels
        """
        if not self._conversation_history:
            return ""
        
        lines = []
        for msg in self._conversation_history:
            role = "User" if msg["role"] == "user" else "Agent"
            lines.append(f"{role}: {msg['content']}")
        
        return "\n\n".join(lines)

    async def _send(
        self,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
        *,
        allow_reconnect: bool = True,
    ) -> None:
        if not self._ws_is_open():
            if allow_reconnect:
                await self.connect()
            if not self._ws_is_open():
                raise RuntimeError("Session websocket is not connected")
        if not self.ws:
            raise RuntimeError("Session websocket is not connected")
        payload = {"event_id": self._generate_id("evt_"), "type": event_type}
        if data:
            payload.update(data)
        await self.ws.send(json.dumps(payload))

    @staticmethod
    def _generate_id(prefix: str) -> str:
        return f"{prefix}{int(dt.datetime.utcnow().timestamp() * 1000)}"
    
    def get_transcript(self) -> str:
        """
        Get the full conversation transcript formatted for summary generation.
        Returns a formatted string with user and assistant messages.
        """
        if not self._conversation_history:
            return ""
        
        transcript_lines = []
        for msg in self._conversation_history:
            role = "Customer" if msg["role"] == "user" else "Agent"
            transcript_lines.append(f"{role}: {msg['content']}")
        
        return "\n\n".join(transcript_lines)

    @staticmethod
    def _encode_client_sdp(client_sdp: str) -> str:
        payload = json.dumps({"type": "offer", "sdp": client_sdp})
        return base64.b64encode(payload.encode("utf-8")).decode("ascii")

    @staticmethod
    def _decode_server_sdp(server_sdp_raw: Optional[str]) -> Optional[str]:
        if not server_sdp_raw:
            return None
        if server_sdp_raw.startswith("v=0"):
            return server_sdp_raw
        try:
            decoded_bytes = base64.b64decode(server_sdp_raw)
        except Exception:
            return server_sdp_raw
        try:
            decoded_text = decoded_bytes.decode("utf-8")
        except Exception:
            return server_sdp_raw
        try:
            payload = json.loads(decoded_text)
        except json.JSONDecodeError:
            return decoded_text
        if isinstance(payload, dict):
            sdp_value = payload.get("sdp")
            if isinstance(sdp_value, str) and sdp_value:
                return sdp_value
        return decoded_text

    def create_event_queue(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._listeners.add(queue)
        return queue

    def remove_event_queue(self, queue: asyncio.Queue) -> None:
        self._listeners.discard(queue)

    async def _broadcast(self, event: Dict[str, Any]) -> None:
        if not self._listeners:
            return
        for queue in list(self._listeners):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning("[%s] Dropping event %s due to slow consumer", self.session_id, event.get("type"))

    async def send_user_message(self, text: str) -> None:
        await self._connected_event.wait()
        await self._ensure_connection()
        await self._send(
            "conversation.item.create",
            {
                "item": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": text}],
                }
            },
        )
        await self._send("response.create")

    async def send_audio_chunk(self, audio_b64: str) -> None:
        await self._connected_event.wait()
        await self._ensure_connection()
        await self._send("input_audio_buffer.append", {"audio": audio_b64})

    async def commit_audio(self) -> None:
        await self._connected_event.wait()
        await self._ensure_connection()
        await self._send("input_audio_buffer.commit")

    async def clear_audio(self) -> None:
        await self._connected_event.wait()
        await self._ensure_connection()
        await self._send("input_audio_buffer.clear")

    async def request_response(self) -> None:
        await self._connected_event.wait()
        await self._ensure_connection()
        await self._send("response.create")

    async def disconnect_avatar(self):
        """Disconnect the avatar and reset connection state."""
        await self._connected_event.wait()
        await self._ensure_connection()
        
        if not self._avatar_connected:
            logger.warning("[%s] Avatar not connected, nothing to disconnect", self.session_id)
            return
        
        logger.info("[%s] Disconnecting avatar", self.session_id)
        await self._send("session.avatar.disconnect", {})
        
        # Reset avatar connection state
        self._avatar_connected = False
        if self._avatar_future and not self._avatar_future.done():
            self._avatar_future.cancel()
            self._avatar_future = None
        
        logger.info("[%s] Avatar disconnected", self.session_id)

    async def connect_avatar(self, client_sdp: str) -> str:
        await self._connected_event.wait()
        await self._ensure_connection()
        
        # Check if avatar is already connected
        if self._avatar_connected:
            logger.warning("[%s] Avatar already connected, returning existing connection", self.session_id)
            raise RuntimeError("Avatar is already connected. Only one avatar connection is allowed per session.")
        
        # Prevent multiple concurrent avatar connections
        if self._avatar_future and not self._avatar_future.done():
            logger.warning("[%s] Avatar connection already in progress, cancelling previous", self.session_id)
            self._avatar_future.cancel()
            
        future: asyncio.Future = asyncio.get_event_loop().create_future()
        self._avatar_future = future
        encoded_sdp = self._encode_client_sdp(client_sdp)
        payload = {
            "client_sdp": encoded_sdp,
            "rtc_configuration": {"bundle_policy": "max-bundle"},
        }
        
        logger.info("[%s] Sending avatar connect request", self.session_id)
        await self._send("session.avatar.connect", payload)
        
        try:
            server_sdp = await asyncio.wait_for(future, timeout=30)
            logger.info("[%s] Avatar SDP negotiation successful", self.session_id)
            self._avatar_connected = True  # Mark avatar as connected
            return server_sdp
        except asyncio.TimeoutError:
            logger.error("[%s] Avatar SDP negotiation timed out after 30 seconds", self.session_id)
            raise RuntimeError("Avatar connection timed out - Azure Voice Live did not respond")
        except asyncio.CancelledError:
            logger.error("[%s] Avatar SDP negotiation was cancelled", self.session_id)
            raise RuntimeError("Avatar connection was cancelled")
        except Exception as e:
            logger.error("[%s] Avatar SDP negotiation failed: %s", self.session_id, str(e))
            raise RuntimeError(f"Avatar connection failed: {str(e)}")
        finally:
            self._avatar_future = None

    async def switch_language(self, language_code: str) -> bool:
        """
        🌍 Switch the active language for voice and transcription
        
        Args:
            language_code: Language code (e.g., 'en-IN', 'hi-IN', 'ta-IN')
            
        Returns:
            bool: True if language switch was successful
        """
        await self._connected_event.wait()
        await self._ensure_connection()
        
        # Get supported languages from transcription config
        transcription_config = self._session_config.get("input_audio_transcription", {})
        supported_languages = transcription_config.get("supported_languages", [])
        
        # Find the language configuration
        language_info = None
        for lang in supported_languages:
            if lang["code"] == language_code:
                language_info = lang
                break
        
        if not language_info:
            logger.error("🌍 Language %s not supported. Available: %s", 
                        language_code, [lang["code"] for lang in supported_languages])
            return False
        
        try:
            # Update voice configuration
            voice_update = {
                "voice": {
                    "name": language_info["voice"],
                    "type": "azure-standard",
                    "temperature": 0.8,
                }
            }
            
            # Update transcription language
            transcription_update = {
                "input_audio_transcription": {
                    "model": "azure-speech",  
                    "language": language_code,
                    "primary_language": language_code
                }
            }
            
            # Send session updates
            await self._send("session.update", {
                "session": {**voice_update, **transcription_update}
            })
            
            # Update local configuration
            self._session_config["voice"]["name"] = language_info["voice"]
            self._session_config["input_audio_transcription"]["language"] = language_code
            
            logger.info("🌍 Language switched to: %s (%s) with voice: %s", 
                       language_info["name"], language_code, language_info["voice"])
            return True
            
        except Exception as e:
            logger.error("🌍 Failed to switch language to %s: %s", language_code, str(e))
            return False

    def get_supported_languages(self) -> list:
        """
        🌍 Get list of supported languages
        
        Returns:
            list: List of language configurations with code, name, and voice
        """
        transcription_config = self._session_config.get("input_audio_transcription", {})
        return transcription_config.get("supported_languages", [])

    def get_current_language(self) -> str:
        """
        🌍 Get the current active language code
        
        Returns:
            str: Current language code (e.g., 'en-IN')
        """
        transcription_config = self._session_config.get("input_audio_transcription", {})
        current_language = transcription_config.get("language", "en-IN")
        
        # If multiple languages are set, return the first one as primary
        if "," in current_language:
            return current_language.split(",")[0].strip()
        
        return current_language

    async def _handle_language_detection(self, detected_language: str, confidence: float) -> None:
        """
        🌍 Handle automatic language detection and switching
        
        Args:
            detected_language: The language code detected by Azure Speech
            confidence: Confidence score (0.0 to 1.0)
        """
        # Update current detected language tracking
        self._current_detected_language = detected_language
        self._language_detection_confidence = confidence
        
        logger.info("🌍 Language detected: %s (confidence: %.2f)", detected_language, confidence)
        
        # Get current voice language
        current_voice_lang = self._session_config["voice"]["name"]
        transcription_config = self._session_config.get("input_audio_transcription", {})
        supported_languages = transcription_config.get("supported_languages", [])
        
        # Find if detected language is supported and different from current
        target_language_info = None
        for lang in supported_languages:
            if lang["code"] == detected_language:
                target_language_info = lang
                break
        
        if target_language_info and current_voice_lang != target_language_info["voice"]:
            # Auto-switch voice to match detected input language
            success = await self._auto_switch_voice_language(detected_language, target_language_info)
            if success:
                await self._broadcast({
                    "type": "language_auto_switched",
                    "from_language": self.get_current_language(),
                    "to_language": detected_language,
                    "language_name": target_language_info["name"],
                    "confidence": confidence,
                    "voice": target_language_info["voice"]
                })
        else:
            logger.debug("🌍 Language %s already active or not supported", detected_language)

    async def _auto_switch_voice_language(self, language_code: str, language_info: dict) -> bool:
        """
        🌍 Automatically switch voice language based on detected input
        
        Args:
            language_code: Language code to switch to
            language_info: Language configuration info
            
        Returns:
            bool: True if switch was successful
        """
        try:
            # Update voice configuration for response
            voice_update = {
                "voice": {
                    "name": language_info["voice"],
                    "type": "azure-standard",
                    "temperature": 0.8,
                }
            }
            
            # Send session update for voice only (keep transcription multi-language)
            await self._send("session.update", {
                "session": voice_update
            })
            
            # Update local voice configuration
            self._session_config["voice"]["name"] = language_info["voice"]
            
            logger.info("🌍 Auto-switched voice to: %s (%s) with voice: %s", 
                       language_info["name"], language_code, language_info["voice"])
            return True
            
        except Exception as e:
            logger.error("🌍 Failed to auto-switch voice to %s: %s", language_code, str(e))
            return False

    def get_detected_language_info(self) -> dict:
        """
        🌍 Get information about the currently detected language
        
        Returns:
            dict: Information about detected language and confidence
        """
        return {
            "detected_language": self._current_detected_language,
            "confidence": self._language_detection_confidence,
            "current_voice_language": self.get_current_language()
        }

    async def _receive_loop(self) -> None:
        ws = self.ws
        if ws is None:
            return
        try:
            async for message in ws:
                try:
                    event = json.loads(message)
                except json.JSONDecodeError:
                    logger.warning("[%s] Failed to decode message", self.session_id)
                    continue
                
                event_type = event.get("type")
                
                if event_type == "error":
                    await self._broadcast({"type": "error", "payload": event})
                elif event_type == "response.audio.delta":
                    await self._broadcast({"type": "assistant_audio_delta", "delta": event.get("delta")})
                elif event_type == "response.audio.done":
                    await self._broadcast({"type": "assistant_audio_done", "payload": event})
                elif event_type == "response.audio_transcript.delta":
                    await self._broadcast(
                        {
                            "type": "assistant_transcript_delta",
                            "delta": event.get("delta"),
                            "item_id": event.get("item_id"),
                        }
                    )
                elif event_type == "response.audio_transcript.done":
                    transcript = event.get("transcript", "")
                    
                    # Store assistant message in conversation history
                    if transcript and len(transcript.strip()) > 0:
                        self._conversation_history.append({
                            "role": "assistant",
                            "content": transcript
                        })
                    
                    await self._broadcast(
                        {
                            "type": "assistant_transcript_done",
                            "transcript": transcript,
                            "item_id": event.get("item_id"),
                        }
                    )
                elif event_type == "conversation.item.input_audio_transcription.completed":
                    transcript = event.get("transcript", "")
                    transcript_data = {
                        "type": "user_transcript_completed",
                        "transcript": transcript,
                        "item_id": event.get("item_id"),
                    }
                    
                    # Store user message in conversation history
                    if transcript and len(transcript.strip()) > 0:
                        self._conversation_history.append({
                            "role": "user",
                            "content": transcript
                        })
                    
                    # 🌍 Handle automatic language detection
                    detected_language = event.get("detected_language")
                    language_confidence = event.get("language_confidence", 0.0)
                    
                    if detected_language and language_confidence > 0.7:  # High confidence threshold
                        await self._handle_language_detection(detected_language, language_confidence)
                        transcript_data["detected_language"] = detected_language
                        transcript_data["language_confidence"] = language_confidence
                    
                    # 😊 Perform sentiment analysis on user transcript
                    if transcript and len(transcript.strip()) > 0:
                        try:
                            sentiment_result = await analyze_sentiment(transcript)
                            transcript_data["sentiment"] = sentiment_result
                            logger.info(
                                "[%s] Sentiment: %s (%s) | Emotion: %s (%s) %s",
                                self.session_id,
                                sentiment_result.get("sentiment", "unknown"),
                                sentiment_result.get("sentiment_score", 0),
                                sentiment_result.get("emotion", "unknown"),
                                sentiment_result.get("emotion_score", 0),
                                sentiment_result.get("emoji", "")
                            )
                        except Exception as e:
                            logger.warning("[%s] Sentiment analysis failed: %s", self.session_id, str(e))
                    
                    await self._broadcast(transcript_data)
                elif event_type == "input_audio_buffer.speech_started":
                    await self._broadcast({"type": "speech_started"})
                elif event_type == "input_audio_buffer.speech_stopped":
                    await self._broadcast({"type": "speech_stopped"})
                elif event_type == "input_audio_buffer.committed":
                    await self._broadcast({"type": "input_audio_committed"})
                elif event_type == "session.avatar.connecting":
                    logger.info("[%s] Received session.avatar.connecting event", self.session_id)
                    server_sdp = event.get("server_sdp")
                    logger.info("[%s] Raw server_sdp length: %s", self.session_id, len(server_sdp) if server_sdp else "None")
                    decoded_sdp = self._decode_server_sdp(server_sdp)
                    logger.info("[%s] Decoded SDP length: %s", self.session_id, len(decoded_sdp) if decoded_sdp else "None")
                    if self._avatar_future and not self._avatar_future.done():
                        if decoded_sdp is None:
                            logger.error("[%s] Empty server SDP received", self.session_id)
                            self._avatar_future.set_exception(RuntimeError("Empty server SDP"))
                        else:
                            logger.info("[%s] Setting SDP result in future", self.session_id)
                            self._avatar_future.set_result(decoded_sdp)
                    else:
                        logger.warning("[%s] No avatar future waiting for SDP", self.session_id)
                    await self._broadcast({"type": "avatar_connecting"})
                elif event_type == "session.avatar.connected":
                    await self._broadcast({"type": "avatar_connected"})
                elif event_type == "session.avatar.disconnected":
                    logger.info("[%s] Received session.avatar.disconnected event", self.session_id)
                    self._avatar_connected = False  # Reset avatar connection state
                    if self._avatar_future and not self._avatar_future.done():
                        self._avatar_future.cancel()
                        self._avatar_future = None
                    await self._broadcast({"type": "avatar_disconnected"})
                elif event_type == "input_audio_buffer.language_detected":
                    # 🌍 Handle language detection events from Azure Speech
                    detected_lang = event.get("language")
                    confidence = event.get("confidence", 0.0)
                    if detected_lang and confidence > 0.6:
                        await self._handle_language_detection(detected_lang, confidence)
                    await self._broadcast({
                        "type": "language_detected",
                        "language": detected_lang,
                        "confidence": confidence,
                        "payload": event
                    })
                elif event_type == "conversation.item.input_audio_transcription.delta":
                    # Handle real-time transcription with language info
                    transcript_delta = {
                        "type": "user_transcript_delta",
                        "delta": event.get("delta"),
                        "item_id": event.get("item_id"),
                    }
                    # Check for language information in delta
                    if "language" in event:
                        transcript_delta["detected_language"] = event.get("language")
                    await self._broadcast(transcript_delta)
                elif event_type == "response.done":
                    await self._broadcast({"type": "response_done", "payload": event})
                else:
                    # 🌍 Log unknown events that might contain language information
                    if "language" in event or "detected" in str(event).lower():
                        logger.info("🌍 Received potential language event: %s", event_type)
                    await self._broadcast({"type": "event", "payload": event})
                    
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("[%s] Azure Voice Live websocket receive loop ended with error", self.session_id)
            await self._broadcast({"type": "error", "payload": {"message": str(exc)}})
        finally:
            if self.ws is ws:
                self.ws = None
            logger.info("[%s] Azure Voice Live websocket closed", self.session_id)