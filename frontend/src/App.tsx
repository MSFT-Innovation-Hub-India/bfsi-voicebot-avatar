import React, { useState, useRef, useEffect } from 'react';
import './App.css';
import { ActionModal } from './components/ActionModal';
import { SessionInitAnimation } from './components/SessionInitAnimation';
import { VoiceWaveform } from './components/VoiceWaveform';

interface SentimentData {
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  emotion: string;
  emotion_score: number;
  emoji: string;
  all_emotions?: Record<string, number>;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isRecent?: boolean; // Mark recent messages
  sentiment?: SentimentData; // Sentiment analysis for user messages
}

interface Config {
  model: string;
  agent_name: string;
  instructions: string;
  context: string;
  agent_id: string;
}

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recentMessages, setRecentMessages] = useState<Message[]>([]); // Only last few messages
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [avatarConnected, setAvatarConnected] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarIceServers, setAvatarIceServers] = useState<RTCIceServer[]>([]);
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [peerConnection, setPeerConnection] = useState<RTCPeerConnection | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [currentSentiment, setCurrentSentiment] = useState<SentimentData | null>(null);
  const [currentAssistantMessage, setCurrentAssistantMessage] = useState<string>('');
  const [sentimentHistory, setSentimentHistory] = useState<SentimentData[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<Date | null>(null);
  const [, setDurationTick] = useState(0); // Force re-render for duration updates
  const [showSummary, setShowSummary] = useState(false);
  const [callSummary, setCallSummary] = useState<string>('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [callAnalytics, setCallAnalytics] = useState<string>('');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  // Action modal states
  const [showActionModal, setShowActionModal] = useState(false);
  const [actionType, setActionType] = useState<'email' | 'human_transfer' | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState(false); // Track if transfer should follow email
  const [isConfigCollapsed, setIsConfigCollapsed] = useState(false);
  const [showInstructionsModal, setShowInstructionsModal] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [showProductKnowledge, setShowProductKnowledge] = useState(false);
  const [showSessionInit, setShowSessionInit] = useState(false);
  // Removed unused setShowFullHistory to fix warning
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const audioPlaybackTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastAssistantTranscriptRef = useRef<string>('');
  const sessionIdRef = useRef<string | null>(null); // Keep sessionId in ref for callbacks
  
  const [config, setConfig] = useState<Config>({
    model: 'gpt-4o-mini',
    agent_name: 'voice-agent',
    instructions: '', // Will be loaded from backend
    context: '',
    agent_id: ''
  });
  const [configLoaded, setConfigLoaded] = useState(false);
  const [agentStatus, setAgentStatus] = useState({ has_agent: false, ready_for_session: false });

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, recentMessages]);

  // Keep only recent messages (last 4 exchanges)
  useEffect(() => {
    const maxRecentMessages = 8; // 4 user + 4 assistant messages
    setRecentMessages(messages.slice(-maxRecentMessages));
  }, [messages]);

  // Auto-cleanup old messages every 10 minutes (optional)
  useEffect(() => {
    const autoCleanup = setInterval(() => {
      if (messages.length > 20) {
        console.log('🧹 Auto-cleaning old messages to improve performance');
        setMessages(prev => prev.slice(-12)); // Keep only last 12 messages
      }
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(autoCleanup);
  }, [messages.length]);

  // Update duration display every second when session is active
  useEffect(() => {
    if (!sessionStartTime) return;
    
    const interval = setInterval(() => {
      setDurationTick(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionStartTime]);

  // Load initial configuration from backend - only when starting session
  const loadConfig = async () => {
    if (configLoaded) return; // Don't reload if already loaded
    
    try {
      // Load config and status in parallel
      const [configResponse, statusResponse] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/config/status')
      ]);
      
      if (configResponse.ok) {
        const backendConfig = await configResponse.json();
        setConfig({
          model: backendConfig.model || 'gpt-4o-mini',
          agent_name: backendConfig.agent_name || 'voice-agent',
          instructions: backendConfig.instructions || '',
          context: backendConfig.context || '',
          agent_id: backendConfig.agent_id || ''
        });
      }
      
      if (statusResponse.ok) {
        const status = await statusResponse.json();
        setAgentStatus(status);
      }
      
      setConfigLoaded(true);
    } catch (error) {
      console.error('Failed to load config:', error);
      setConfigLoaded(true); // Mark as loaded even if failed to avoid retry loops
    }
  };

  // Load configuration on component mount
  useEffect(() => {
    loadConfig();
  }, []);

  // Update configuration locally only (for real-time typing)
  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
  };

  const startSession = async () => {
    try {
      // Load configuration only when starting session
      await loadConfig();
      
      // Check if agent is configured
      if (!config.agent_id) {
        alert('Please create an agent first by configuring and saving your agent settings.');
        return;
      }
      
      // Show session initialization animation
      setShowSessionInit(true);
      
      const response = await fetch('/api/session', { method: 'POST' });
      const data = await response.json();
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id; // Update ref

      // Connect WebSocket - use proxy on port 3000 which forwards to backend on port 8000
      const websocket = new WebSocket(`ws://localhost:3000/api/ws/${data.session_id}`);
      
      websocket.onopen = () => {
        setIsConnected(true);
        setWs(websocket);
        setSessionStartTime(new Date());
        setSentimentHistory([]);
        // Clear previous session data
        setMessages([]);
        setRecentMessages([]);
        setCallSummary('');
        setShowSummary(false);
        
        // Automatically show call history for bank and insurance scenarios
        if (config.agent_name === 'Credit-card Re-issue' || config.agent_name === 'Insurance Claim Re-Submission') {
          setShowCallHistory(true);
          setIsConfigCollapsed(false); // Ensure config panel is open
        }
        
        console.log('WebSocket connected');
      };

      websocket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      };

      websocket.onclose = () => {
        setIsConnected(false);
        setWs(null);
        console.log('WebSocket disconnected');
      };

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      console.error('Failed to start session:', error);
      setShowSessionInit(false);
    }
  };

  const disconnectSession = async () => {
    if (!sessionId) return;

    try {
      // Close WebSocket
      if (ws) {
        ws.close();
        setWs(null);
      }

      // Clear any pending audio playback timers
      if (audioPlaybackTimerRef.current) {
        clearTimeout(audioPlaybackTimerRef.current);
        audioPlaybackTimerRef.current = null;
      }

      // Stop recording if active
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        setIsRecording(false);
      }

      // Close peer connection
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }

      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // Remove audio element
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }

      // Call backend to disconnect session and delete agent
      const response = await fetch(`/api/session/${sessionId}/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Backend session disconnect failed:', errorData);
      }

      // Update UI state
      setIsConnected(false);
      setAvatarConnected(false);
      setAvatarLoading(false);
      setSessionId(null);
      sessionIdRef.current = null;
      setConfig(prev => ({ ...prev, agent_id: '' }));
      setAgentStatus({ has_agent: false, ready_for_session: false });
      
      console.log('Session disconnected and agent deleted');

    } catch (error) {
      console.error('Failed to disconnect session:', error);
      // Still update UI state even if backend call fails
      setIsConnected(false);
      setAvatarConnected(false);
      setAvatarLoading(false);
      setSessionId(null);
      sessionIdRef.current = null;
      if (ws) ws.close();
      setWs(null);
    }
  };

  const fetchCallSummary = async (autoTriggered = false) => {
    if (!sessionId) {
      alert('No active session to summarize');
      return;
    }

    // If summary already exists, just show it (unless auto-triggered)
    if (callSummary) {
      if (!autoTriggered) {
        setShowSummary(true);
      }
      return;
    }

    try {
      setSummaryLoading(true);
      const response = await fetch(`/api/session/${sessionId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch summary');
      }

      const data = await response.json();
      setCallSummary(data.summary);
      // Only show summary modal if not auto-triggered (animation will handle it)
      if (!autoTriggered) {
        setShowSummary(true);
      }
    } catch (error) {
      console.error('Failed to fetch summary:', error);
      if (!autoTriggered) {
        alert('Failed to generate call summary. Please try again.');
      }
    } finally {
      setSummaryLoading(false);
    }
  };

  const fetchCallAnalytics = async () => {
    if (!sessionId) {
      alert('No active session for analytics');
      return;
    }

    // If analytics already exists, just show it
    if (callAnalytics) {
      setShowAnalytics(true);
      return;
    }

    // Check if summary exists first
    if (!callSummary) {
      alert('Please generate call summary first before requesting analytics.');
      return;
    }

    try {
      setAnalyticsLoading(true);
      const response = await fetch(`/api/session/${sessionId}/analytics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch analytics');
      }

      const data = await response.json();
      
      if (data.status === 'no_summary') {
        alert('Please generate call summary first before requesting analytics.');
        return;
      }
      
      setCallAnalytics(data.analytics);
      setShowAnalytics(true);
    } catch (error) {
      console.error('Failed to fetch analytics:', error);
      alert('Failed to generate call analytics. Please try again.');
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // Detect action keywords in assistant's message
  const detectAction = async (text: string) => {
    const lowerText = text.toLowerCase();
    
    console.log('🔍 Checking text for actions:', lowerText.substring(0, 100) + '...');
    console.log('🎯 Current agent:', config.agent_name);
    
    // Determine action type based on scenario
    const isBankOrInsurance = config.agent_name === 'Credit-card Re-issue' || 
                              config.agent_name === 'Insurance Claim Re-Submission';
    const isTrade = config.agent_name === 'Trade Reversal' || 
                    config.agent_name === 'Mutual Funds Trade Outbound Call' ||
                    config.agent_name === 'Mutual Fund Comparison';
    
    // Call ending phrases - trigger automatic summary generation
    const callEndingPhrases = [
      'thank you for calling',
      'thank you for contacting',
      'have a wonderful day',
      'have a great day',
      'have a nice day',
      'take care and have a wonderful day',
      'thank you for choosing',
      'thank you for your patience',
      'is there anything else i can help you with',
      'is there anything else i can assist you with',
      'if you need any further assistance',
      'feel free to contact us again',
      'please feel free to reach out',
      'we appreciate your patience',
      'thank you for your cooperation',
      'we appreciate your cooperation',
      'goodbye',
      'have a good day'
    ];
    
    // Check if call is ending - auto-generate summary
    const isCallEnding = callEndingPhrases.some(phrase => lowerText.includes(phrase));
    if (isCallEnding && sessionId && !callSummary && messages.length > 0) {
      console.log('📞 Call ending detected! Auto-generating summary...');
      try {
        setSummaryLoading(true);
        const response = await fetch(`/api/session/${sessionId}/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          const data = await response.json();
          setCallSummary(data.summary);
          setShowSummary(true);
          console.log('✅ Auto-generated summary successfully');
        }
      } catch (error) {
        console.error('Failed to auto-generate summary:', error);
      } finally {
        setSummaryLoading(false);
      }
    }
    
    // Email conclusion phrases (for all scenarios)
    const emailConclusionPhrases = [
      // Confirmation email - full forms
      'confirmation email will be sent',
      'confirmation email will be',
      'email will be sent to your registered',
      'email will be sent to you',
      'sending you a confirmation email',
      'you will receive a confirmation email',
      'you will receive an email',
      'email confirmation will be sent',
      'we will send you an email',
      'we will email you',
      'i will send you an email',
      'i will email you',
      
      // Confirmation email - contractions
      "you'll receive a confirmation email",
      "you'll receive an email",
      "you'll get a confirmation email",
      "you'll get an email",
      "we'll send you an email",
      "we'll email you",
      "i'll send you an email",
      "i'll email you",
      "it'll be sent via email",
      "that'll be sent via email",
      
      // Email with details/tracking
      'email shortly along with',
      'email shortly with',
      'email with the details',
      'email with details',
      'email with tracking',
      'details via email',
      'details through email',
      'details by email',
      'email you the details',
      'email you the tracking',
      'sending an email with',
      'send an email with',
      
      // Summary/report via email
      'summary will be sent via email',
      'summary via email',
      'report will be emailed',
      'emailing you the summary',
      'email the summary',
      
      // General email arrival
      'email will arrive shortly',
      'email will arrive soon',
      'email should arrive',
      'check your email',
      'look out for an email',
      'look for an email',
      'expect an email',
      'watch for an email',
      'email coming soon',
      'email on its way',
      
      // Trade specific
      'reversal confirmation via email',
      'reversal confirmation email',
      'trade confirmation email',
      'transaction details via email',
      'transaction email',
      'confirmation will be emailed',
      'details will be emailed',
      
      // Advisor/follow-up scheduling
      'arrange a follow-up',
      'arrange a quick follow-up',
      'arrange follow-up',
      'connect you with an advisor',
      'connect you with our advisor',
      'connect you with an investment advisor',
      'our investment advisor will reach out',
      'our advisor will reach out',
      'advisor will contact you',
      'advisor will reach out',
      'schedule a follow-up',
      'follow-up session with our advisor',
      'follow-up with an advisor',
      
      // Email shortly/soon variations
      'receive a confirmation email shortly',
      'receive an email shortly',
      'receive the email soon',
      'get an email shortly',
      'get a confirmation email',
      
      // Documents via email
      'upload them securely',
      'documents via email',
      'send the documents via email'
    ];
    
    // Human transfer conclusion phrases (for bank/insurance scenarios)
    const transferConclusionPhrases = [
      // Direct transfer - full forms
      'connect you with a human',
      'connect you with the human',
      'connect you to a human',
      'connect you to the human',
      'transfer you to',
      'transfer your call to',
      'transfer you over to',
      'transferring you to',
      'transferring your call',
      'transferring your call to',
      'transferring you over',
      'transfer you now',
      'transfer your call',
      
      // Direct transfer - contractions
      "i'll connect you with",
      "i'll connect you to",
      "i'll transfer you to",
      "i'll transfer you over",
      "i'll now transfer you",
      "i'll transfer your call",
      
      // Routing - full forms
      'route you to',
      'routing you to',
      'i will route you to',
      'i will now route you',
      'i am routing you to',
      'let me route you to',
      
      // Routing - contractions
      "i'll route you to",
      "i'll now route you",
      "i'll be routing you",
      
      // Connecting phrases - full forms
      'connecting you with',
      'connecting you to',
      'connecting you with a',
      'i will now connect you',
      'i will connect you to',
      'i will connect you with',
      'let me connect you',
      'allow me to connect you',
      
      // Connecting phrases - contractions
      "i'll now connect you",
      "i'll be connecting you",
      
      // Specialist/Expert transfer
      'connect you to a specialist',
      'connecting you to a specialist',
      'transfer you to a specialist',
      'transfer you to an expert',
      'transfer you to our expert',
      'route you to our expert',
      'routing you to our expert',
      'route you to a specialist',
      'route you to the specialist',
      'specialist will assist',
      'specialist will assist you',
      'expert will help you',
      'expert will assist',
      'expert will assist you',
      'specialist will be with you',
      'expert will be with you',
      'expert who will assist',
      'specialist who will help',
      
      // Upgrade specific
      'upgrade expert',
      'card upgrade expert',
      'upgrade specialist',
      'upgrade team',
      
      // Hold/wait/stay phrases
      'please hold on while i connect',
      'please hold for a moment while i transfer',
      'please hold while i transfer',
      'please hold while i connect',
      'one moment while i connect',
      'one moment while i transfer',
      'hold on while i transfer',
      'hold on while i connect',
      'please wait while i connect',
      'please wait while i transfer',
      'please stay on the line',
      'stay on the line',
      'hold for a moment',
      'wait for a moment',
      
      // Action in progress - full forms
      'i will transfer you now',
      'i will transfer you',
      'i am transferring you now',
      'i am transferring you',
      'i am connecting you',
      'transfer in progress',
      'transferring now',
      'connecting now',
      
      // Action in progress - contractions
      "i'll transfer you now",
      "i'm transferring you now",
      "i'm transferring you",
      "i'm connecting you",
      
      // Bank specific
      'dispatch support expert',
      'card dispatch support',
      'dispatch specialist',
      'dispatch team',
      'dispatch expert',
      'delivery specialist',
      'delivery expert',
      'delivery team',
      're-dispatch team',
      're-dispatch specialist',
      're-dispatch expert',
      
      // Insurance specific
      'claim support expert',
      'claims support expert',
      'claim specialist',
      'claims specialist',
      'claims team',
      'claim processing expert',
      'claims processing expert',
      'claims department',
      'claim department',
      
      // General support transfer
      'human support specialist',
      'human specialist',
      'human agent',
      'human representative',
      'human expert',
      'customer support specialist',
      'customer service specialist',
      'support team member',
      'support specialist',
      'senior specialist',
      'senior expert',
      'dedicated specialist',
      'dedicated expert',
      
      // Additional action variations
      'let me transfer you',
      'let me transfer your call',
      'i will now transfer',
      "i'll now transfer",
      'transferring your case',
      'transfer your case',
      'directing you to',
      'direct you to',
      'putting you through to',
      'put you through to',
      'forward you to',
      'forwarding you to',
      
      // Expert assistance phrases
      'who will help you',
      'who will assist you',
      'who can help you',
      'who can assist you'
    ];
    
    // Check for email action - for ALL scenarios (trade, bank, insurance)
    const hasEmailConclusion = emailConclusionPhrases.some(phrase => lowerText.includes(phrase));
    
    // Check for human transfer action (for bank/insurance scenarios)
    const hasTransferConclusion = transferConclusionPhrases.some(phrase => lowerText.includes(phrase));
    
    // For Bank/Insurance: Check for BOTH email and transfer in the same response
    if (isBankOrInsurance) {
      if (hasEmailConclusion && hasTransferConclusion) {
        // Both detected in same response - show email first, then transfer automatically
        console.log('✅ Both email and transfer detected in same response! Showing email animation first...');
        console.log('📊 Current state - sessionId:', sessionId, 'callSummary exists:', !!callSummary);
        
        // Generate call summary now for the upcoming transfer
        if (sessionId) {
          if (!callSummary) {
            try {
              console.log('📋 Generating call summary for transfer...');
              const response = await fetch(`/api/session/${sessionId}/summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              });

              if (response.ok) {
                const data = await response.json();
                setCallSummary(data.summary);
                console.log('✅ Summary generated successfully (will show after email animation)');
              } else {
                console.error('❌ Summary generation failed with status:', response.status);
              }
            } catch (error) {
              console.error('Failed to generate summary for transfer:', error);
            }
          } else {
            console.log('ℹ️ Summary already exists, will show after email animation');
          }
        } else {
          console.error('❌ No sessionId available for summary generation');
        }
        
        setPendingTransfer(true); // Mark that transfer should follow
        setActionType('email');
        setShowActionModal(true);
        return;
      } else if (hasEmailConclusion) {
        // Only email detected
        console.log('✅ Email conclusion detected for bank/insurance! Triggering animation...');
        setActionType('email');
        setShowActionModal(true);
        return;
      } else if (hasTransferConclusion) {
        // Only transfer detected
        console.log('✅ Human transfer detected for bank/insurance! Showing animation first...');
        console.log('📊 Current state - sessionId:', sessionIdRef.current, 'callSummary exists:', !!callSummary);
        
        // Show transfer animation first, summary will be triggered after animation completes
        setActionType('human_transfer');
        setShowActionModal(true);
        return;
      }
    }
    
    // For Trade: Check for transfer (trade-use-case-2 specific)
    const tradeTransferPhrases = [
      'connect you to one of our experts',
      'connect you to our experts',
      'connect you with one of our experts',
      'connect you with our experts',
      'transfer you to one of our experts',
      'transfer you to our experts',
      "i'll connect you to one of our experts",
      "i will connect you to one of our experts",
      'connect you to an expert',
      'connect you with an expert',
      'transfer you to an expert',
      'experts for the further process',
      'expert for the further process',
      'experts will assist you further',
      'expert will assist you further'
    ];
    
    const hasTradeTransfer = tradeTransferPhrases.some(phrase => lowerText.includes(phrase));
    
    // For Trade: Check for email OR transfer
    if (isTrade) {
      if (hasEmailConclusion) {
        console.log('✅ Email conclusion detected for trade! Triggering animation...');
        setActionType('email');
        setShowActionModal(true);
        return;
      } else if (hasTradeTransfer) {
        console.log('✅ Expert transfer detected for trade! Triggering animation...');
        setActionType('human_transfer');
        setShowActionModal(true);
        return;
      }
    }
    
    console.log('❌ No action detected or wrong scenario for this message');
  };

  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'user_transcript_completed':
        // User finished speaking - add message with sentiment
        const sentiment = message.sentiment || null;
        addMessage('user', message.transcript, sentiment);
        
        // Update current sentiment for display and history
        if (sentiment) {
          setCurrentSentiment(sentiment);
          setSentimentHistory(prev => [...prev, sentiment]);
          console.log('😊 Sentiment:', sentiment.sentiment, sentiment.emoji, '| Emotion:', sentiment.emotion);
        }
        console.log('User said:', message.transcript);
        // Clear any previous assistant streaming message when user speaks
        setCurrentAssistantMessage('');
        break;
        
      case 'assistant_transcript_delta':
        // Real-time streaming of assistant's speech - accumulate for current response
        setCurrentAssistantMessage(prev => {
          // If this is the first delta of a new response, start fresh
          if (prev === '' || message.delta === prev) {
            return message.delta || '';
          }
          return prev + (message.delta || '');
        });
        break;
        
      case 'assistant_transcript_done':
        // Assistant finished speaking - use final transcript and clear streaming
        const finalTranscript = message.transcript || currentAssistantMessage;
        if (finalTranscript) {
          addMessage('assistant', finalTranscript);
          // Store transcript for later action detection after audio completes
          lastAssistantTranscriptRef.current = finalTranscript;
          // Mark audio as playing
          setIsAudioPlaying(true);
        }
        setCurrentAssistantMessage(''); // Clear streaming message
        console.log('Assistant said:', finalTranscript);
        break;
        
      case 'response.audio.delta':
      case 'assistant_audio_delta':
        // Avatar audio response started - clear previous streaming text
        break;
        
      case 'speech_started':
        // User started speaking - clear any assistant streaming
        setCurrentAssistantMessage('');
        break;
        
      case 'response_done':
        // Response completely finished - ensure streaming is cleared
        setCurrentAssistantMessage('');
        
        // Clear any existing timer
        if (audioPlaybackTimerRef.current) {
          clearTimeout(audioPlaybackTimerRef.current);
        }
        
        // Add delay to ensure audio has finished playing
        // Calculate delay based on transcript length (rough estimate: 150 words per minute = 2.5 words per second)
        if (lastAssistantTranscriptRef.current) {
          const transcript = lastAssistantTranscriptRef.current;
          const wordCount = transcript.split(/\s+/).length;
          // Add 400ms per word as buffer (slower than typical speech for safety)
          const estimatedDelay = Math.max(2000, wordCount * 400); // Minimum 2 seconds
          
          console.log(`⏱️ Delaying action detection for ${estimatedDelay}ms (${wordCount} words)`);
          
          audioPlaybackTimerRef.current = setTimeout(() => {
            console.log('🎬 Audio playback should be complete, checking for actions now...');
            setIsAudioPlaying(false);
            detectAction(transcript);
            lastAssistantTranscriptRef.current = ''; // Clear after processing
            audioPlaybackTimerRef.current = null;
          }, estimatedDelay);
        }
        break;
        
      case 'avatar_connecting':
        console.log('Avatar connecting...');
        setAvatarLoading(true);
        break;
      case 'avatar_connected':
        console.log('Avatar connected!');
        setAvatarLoading(false);
        break;
      case 'avatar_disconnected':
        console.log('Avatar disconnected by server');
        setAvatarConnected(false);
        setAvatarLoading(false);
        if (peerConnection) {
          peerConnection.close();
          setPeerConnection(null);
        }
        if (videoRef.current) {
          videoRef.current.srcObject = null;
        }
        break;
      case 'event': {
        const payload = message.payload as Record<string, any> | undefined;
        if (payload?.type === "session.updated") {
          console.log('Received session.updated:', payload);
          const session = payload.session ?? {};
          const avatar = session.avatar ?? {};
          
          // Look for ICE servers in multiple locations
          const candidateSources = [
            avatar.ice_servers,
            session.rtc?.ice_servers,
            session.ice_servers,
          ].find((value) => Array.isArray(value));
          
          if (candidateSources) {
            const normalized: RTCIceServer[] = candidateSources
              .map((entry: any) => {
                if (typeof entry === "string") {
                  return { urls: entry } as RTCIceServer;
                }
                if (entry && typeof entry === "object") {
                  const { urls, username, credential } = entry;
                  if (!urls) {
                    return null;
                  }
                  return {
                    urls,
                    username,
                    credential,
                  } as RTCIceServer;
                }
                return null;
              })
              .filter((entry): entry is RTCIceServer => Boolean(entry));
            
            if (normalized.length) {
              setAvatarIceServers(normalized);
              console.log(`Received ${normalized.length} ICE server${normalized.length > 1 ? "s" : ""} from session:`, normalized);
            }
          }
        }
        break;
      }
      case 'error':
        console.error('Voice Live error:', message.payload);
        break;
      default:
        console.log('Received message:', message);
    }
  };

  const addMessage = (role: 'user' | 'assistant', content: string, sentiment?: SentimentData | null) => {
    const newMessage: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
      isRecent: true,
      sentiment: sentiment || undefined
    };
    setMessages(prev => [...prev, newMessage]);
  };

  // Calculate sentiment trend based on recent history
  const getSentimentTrend = (): string => {
    if (sentimentHistory.length < 2) return '→';
    
    const recent = sentimentHistory.slice(-3);
    const sentimentScores = recent.map(s => 
      s.sentiment === 'positive' ? 1 : s.sentiment === 'negative' ? -1 : 0
    );
    
    const avg = sentimentScores.reduce((a: number, b) => a + b, 0) / sentimentScores.length;
    if (avg > 0.3) return '↗️';
    if (avg < -0.3) return '↘️';
    return '→';
  };

  // Format session duration
  const getSessionDuration = (): string => {
    if (!sessionStartTime) return '0:00';
    
    const now = new Date();
    const diff = Math.floor((now.getTime() - sessionStartTime.getTime()) / 1000);
    const minutes = Math.floor(diff / 60);
    const seconds = diff % 60;
    
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const clearConversationHistory = () => {
    setMessages([]);
    setRecentMessages([]);
    setCurrentAssistantMessage(''); // Clear any streaming assistant message
    console.log('🧹 Conversation history cleared');
  };

  const disconnectAvatar = async () => {
    if (!sessionId || !avatarConnected) return;

    try {
      // Close WebRTC connection
      if (peerConnection) {
        peerConnection.close();
        setPeerConnection(null);
      }

      // Clear video
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      // Remove audio element
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }

      // Call backend to disconnect avatar
      const response = await fetch(`/api/session/${sessionId}/avatar/disconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Backend avatar disconnect failed:', errorData);
      }

      setAvatarConnected(false);
      setAvatarLoading(false);
      console.log('Avatar disconnected');

    } catch (error) {
      console.error('Failed to disconnect avatar:', error);
      // Still set state to disconnected even if backend call fails
      setAvatarConnected(false);
      setAvatarLoading(false);
      setPeerConnection(null);
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.pause();
        remoteAudioRef.current.srcObject = null;
        remoteAudioRef.current.remove();
        remoteAudioRef.current = null;
      }
    }
  };

  const connectAvatar = async () => {
    if (!sessionId || avatarConnected || avatarLoading) return;

    setAvatarLoading(true);
    console.log('Starting avatar connection...');

    try {
      // Create RTCPeerConnection with ICE servers from Azure
      const pc = new RTCPeerConnection({
        bundlePolicy: "max-bundle",
        iceServers: avatarIceServers.length > 0 ? avatarIceServers : [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      
      console.log('Created RTCPeerConnection with ICE servers:', pc.getConfiguration().iceServers);

      // Add receive-only transceivers for avatar stream
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });
      console.log('Added audio and video transceivers');

      // Handle incoming tracks
      pc.ontrack = (event) => {
        console.log('Received track:', event.track.kind, 'streams:', event.streams.length);
        const [stream] = event.streams;
        if (!stream) {
          console.warn('No stream received with track');
          return;
        }

        if (event.track.kind === "video" && videoRef.current) {
          console.log('Setting video srcObject');
          videoRef.current.srcObject = stream;
          videoRef.current.play().then(() => {
            console.log('Video playing successfully');
            setAvatarConnected(true);
            setAvatarLoading(false);
          }).catch((err) => {
            console.error('Failed to play video:', err);
          });
        }

        if (event.track.kind === "audio") {
          console.log('Setting up audio track');
          // Create hidden audio element for WebRTC audio
          let audioEl = remoteAudioRef.current;
          if (!audioEl) {
            audioEl = document.createElement("audio");
            audioEl.autoplay = true;
            audioEl.controls = false;
            audioEl.style.display = "none";
            audioEl.setAttribute("playsinline", "true");
            audioEl.muted = false;
            document.body.appendChild(audioEl);
            remoteAudioRef.current = audioEl;
          }
          audioEl.srcObject = stream;
          audioEl.play().catch((err) => console.warn('Audio autoplay failed:', err));
          console.log('Avatar audio track configured');
        }
      };

      // Monitor connection states
      pc.onconnectionstatechange = () => {
        console.log('WebRTC connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          console.error('WebRTC connection failed');
          setAvatarLoading(false);
          setAvatarConnected(false);
        }
        if (pc.connectionState === 'disconnected') {
          console.log('WebRTC disconnected');
          setAvatarConnected(false);
          setPeerConnection(null);
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('ICE connection state:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          console.error('ICE connection failed - check network/TURN servers');
        }
      };

      // Wait for ICE gathering to complete
      const gatheringFinished = new Promise<void>((resolve) => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        } else {
          pc.addEventListener("icegatheringstatechange", () => {
            if (pc.iceGatheringState === "complete") {
              resolve();
            }
          });
        }
      });

      // Create and set local description
      console.log('Creating SDP offer...');
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await gatheringFinished;

      const localSdp = pc.localDescription?.sdp;
      if (!localSdp) {
        throw new Error("Failed to obtain local SDP");
      }

      console.log('Sending SDP offer to backend, SDP length:', localSdp.length);
      
      // Send SDP offer to backend using the correct endpoint
      const response = await fetch(`/api/session/${sessionId}/avatar/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_sdp: localSdp }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Avatar offer failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('Received SDP answer from backend, length:', data.server_sdp?.length);

      // Set remote description with Azure's SDP answer
      await pc.setRemoteDescription({ type: "answer", sdp: data.server_sdp });
      console.log('Set remote description successfully');

      setPeerConnection(pc);
      console.log('Avatar SDP negotiation completed');

    } catch (error) {
      console.error('Failed to connect avatar:', error);
      setAvatarLoading(false);
      setAvatarConnected(false);
      alert(`Failed to connect avatar: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const startRecording = async () => {
    try {
      console.log('Starting microphone with PCM audio...');
      
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 24000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });

      // Create AudioContext for PCM processing
      const audioContext = new AudioContext({ sampleRate: 24000 });
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);

      source.connect(processor);
      processor.connect(audioContext.destination);

      // Process audio and send PCM chunks
      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        const inputData = e.inputBuffer.getChannelData(0);
        
        // Convert Float32Array to Int16Array (PCM 16-bit)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Convert to base64
        const bytes = new Uint8Array(pcmData.buffer);
        const base64 = btoa(String.fromCharCode(...bytes));

        // Send PCM audio chunk
        ws.send(JSON.stringify({
          type: 'audio_chunk',
          audio: base64
        }));
      };

      // Store all references for cleanup
      setMediaRecorder({ 
        stop: () => {
          console.log('Stopping audio processing...');
          try {
            processor.onaudioprocess = null;
            processor.disconnect();
            source.disconnect();
            stream.getTracks().forEach(track => {
              track.stop();
              console.log('Stopped track:', track.kind);
            });
            audioContext.close().then(() => {
              console.log('AudioContext closed');
            });
          } catch (err) {
            console.error('Error during cleanup:', err);
          }
        },
        stream: stream,
        audioContext: audioContext,
        processor: processor,
        source: source
      } as any);
      
      setIsRecording(true);
      console.log('✅ PCM audio streaming started');

    } catch (error) {
      console.error('Failed to start recording:', error);
      alert(`Microphone error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const stopRecording = () => {
    console.log('Stop recording called');
    if (mediaRecorder) {
      try {
        // Call the stop function we defined
        mediaRecorder.stop();
        
        // Commit audio buffer to Azure
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'commit_audio' }));
          console.log('Committed audio buffer');
        }
        
        // Clear the recorder reference
        setMediaRecorder(null);
        setIsRecording(false);
        console.log('✅ Recording stopped');
        
      } catch (error) {
        console.error('Error stopping recording:', error);
        setMediaRecorder(null);
        setIsRecording(false);
      }
    }
  };

  const sendTextMessage = async (text: string) => {
    if (!sessionId || !text.trim()) return;

    try {
      await fetch(`/api/session/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
    } catch (error) {
      console.error('Failed to send message:', error);
    }
  };

  const handleTextSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const text = formData.get('message') as string;
    if (text) {
      sendTextMessage(text);
      e.currentTarget.reset();
    }
  };

  // Pre-defined bot templates
  const predefinedBots: Record<string, { name: string; icon: string; scenario: string; callHistory?: Array<{ callNumber: number; date: string; customerName: string; purpose: string; details: string; outcome: string; }> }> = {
    'default': {
      name: 'Default',
      icon: '⚙️',
      scenario: ''
    },
    'Credit-card Re-issue': {
      name: 'Global Trust Bank',
      icon: '💳',
      scenario: `Customer Name: Mr. Raj Kapoor
Bank: Global Trust Bank
Contact Type: Inbound Phone Call
Current Call Number: 4th call in 10 days

Background:

Mr. Raj Kapoor had applied for a Global Trust Bank Credit Card 10 days ago. His application was successfully processed and the card was dispatched to his home address through Bluedart courier.

However, due to Mr. Kapoor not being available at the delivery location at the time of courier attempt, the card was returned back to the bank.

Mr. Kapoor had already contacted the bank earlier:
- First Call: To inquire about credit card options and offers - showed interest in Global Trust Cashback Credit Card.
- Second Call: To apply for the new credit card — KYC and verification completed.
- Third Call: To check status when the estimated delivery date passed.

Now, this is his fourth call.`,
      callHistory: [
        {
          callNumber: 1,
          date: '27 October 2025',
          customerName: 'Raj Kapoor',
          purpose: 'Credit Card Inquiry and Offers',
          details: 'Customer called to inquire about available credit card options and ongoing offers. The agent explained the features and benefits of different Global Trust Bank credit cards, including cashback, travel, and rewards variants. Customer showed interest in the Global Trust Cashback Credit Card and requested guidance on the application process.',
          outcome: 'Inquiry resolved. Customer informed about eligibility criteria and required documents. Customer mentioned intent to apply soon.'
        },
        {
          callNumber: 2,
          date: '28 October 2025',
          customerName: 'Raj Kapoor',
          purpose: 'Credit Card Application',
          details: 'Customer called to apply for a new Global Trust Bank credit card. KYC details were collected and verified. Customer selected the Global Trust Cashback Credit Card. Application was submitted successfully.',
          outcome: 'Application submitted. Customer informed estimated delivery time of 5–7 business days.'
        },
        {
          callNumber: 3,
          date: '03 November 2025',
          customerName: 'Raj Kapoor',
          purpose: 'Credit Card Delivery Status',
          details: 'Customer called to check status as delivery time was exceeded. System showed card dispatched via Bluedart courier and delivery attempt was made but not completed.',
          outcome: 'Customer advised to keep phone available for courier contact. Customer acknowledged and agreed.'
        }
      ]
    },
    'Insurance Claim Re-Submission': {
      name: 'Global Trust Insurance',
      icon: '🛡️',
      scenario: `Customer Name: Ms. Priya Sharma
Organization: Global Trust Insurance (GTI)
Contact Type: Inbound Phone Call
Current Call Number: 4th call within 2 weeks

🧾 Background / Call History:

First Call:
Ms. Sharma inquired about hospitals covered under the GTI Health Insurance network. The agent explained network access details and she expressed interest in purchasing a policy.

Second Call:
She purchased a GTI Health Insurance Policy and was guided on how to submit a medical reimbursement claim.

Third Call:
She contacted to check her claim status. The claim was placed on hold due to a missing document — Hospital Discharge Summary.

Current Call (Now):
She has the missing document ready and wants to re-submit it so her claim can continue processing.`,
      callHistory: [
        {
          callNumber: 1,
          date: '17 October 2025',
          customerName: 'Priya Sharma',
          purpose: 'Health Insurance Network Inquiry',
          details: 'Customer called to inquire about the list of hospitals covered under the GTI Health Insurance network. The agent explained how to check empanelled hospitals through the GTI website and mobile app, and also shared key coverage details for cashless hospitalization. Customer expressed interest in purchasing a policy after reviewing the network.',
          outcome: 'Inquiry resolved. Customer informed about network access and eligibility details.'
        },
        {
          callNumber: 2,
          date: '18 October 2025',
          customerName: 'Priya Sharma',
          purpose: 'Health Insurance Purchase and Claim Guidance',
          details: 'Customer purchased a new GTI Health Insurance policy and asked how to submit a medical reimbursement claim. The agent explained the document requirements and guided the customer to use the GTI Mobile App (Claims → Submit Claim).',
          outcome: 'Customer understood the claim submission process and ended the call politely.'
        },
        {
          callNumber: 3,
          date: '27 October 2025',
          customerName: 'Priya Sharma',
          purpose: 'Claim Status Follow-Up',
          details: 'Customer contacted support to check the status of her reimbursement claim. The system showed that the claim was placed on hold due to a missing Hospital Discharge Summary document. Customer was informed about the missing document and was advised to re-submit via the secure upload link or through the GTI App.',
          outcome: 'Customer acknowledged and said she would arrange the required document and call back once ready.'
        }
      ]
    },
    'Trade Reversal': {
      name: 'Global Trust Trade',
      icon: '📈',
      scenario: `Customer Name:Mr. Arjun Mehta
Brokerage/Platform: Global Trust Securities (GTS)
Contact Type: Inbound Phone Call


🧾 Background:

Mr. Mehta recently placed a stock trade through the GTS trading platform.
He bought shares of Infosys during market hours.

After the trade was executed successfully, he realized that he did not intend to purchase the quantity he ordered and is now requesting to reverse or cancel the trade.

Mr. Mehta contacted customer support right after the trade, asking if the order could be reversed.`
    },
    'Mutual Funds Trade Outbound Call': {
      name: 'Global Trust Trade',
      icon: '💰',
      scenario: `Agent Name: Maya
Organization: Global Trust Trade
Contact Type: Outbound Call
Objective: Introduce mutual fund investment options

🧾 Background:

Maya is making an outbound call to an Indian customer to introduce Global Trust Trade's mutual fund investment opportunities.

The call focuses on:
- Explaining mutual fund benefits in simple terms
- Highlighting growth potential and tax savings
- Offering to connect with an investment advisor for personalized assistance

This is a proactive awareness call to help customers explore investment options.`
    },
    'Mutual Fund Comparison': {
      name: 'Global Trust Trade',
      icon: '📊',
      scenario: `Agent Name: Maya
Organization: Global Trust Trade
Contact Type: Inbound Call
Objective: Compare two mutual funds

🧾 Background:

Customer is calling to understand the differences between:
- Aditya Birla Sun Life Multi Asset Allocation Fund
- Aditya Birla Sun Life Flexi Cap Fund

The customer wants to know:
- Key differences between the funds
- Risk profiles and asset allocation
- Which fund suits their investment goals
- Minimum investment requirements

Maya will provide a comprehensive comparison without giving direct investment advice.`
    }
  };

  const loadPredefinedBot = async (botKey: string) => {
    try {
      const response = await fetch(`/api/predefined-bots/${botKey}`);
      if (!response.ok) {
        throw new Error('Failed to load bot template');
      }
      
      const data = await response.json();
      
      if (!data.available) {
        alert(data.instructions);
        return;
      }
      
      // Get the bot scenario and put it in context field
      const bot = predefinedBots[botKey as keyof typeof predefinedBots];
      const scenarioText = bot && bot.scenario ? bot.scenario : '';
      
      setConfig(prev => ({
        ...prev,
        instructions: data.instructions,
        agent_name: botKey,
        context: scenarioText  // Put scenario in context field
      }));
      
    } catch (error) {
      console.error('Failed to load predefined bot:', error);
      alert('Failed to load bot template. Please try again.');
    }
  };

  const saveConfiguration = async () => {
    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          agent_name: config.agent_name,
          instructions: config.instructions,
          context: config.context
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('Agent configuration result:', result);
        
        // Update config with the agent ID
        setConfig(prev => ({ ...prev, agent_id: result.agent_id }));
        
        // Update agent status
        setAgentStatus({ has_agent: true, ready_for_session: true });
        
        alert(result.message);
      } else {
        const error = await response.json();
        throw new Error(error.detail || `HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to save configuration:', error);
      alert(`Failed to save configuration: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  return (
    <>
      <style>{`
        html, body, #root {
          background: #ffffff !important;
          margin: 0 !important;
          padding: 0 !important;
          min-height: 100vh !important;
          height: 100% !important;
          overflow-x: hidden !important;
        }
        
        /* Force ALL elements to avoid colored backgrounds */
        * {
          box-sizing: border-box;
        }
        
        *:not(input):not(textarea):not(select) {
          
        }
        
        /* Ensure entire page is covered */
        body::before {
          content: '';
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 200vh;
          background: #ffffff;
          z-index: -1000;
        }
        
        /* Additional coverage for scrolling */
        html::before {
          content: '';
          position: fixed;
          top: -100vh;
          left: -100vw;
          width: 300vw;
          height: 300vh;
          background: #ffffff;
          z-index: -2000;
        }
      `}</style>
      <div style={{
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#ffffff',
        minHeight: '100vh',
        height: '100%',
        color: '#1a1a1a',
        position: 'relative'
      }}>
      {/* Main Container - 2 Column Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isConfigCollapsed ? '1fr 0px' : '1fr 400px',
        height: '100vh',
        minHeight: '100vh',
        gap: 0,
        background: '#ffffff',
        transition: 'grid-template-columns 0.3s ease'
      }}>
        
        {/* Left Column - Main App */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          background: '#f8fafc',
          borderRight: '1px solid #e2e8f0'
        }}>
          
          {/* Header */}
          <div style={{
            padding: '24px 32px',
            background: '#ffffff',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
          }}>
            <h1 style={{
              fontSize: '28px',
              fontWeight: '700',
              margin: 0,
              color: '#2563eb',
              letterSpacing: '-0.5px'
            }}>
              Global Trust Contact Center
            </h1>
            
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px'
            }}>
              {!isConnected && (
                <>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 18px',
                    background: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '25px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#dc2626',
                    boxShadow: '0 4px 6px -1px rgba(239, 68, 68, 0.1)',
                    transition: 'all 0.3s ease'
                  }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: '#ef4444'
                    }} />
                    <span>Disconnected</span>
                  </div>
                  
                  <button 
                    onClick={startSession}
                    disabled={!config.agent_id}
                    style={{
                      padding: '12px 24px',
                      background: !config.agent_id
                        ? 'rgba(148, 163, 184, 0.1)'
                        : 'linear-gradient(45deg, #3b82f6, #1d4ed8)',
                      border: 'none',
                      borderRadius: '12px',
                      color: !config.agent_id ? '#64748b' : 'white',
                      fontWeight: '600',
                      fontSize: '14px',
                      cursor: !config.agent_id ? 'not-allowed' : 'pointer',
                      opacity: !config.agent_id ? 0.5 : 1,
                      boxShadow: !config.agent_id ? 'none' : '0 8px 25px -8px rgba(59, 130, 246, 0.4)',
                      transition: 'all 0.3s ease',
                      transform: 'translateY(0)'
                    }}
                    onMouseEnter={(e) => {
                      if (config.agent_id) {
                        e.currentTarget.style.transform = 'translateY(-2px)';
                        e.currentTarget.style.boxShadow = '0 12px 35px -8px rgba(59, 130, 246, 0.5)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (config.agent_id) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 8px 25px -8px rgba(59, 130, 246, 0.4)';
                      }
                    }}
                  >
                    {!config.agent_id ? 'Create Agent First' : 'Start Session'}
                  </button>
                </>
              )}
              
              <button 
                onClick={() => fetchCallSummary(false)}
                disabled={messages.length === 0 || summaryLoading}
                style={{
                  padding: '8px 16px',
                  background: (messages.length === 0 || summaryLoading)
                    ? 'rgba(148, 163, 184, 0.1)' 
                    : 'linear-gradient(45deg, #8b5cf6, #7c3aed)',
                  border: 'none',
                  borderRadius: '8px',
                  color: (messages.length === 0 || summaryLoading) ? '#64748b' : 'white',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: (messages.length === 0 || summaryLoading) ? 'not-allowed' : 'pointer',
                  opacity: (messages.length === 0 || summaryLoading) ? 0.5 : 1,
                  boxShadow: (messages.length === 0 || summaryLoading) ? 'none' : '0 4px 12px rgba(139, 92, 246, 0.3)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  letterSpacing: '0.3px'
                }}
                onMouseEnter={(e) => {
                  if (messages.length > 0 && !summaryLoading) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(139, 92, 246, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (messages.length > 0 && !summaryLoading) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
                  }
                }}
              >
                {summaryLoading ? '⏳ Generating...' : '📋 View Call Summary'}
              </button>

              <button 
                onClick={fetchCallAnalytics}
                disabled={!callSummary || analyticsLoading}
                style={{
                  padding: '10px 20px',
                  background: callSummary && !analyticsLoading 
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' 
                    : 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)',
                  border: 'none',
                  borderRadius: '10px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: callSummary && !analyticsLoading ? 'pointer' : 'not-allowed',
                  boxShadow: callSummary && !analyticsLoading 
                    ? '0 4px 12px rgba(16, 185, 129, 0.3)' 
                    : 'none',
                  transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  opacity: callSummary && !analyticsLoading ? 1 : 0.6,
                  transform: 'translateY(0)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  letterSpacing: '0.3px'
                }}
                onMouseEnter={(e) => {
                  if (callSummary && !analyticsLoading) {
                    e.currentTarget.style.transform = 'translateY(-2px)';
                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.4)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (callSummary && !analyticsLoading) {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(16, 185, 129, 0.3)';
                  }
                }}
              >
                {analyticsLoading ? '⏳ Generating...' : '📊 View Call Analytics'}
              </button>
              
              {/* Test Analytics UI Button 
              <button 
                onClick={() => {
                  setCallAnalytics(`Overall Outcome
Intent: Inquired about credit card delivery status
Outcome: Re-dispatch request confirmed
Next Steps: Transfer to Card Upgrade Expert
Compliance: Verification completed
Call Type: Inbound
Opportunity: Card upgrade discussed

Support Associate Outcome
Agent Action: Processed re-dispatch request and offered upgrade
Agent Performance: Cooperative and informative

Customer Outcome
Sentiment: Positive`);
                  setShowAnalytics(true);
                }}
                style={{
                  padding: '8px 16px',
                  background: 'linear-gradient(45deg, #ec4899, #db2777)',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '13px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(236, 72, 153, 0.3)',
                  transition: 'all 0.3s ease'
                }}
              >
                🧪 Test Analytics UI
              </button>
              */}
              
              {/* Test Animation Buttons
              <button 
                onClick={() => {
                  setActionType('email');
                  setShowActionModal(true);
                }}
                style={{
                  padding: '12px 24px',
                  background: 'linear-gradient(45deg, #10b981, #059669)',
                  border: 'none',
                  borderRadius: '12px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 8px 25px -8px rgba(16, 185, 129, 0.4)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 35px -8px rgba(16, 185, 129, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 25px -8px rgba(16, 185, 129, 0.4)';
                }}
              >
                📧 Test Email Animation
              </button>

              <button 
                onClick={() => {
                  setActionType('human_transfer');
                  setShowActionModal(true);
                }}
                style={{
                  padding: '12px 24px',
                  background: 'linear-gradient(45deg, #f59e0b, #d97706)',
                  border: 'none',
                  borderRadius: '12px',
                  color: 'white',
                  fontWeight: '600',
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 8px 25px -8px rgba(245, 158, 11, 0.4)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 35px -8px rgba(245, 158, 11, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 25px -8px rgba(245, 158, 11, 0.4)';
                }}
              >
                👤 Test Human Transfer Animation
              </button>
            
             */}


            </div>

          </div>

          {/* Compact Sentiment Analysis Bar */}
          {isConnected && currentSentiment && (
            <div style={{
              padding: '8px 24px',
              background: 'linear-gradient(to right, rgba(59, 130, 246, 0.05), rgba(147, 51, 234, 0.05))',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              fontSize: '13px',
              color: '#475569',
              flexWrap: 'nowrap',
              minHeight: '40px',
              flexShrink: 0
            }}>
              {/* Current Sentiment */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontWeight: '600',
                color: currentSentiment.sentiment === 'positive' 
                  ? '#10b981' 
                  : currentSentiment.sentiment === 'negative'
                  ? '#ef4444'
                  : '#6b7280'
              }}>
                <span style={{ fontSize: '18px' }}>{currentSentiment.emoji}</span>
                <span style={{ textTransform: 'capitalize' }}>{currentSentiment.emotion}</span>
              </div>
              
              <div style={{ 
                width: '1px', 
                height: '20px', 
                background: '#e2e8f0' 
              }} />
              
              {/* Trend Indicator */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>Trend:</span>
                <span style={{ fontSize: '16px' }}>{getSentimentTrend()}</span>
              </div>
              
              <div style={{ 
                width: '1px', 
                height: '20px', 
                background: '#e2e8f0' 
              }} />
              
              {/* Message Count */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>Messages:</span>
                <span style={{ fontWeight: '600' }}>{messages.filter(m => m.role === 'user').length}</span>
              </div>
              
              <div style={{ 
                width: '1px', 
                height: '20px', 
                background: '#e2e8f0' 
              }} />
              
              {/* Duration */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>Duration:</span>
                <span style={{ fontWeight: '600', fontFamily: 'monospace' }}>{getSessionDuration()}</span>
              </div>
            </div>
          )}

          {/* Main Content Area */}
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            padding: '24px',
            gap: '24px',
            overflowY: 'auto',
            background: '#ffffff'
          }}>
            
            {/* Video Boxes Section */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '20px 16px 16px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              transition: 'all 0.3s ease',
              maxWidth: '700px',
              margin: '0 auto'
            }}>
             
              
              {/* Two Boxes Row - Leftmost and Rightmost */}
              <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start',
                marginBottom: '12px',
                width: '100%',
                gap: '24px'
              }}>
                {/* User Box */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{
                    position: 'relative',
                    width: '220px',
                    height: '160px',
                    background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                    transition: 'all 0.3s ease'
                  }}>
                    <img 
                      src={config.agent_name === 'Insurance Claim Re-Submission' 
                        ? "/customer-images/female image.png"
                        : "/customer-images/male image.png"}
                      alt={config.agent_name === 'Insurance Claim Re-Submission' 
                        ? "Female Customer"
                        : "Male Customer"}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        zIndex: 1
                      }}
                      onError={(e) => {
                        // Hide image on error and show emoji fallback
                        const target = e.currentTarget as HTMLImageElement;
                        target.style.display = 'none';
                      }}
                    />
                    {/* Fallback emoji (shown if image fails to load) */}
                    <div style={{
                      fontSize: '64px',
                      zIndex: 0,
                      position: 'relative'
                    }}>
                      {config.agent_name === 'Insurance Claim Re-Submission' ? '👩' : '👨'}
                    </div>
                  </div>
                  <div style={{
                    marginTop: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#2563eb'
                  }}>
                    Customer
                  </div>
                </div>

                {/* Voice Waveform - Between Customer and Avatar */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginTop: '60px'
                }}>
                  <VoiceWaveform isActive={isConnected && (isRecording || currentAssistantMessage !== '')} />
                </div>

                {/* Avatar Box */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  <div style={{
                    position: 'relative',
                    width: '220px',
                    height: '160px',
                    background: 'rgba(0, 0, 0, 0.3)',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    border: '2px solid rgba(59, 130, 246, 0.3)',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.2)',
                    transition: 'all 0.3s ease'
                  }}>
                    <video 
                      ref={videoRef} 
                      autoPlay 
                      playsInline 
                      muted={false}
                      controls={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover'
                      }}
                    />
                    {!avatarConnected && !avatarLoading && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        color: '#2563eb'
                      }}>
                        <div style={{
                          fontSize: '32px',
                          opacity: 0.6
                        }}>
                          🎭
                        </div>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: '500',
                          textAlign: 'center'
                        }}>
                          Avatar Disconnected
                        </div>
                      </div>
                    )}
                    {avatarLoading && (
                      <div style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '12px',
                        color: '#60a5fa'
                      }}>
                        <div style={{
                          fontSize: '24px',
                          animation: 'spin 1s linear infinite'
                        }}>
                          ⏳
                        </div>
                        <div style={{
                          fontSize: '12px',
                          fontWeight: '500'
                        }}>
                          Connecting...
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{
                    marginTop: '8px',
                    fontSize: '16px',
                    fontWeight: '600',
                    color: '#2563eb'
                  }}>
                    Maya (AI-Avatar)
                  </div>
                </div>
              </div>

              {/* Transcriptions Below Boxes - HIDDEN 
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                paddingLeft: '20px',
                paddingRight: '20px'
              }}>
                <div style={{
                  background: 'rgba(59, 130, 246, 0.05)',
                  border: '1px solid rgba(59, 130, 246, 0.2)',
                  borderRadius: '16px',
                  padding: '16px',
                  minHeight: '70px',
                  width: '280px',
                  boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.1)',
                  transition: 'all 0.3s ease'
                }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#2563eb',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>👤</span>
                    <span>USER</span>
                  </div>
                  <div style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: '#374151'
                  }}>
                    {(() => {
                      const lastUserMessage = recentMessages
                        .filter(m => m.role === 'user')
                        .slice(-1)[0];
                      
                      return lastUserMessage ? (
                        <div>
                          {lastUserMessage.content}
                          <div style={{
                            fontSize: '10px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            marginTop: '4px'
                          }}>
                            {lastUserMessage.timestamp.toLocaleTimeString()}
                          </div>
                        </div>
                      ) : (
                        <div style={{ color: '#2563eb', fontStyle: 'italic' }}>
                          Start talking...
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div style={{
                  background: 'rgba(34, 197, 94, 0.05)',
                  border: '1px solid rgba(34, 197, 94, 0.2)',
                  borderRadius: '16px',
                  padding: '16px',
                  minHeight: '70px',
                  width: '280px',
                  boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.1)',
                  transition: 'all 0.3s ease'
                }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#16a34a',
                    marginBottom: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span>🤖</span>
                    <span>AVATAR</span>
                    {currentAssistantMessage && (
                      <span style={{
                        fontSize: '10px',
                        background: 'rgba(34, 197, 94, 0.2)',
                        padding: '1px 6px',
                        borderRadius: '8px',
                        color: '#22c55e'
                      }}>
                        Speaking...
                      </span>
                    )}
                  </div>
                  <div style={{
                    fontSize: '12px',
                    lineHeight: '1.4',
                    color: '#374151'
                  }}>
                    {currentAssistantMessage ? (
                      <div>
                        {currentAssistantMessage}
                        <span style={{
                          display: 'inline-block',
                          width: '2px',
                          height: '14px',
                          background: '#22c55e',
                          marginLeft: '4px',
                          animation: 'blink 1s infinite'
                        }} />
                      </div>
                    ) : (
                      (() => {
                        const lastAssistantMessage = recentMessages
                          .filter(m => m.role === 'assistant')
                          .slice(-1)[0];
                        
                        return lastAssistantMessage ? (
                          <div>
                            {lastAssistantMessage.content}
                            <div style={{
                              fontSize: '10px',
                              color: 'rgba(255, 255, 255, 0.5)',
                              marginTop: '4px'
                            }}>
                              {lastAssistantMessage.timestamp.toLocaleTimeString()}
                            </div>
                          </div>
                        ) : (
                          <div style={{ color: '#2563eb', fontStyle: 'italic' }}>
                            Waiting for response...
                          </div>
                        );
                      })()
                    )}
                  </div>
                </div>
              </div>
              */}

              {/* Avatar Controls */}
              <div style={{
                marginTop: '8px',
                display: 'flex',
                justifyContent: 'center',
                gap: '12px'
              }}>
                {!isConnected ? (
                  <div style={{ color: '#2563eb', fontSize: '13px' }}>
                    Start a session to connect avatar
                  </div>
                ) : avatarLoading ? (
                  <div style={{ color: '#f59e0b', fontSize: '13px' }}>
                    Connecting avatar...
                  </div>
                ) : avatarConnected ? (
                  <div style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>
                    
                  </div>
                ) : (
                  <button onClick={connectAvatar} style={{
                    padding: '6px 12px',
                    background: 'linear-gradient(45deg, #22c55e, #16a34a)',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    boxShadow: '0 2px 8px rgba(34, 197, 94, 0.3)'
                  }}>
                    Connect Avatar
                  </button>
                )}
              </div>
              
              {/* Call History Button - Only for Bank and Insurance after agent is created */}
              {config.agent_id && (config.agent_name === 'Credit-card Re-issue' || config.agent_name === 'Insurance Claim Re-Submission') && (
                <div style={{
                  marginTop: '16px',
                  display: 'flex',
                  justifyContent: 'center',
                  paddingBottom: '12px'
                }}>
                  <button
                    onClick={() => {
                      setShowCallHistory(true);
                      if (isConfigCollapsed) setIsConfigCollapsed(false);
                    }}
                    style={{
                      padding: '5px 10px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(99, 102, 241, 0.3)',
                      transition: 'all 0.3s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      letterSpacing: '0.3px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 6px 20px rgba(99, 102, 241, 0.4)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(99, 102, 241, 0.3)';
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 5H7C5.89543 5 5 5.89543 5 7V19C5 20.1046 5.89543 21 7 21H17C18.1046 21 19 20.1046 19 19V7C19 5.89543 18.1046 5 17 5H15M9 5C9 6.10457 9.89543 7 11 7H13C14.1046 7 15 6.10457 15 5M9 5C9 3.89543 9.89543 3 11 3H13C14.1046 3 15 3.89543 15 5M12 12H15M12 16H15M9 12H9.01M9 16H9.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>Call History</span>
                  </button>
                </div>
              )}
            </div>

            {/* Conversation Section */}
            <div style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '24px',
              display: 'flex',
              flexDirection: 'column',
              height: '600px',
              maxHeight: '600px',
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              transition: 'all 0.3s ease'
            }}>
              <div style={{
                padding: '20px 24px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexShrink: 0
              }}>
                <h3 style={{
                  fontSize: '16px',
                  fontWeight: '600',
                  margin: 0,
                  color: '#2563eb'
                }}>
                  Conversation
                </h3>
                {messages.length > 0 && (
                  <button 
                    onClick={clearConversationHistory}
                    style={{
                      padding: '6px 12px',
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      borderRadius: '6px',
                      color: '#dc2626',
                      fontSize: '12px',
                      fontWeight: '500',
                      cursor: 'pointer'
                    }}
                  >
                    Clear History
                  </button>
                )}
              </div>
              
              {/* Scrollable Messages Container */}
              <div style={{
                flex: 1,
                padding: '16px 24px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                minHeight: 0
              }}>
                {recentMessages.map((message) => (
                  <div key={message.id} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: message.role === 'user' ? 'flex-end' : 'flex-start'
                  }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '12px 16px',
                      borderRadius: message.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: message.role === 'user' 
                        ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                        : '#f1f5f9',
                      border: message.role === 'user' ? 'none' : '1px solid #e2e8f0',
                      color: message.role === 'user' ? 'white' : '#1e293b',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      position: 'relative'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        opacity: 0.7,
                        marginBottom: '4px',
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        {message.role === 'user' ? '👤 You' : '🤖 Assistant'}
                        {/* Small Sentiment Emoji for User Messages */}
                        {message.role === 'user' && message.sentiment && (
                          <span style={{ fontSize: '14px' }}>
                            {message.sentiment.emoji}
                          </span>
                        )}
                      </div>
                      {message.content}
                    </div>
                    <div style={{
                      fontSize: '11px',
                      color: 'rgba(255, 255, 255, 0.5)',
                      marginTop: '4px',
                      marginLeft: message.role === 'user' ? '0' : '8px',
                      marginRight: message.role === 'user' ? '8px' : '0'
                    }}>
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                
                {currentAssistantMessage && (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start'
                  }}>
                    <div style={{
                      maxWidth: '80%',
                      padding: '12px 16px',
                      borderRadius: '16px 16px 16px 4px',
                      background: 'rgba(34, 197, 94, 0.2)',
                      border: '1px solid rgba(34, 197, 94, 0.3)',
                      color: 'white',
                      fontSize: '14px',
                      lineHeight: '1.5',
                      position: 'relative'
                    }}>
                      <div style={{
                        fontSize: '11px',
                        opacity: 0.7,
                        marginBottom: '4px',
                        fontWeight: '500'
                      }}>
                        🤖 Assistant (speaking...)
                      </div>
                      {currentAssistantMessage}
                      <span style={{
                        display: 'inline-block',
                        width: '2px',
                        height: '16px',
                        background: '#22c55e',
                        marginLeft: '4px',
                        animation: 'blink 1s infinite'
                      }} />
                    </div>
                  </div>
                )}
                
                <div ref={messagesEndRef} />
              </div>
              
              {/* Fixed Input Section */}
              <div style={{
                padding: '20px 24px',
                borderTop: '1px solid #e2e8f0',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-end',
                flexShrink: 0,
                background: '#ffffff'
              }}>
                <button
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={!isConnected}
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    border: 'none',
                    background: isRecording 
                      ? 'linear-gradient(45deg, #ef4444, #dc2626)'
                      : isConnected 
                        ? 'linear-gradient(45deg, #22c55e, #16a34a)'
                        : 'rgba(255, 255, 255, 0.1)',
                    color: 'white',
                    fontSize: '20px',
                    cursor: isConnected ? 'pointer' : 'not-allowed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: isRecording ? '0 4px 15px rgba(239, 68, 68, 0.4)' : 'none',
                    transition: 'all 0.2s ease'
                  }}
                >
                  {isRecording ? '⏹️' : '🎤'}
                </button>
                
                <form onSubmit={handleTextSubmit} style={{
                  flex: 1,
                  display: 'flex',
                  gap: '8px'
                }}>
                  <input
                    type="text"
                    name="message"
                    placeholder="Type your message..."
                    disabled={!isConnected}
                    style={{
                      flex: 1,
                      padding: '12px 16px',
                      background: '#ffffff',
                      border: '1px solid #d1d5db',
                      borderRadius: '24px',
                      color: '#374151',
                      fontSize: '14px',
                      outline: 'none'
                    }}
                  />
                  <button 
                    type="submit" 
                    disabled={!isConnected}
                    style={{
                      padding: '12px 20px',
                      background: isConnected 
                        ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                        : 'rgba(148, 163, 184, 0.3)',
                      border: 'none',
                      borderRadius: '24px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: isConnected ? 'pointer' : 'not-allowed',
                      boxShadow: isConnected ? '0 2px 8px rgba(59, 130, 246, 0.3)' : 'none'
                    }}
                  >
                    Send
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Configuration Panel */}
        <div style={{
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'relative',
          overflow: 'hidden',
          width: isConfigCollapsed ? '0' : '400px',
          transition: 'width 0.3s ease'
        }}>
          
          {/* Configuration Header */}
          <div style={{
            padding: '24px',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
            flexShrink: 0,
            boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <h2 style={{
              fontSize: '20px',
              fontWeight: '700',
              margin: 0,
              color: '#2563eb',
              letterSpacing: '-0.3px'
            }}>
              {showCallHistory ? 'Call History' : 'Configuration'}
            </h2>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {showCallHistory && (
                <button
                  onClick={() => setShowCallHistory(false)}
                  style={{
                    padding: '6px 14px',
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1d4ed8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2563eb';
                  }}
                >
                  ← Back
                </button>
              )}
              <button
                onClick={() => setIsConfigCollapsed(!isConfigCollapsed)}
                style={{
                  width: '28px',
                  height: '28px',
                  background: 'transparent',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  color: '#64748b',
                  fontSize: '14px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.color = '#2563eb';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.color = '#64748b';
                }}
                title={showCallHistory ? "Close Call History" : "Collapse Configuration"}
              >
                ✕
              </button>
            </div>
          </div>

          {/* Configuration/Call History Content - Scrollable */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px',
            background: '#f8fafc',
            minHeight: 0
          }}>
            
            {showCallHistory ? (
              /* Call History Panel */
              <div>
                {(() => {
                  const bot = predefinedBots[config.agent_name as keyof typeof predefinedBots];
                  const callHistory = (bot?.callHistory || []).slice().reverse();
                  
                  if (callHistory.length === 0) {
                    return (
                      <div style={{
                        padding: '40px 20px',
                        textAlign: 'center',
                        color: '#64748b'
                      }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
                        <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>No Call History Available</div>
                        <div style={{ fontSize: '14px' }}>This customer has no previous interactions on record.</div>
                      </div>
                    );
                  }
                  
                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                      {/* Customer Info Header */}
                      <div style={{
                        background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                        padding: '20px',
                        borderRadius: '12px',
                        border: '1px solid #c4b5fd'
                      }}>
                        <div style={{
                          fontSize: '14px',
                          fontWeight: '700',
                          color: '#5b21b6',
                          marginBottom: '8px',
                          letterSpacing: '0.5px',
                          textTransform: 'uppercase'
                        }}>
                          Customer Profile
                        </div>
                        <div style={{
                          fontSize: '18px',
                          fontWeight: '700',
                          color: '#1e293b',
                          marginBottom: '4px'
                        }}>
                          {callHistory[0]?.customerName}
                        </div>
                        <div style={{
                          fontSize: '13px',
                          color: '#64748b'
                        }}>
                          Total Interactions: {callHistory.length}
                        </div>
                      </div>
                      
                      {/* Call History Timeline */}
                      <div style={{
                        fontSize: '12px',
                        fontWeight: '700',
                        color: '#64748b',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        marginTop: '8px'
                      }}>
                        Previous Interactions
                      </div>
                      
                      {callHistory.map((call, index) => (
                        <div key={index} style={{
                          background: '#ffffff',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '20px',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                          position: 'relative',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.08)';
                          e.currentTarget.style.transform = 'translateY(-2px)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.04)';
                          e.currentTarget.style.transform = 'translateY(0)';
                        }}>
                          {/* Call Badge */}
                          <div style={{
                            position: 'absolute',
                            top: '-10px',
                            left: '20px',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                            color: 'white',
                            padding: '4px 12px',
                            borderRadius: '12px',
                            fontSize: '11px',
                            fontWeight: '700',
                            letterSpacing: '0.5px',
                            boxShadow: '0 4px 8px rgba(37, 99, 235, 0.3)'
                          }}>
                            CALL #{call.callNumber}
                          </div>
                          
                          {/* Date */}
                          <div style={{
                            fontSize: '12px',
                            color: '#64748b',
                            marginTop: '12px',
                            marginBottom: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M8 7V3M16 7V3M7 11H17M5 21H19C20.1046 21 21 20.1046 21 19V7C21 5.89543 20.1046 5 19 5H5C3.89543 5 3 5.89543 3 7V19C3 20.1046 3.89543 21 5 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span style={{ fontWeight: '600' }}>{call.date}</span>
                          </div>
                          
                          {/* Purpose */}
                          <div style={{
                            fontSize: '15px',
                            fontWeight: '700',
                            color: '#0f172a',
                            marginBottom: '12px',
                            lineHeight: '1.4'
                          }}>
                            {call.purpose}
                          </div>
                          
                          {/* Details */}
                          <div style={{
                            fontSize: '13px',
                            color: '#475569',
                            lineHeight: '1.6',
                            marginBottom: '16px',
                            paddingLeft: '12px',
                            borderLeft: '3px solid #e2e8f0'
                          }}>
                            {call.details}
                          </div>
                          
                          {/* Outcome */}
                          <div style={{
                            background: '#f0fdf4',
                            border: '1px solid #86efac',
                            borderRadius: '8px',
                            padding: '12px',
                            fontSize: '12px',
                            color: '#166534',
                            lineHeight: '1.5'
                          }}>
                            <div style={{
                              fontWeight: '700',
                              marginBottom: '4px',
                              textTransform: 'uppercase',
                              fontSize: '11px',
                              letterSpacing: '0.5px',
                              color: '#15803d'
                            }}>
                              Outcome
                            </div>
                            {call.outcome}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            ) : (
              <React.Fragment>
            {/* Agent Status */}
            {agentStatus.has_agent && (
              <div style={{ 
                marginBottom: '24px',
                padding: '20px',
                background: 'rgba(34, 197, 94, 0.1)',
                border: '1px solid rgba(34, 197, 94, 0.3)',
                borderRadius: '16px',
                boxShadow: '0 4px 6px -1px rgba(34, 197, 94, 0.1)',
                transition: 'all 0.3s ease'
              }}>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: '#22c55e',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  ✅ Agent Configured
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#374151',
                  marginBottom: '4px'
                }}>
                  Agent ID: {config.agent_id}
                </div>
                <div style={{
                  fontSize: '12px',
                  color: '#374151'
                }}>
                  Status: {agentStatus.ready_for_session ? 'Ready for sessions' : 'Configuration incomplete'}
                </div>
              </div>
            )}
            
            {/* Product Knowledge Handbook Button */}
            <div style={{
              marginBottom: '24px',
              padding: '20px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '12px'
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  background: 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  boxShadow: '0 2px 8px rgba(30, 64, 175, 0.2)'
                }}>
                  📘
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: '600',
                    color: '#1e293b',
                    marginBottom: '2px'
                  }}>
                    Product Knowledge Base
                  </div>
                  <div style={{
                    fontSize: '12px',
                    color: '#64748b'
                  }}>
                    Global Trust comprehensive guide
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowProductKnowledge(true)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(30, 64, 175, 0.15)',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  letterSpacing: '0.3px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(30, 64, 175, 0.25)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(30, 64, 175, 0.15)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 6.25278V19.2528M12 6.25278C10.8321 5.47686 9.24649 5 7.5 5C5.75351 5 4.16789 5.47686 3 6.25278V19.2528C4.16789 18.4769 5.75351 18 7.5 18C9.24649 18 10.8321 18.4769 12 19.2528M12 6.25278C13.1679 5.47686 14.7535 5 16.5 5C18.2465 5 19.8321 5.47686 21 6.25278V19.2528C19.8321 18.4769 18.2465 18 16.5 18C14.7535 18 13.1679 18.4769 12 19.2528" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>View Product Handbook</span>
              </button>
            </div>


















            {/* Test Session Init Animation Button */}
            {/* <div style={{ 
              marginTop: '24px',
              marginBottom: '24px',
              padding: '20px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)'
            }}>
              <button
                onClick={() => setShowSessionInit(true)}
                style={{
                  width: '100%',
                  padding: '14px 24px',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '13px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: '0 2px 8px rgba(139, 92, 246, 0.2)',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  letterSpacing: '0.3px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(139, 92, 246, 0.2)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="currentColor"/>
                </svg>
                <span>Preview Session Init Animation</span>
              </button>
              <p style={{
                fontSize: '11px',
                color: '#64748b',
                marginTop: '8px',
                textAlign: 'center',
                lineHeight: '1.5'
              }}>
                See how the agent loads knowledge base and call history
              </p>
            </div> */}





            
            {/* Agent Information */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#2563eb',
                marginBottom: '16px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                Agent Configuration
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  Model
                </label>
                <select
                  value={config.model}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '14px',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                >
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-realtime-preview">GPT-4o Realtime Preview</option>
                </select>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  Scenario
                </label>
                <input
                  type="text"
                  value={config.agent_name}
                  onChange={(e) => updateConfig({ agent_name: e.target.value })}
                  placeholder="Enter agent name..."
                  style={{
                    width: '100%',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '14px',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  <span>Context</span>
                  <button
                    onClick={() => setShowContextModal(true)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #e2e8f0',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                      e.currentTarget.style.color = '#2563eb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.color = '#64748b';
                    }}
                    title="Expand Context"
                  >
                    ⛶
                  </button>
                </label>
                <textarea
                  value={config.context}
                  onChange={(e) => updateConfig({ context: e.target.value })}
                  placeholder="Enter context for the AI agent..."
                  style={{
                    width: '100%',
                    height: '100px',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  color: '#2563eb',
                  marginBottom: '6px'
                }}>
                  <span>Instructions</span>
                  <button
                    onClick={() => setShowInstructionsModal(true)}
                    style={{
                      background: 'transparent',
                      border: '1px solid #e2e8f0',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      color: '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                      e.currentTarget.style.borderColor = '#cbd5e1';
                      e.currentTarget.style.color = '#2563eb';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                      e.currentTarget.style.color = '#64748b';
                    }}
                    title="Expand Instructions"
                  >
                    ⛶
                  </button>
                </label>
                <textarea
                  value={config.instructions}
                  onChange={(e) => updateConfig({ instructions: e.target.value })}
                  placeholder="Enter instructions for the AI agent..."
                  style={{
                    width: '100%',
                    height: '120px',
                    padding: '12px 16px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: '12px',
                    color: '#374151',
                    fontSize: '13px',
                    lineHeight: '1.5',
                    resize: 'vertical',
                    fontFamily: 'inherit',
                    outline: 'none',
                    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
                    transition: 'all 0.2s ease'
                  }}
                />
              </div>
              
              {config.agent_id && (
                <div style={{ marginBottom: '16px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: '500',
                    color: '#2563eb',
                    marginBottom: '6px'
                  }}>
                    Current Agent ID
                  </label>
                  <div style={{
                    padding: '12px 16px',
                    background: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    borderRadius: '12px',
                    color: '#22c55e',
                    fontSize: '12px',
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    boxShadow: '0 2px 4px 0 rgba(34, 197, 94, 0.1)'
                  }}>
                    {config.agent_id}
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '12px', flexDirection: 'column' }}>
              <button
                onClick={saveConfiguration}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: agentStatus.has_agent 
                    ? 'linear-gradient(45deg, #3b82f6, #1d4ed8)'
                    : 'linear-gradient(45deg, #22c55e, #16a34a)',
                  border: 'none',
                  borderRadius: '16px',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  boxShadow: agentStatus.has_agent 
                    ? '0 10px 25px -5px rgba(59, 130, 246, 0.4)'
                    : '0 10px 25px -5px rgba(34, 197, 94, 0.4)',
                  transition: 'all 0.3s ease',
                  transform: 'translateY(0)'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = agentStatus.has_agent 
                    ? '0 15px 35px -5px rgba(59, 130, 246, 0.5)'
                    : '0 15px 35px -5px rgba(34, 197, 94, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = agentStatus.has_agent 
                    ? '0 10px 25px -5px rgba(59, 130, 246, 0.4)'
                    : '0 10px 25px -5px rgba(34, 197, 94, 0.4)';
                }}
              >
                {agentStatus.has_agent ? '🔄 Update Agent' : '🤖 Create Agent'}
              </button>
              
              {/* Pre-defined Bots Dropdown */}
              <div style={{
                marginTop: '8px',
                padding: '16px',
                background: 'linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%)',
                border: '1px solid #c7d2fe',
                borderRadius: '12px'
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '13px',
                  fontWeight: '600',
                  color: '#4f46e5',
                  marginBottom: '8px'
                }}>
                  📋 Pre-defined Bots
                </label>
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      loadPredefinedBot(e.target.value);
                      e.target.value = ''; // Reset dropdown
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'white',
                    border: '1px solid #c7d2fe',
                    borderRadius: '8px',
                    color: '#374151',
                    fontSize: '13px',
                    cursor: 'pointer',
                    outline: 'none',
                    transition: 'all 0.2s ease'
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = '#6366f1';
                    e.target.style.boxShadow = '0 0 0 3px rgba(99, 102, 241, 0.1)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = '#c7d2fe';
                    e.target.style.boxShadow = 'none';
                  }}
                >
                  <option value="">Select a scenario...</option>
                  {Object.entries(predefinedBots).map(([key, bot]) => (
                    <option key={key} value={key}>
                      {bot.icon} {bot.name}
                    </option>
                  ))}
                </select>
                <div style={{
                  marginTop: '8px',
                  fontSize: '11px',
                  color: '#6366f1',
                  fontStyle: 'italic'
                }}>
                  Select a scenario to auto-fill instructions
                </div>
              </div>
              
              {/* Disconnect Avatar and Delete Agent Buttons */}
              {isConnected && (
                <>
                  {/* Disconnect Avatar Button */}
                  <button
                    onClick={disconnectAvatar}
                    disabled={!avatarConnected}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background: !avatarConnected
                        ? 'rgba(148, 163, 184, 0.1)'
                        : 'linear-gradient(45deg, #f59e0b, #d97706)',
                      border: 'none',
                      borderRadius: '12px',
                      color: !avatarConnected ? '#64748b' : 'white',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: !avatarConnected ? 'not-allowed' : 'pointer',
                      opacity: !avatarConnected ? 0.5 : 1,
                      boxShadow: !avatarConnected ? 'none' : '0 6px 20px -5px rgba(245, 158, 11, 0.4)',
                      transition: 'all 0.3s ease',
                      transform: 'translateY(0)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => {
                      if (avatarConnected) {
                        e.currentTarget.style.transform = 'translateY(-1px)';
                        e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(245, 158, 11, 0.5)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (avatarConnected) {
                        e.currentTarget.style.transform = 'translateY(0)';
                        e.currentTarget.style.boxShadow = '0 6px 20px -5px rgba(245, 158, 11, 0.4)';
                      }
                    }}
                  >
                    🔌 {avatarConnected ? 'Disconnect Avatar' : 'Avatar Not Connected'}
                  </button>

                  {/* Disconnect Session and Delete Agent Button */}
                  <button
                    onClick={disconnectSession}
                    style={{
                      width: '100%',
                      padding: '14px',
                      background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                      border: 'none',
                      borderRadius: '12px',
                      color: 'white',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      boxShadow: '0 6px 20px -5px rgba(239, 68, 68, 0.4)',
                      transition: 'all 0.3s ease',
                      transform: 'translateY(0)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(239, 68, 68, 0.5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = '0 6px 20px -5px rgba(239, 68, 68, 0.4)';
                    }}
                  >
                    🗑️ Disconnect & Delete Agent
                  </button>
                </>
              )}
             
              
              {agentStatus.has_agent && (
                <button
                  onClick={async () => {
                    if (confirm('Are you sure you want to reset the agent configuration? This will clear the current agent.')) {
                      try {
                        const response = await fetch('/api/config/agent', { method: 'DELETE' });
                        if (response.ok) {
                          setConfig(prev => ({ ...prev, agent_id: '' }));
                          setAgentStatus({ has_agent: false, ready_for_session: false });
                          alert('Agent configuration has been reset.');
                        }
                      } catch (error) {
                        alert('Failed to reset agent configuration.');
                      }
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: 'linear-gradient(45deg, #ef4444, #dc2626)',
                    border: 'none',
                    borderRadius: '12px',
                    color: 'white',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    boxShadow: '0 6px 20px -5px rgba(239, 68, 68, 0.4)',
                    transition: 'all 0.3s ease',
                    transform: 'translateY(0)'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 10px 25px -5px rgba(239, 68, 68, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateY(0)';
                    e.currentTarget.style.boxShadow = '0 6px 20px -5px rgba(239, 68, 68, 0.4)';
                  }}
                >
                  🗑️ Reset Agent
                </button>
              )}
            </div>
              </React.Fragment>
            )}
          </div>
        </div>
      </div>
      </div>
      
      {/* Floating button to show config when collapsed */}
      {isConfigCollapsed && (
        <button
          onClick={() => setIsConfigCollapsed(false)}
          style={{
            position: 'fixed',
            top: '80px',
            right: '0',
            width: '24px',
            height: '48px',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRight: 'none',
            borderRadius: '8px 0 0 8px',
            color: '#64748b',
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '-2px 2px 8px rgba(0, 0, 0, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#f8fafc';
            e.currentTarget.style.color = '#2563eb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#ffffff';
            e.currentTarget.style.color = '#64748b';
          }}
          title="Show Configuration"
        >
          ⚙
        </button>
      )}
      
      {/* CSS Animations */}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
        
        @keyframes slideUp {
          from { 
            opacity: 0; 
            transform: translateY(30px) scale(0.95); 
          }
          to { 
            opacity: 1; 
            transform: translateY(0) scale(1); 
          }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        body {
          background: #ffffff;
          margin: 0;
          padding: 0;
          animation: fadeIn 0.6s ease-out;
        }
        
        /* Enhanced scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
        }

        ::-webkit-scrollbar-track {
          background: rgba(0, 0, 0, 0.05);
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
          background: linear-gradient(45deg, rgba(59, 130, 246, 0.3), rgba(59, 130, 246, 0.5));
          border-radius: 4px;
          transition: all 0.3s ease;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(45deg, rgba(59, 130, 246, 0.5), rgba(59, 130, 246, 0.7));
        }
        
        /* Smooth focus transitions */
        input:focus, textarea:focus, select:focus {
          border-color: #3b82f6 !important;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1) !important;
        }
        
        /* Button hover effects */
        button:not(:disabled):hover {
          transition: all 0.3s ease;
        }
        
        /* Card hover effects */
        .card-hover:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        }
      `}</style>
      
      {/* Call Summary Modal */}
      {showSummary && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setShowSummary(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #e5e7eb',
            animation: 'slideUp 0.3s ease'
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9fafb'
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: '600',
                color: '#111827',
                letterSpacing: '-0.025em'
              }}>
                Call Summary Report
              </h2>
              
              <button
                onClick={() => setShowSummary(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#6b7280',
                  fontSize: '24px',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                  transition: 'all 0.2s ease',
                  fontWeight: '300'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f3f4f6';
                  e.currentTarget.style.color = '#111827';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = '#6b7280';
                }}
              >
                ×
              </button>
            </div>
            
            {/* Modal Body */}
            <div style={{
              padding: '24px',
              overflowY: 'auto',
              flex: 1,
              background: '#ffffff'
            }}>
              {(() => {
                // Parse the summary into two parts: A) Short Summary and B) Structured Summary
                const summaryText = callSummary;
                
                // Split by the B) marker to separate the two parts
                const parts = summaryText.split(/B\)\s*Structured Summary/i);
                const shortSummary = parts[0]?.replace(/A\)\s*Short Summary[^\n]*\n?/i, '').trim() || '';
                const structuredSummary = parts[1]?.trim() || '';
                
                return (
                  <>
                    {/* Part A: Short Summary */}
                    {shortSummary && (
                      <div style={{
                        marginBottom: '24px',
                        paddingBottom: '24px',
                        borderBottom: '2px solid #e5e7eb'
                      }}>
                        <h3 style={{
                          margin: '0 0 16px 0',
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#111827',
                          letterSpacing: '-0.025em'
                        }}>
                          Summary
                        </h3>
                        <div style={{
                          fontSize: '14px',
                          lineHeight: '1.7',
                          color: '#4b5563',
                          whiteSpace: 'pre-wrap',
                          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                          background: '#f9fafb',
                          padding: '16px',
                          borderRadius: '6px',
                          borderLeft: '3px solid #2563eb'
                        }}>
                          {shortSummary}
                        </div>
                      </div>
                    )}
                    
                    {/* Part B: Structured Summary (Analytics) */}
                    {structuredSummary && (
                      <div>
                        <h3 style={{
                          margin: '0 0 20px 0',
                          fontSize: '18px',
                          fontWeight: '600',
                          color: '#111827',
                          letterSpacing: '-0.025em'
                        }}>
                          Analytics
                        </h3>
                        
                        {structuredSummary.split('\n\n').map((section, index) => {
                          const lines = section.split('\n');
                          const title = lines[0];
                          const content = lines.slice(1).join('\n');
                          
                          // Skip empty sections
                          if (!title.trim() || !content.trim()) return null;
                          
                          // Detect sentiment for "Overall Sentiment" section
                          const getSentimentStyle = (sectionTitle: string, text: string) => {
                            if (!sectionTitle.toLowerCase().includes('sentiment')) return null;
                            
                            const lowerText = text.toLowerCase();
                            
                            // Professional sentiment color mapping
                            const sentiments = [
                              { keywords: ['positive', 'satisfied', 'pleased', 'happy', 'delighted', 'cheerful', 'content'], 
                                color: '#059669', bgColor: '#d1fae5', label: 'Positive' },
                              { keywords: ['negative', 'frustrated', 'upset', 'angry', 'disappointed', 'unhappy', 'annoyed'], 
                                color: '#dc2626', bgColor: '#fee2e2', label: 'Negative' },
                              { keywords: ['neutral', 'calm', 'composed', 'balanced'], 
                                color: '#4b5563', bgColor: '#f3f4f6', label: 'Neutral' },
                              { keywords: ['concerned', 'worried', 'anxious'], 
                                color: '#d97706', bgColor: '#fef3c7', label: 'Concerned' },
                              { keywords: ['confused', 'uncertain', 'puzzled'], 
                                color: '#7c3aed', bgColor: '#ede9fe', label: 'Confused' }
                            ];
                            
                            for (const sentiment of sentiments) {
                              if (sentiment.keywords.some(keyword => lowerText.includes(keyword))) {
                                return { color: sentiment.color, bgColor: sentiment.bgColor, label: sentiment.label };
                              }
                            }
                            return null;
                          };
                          
                          const sentimentStyle = getSentimentStyle(title, content);
                          
                          return (
                            <div key={index} style={{
                              marginBottom: '20px',
                              paddingBottom: '20px',
                              borderBottom: '1px solid #f3f4f6'
                            }}>
                              <h4 style={{
                                margin: '0 0 12px 0',
                                fontSize: '15px',
                                fontWeight: '600',
                                color: '#111827',
                                letterSpacing: '-0.025em'
                              }}>
                                {title.replace(/^\d+\.\s*/, '')}
                              </h4>
                              <div style={{
                                fontSize: '14px',
                                lineHeight: '1.6',
                                color: '#4b5563',
                                whiteSpace: 'pre-wrap',
                                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
                              }}>
                                {sentimentStyle ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      padding: '6px 12px',
                                      borderRadius: '6px',
                                      background: sentimentStyle.bgColor,
                                      border: `1px solid ${sentimentStyle.color}40`,
                                      width: 'fit-content'
                                    }}>
                                      <span style={{
                                        fontSize: '13px',
                                        fontWeight: '600',
                                        color: sentimentStyle.color,
                                        letterSpacing: '0.025em'
                                      }}>
                                        {sentimentStyle.label.toUpperCase()}
                                      </span>
                                    </div>
                                    <div>{content}</div>
                                  </div>
                                ) : (
                                  content
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
            
            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9fafb'
            }}>
              <div style={{
                fontSize: '12px',
                color: '#6b7280'
              }}>
                Generated by AI • {new Date().toLocaleDateString()}
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(callSummary);
                    const btn = document.activeElement as HTMLButtonElement;
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.style.background = '#10b981';
                    setTimeout(() => {
                      btn.textContent = originalText;
                      btn.style.background = '#2563eb';
                    }, 2000);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1d4ed8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2563eb';
                  }}
                >
                  Copy to Clipboard
                </button>
                
                <button
                  onClick={() => setShowSummary(false)}
                  style={{
                    padding: '8px 16px',
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    color: '#374151',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#9ca3af';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Call Analytics Modal */}
      {showAnalytics && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setShowAnalytics(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '8px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid #e5e7eb',
            animation: 'slideUp 0.3s ease'
          }} onClick={(e) => e.stopPropagation()}>
            
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9fafb'
            }}>
              <h2 style={{
                margin: 0,
                fontSize: '20px',
                fontWeight: '600',
                color: '#111827',
                letterSpacing: '-0.025em'
              }}>
                Call Analytics Report
              </h2>
              
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                {/* Score Badge */}
                {(() => {
                  // Extract sentiment from analytics text
                  const sentimentMatch = callAnalytics.match(/Sentiment:\s*(Positive|Neutral|Negative)/i);
                  const sentiment = sentimentMatch ? sentimentMatch[1].toLowerCase() : 'neutral';
                  
                  // Calculate score based on sentiment
                  const score = sentiment === 'positive' ? 8 : sentiment === 'negative' ? 6 : 7;
                  
                  // Score color
                  const scoreColor = score >= 8 ? '#10b981' : score >= 7 ? '#f59e0b' : '#ef4444';
                  
                  return (
                    <div style={{
                      padding: '6px 14px',
                      background: scoreColor,
                      borderRadius: '20px',
                      fontSize: '16px',
                      fontWeight: '700',
                      color: 'white',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
                    }}>
                      {score}/10
                    </div>
                  );
                })()}
                
                <button
                  onClick={() => setShowAnalytics(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#6b7280',
                    fontSize: '24px',
                    width: '32px',
                    height: '32px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: '6px',
                    transition: 'all 0.2s ease',
                    fontWeight: '300'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f3f4f6';
                    e.currentTarget.style.color = '#111827';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = '#6b7280';
                  }}
                >
                  ×
                </button>
              </div>
            </div>
            
            {/* Modal Body */}
            <div style={{
              padding: '24px',
              overflowY: 'auto',
              flex: 1,
              background: '#ffffff'
            }}>
              <div style={{
                fontSize: '14px',
                lineHeight: '1.8',
                color: '#374151',
                whiteSpace: 'pre-wrap',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              }}>
                {(() => {
                  // Clean the analytics text:
                  // 1. Remove all asterisks and hashtags
                  // 2. Remove repeated "Call Analytics Report" heading
                  let cleanedAnalytics = callAnalytics
                    .replace(/\*+/g, '') // Remove all asterisks
                    .replace(/#+/g, '') // Remove all hashtags
                    .replace(/Call Analytics Report/gi, '') // Remove repeated heading
                    .replace(/^\s*\n/gm, '\n') // Remove empty lines at start
                    .trim();
                  
                  return cleanedAnalytics;
                })()}
              </div>
            </div>
            
            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e5e7eb',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9fafb'
            }}>
              <div style={{
                fontSize: '12px',
                color: '#6b7280'
              }}>
                Generated by AI • {new Date().toLocaleDateString()}
              </div>
              
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(callAnalytics);
                    const btn = document.activeElement as HTMLButtonElement;
                    const originalText = btn.textContent;
                    btn.textContent = 'Copied!';
                    btn.style.background = '#10b981';
                    setTimeout(() => {
                      btn.textContent = originalText;
                      btn.style.background = '#2563eb';
                    }, 2000);
                  }}
                  style={{
                    padding: '8px 16px',
                    background: '#2563eb',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#1d4ed8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#2563eb';
                  }}
                >
                  Copy to Clipboard
                </button>
                
                <button
                  onClick={() => setShowAnalytics(false)}
                  style={{
                    padding: '8px 16px',
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    color: '#374151',
                    fontWeight: '500',
                    fontSize: '14px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#f9fafb';
                    e.currentTarget.style.borderColor = '#9ca3af';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'white';
                    e.currentTarget.style.borderColor = '#d1d5db';
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instructions Modal */}
      {showInstructionsModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setShowInstructionsModal(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUp 0.3s ease'
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#2563eb'
              }}>
                Instructions
              </h3>
              <button
                onClick={() => setShowInstructionsModal(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.color = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.color = '#64748b';
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Modal Body */}
            <div style={{
              padding: '24px',
              overflowY: 'auto',
              flex: 1,
              background: '#ffffff'
            }}>
              <div style={{
                padding: '20px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '14px',
                lineHeight: '1.8',
                color: '#374151',
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                minHeight: '300px'
              }}>
                {config.instructions || 'No instructions provided yet. Enter instructions in the configuration panel.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Context Modal - Expanded View */}
      {showContextModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setShowContextModal(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '16px',
            maxWidth: '800px',
            width: '100%',
            maxHeight: '80vh',
            overflow: 'hidden',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.3)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUp 0.3s ease'
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '20px 24px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #f8fafc 0%, #ffffff 100%)'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                fontWeight: '600',
                color: '#2563eb'
              }}>
                Context
              </h3>
              <button
                onClick={() => setShowContextModal(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  width: '28px',
                  height: '28px',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#64748b',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = '#f8fafc';
                  e.currentTarget.style.borderColor = '#cbd5e1';
                  e.currentTarget.style.color = '#ef4444';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = '#e2e8f0';
                  e.currentTarget.style.color = '#64748b';
                }}
              >
                ✕
              </button>
            </div>
            
            {/* Modal Body */}
            <div style={{
              padding: '24px',
              overflowY: 'auto',
              flex: 1,
              background: '#ffffff'
            }}>
              <div style={{
                padding: '20px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                fontSize: '14px',
                lineHeight: '1.8',
                color: '#374151',
                whiteSpace: 'pre-wrap',
                fontFamily: 'inherit',
                minHeight: '300px'
              }}>
                {config.context || 'No context provided yet. Enter context in the configuration panel.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Knowledge Handbook Modal */}
      {showProductKnowledge && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(15, 23, 42, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px',
          animation: 'fadeIn 0.2s ease'
        }} onClick={() => setShowProductKnowledge(false)}>
          <div style={{
            background: '#ffffff',
            borderRadius: '12px',
            maxWidth: '1100px',
            width: '100%',
            maxHeight: '90vh',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUp 0.3s ease',
            border: '1px solid #e2e8f0'
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '28px 32px',
              borderBottom: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'linear-gradient(135deg, #1e293b 0%, #334155 100%)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '56px',
                  height: '56px',
                  background: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '28px',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                  📘
                </div>
                <div>
                  <h3 style={{
                    margin: 0,
                    fontSize: '22px',
                    fontWeight: '700',
                    color: '#ffffff',
                    letterSpacing: '-0.3px'
                  }}>
                    Product Knowledge Handbook
                  </h3>
                  <p style={{
                    margin: '6px 0 0 0',
                    fontSize: '14px',
                    color: 'rgba(255, 255, 255, 0.8)',
                    fontWeight: '500'
                  }}>
                    Global Trust • Comprehensive Guide
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <a
                  href="/Global Trust Product Knowledge (1).pdf"
                  download="Global_Trust_Product_Knowledge (1).pdf"
                  style={{
                    padding: '10px 20px',
                    background: 'rgba(255, 255, 255, 0.15)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '13px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease',
                    letterSpacing: '0.3px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M4 16V17C4 18.6569 5.34315 20 7 20H17C18.6569 20 20 18.6569 20 17V16M16 12L12 16M12 16L8 12M12 16V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span>Download PDF</span>
                </a>
                <button
                  onClick={() => setShowProductKnowledge(false)}
                  style={{
                    background: 'rgba(255, 255, 255, 0.15)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    width: '40px',
                    height: '40px',
                    cursor: 'pointer',
                    fontSize: '18px',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    fontWeight: '300'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                    e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            
            {/* Modal Body - PDF Viewer */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              background: '#f1f5f9',
              padding: '2px'
            }}>
              <iframe
                src="/Global Trust Product Knowledge (1).pdf"
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                  minHeight: '75vh',
                  background: '#ffffff'
                }}
                title="Product Knowledge Handbook"
              />
            </div>
          </div>
        </div>
      )}

      {/* Session Initialization Animation Modal */}
      {showSessionInit && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '20px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
            animation: 'slideUp 0.4s ease-out',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto'
          }}>
            <SessionInitAnimation
              onComplete={() => setShowSessionInit(false)}
              agentName={config.agent_name}
            />
          </div>
        </div>
      )}

      {/* Action Modal for Email/Human Transfer animations */}
      <ActionModal 
        isVisible={showActionModal}
        actionType={actionType}
        callSummary={callSummary}
        onClose={() => {
          setShowActionModal(false);
          
          // If there's a pending transfer after email, show it now
          if (pendingTransfer && actionType === 'email') {
            console.log('📞 Email animation complete, now showing transfer animation...');
            setPendingTransfer(false);
            
            // Generate summary if not already done
            if (sessionId && !callSummary) {
              fetch(`/api/session/${sessionId}/summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              })
              .then(res => res.json())
              .then(data => {
                setCallSummary(data.summary);
                console.log('✅ Summary generated for transfer');
              })
              .catch(err => console.error('Failed to generate summary:', err));
            }
            
            // Show transfer animation after a brief delay
            setTimeout(() => {
              setActionType('human_transfer');
              setShowActionModal(true);
            }, 500);
          } 
          // If transfer animation just completed, show summary modal
          else if (actionType === 'human_transfer') {
            console.log('📊 Transfer animation complete, triggering summary generation...');
            setActionType(null);
            setPendingTransfer(false);
            
            // Auto-trigger summary generation if not already done
            if (!callSummary && sessionIdRef.current) {
              console.log('🔄 Generating summary after animation...');
              fetchCallSummary(true).then(() => {
                console.log('✅ Summary generated, showing modal');
                setTimeout(() => {
                  setShowSummary(true);
                }, 300);
              }).catch(err => {
                console.error('❌ Failed to generate summary:', err);
              });
            } else if (callSummary) {
              // Summary already exists, just show it
              console.log('✅ Showing existing summary modal after transfer animation');
              setTimeout(() => {
                setShowSummary(true);
              }, 300);
            } else {
              console.error('❌ No sessionId available to generate summary');
            }
          } 
          else {
            setActionType(null);
            setPendingTransfer(false);
          }
        }}
      />
    </>
  );
};

export default App;