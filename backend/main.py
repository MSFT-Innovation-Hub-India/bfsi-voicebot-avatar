from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Dict

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import requests
from pathlib import Path
from dotenv import load_dotenv
from azure.ai.projects import AIProjectClient
from azure.identity import DefaultAzureCredential

from session_manager import SessionManager
from sentiment_analyzer import load_models as load_sentiment_models
from summarizer import generate_summary
from call_analytics import generate_call_analytics

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


class SessionResponse(BaseModel):
    session_id: str


class AvatarOfferRequest(BaseModel):
    client_sdp: str


class AvatarAnswerResponse(BaseModel):
    server_sdp: str


class TextMessageRequest(BaseModel):
    text: str


class AudioCommitResponse(BaseModel):
    status: str


class ConfigUpdate(BaseModel):
    model: str = "gpt-4o-mini"
    agent_name: str = "voice-agent"
    instructions: str = "You are an AI Voice Assistant designed to have natural conversations with users."
    context: str = ""  # Optional context field for additional information


class ConfigResponse(BaseModel):
    model: str
    agent_name: str
    instructions: str
    agent_id: str = ""


class AgentCreateResponse(BaseModel):
    agent_id: str
    status: str
    message: str = ""


class SummaryRequest(BaseModel):
    session_id: str


class SummaryResponse(BaseModel):
    summary: str
    status: str


class AnalyticsResponse(BaseModel):
    analytics: str
    status: str


session_manager = SessionManager()

# Temporary storage for transcripts after session disconnect
# Key: session_id, Value: transcript text
session_transcripts: Dict[str, str] = {}

# Temporary storage for summaries (used for analytics generation)
# Key: session_id, Value: summary text
session_summaries: Dict[str, str] = {}

# Load environment variables
load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=False)


def read_instructions() -> str:
    """Read instructions from instructions.txt file."""
    instructions_path = Path(__file__).resolve().parents[1] / "instructions.txt"
    
    # Default instructions if file doesn't exist
    default_instructions = "You are an AI Voice Assistant designed to have natural conversations with users."
    
    if not instructions_path.exists():
        return default_instructions
    
    try:
        with open(instructions_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            return content if content else default_instructions
    except Exception as e:
        logger.error(f"Failed to read instructions: {str(e)}")
        return default_instructions


def read_call_history(agent_name: str) -> str:
    """Read call history from appropriate file based on agent name."""
    # Map agent names to call history files
    call_history_map = {
        "Credit-card Re-issue": "call-history-bank.txt",
        "Insurance Claim Re-Submission": "call-history-insurance.txt"
    }
    
    # Check if this agent needs call history
    if agent_name not in call_history_map:
        return ""
    
    history_file = call_history_map[agent_name]
    history_path = Path(__file__).resolve().parents[1] / history_file
    
    if not history_path.exists():
        logger.warning(f"Call history file not found: {history_file}")
        return ""
    
    try:
        with open(history_path, 'r', encoding='utf-8') as f:
            content = f.read().strip()
            if content:
                # Format the call history as knowledge base
                knowledge_base = "\n\n" + "="*80 + "\n"
                knowledge_base += "### 📋 CUSTOMER CALL HISTORY - KNOWLEDGE BASE\n"
                knowledge_base += "="*80 + "\n\n"
                knowledge_base += "**IMPORTANT: The following call history contains previous interactions with this customer.**\n"
                knowledge_base += "**You MUST reference this information when the customer contacts you.**\n"
                knowledge_base += "**After identity verification, acknowledge their previous interactions naturally.**\n\n"
                knowledge_base += content
                knowledge_base += "\n\n" + "="*80 + "\n"
                knowledge_base += "**USE THIS INFORMATION: When the customer mentions their issue, recall the above interactions and provide contextual support.**\n"
                knowledge_base += "="*80 + "\n\n"
                return knowledge_base
            return ""
    except Exception as e:
        logger.error(f"Failed to read call history from {history_file}: {str(e)}")
        return ""


def write_instructions(instructions: str) -> None:
    """Write instructions to instructions.txt file."""
    instructions_path = Path(__file__).resolve().parents[1] / "instructions.txt"
    
    try:
        with open(instructions_path, 'w', encoding='utf-8') as f:
            f.write(instructions)
        logger.info("Instructions saved to instructions.txt")
    except Exception as e:
        logger.error(f"Failed to write instructions.txt: {str(e)}")
        raise


def update_env_file(key: str, value: str) -> None:
    """Update or add a key-value pair in the .env file."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content with UTF-8 encoding
    lines = []
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    # Update or add the key
    updated = False
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}\n"
            updated = True
            break
    
    if not updated:
        lines.append(f"{key}={value}\n")
    
    # Write back to file with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    # Update current environment
    os.environ[key] = value


def batch_update_env_file(updates: Dict[str, str]) -> None:
    """Update multiple key-value pairs in the .env file efficiently."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content with UTF-8 encoding
    lines = []
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    # Update existing keys and track which ones we've updated
    updated_keys = set()
    for i, line in enumerate(lines):
        for key, value in updates.items():
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                updated_keys.add(key)
                break
    
    # Add new keys that weren't found
    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}\n")
    
    # Write back to file with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    # Update current environment
    for key, value in updates.items():
        os.environ[key] = value


