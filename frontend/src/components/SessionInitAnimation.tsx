import React, { useEffect, useState, useRef } from 'react';

interface SessionInitAnimationProps {
  onComplete: () => void;
  agentName: string;
}

export const SessionInitAnimation: React.FC<SessionInitAnimationProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'loading_kb' | 'loading_history' | 'transferring' | 'ready'>('loading_kb');
  const [dots, setDots] = useState('');
  const [kbProgress, setKbProgress] = useState(0);
  const [historyProgress, setHistoryProgress] = useState(0);
  const onCompleteRef = useRef(onComplete);

  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let dotsInterval: NodeJS.Timeout | null = null;
    let progressInterval: NodeJS.Timeout | null = null;

    console.log('🚀 Session initialization started');

    // Stage 1: Loading Knowledge Base (0-1.5s)
    progressInterval = setInterval(() => {
      setKbProgress(prev => {
        if (prev >= 100) {
          if (progressInterval) clearInterval(progressInterval);
          return 100;
        }
        return prev + 5;
      });
    }, 30);

    const kbTimer = setTimeout(() => {
      console.log('Stage: Loading KB → Loading History');
      setStage('loading_history');
      if (progressInterval) clearInterval(progressInterval);
      
      // Start history progress
      progressInterval = setInterval(() => {
        setHistoryProgress(prev => {
          if (prev >= 100) {
            if (progressInterval) clearInterval(progressInterval);
            return 100;
          }
          return prev + 5;
        });
      }, 25);
    }, 1500);

    // Stage 2: Loading Call History (1.5s - 3s)
    const historyTimer = setTimeout(() => {
      console.log('Stage: Loading History → Transferring');
      setStage('transferring');
      if (progressInterval) clearInterval(progressInterval);
    }, 3000);

    // Stage 3: Transferring Knowledge (3s - 4.5s)
    const transferTimer = setTimeout(() => {
      console.log('Stage: Transferring → Ready');
      setStage('ready');
      if (dotsInterval) {
        clearInterval(dotsInterval);
        dotsInterval = null;
      }
      setDots('');
    }, 4500);

    // Stage 4: Ready - show for 1s before closing
    const readyTimer = setTimeout(() => {
      console.log('✅ Session initialization complete');
      onCompleteRef.current();
    }, 7000);

    // Dots animation
    dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 400);

    return () => {
      clearTimeout(kbTimer);
      clearTimeout(historyTimer);
      clearTimeout(transferTimer);
      clearTimeout(readyTimer);
      if (dotsInterval) clearInterval(dotsInterval);
      if (progressInterval) clearInterval(progressInterval);
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '32px',
      padding: '40px',
      minWidth: '550px'
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
        <h1 style={{
          fontSize: '26px',
          fontWeight: '600',
          color: '#0f172a',
          marginBottom: '8px',
          letterSpacing: '-0.5px',
          animation: 'fadeIn 0.5s ease-out'
        }}>
          Initializing Session
        </h1>
        <p style={{
          fontSize: '14px',
          color: '#64748b',
          fontWeight: '500'
        }}>
        Assisting <strong style={{ color: '#1e40af' }}>Agent Maya</strong> with knowledge and context

        </p>
      </div>

      {/* Agent Transfer Animation */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: '160px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 40px',
        marginBottom: '20px',
        gap: '60px'
      }}>
        {/* Active Agent (Left) - Receiving Knowledge */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          transition: 'all 0.5s ease-out',
          flex: '0 0 auto'
        }}>
          <div style={{
            width: '100px',
            height: '100px',
            borderRadius: '16px',
            background: stage === 'ready'
              ? 'linear-gradient(135deg, #1e40af 0%, #1e3a8a 100%)'
              : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            boxShadow: stage === 'ready'
              ? '0 10px 40px rgba(30, 64, 175, 0.4)'
              : '0 8px 30px rgba(59, 130, 246, 0.3)',
            animation: stage === 'transferring' ? 'receivePulse 0.8s ease-in-out infinite' : 'none',
            transform: stage === 'ready' ? 'scale(1.05)' : 'scale(1)',
            position: 'relative',
            border: '3px solid rgba(255, 255, 255, 0.2)'
          }}>
            🤖
            {/* Success indicator */}
            {stage === 'ready' && (
              <div style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                animation: 'scaleIn 0.5s ease-out',
                boxShadow: '0 4px 20px rgba(34, 197, 94, 0.5)',
                border: '2px solid white'
              }}>
                ✓
              </div>
            )}
          </div>
          <div style={{
            fontSize: '13px',
            fontWeight: '600',
            color: stage === 'ready' ? '#1e40af' : '#3b82f6',
            textAlign: 'center',
            transition: 'color 0.3s ease-out'
          }}>
            Agent Maya 
          </div>
        </div>

        {/* Transfer Animation - Knowledge Items Flying from Right to Left */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          alignItems: 'center',
          zIndex: 10
        }}>
          {/* Knowledge Base Item */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 18px',
            background: 'white',
            border: `2px solid ${stage === 'loading_kb' || stage === 'transferring' ? '#1e40af' : '#e2e8f0'}`,
            borderRadius: '10px',
            animation: stage === 'transferring' ? 'slideToLeft 1.5s ease-in-out' : 'none',
            opacity: stage === 'ready' ? 0 : 1,
            transition: 'all 0.3s ease-out',
            boxShadow: stage === 'loading_kb' || stage === 'transferring' ? '0 4px 20px rgba(30, 64, 175, 0.15)' : '0 2px 8px rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ 
              fontSize: '22px',
              filter: stage === 'loading_kb' ? 'drop-shadow(0 0 8px rgba(30, 64, 175, 0.4))' : 'none'
            }}>�</div>
            <div style={{
              fontSize: '13px',
              fontWeight: '600',
              color: '#1e40af'
            }}>
              Knowledge Base
            </div>
          </div>

          {/* Call History Item */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '10px 18px',
            background: 'white',
            border: `2px solid ${stage === 'loading_history' || stage === 'transferring' ? '#0891b2' : '#e2e8f0'}`,
            borderRadius: '10px',
            animation: stage === 'transferring' ? 'slideToLeft 1.5s ease-in-out 0.2s' : 'none',
            opacity: stage === 'ready' ? 0 : 1,
            transition: 'all 0.3s ease-out',
            boxShadow: stage === 'loading_history' || stage === 'transferring' ? '0 4px 20px rgba(8, 145, 178, 0.15)' : '0 2px 8px rgba(0, 0, 0, 0.05)'
          }}>
            <div style={{ 
              fontSize: '22px',
              filter: stage === 'loading_history' ? 'drop-shadow(0 0 8px rgba(8, 145, 178, 0.4))' : 'none'
            }}>📋</div>
            <div style={{
              fontSize: '13px',
              fontWeight: '600',
              color: '#0891b2'
            }}>
              Call History
            </div>
          </div>
        </div>

        {/* Support Agent (Right) - Providing Knowledge */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          transition: 'all 0.5s ease-out',
          opacity: stage === 'ready' ? 0.5 : 1,
          flex: '0 0 auto'
        }}>
          <div style={{
            width: '100px',
            height: '100px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '48px',
            boxShadow: '0 8px 30px rgba(8, 145, 178, 0.3)',
            animation: stage === 'loading_kb' || stage === 'loading_history' ? 'pulse 1.5s ease-in-out infinite' : 'none',
            position: 'relative',
            border: '3px solid rgba(255, 255, 255, 0.2)'
          }}>
            👨‍💼
            {/* Active indicator during loading */}
            {(stage === 'loading_kb' || stage === 'loading_history') && (
              <div style={{
                position: 'absolute',
                top: '-8px',
                right: '-8px',
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                animation: 'spin 2s linear infinite',
                boxShadow: '0 4px 20px rgba(245, 158, 11, 0.5)',
                border: '2px solid white'
              }}>
                ⚡
              </div>
            )}
          </div>
          <div style={{
            fontSize: '13px',
            fontWeight: '600',
            color: '#0891b2',
            textAlign: 'center'
          }}>
            Support Agent
          </div>
        </div>

        {/* Data flow particles during transfer */}
        {stage === 'transferring' && (
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  right: '30%',
                  top: `${45 + (i % 2) * 10}%`,
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: i % 2 === 0 ? '#1e40af' : '#0891b2',
                  animation: `particleFlowLeft 1.5s ease-in-out infinite`,
                  animationDelay: `${i * 0.25}s`,
                  opacity: 0,
                  boxShadow: '0 0 10px currentColor'
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Progress Section */}
      <div style={{ width: '100%', maxWidth: '500px' }}>
        <div style={{
          textAlign: 'center',
          marginBottom: '20px'
        }}>
          <h2 style={{
            fontSize: '16px',
            fontWeight: '600',
            color: '#0f172a',
            marginBottom: '6px',
            animation: 'fadeIn 0.3s ease-out'
          }}>
            {stage === 'loading_kb' && `Loading Knowledge Base${dots}`}
            {stage === 'loading_history' && `Loading Call History${dots}`}
            {stage === 'transferring' && `Transferring Knowledge${dots}`}
            {stage === 'ready' && 'Session Ready'}
          </h2>
          <p style={{
            fontSize: '13px',
            color: '#64748b',
            lineHeight: '1.5'
          }}>
            {stage === 'loading_kb' && 'Gathering product knowledge and customer information'}
            {stage === 'loading_history' && 'Analyzing previous customer interactions'}
            {stage === 'transferring' && 'Equipping agent with necessary context'}
            {stage === 'ready' && 'Your agent is ready to assist customers'}
          </p>
        </div>

        {/* Progress Bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Knowledge Base Progress */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '6px'
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: stage === 'loading_kb' ? '#1e40af' : '#64748b'
              }}>
                � Knowledge Base
              </span>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: stage === 'loading_kb' ? '#1e40af' : '#64748b'
              }}>
                {kbProgress}%
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '6px',
              background: '#e2e8f0',
              borderRadius: '999px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${kbProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #1e40af, #3b82f6)',
                borderRadius: '999px',
                transition: 'width 0.3s ease-out',
                boxShadow: kbProgress > 0 && kbProgress < 100 ? '0 0 10px rgba(30, 64, 175, 0.4)' : 'none'
              }} />
            </div>
          </div>

          {/* Call History Progress */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: '6px'
            }}>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: stage === 'loading_history' ? '#0891b2' : '#64748b'
              }}>
                📋 Call History
              </span>
              <span style={{
                fontSize: '12px',
                fontWeight: '600',
                color: stage === 'loading_history' ? '#0891b2' : '#64748b'
              }}>
                {historyProgress}%
              </span>
            </div>
            <div style={{
              width: '100%',
              height: '6px',
              background: '#e2e8f0',
              borderRadius: '999px',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${historyProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #0891b2, #06b6d4)',
                borderRadius: '999px',
                transition: 'width 0.3s ease-out',
                boxShadow: historyProgress > 0 && historyProgress < 100 ? '0 0 10px rgba(8, 145, 178, 0.4)' : 'none'
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      {stage === 'ready' && (
        <div style={{
          display: 'flex',
          gap: '12px',
          animation: 'slideUp 0.5s ease-out',
          marginTop: '8px'
        }}>
          <div style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
            border: '1px solid #bfdbfe',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 1
          }}>
            <span style={{ fontSize: '20px' }}>�</span>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Knowledge Base</div>
              <div style={{ fontSize: '13px', color: '#1e40af', fontWeight: '600' }}>Ready</div>
            </div>
          </div>
          <div style={{
            padding: '12px 18px',
            background: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 100%)',
            border: '1px solid #a5f3fc',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            flex: 1
          }}>
            <span style={{ fontSize: '20px' }}>📋</span>
            <div>
              <div style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>Call History</div>
              <div style={{ fontSize: '13px', color: '#0891b2', fontWeight: '600' }}>Ready</div>
            </div>
          </div>
        </div>
      )}

      {/* Estimated Time */}
      {stage !== 'ready' && (
        <div style={{
          fontSize: '12px',
          color: '#64748b',
          padding: '10px 20px',
          background: '#f8fafc',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          animation: 'fadeIn 0.5s ease-out',
          marginTop: '8px',
          border: '1px solid #e2e8f0'
        }}>
          <span style={{ fontSize: '14px' }}>⏱️</span>
          <span>Estimated time: <strong style={{ color: '#1e40af' }}>5 seconds</strong></span>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }

        @keyframes receivePulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.06); }
        }

        @keyframes slideToLeft {
          0% {
            transform: translateX(0);
            opacity: 1;
          }
          100% {
            transform: translateX(-200px);
            opacity: 0;
          }
        }

        @keyframes particleFlowLeft {
          0% {
            right: 30%;
            opacity: 0;
            transform: scale(0);
          }
          20% {
            opacity: 1;
            transform: scale(1);
          }
          80% {
            opacity: 0.8;
          }
          100% {
            right: 70%;
            opacity: 0;
            transform: scale(0);
          }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes slideUp {
          from { 
            opacity: 0;
            transform: translateY(20px);
          }
          to { 
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes scaleIn {
          from {
            transform: scale(0);
            opacity: 0;
          }
          to {
            transform: scale(1);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};
