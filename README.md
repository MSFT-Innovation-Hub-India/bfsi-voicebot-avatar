# Voice Live AI Contact Center Agent

A modern, production-ready AI-powered contact center application built with Azure Voice Live API, featuring real-time voice conversations, sentiment analysis, call analytics, and comprehensive multi-industry support.

## Overview

This application provides an intelligent voice agent platform designed for contact centers across multiple industries including banking, insurance, and trading. It combines Azure's Voice Live API with real-time sentiment analysis, call summarization, and analytics generation to deliver exceptional customer service experiences.

## Key Features

### 🎙️ Real-Time Voice Conversation
- Natural voice interactions powered by Azure Voice Live API
- WebSocket-based audio streaming for low-latency communication
- Support for multiple Azure TTS voices
- Automatic audio transcription for both user and assistant

### 📊 Advanced Analytics
- **Real-time sentiment analysis** using DistilBERT-based models
- **Emotion detection** with emoji indicators (😊 😐 😢)
- **Call summarization** with Azure OpenAI GPT-4o-mini integration
- **Call analytics generation** including key metrics, insights, and recommendations
- Sentiment history tracking throughout conversations

### 👤 Multi-Industry Support
Pre-configured customer databases and use cases for:
- **Banking** - Account inquiries, transactions, credit cards
- **Insurance** - Auto, life, and general insurance policies
- **Trading** - Investment portfolios, market insights, fund allocation

### 🎨 Modern Web Interface
- React + TypeScript frontend with Vite
- Real-time WebSocket communication
- Animated UI components with smooth transitions
- Action modal system for email, transfers, and session management
- Voice waveform visualization
- Live sentiment indicators and conversation history
- Session duration tracking and metrics display

### 🔧 Flexible Configuration
- Dynamic agent configuration via REST API
- Support for custom instructions and context
- Multiple model options (GPT-4o, GPT-4o-mini)
- Configurable customer data sources
- Environment-based configuration management

## Project Structure

```
voiceliveagent/
├── backend/                          # FastAPI backend server
│   ├── main.py                       # FastAPI app with REST & WebSocket APIs
│   ├── voice_live_client.py          # Azure Voice Live client wrapper
│   ├── session_manager.py            # Session lifecycle management
│   ├── sentiment_analyzer.py         # Real-time sentiment & emotion analysis
│   ├── summarizer.py                 # Call summarization with GPT-4o-mini
│   ├── call_analytics.py             # Analytics generation from summaries
│   ├── customer_lookup.py            # Customer data management
│   ├── test_analytics.py             # Analytics testing script
│   ├── test_summarizer.py            # Summarizer testing script
│   └── data/                         # Customer databases (JSON)
│       ├── bank_customers.json
│       ├── auto_insurance_customers.json
│       ├── life_insurance_customers.json
│       ├── general_insurance_customers.json
│       └── trade_customers.json
│
├── frontend/                         # React TypeScript frontend
│   ├── src/
│   │   ├── App.tsx                   # Main application component
│   │   ├── App.css                   # Application styles
│   │   ├── main.tsx                  # React entry point
│   │   ├── index.css                 # Global styles
│   │   └── components/               # Reusable UI components
│   │       ├── ActionModal.tsx       # Action confirmation modal
│   │       ├── EmailAnimation.tsx    # Email sending animation
│   │       ├── HumanTransferAnimation.tsx  # Transfer animation
│   │       ├── SessionInitAnimation.tsx    # Session start animation
│   │       └── VoiceWaveform.tsx     # Voice activity visualization
│   ├── public/
│   │   └── customer-images/          # Customer profile images
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── tsconfig.node.json
│
├── instructions.txt                  # Agent instructions template
├── bank-use-case.txt                 # Banking scenario documentation
├── insurance-use-case.txt            # Insurance scenario documentation
├── trade-use-case.txt                # Trading scenario documentation
├── call-history-bank.txt             # Sample bank call history
├── call-history-insurance.txt        # Sample insurance call history
├── requirements.txt                  # Python dependencies
├── package.json                      # Node.js dependencies
└── README.md                         # This file
```