def update_env_batch(updates: dict) -> None:
    """Update multiple key-value pairs in the .env file efficiently."""
    env_path = Path(__file__).resolve().parents[1] / ".env"
    
    # Create .env if it doesn't exist
    if not env_path.exists():
        env_path.touch()
    
    # Read existing content with UTF-8 encoding
    lines = []
    if env_path.exists():
        with open(env_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    
    # Update existing keys and track which ones were updated
    updated_keys = set()
    for i, line in enumerate(lines):
        for key, value in updates.items():
            if line.strip().startswith(f"{key}="):
                lines[i] = f"{key}={value}\n"
                updated_keys.add(key)
                break
    
    # Add new keys that weren't found
    for key, value in updates.items():
        if key not in updated_keys:
            lines.append(f"{key}={value}\n")
    
    # Write back to file once with UTF-8 encoding
    with open(env_path, 'w', encoding='utf-8') as f:
        f.writelines(lines)
    
    # Update current environment
    for key, value in updates.items():
        os.environ[key] = value


async def create_azure_agent(model: str, name: str, instructions: str, agent_name: str = "") -> str:
    """Create an Azure AI agent and return the agent ID."""
    try:
        # Get connection string from environment
        connection_string = os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING")
        if not connection_string:
            raise ValueError("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING environment variable is required")
        
        # Create project client
        project_client = AIProjectClient.from_connection_string(
            credential=DefaultAzureCredential(),
            conn_str=connection_string,
        )
        
        # Create knowledge base summary from customer data
        from customer_lookup import load_customer_data
        customer_data = load_customer_data()
        
        # Create a concise summary of available data
        knowledge_base = "\n\n---\n\n## 📊 CUSTOMER DATABASE ACCESS\n\n"
        knowledge_base += "You have access to comprehensive customer databases:\n\n"
        
        bank_count = len(customer_data.get("bank_customers", []))
        gen_ins_count = len(customer_data.get("general_insurance_customers", []))
        life_ins_count = len(customer_data.get("life_insurance_customers", []))
        auto_ins_count = len(customer_data.get("auto_insurance_customers", []))
        trade_count = len(customer_data.get("trade_customers", []))
        
        knowledge_base += f"- 🏦 **Bank Customers**: {bank_count} customers with accounts, loans, and credit cards\n"
        knowledge_base += f"- 🛡️ **General Insurance**: {gen_ins_count} customers with property, health policies\n"
        knowledge_base += f"- 💼 **Life Insurance**: {life_ins_count} customers with life coverage policies\n"
        knowledge_base += f"- 🚗 **Auto Insurance**: {auto_ins_count} customers with vehicle insurance\n"
        knowledge_base += f"- 📈 **Trade/Investment**: {trade_count} customers with trading accounts\n\n"
        
        knowledge_base += "### 🔍 IMPORTANT: Customer Data Search Instructions\n\n"
        knowledge_base += "**When a customer contacts you:**\n"
        knowledge_base += "1. **Ask for identification** - Request their phone number, name, or account number\n"
        knowledge_base += "2. **Search the data below** - Look through ALL the customer records provided\n"
        knowledge_base += "3. **Match by phone number** - Primary search key (e.g., +91-9876543210 or 9876543210)\n"
        knowledge_base += "4. **Provide personalized help** - Use their EXACT account balances, policy numbers, etc. from the data\n"
        knowledge_base += "5. **Cross-reference** - Check all divisions (bank, insurance, trade) for the same customer\n\n"
        
        knowledge_base += "### 📊 Complete Customer Database:\n\n"
        
        # Include ALL customer data in a readable format
        if bank_count > 0:
            knowledge_base += "#### 🏦 Bank Customers:\n"
            knowledge_base += f"```json\n{json.dumps(customer_data['bank_customers'], indent=2)}\n```\n\n"
        
        if gen_ins_count > 0:
            knowledge_base += "#### 🛡️ General Insurance Customers:\n"
            knowledge_base += f"```json\n{json.dumps(customer_data['general_insurance_customers'], indent=2)}\n```\n\n"
        
        if life_ins_count > 0:
            knowledge_base += "#### 💼 Life Insurance Customers:\n"
            knowledge_base += f"```json\n{json.dumps(customer_data['life_insurance_customers'], indent=2)}\n```\n\n"
        
        if auto_ins_count > 0:
            knowledge_base += "#### 🚗 Auto Insurance Customers:\n"
            knowledge_base += f"```json\n{json.dumps(customer_data['auto_insurance_customers'], indent=2)}\n```\n\n"
        
        if trade_count > 0:
            knowledge_base += "#### 📈 Trade/Investment Customers:\n"
            knowledge_base += f"```json\n{json.dumps(customer_data['trade_customers'], indent=2)}\n```\n\n"
        
        knowledge_base += "**CRITICAL: You MUST search through the above JSON data to find customers. When a customer provides their phone number (like 9876543210), find them in the data and use their ACTUAL information (account balances, policy details, etc.) to help them.**\n\n"
        
        # Add call history knowledge base for bank and insurance scenarios
        call_history_kb = ""
        if agent_name:
            call_history_kb = read_call_history(agent_name)
            if call_history_kb:
                logger.info(f"Adding call history knowledge base for agent: {agent_name}")
        
        # Combine instructions with knowledge base and call history
        enhanced_instructions = instructions + knowledge_base + call_history_kb
        
        logger.info(f"Creating agent with knowledge base: {bank_count + gen_ins_count + life_ins_count + auto_ins_count + trade_count} total customers")
        if call_history_kb:
            logger.info(f"Call history knowledge base included for {agent_name}")
        
        # Create agent
        agent = project_client.agents.create_agent(
            model=model,
            name=name,
            instructions=enhanced_instructions,
            tools=[]  # Using instructions-based knowledge base
        )
        
        logger.info(f"Created agent with ID: {agent.id}")
        return agent.id
        
    except Exception as e:
        logger.error(f"Failed to create agent: {str(e)}")
        raise


async def delete_azure_agent(agent_id: str) -> None:
    """Delete an Azure AI agent by ID."""
    try:
        # Get connection string from environment
        connection_string = os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING")
        if not connection_string:
            raise ValueError("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING environment variable is required")
        
        # Create project client
        project_client = AIProjectClient.from_connection_string(
            credential=DefaultAzureCredential(),
            conn_str=connection_string,
        )
        
        # Delete agent
        project_client.agents.delete_agent(agent_id)
        
        logger.info(f"Deleted agent with ID: {agent_id}")
        
    except Exception as e:
        logger.error(f"Failed to delete agent: {str(e)}")
        raise


async def warmup_ecom_api():
    """Warm up the ecom API by calling the /openapi endpoint"""
    ecom_api_url = os.getenv("ecom_api_url")
    if not ecom_api_url:
        logger.warning("ecom_api_url not configured, skipping API warmup")
        return
    
    warmup_url = f"{ecom_api_url.rstrip('/')}/openapi"
    
    try:
        logger.info("Warming up ecom API at %s", warmup_url)
        
        # Run the blocking requests call in a thread to avoid blocking the event loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, 
            lambda: requests.get(warmup_url, timeout=30)
        )
        
        if response.status_code == 200:
            logger.info("Successfully warmed up ecom API - Status: %d", response.status_code)
        else:
            logger.warning("Ecom API warmup returned status %d", response.status_code)
            
    except requests.exceptions.RequestException as e:
        logger.warning("Failed to warm up ecom API: %s", str(e))
    except Exception as e:
        logger.error("Unexpected error during ecom API warmup: %s", str(e))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:  # pylint: disable=unused-argument
    try:
        # Startup: Load sentiment analysis models
        logger.info("🚀 Preloading sentiment analysis models...")
        load_sentiment_models()
        logger.info("✓ Sentiment models preloaded and ready!")
        
        # Startup: warm up the ecom API
        await warmup_ecom_api()
        yield
    finally:
        # ensure all sessions are cleaned up
        remaining = await session_manager.list_session_ids()
        await asyncio.gather(*[session_manager.remove_session(session_id) for session_id in remaining])


