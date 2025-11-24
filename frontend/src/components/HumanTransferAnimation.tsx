import React, { useEffect, useState, useRef } from 'react';

interface HumanTransferAnimationProps {
  onComplete: () => void;
  callSummary?: string;
}

export const HumanTransferAnimation: React.FC<HumanTransferAnimationProps> = ({ onComplete, callSummary = '' }) => {
  const [stage, setStage] = useState<'finding' | 'connecting' | 'transferring_summary' | 'connected'>('finding');
  const [dots, setDots] = useState('');
  const onCompleteRef = useRef(onComplete);

  // Update ref when onComplete changes
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let dotsInterval: NodeJS.Timeout | null = null;
    
    console.log('🚀 Animation started');
    
    // Stage 1: Finding expert (0-1s)
    const findingTimer = setTimeout(() => {
      console.log('Stage: Finding → Connecting');
      setStage('connecting');
    }, 1000);

    // Stage 2: Connecting (1s - 2s)
    const connectingTimer = setTimeout(() => {
      console.log('Stage: Connecting → Transferring Summary');
      setStage('transferring_summary');
    }, 2000);

    // Stage 3: Transferring Summary (2s - 3.5s)
    const summaryTimer = setTimeout(() => {
      console.log('Stage: Transferring Summary → Connected');
      setStage('connected');
      // Stop dots animation when connected
      if (dotsInterval) {
        clearInterval(dotsInterval);
        dotsInterval = null;
      }
      setDots(''); // Clear dots
    }, 4500); // Always show summary stage

    // Stage 4: Connected - show for 1.5s before closing
    const connectedTimer = setTimeout(() => {
      console.log('✅ Animation complete, closing modal');
      onCompleteRef.current();
    }, 6000);

    // Dots animation for loading effect
    dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 300);

    // Cleanup all timers
    return () => {
      clearTimeout(findingTimer);
      clearTimeout(connectingTimer);
      clearTimeout(summaryTimer);
      clearTimeout(connectedTimer);
      if (dotsInterval) {
        clearInterval(dotsInterval);
      }
    };
  }, [callSummary]); // Depend on callSummary

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '32px',
      padding: '40px',
      minWidth: '500px'
    }}>
      {/* Avatar Transition Animation */}
      <div style={{
        position: 'relative',
        width: '200px',
        height: '120px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px'
      }}>
        {/* Bot Avatar */}
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          boxShadow: '0 8px 25px rgba(59, 130, 246, 0.3)',
          transition: 'all 0.5s ease-out',
          opacity: stage === 'connected' ? 0.3 : 1,
          transform: stage === 'connected' ? 'translateX(-30px) scale(0.8)' : 'translateX(0) scale(1)'
        }}>
          🤖
        </div>

        {/* Transfer Arrow or Summary Icon */}
        <div style={{
          fontSize: '32px',
          animation: stage === 'transferring_summary' ? 'none' : 'slideRight 1s ease-in-out infinite',
          opacity: stage === 'connected' ? 0 : 1,
          transition: 'opacity 0.3s ease-out'
        }}>
          {stage === 'transferring_summary' ? '📋' : '➡️'}
        </div>

        {/* Human Avatar */}
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: stage === 'connected' 
            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
            : 'linear-gradient(135deg, #94a3b8, #64748b)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          boxShadow: stage === 'connected' 
            ? '0 8px 25px rgba(34, 197, 94, 0.4)' 
            : '0 4px 15px rgba(148, 163, 184, 0.2)',
          transition: 'all 0.5s ease-out',
          transform: stage === 'connected' ? 'scale(1.1)' : 'scale(1)',
          animation: stage === 'connected' ? 'pulse 1.5s ease-in-out infinite' : 'none'
        }}>
          👤
        </div>

        {/* Connecting Waves */}
        {stage === 'connecting' && (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  width: '100px',
                  height: '100px',
                  borderRadius: '50%',
                  border: '2px solid rgba(59, 130, 246, 0.3)',
                  animation: `ripple 1.5s ease-out infinite`,
                  animationDelay: `${i * 0.5}s`,
                  left: '50%',
                  top: '50%',
                  transform: 'translate(-50%, -50%)'
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* Status Text */}
      <div style={{
        textAlign: 'center',
        minHeight: '100px'
      }}>
        <h2 style={{
          fontSize: '24px',
          fontWeight: '700',
          color: '#1e293b',
          marginBottom: '12px',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          {stage === 'finding' && `🔍 Finding Available Expert${dots}`}
          {stage === 'connecting' && `🔗 Connecting to Specialist${dots}`}
          {stage === 'transferring_summary' && `📋 Transferring Call Summary${dots}`}
          {stage === 'connected' && '✅ Connected Successfully!'}
        </h2>
        
        <p style={{
          fontSize: '14px',
          color: '#64748b',
          lineHeight: '1.6',
          marginBottom: '16px'
        }}>
          {stage === 'finding' && 'Searching for the best available specialist to assist you'}
          {stage === 'connecting' && 'Establishing secure connection with the expert'}
          {stage === 'transferring_summary' && 'Sending call history and summary to the specialist for context'}
          {stage === 'connected' && 'You are now connected to a human expert who will assist you shortly'}
        </p>

        {/* Summary Transfer Indicator (shown during summary stage) */}
        {stage === 'transferring_summary' && callSummary && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 24px',
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            borderRadius: '12px',
            animation: 'slideUp 0.5s ease-out',
            marginTop: '16px',
            maxWidth: '400px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              animation: 'pulse 1s ease-in-out infinite'
            }}>
              📋
            </div>
            <div style={{ textAlign: 'left', flex: 1 }}>
              <div style={{
                fontSize: '14px',
                fontWeight: '600',
                color: '#4f46e5',
                marginBottom: '4px'
              }}>
                Call Summary Attached
              </div>
              <div style={{
                fontSize: '12px',
                color: '#64748b'
              }}>
                Transferring conversation context...
              </div>
            </div>
            <div style={{
              fontSize: '20px',
              animation: 'spin 1s linear infinite'
            }}>
              ⚡
            </div>
          </div>
        )}

        {/* Expert Details (shown when connected) */}
        {stage === 'connected' && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 24px',
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '12px',
            animation: 'slideUp 0.5s ease-out',
            marginTop: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              👨‍💼
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#16a34a'
              }}>
                Expert Specialist
              </div>
              <div style={{
                fontSize: '13px',
                color: '#64748b',
                marginTop: '2px'
              }}>
                Customer Support Team
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connection Progress Indicator */}
      <div style={{
        width: '100%',
        maxWidth: '400px'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '12px'
        }}>
          {['Finding', 'Connecting', 'Transferring', 'Connected'].map((label, index) => {
            const isActive = 
              (stage === 'finding' && index === 0) ||
              (stage === 'connecting' && index === 1) ||
              (stage === 'transferring_summary' && index === 2) ||
              (stage === 'connected' && index === 3);
            const isComplete = 
              (stage === 'connecting' && index === 0) ||
              (stage === 'transferring_summary' && index <= 1) ||
              (stage === 'connected' && index <= 2);

            return (
              <div key={label} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '8px',
                flex: 1
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  background: isComplete || isActive
                    ? 'linear-gradient(135deg, #3b82f6, #1d4ed8)'
                    : 'rgba(148, 163, 184, 0.2)',
                  border: isActive ? '3px solid #60a5fa' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '16px',
                  color: 'white',
                  fontWeight: '600',
                  transition: 'all 0.3s ease-out',
                  animation: isActive ? 'pulse 1s ease-in-out infinite' : 'none'
                }}>
                  {isComplete ? '✓' : index + 1}
                </div>
                <div style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: isActive || isComplete ? '#3b82f6' : '#94a3b8',
                  transition: 'color 0.3s ease-out'
                }}>
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Connection Line */}
        <div style={{
          position: 'relative',
          width: '100%',
          height: '4px',
          background: 'rgba(148, 163, 184, 0.2)',
          borderRadius: '999px',
          marginTop: '-30px',
          marginBottom: '30px',
          zIndex: -1
        }}>
          <div style={{
            width: stage === 'finding' ? '0%' : stage === 'connecting' ? '33%' : stage === 'transferring_summary' ? '66%' : '100%',
            height: '100%',
            background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
            borderRadius: '999px',
            transition: 'width 1s ease-out'
          }} />
        </div>
      </div>

      {/* Estimated Wait Time */}
      {stage !== 'connected' && (
        <div style={{
          fontSize: '13px',
          color: '#64748b',
          padding: '12px 20px',
          background: 'rgba(59, 130, 246, 0.05)',
          borderRadius: '8px',
          animation: 'fadeIn 0.5s ease-out'
        }}>
          ⏱️ Estimated wait time: <strong style={{ color: '#3b82f6' }}>~30 seconds</strong>
        </div>
      )}

      <style>{`
        @keyframes slideRight {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(10px); }
        }
        
        @keyframes pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 8px 25px rgba(34, 197, 94, 0.4); }
          50% { transform: scale(1.05); box-shadow: 0 12px 35px rgba(34, 197, 94, 0.6); }
        }
        
        @keyframes ripple {
          0% {
            transform: translate(-50%, -50%) scale(0.8);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(2);
            opacity: 0;
          }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
};