## Prerequisites

- **Python 3.8+** with pip
- **Node.js 18+** with npm
- **Azure subscription** with Voice Live API access
- **Azure AI Projects** workspace configured
- **Azure OpenAI** deployment (GPT-4o or GPT-4o-mini)

## Setup Instructions



### 1. Configure Environment Variables

Create a `.env` file in the project root with your Azure credentials:

```env
# Azure Voice Live Configuration
AZURE_VOICE_LIVE_ENDPOINT=https://your-endpoint.cognitiveservices.azure.com/
AZURE_VOICE_LIVE_AGENT_ID=your-agent-id
AZURE_VOICE_LIVE_AGENT_CONNECTION_STRING=region.api.azureml.ms;workspace-id;resource-group;project-name
AZURE_VOICE_LIVE_API_VERSION=2025-10-01

# Azure OpenAI Configuration (for summarization and analytics)
AZURE_OPENAI_ENDPOINT=https://your-openai.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# TTS Voice Configuration
AZURE_TTS_VOICE=en-IN-AartiIndicNeural

# Azure AI Project Configuration
AZURE_AI_PROJECT_CONNECTION_STRING=your-connection-string
```

### 2. Install Backend Dependencies

```bash
pip install -r requirements.txt
```

Required Python packages include:
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `websockets` - WebSocket client/server
- `azure-identity` - Azure authentication
- `azure-ai-projects` - Azure AI SDK
- `transformers` - Sentiment analysis models
- `torch` - Deep learning framework
- `python-dotenv` - Environment management

### 3. Install Frontend Dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Download Sentiment Analysis Models

The sentiment analyzer will automatically download required models on first run:
- `distilbert-base-uncased-finetuned-sst-2-english` (sentiment)
- `bhadresh-savani/distilbert-base-uncased-emotion` (emotion)

## Running the Application

### Option 1: Development Mode (Recommended)

**Start the backend server:**

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**In a separate terminal, start the frontend:**

```bash
cd frontend
npm run dev
```

The application will be available at `http://localhost:5173`

### Option 2: Production Mode

**Build the frontend:**

```bash
cd frontend
npm run build
cd ..
```

**Run the backend with production settings:**

```bash
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Access at `http://localhost:8000`

## Usage Guide

### Starting a Conversation

1. Open the web application in your browser
2. Click **"Start Session"** to initialize a new voice session
3. Grant microphone permissions when prompted
4. Click the **microphone button** to start speaking
5. The AI agent will respond in real-time with voice and text

### Viewing Analytics

1. During or after a conversation, view real-time sentiment indicators
2. Click **"Show Summary"** to generate a call summary
3. Click **"Show Analytics"** to view detailed call analytics including:
   - Call metrics (duration, sentiment, resolution)
   - Key insights and discussion points
   - Agent performance evaluation
   - Recommended follow-up actions

### Managing Customer Context

- The system automatically loads customer data based on the selected industry
- Customer information is displayed during conversations
- Support for banking, insurance (auto, life, general), and trading customers

### Configuration Management

- Use the **Settings** panel to customize agent behavior
- Update instructions, context, and model selection
- Changes apply to new sessions immediately

### Session Management

- Track session duration in real-time
- View conversation history with sentiment indicators
- End session to generate final summary and analytics

## API Endpoints

### REST API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/session` | POST | Create new voice session |
| `/api/session/{session_id}` | GET | Get session status |
| `/api/session/{session_id}/message` | POST | Send text message |
| `/api/session/{session_id}/config` | PUT | Update session configuration |
| `/api/session/{session_id}/summary` | POST | Generate call summary |
| `/api/session/{session_id}/analytics` | GET | Get call analytics |
| `/api/customers` | GET | List all customers |
| `/api/customers/{customer_id}` | GET | Get customer details |

### WebSocket API

Connect to `/api/ws/{session_id}` for real-time events:

**Events received:**
- `session_started` - Session initialization complete
- `user_speaking` - User audio detected
- `assistant_speaking` - Assistant is responding
- `transcription` - Text transcription update
- `sentiment_update` - Real-time sentiment analysis
- `session_ended` - Session terminated

**Events sent:**
- `audio` - Send audio data (base64 encoded)
- `message` - Send text message
- `end_session` - Terminate the session

## Testing

### Test Call Summarization

```bash
cd backend
python test_summarizer.py
```

### Test Analytics Generation

```bash
cd backend
python test_analytics.py
```

## Authentication

This application uses `DefaultAzureCredential` from Azure Identity. Make sure you're authenticated using one of:

- Azure CLI: `az login`
- Environment variables (AZURE_CLIENT_ID, AZURE_TENANT_ID, AZURE_CLIENT_SECRET)
- Managed Identity (when deployed to Azure)

## Troubleshooting

### Common Issues

1. **Microphone not working:**
   - Grant microphone permissions in your browser
   - Check that no other application is using the microphone
   - Verify browser supports WebRTC

2. **Session connection fails:**
   - Verify all environment variables are set correctly
   - Check Azure credentials are valid
   - Review backend logs for detailed error messages
   - Ensure Azure Voice Live API access is enabled

3. **Sentiment analysis errors:**
   - Models will download automatically on first run
   - Ensure sufficient disk space for model files (~500MB)
   - Check internet connection for model downloads

4. **WebSocket disconnections:**
   - Check network stability
   - Verify firewall allows WebSocket connections
   - Review browser console for error messages

5. **Analytics not generating:**
   - Ensure Azure OpenAI endpoint is configured
   - Check API key and deployment name
   - Verify sufficient quota in Azure OpenAI

### Debug Mode

Enable verbose logging for troubleshooting:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Architecture

### Backend Components

- **FastAPI Server** - REST and WebSocket APIs
- **Voice Live Client** - Azure Voice Live integration
- **Session Manager** - Session lifecycle and state management
- **Sentiment Analyzer** - Real-time emotion and sentiment detection
- **Summarizer** - Call summary generation
- **Call Analytics** - Post-call insights and metrics
- **Customer Lookup** - Multi-industry customer data management

### Frontend Components

- **React + TypeScript** - Modern UI framework
- **Vite** - Fast build tooling
- **WebSocket Client** - Real-time communication
- **Audio Processing** - Microphone input and playback
- **Animated Components** - Enhanced user experience

### Data Flow

1. User speaks → Microphone captures audio
2. Audio streamed via WebSocket → Backend
3. Backend forwards to Azure Voice Live → AI processing
4. Voice Live returns response → Backend
5. Sentiment analysis performed → Real-time updates
6. Response streamed to frontend → User hears/sees reply
7. End of call → Summary and analytics generated

## Development

### Adding New Features

1. Backend changes go in `backend/main.py` or respective modules
2. Frontend changes go in `frontend/src/App.tsx` or components
3. Voice agent logic updates go in `voice_live_client.py`

### Building for Production

```bash
# Build frontend
cd frontend
npm run build

# Deploy backend with production ASGI server
pip install gunicorn
gunicorn backend.main:app -w 4 -k uvicorn.workers.UvicornWorker
```

### Code Style

- Python: Follow PEP 8 guidelines
- TypeScript: Use ESLint configuration
- Components: Functional components with hooks

## Contributing

Pull requests are welcome! Please ensure:
- All sensitive information is removed before committing
- Code follows existing style conventions
- Tests pass successfully
- Documentation is updated

## License

This project is for educational and development purposes. Please ensure compliance with Azure service terms and conditions.

## Support

For issues and questions:
- Check the troubleshooting section
- Review Azure Voice Live documentation
- Open an issue on GitHub

## Acknowledgments

Built with:
- Azure Voice Live API
- Azure OpenAI Service
- React and TypeScript
- FastAPI
- Hugging Face Transformers