app = FastAPI(title="Azure Voice Live Avatar Backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Mount static files (frontend build) when in production
static_dir = Path(__file__).parent.parent / "static"
if static_dir.exists():
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "voice-live-avatar-backend"}


@app.get("/api/config", response_model=ConfigResponse)
async def get_config() -> ConfigResponse:
    """Get current configuration"""
    return ConfigResponse(
        model=os.getenv("AGENT_MODEL", "gpt-4o-mini"),
        agent_name=os.getenv("AGENT_NAME", "voice-agent"),
        instructions=read_instructions(),
        agent_id=os.getenv("AZURE_VOICE_LIVE_AGENT_ID", "")
    )


@app.post("/api/config", response_model=AgentCreateResponse)
async def update_config(config: ConfigUpdate) -> AgentCreateResponse:
    """Update configuration and create new agent if needed"""
    try:
        # Check if agent already exists with same configuration
        current_agent_id = os.getenv("AZURE_VOICE_LIVE_AGENT_ID")
        current_model = os.getenv("AGENT_MODEL")
        current_name = os.getenv("AGENT_NAME")
        current_instructions = read_instructions()
        
        # If agent exists with same config, return existing agent
        if (current_agent_id and 
            current_model == config.model and 
            current_name == config.agent_name and 
            current_instructions == config.instructions):
            
            logger.info(f"Agent already exists with same configuration: {current_agent_id}")
            return AgentCreateResponse(
                agent_id=current_agent_id,
                status="success",
                message=f"Using existing agent with ID: {current_agent_id}"
            )
        
        # Create new agent only if configuration has changed
        logger.info(f"Creating new agent with updated configuration")
        agent_id = await create_azure_agent(
            model=config.model,
            name=config.agent_name,
            instructions=config.instructions,
            agent_name=config.agent_name  # Pass agent_name for call history lookup
        )
        
        # Save instructions to file
        write_instructions(config.instructions)
        
        # Update environment variables in one batch operation (excluding instructions)
        batch_update_env_file({
            "AGENT_MODEL": config.model,
            "AGENT_NAME": config.agent_name,
            "AZURE_VOICE_LIVE_AGENT_ID": agent_id
        })
        
        logger.info(f"Configuration updated and new agent created: {agent_id}")
        
        return AgentCreateResponse(
            agent_id=agent_id,
            status="success",
            message=f"New agent created successfully with ID: {agent_id}"
        )
        
    except Exception as e:
        logger.error(f"Failed to update config and create agent: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to create agent: {str(e)}"
        )


@app.post("/api/config/reload")
async def reload_config():
    """Reload configuration from environment variables"""
    # Reload .env file
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)
    return {"status": "reloaded", "message": "Configuration reloaded successfully"}


@app.delete("/api/config/agent")
async def reset_agent():
    """Reset the current agent configuration and delete the agent from Azure"""
    try:
        # Get current agent ID before clearing
        agent_id = os.getenv("AZURE_VOICE_LIVE_AGENT_ID", "")
        
        # Delete agent from Azure if it exists
        if agent_id:
            try:
                await delete_azure_agent(agent_id)
                logger.info(f"Successfully deleted agent from Azure: {agent_id}")
            except Exception as e:
                logger.warning(f"Failed to delete agent from Azure (continuing with reset): {str(e)}")
        
        # Clear agent-related environment variables (instructions stay in file)
        update_env_batch({
            "AZURE_VOICE_LIVE_AGENT_ID": "",
            "AGENT_MODEL": "",
            "AGENT_NAME": ""
        })
        
        logger.info("Agent configuration reset")
        return {"status": "success", "message": "Agent configuration has been reset and agent deleted from Azure"}
        
    except Exception as e:
        logger.error(f"Failed to reset agent configuration: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to reset agent: {str(e)}")


@app.get("/api/config/status")
async def get_config_status():
    """Get the current configuration status"""
    agent_id = os.getenv("AZURE_VOICE_LIVE_AGENT_ID", "")
    return {
        "has_agent": bool(agent_id),
        "agent_id": agent_id,
        "model": os.getenv("AGENT_MODEL", ""),
        "agent_name": os.getenv("AGENT_NAME", ""),
        "ready_for_session": bool(agent_id and os.getenv("AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING"))
    }


@app.get("/api/predefined-bots/{bot_key}")
async def get_predefined_bot(bot_key: str):
    """Get instructions for a predefined bot scenario"""
    try:
        # Map bot keys to their instruction files
        bot_files = {
            "default": "default.txt",
            "Credit-card Re-issue": "bank-use-case.txt",
            "Insurance Claim Re-Submission": "insurance-use-case.txt",
            "Trade Reversal": "trade-use-case.xt",
            "Mutual Funds Trade Outbound Call": "trade-use-case-2.txt",
            "Mutual Fund Comparison": "trade-use-case-3.txt"
        }
        
        # Map bot keys to their display names
        bot_names = {
            "default": "Default",
            "Credit-card Re-issue": "Credit Card Reissue",
            "Insurance Claim Re-Submission": "Health Insurance Claim Re-Submission",
            "Trade Reversal": "Reverse Trade",
            "Mutual Funds Trade Outbound Call": "Mutual Fund Investment Call",
            "Mutual Fund Comparison": "Mutual Fund Comparison"
        }
        
        if bot_key not in bot_files:
            raise HTTPException(status_code=404, detail="Bot template not found")
        
        filename = bot_files[bot_key]
        bot_name = bot_names.get(bot_key, bot_key.replace("-", " ").title())
        
        if not filename:
            return {
                "name": bot_name,
                "instructions": f"🚧 {bot_name} bot instructions (coming soon)...",
                "available": False
            }
        
        # Read the instructions file
        file_path = Path(__file__).resolve().parents[1] / filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Instructions file not found")
        
        with open(file_path, 'r', encoding='utf-8') as f:
            instructions = f.read().strip()
        
        return {
            "name": bot_name,
            "instructions": instructions,
            "available": True
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to load bot template {bot_key}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


async def _ensure_session(session_id: str):
    try:
        return await session_manager.get_session(session_id)
    except KeyError as exc:  # pylint: disable=raise-missing-from
        raise HTTPException(status_code=404, detail="Session not found") from exc


@app.post("/api/session", response_model=SessionResponse)
async def create_session() -> SessionResponse:
    session = await session_manager.create_session()
    return SessionResponse(session_id=session.session_id)


@app.get("/api/session/{session_id}")
async def get_session_status(session_id: str):
    try:
        session = await session_manager.get_session(session_id)
        return {"session_id": session_id, "status": "active"}
    except KeyError:
        raise HTTPException(status_code=404, detail="Session not found")


@app.post("/api/session/{session_id}/avatar/disconnect")
async def disconnect_avatar(session_id: str):
    try:
        session = session_manager.get_session(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
            
        await session.disconnect_avatar()
        return {"success": True, "message": "Avatar disconnected"}
        
    except Exception as e:
        logger.error("Avatar disconnect failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/disconnect")
async def disconnect_session(session_id: str):
    """Disconnect session and delete the agent"""
    try:
        # Get current agent ID
        agent_id = os.getenv("AZURE_VOICE_LIVE_AGENT_ID", "")
        
        # Save transcript before removing session
        try:
            session = await session_manager.get_session(session_id)
            if session:
                transcript = session.get_transcript()
                if transcript:
                    session_transcripts[session_id] = transcript
                    logger.info(f"Saved transcript for session {session_id} ({len(transcript)} chars)")
                else:
                    logger.warning(f"No transcript available for session {session_id}")
        except Exception as e:
            logger.warning(f"Could not save transcript for session {session_id}: {e}")
        
        # Remove the session
        try:
            await session_manager.remove_session(session_id)
            logger.info(f"Session {session_id} removed")
        except KeyError:
            logger.warning(f"Session {session_id} not found in session manager")
        
        # Delete agent from Azure if it exists
        if agent_id:
            try:
                await delete_azure_agent(agent_id)
                logger.info(f"Successfully deleted agent from Azure: {agent_id}")
            except Exception as e:
                logger.warning(f"Failed to delete agent from Azure: {str(e)}")
        
        # Clear agent-related environment variables (instructions stay in file)
        update_env_batch({
            "AZURE_VOICE_LIVE_AGENT_ID": "",
            "AGENT_MODEL": "",
            "AGENT_NAME": ""
        })
        
        return {"success": True, "message": "Session disconnected and agent deleted"}
        
    except Exception as e:
        logger.error("Session disconnect failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/session/{session_id}/avatar/connect")
async def handle_avatar_offer(session_id: str, request: AvatarOfferRequest) -> AvatarAnswerResponse:
    try:
        session = await _ensure_session(session_id)
        logger.info("[%s] Handling avatar connect request", session_id)
        server_sdp = await session.connect_avatar(request.client_sdp)
        logger.info("[%s] Avatar connect successful", session_id)
        return AvatarAnswerResponse(server_sdp=server_sdp)
    except RuntimeError as e:
        logger.error("[%s] Avatar connection failed: %s", session_id, str(e))
        raise HTTPException(status_code=500, detail=f"Avatar connection failed: {str(e)}")
    except Exception as e:
        logger.error("[%s] Unexpected avatar error: %s", session_id, str(e))
        raise HTTPException(status_code=500, detail="Avatar connection failed due to unexpected error")


@app.post("/api/session/{session_id}/message")
async def send_text_message(session_id: str, request: TextMessageRequest) -> Dict[str, str]:
    session = await _ensure_session(session_id)
    await session.send_user_message(request.text)
    return {"status": "queued"}


@app.post("/sessions/{session_id}/commit-audio", response_model=AudioCommitResponse)
async def commit_audio(session_id: str) -> AudioCommitResponse:
    session = await _ensure_session(session_id)
    await session.commit_audio()
    return AudioCommitResponse(status="committed")


@app.post("/api/session/{session_id}/summary", response_model=SummaryResponse)
async def get_call_summary(session_id: str):
    """Generate a professional call summary from the session transcript"""
    try:
        # First check if we have a saved transcript (after disconnect)
        transcript = session_transcripts.get(session_id)
        
        # If not, try to get it from active session
        if not transcript:
            session = session_manager.get(session_id)
            if session:
                transcript = session.get_transcript()
        
        if not transcript or len(transcript.strip()) < 10:
            return SummaryResponse(
                summary="No conversation data available to summarize.",
                status="empty"
            )
        
        # Generate summary using the summarizer agent
        logger.info(f"📝 Generating summary for session {session_id}...")
        logger.info(f"Transcript length: {len(transcript)} characters")
        summary = generate_summary(transcript)
        
        logger.info("✓ Summary generated successfully")
        
        # Store summary for analytics generation
        session_summaries[session_id] = summary
        
        # Note: We keep the transcript in session_transcripts for potential re-use
        # It will be cleaned up when a new session starts or on server restart
        
        return SummaryResponse(summary=summary, status="success")
        
    except Exception as e:
        logger.error(f"Error generating summary: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/session/{session_id}/analytics", response_model=AnalyticsResponse)
async def get_call_analytics(session_id: str):
    """Generate call analytics from the session summary"""
    try:
        # First check if we have a summary generated
        summary = session_summaries.get(session_id)
        
        if not summary:
            return AnalyticsResponse(
                analytics="Please generate call summary first before requesting analytics.",
                status="no_summary"
            )
        
        # Generate analytics using the call analytics agent
        logger.info(f"📊 Generating analytics for session {session_id}...")
        logger.info(f"Summary length: {len(summary)} characters")
        analytics = generate_call_analytics(summary)
        
        logger.info("✓ Analytics generated successfully")
        
        return AnalyticsResponse(analytics=analytics, status="success")
        
    except Exception as e:
        logger.error(f"Error generating analytics: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.websocket("/api/ws/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str):
    await websocket.accept()
    try:
        session = await _ensure_session(session_id)
    except HTTPException:
        await websocket.close(code=4404)
        return

    queue = session.create_event_queue()

    async def emitter():
        try:
            while True:
                event = await queue.get()
                await websocket.send_json(event)
        except WebSocketDisconnect:
            logger.info("Websocket emitter disconnect for session %s", session_id)
        except Exception as exc:  # pylint: disable=broad-except
            logger.exception("Emitter failed: %s", exc)

    emitter_task = asyncio.create_task(emitter())

    await websocket.send_json({"type": "session_ready", "session_id": session_id})

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")
            if msg_type == "audio_chunk":
                audio_data = message.get("audio")  # Frontend sends 'audio' field
                await session.send_audio_chunk(audio_data)
            elif msg_type == "commit_audio":
                await session.commit_audio()
            elif msg_type == "clear_audio":
                await session.clear_audio()
            elif msg_type == "user_text":
                await session.send_user_message(message.get("text", ""))
            elif msg_type == "request_response":
                await session.request_response()
            else:
                logger.warning("Unknown WS message type: %s", msg_type)
    except WebSocketDisconnect:
        logger.info("Client disconnected from session %s", session_id)
    finally:
        emitter_task.cancel()
        session.remove_event_queue(queue)


# Serve React app for any unmatched routes (SPA fallback)
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    """Serve the React SPA for any non-API routes"""
    static_dir = Path(__file__).parent.parent / "static"
    
    # If static files exist and this isn't an API call, serve index.html
    if static_dir.exists() and not full_path.startswith(("sessions", "ws", "health", "static")):
        index_file = static_dir / "index.html"
        if index_file.exists():
            # Warm up the ecom API when serving the main page to prevent cold start delays
            if full_path == "" or full_path == "index.html":
                asyncio.create_task(warmup_ecom_api())
            return FileResponse(index_file)
    
    # Fallback 404 for missing routes
    raise HTTPException(status_code=404, detail="Not found")