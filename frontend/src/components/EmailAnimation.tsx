import React, { useEffect, useState, useRef } from 'react';

interface EmailAnimationProps {
  onComplete: () => void;
}

export const EmailAnimation: React.FC<EmailAnimationProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'composing' | 'attaching' | 'sending' | 'delivered'>('composing');
  const [dots, setDots] = useState('');
  const onCompleteRef = useRef(onComplete);

  // Update ref when onComplete changes
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    let dotsInterval: NodeJS.Timeout | null = null;
    
    console.log('🚀 Email animation started');
    
    // Stage 1: Composing (0-1s)
    const composingTimer = setTimeout(() => {
      console.log('Stage: Composing → Attaching Summary');
      setStage('attaching');
    }, 2000);

    // Stage 2: Attaching Summary (1s - 2s)
    const attachingTimer = setTimeout(() => {
      console.log('Stage: Attaching → Sending');
      setStage('sending');
    }, 4000);

    // Stage 3: Sending (2s - 3.5s)
    const sendingTimer = setTimeout(() => {
      console.log('Stage: Sending → Delivered');
      setStage('delivered');
      // Stop dots animation when delivered
      if (dotsInterval) {
        clearInterval(dotsInterval);
        dotsInterval = null;
      }
      setDots('');
    }, 5500);

    // Stage 4: Delivered - show for 1.5s before closing
    const deliveredTimer = setTimeout(() => {
      console.log('✅ Email animation complete, closing modal');
      onCompleteRef.current();
    }, 7000);

    // Dots animation for loading effect
    dotsInterval = setInterval(() => {
      setDots(prev => prev.length >= 3 ? '' : prev + '.');
    }, 300);

    // Cleanup all timers
    return () => {
      clearTimeout(composingTimer);
      clearTimeout(attachingTimer);
      clearTimeout(sendingTimer);
      clearTimeout(deliveredTimer);
      if (dotsInterval) {
        clearInterval(dotsInterval);
      }
    };
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '32px',
      padding: '40px',
      minWidth: '500px'
    }}>
      {/* Email Transition Animation */}
      <div style={{
        position: 'relative',
        width: '200px',
        height: '120px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px'
      }}>
        {/* Document Icon */}
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
          opacity: stage === 'delivered' ? 0.3 : 1,
          transform: stage === 'delivered' ? 'translateX(-30px) scale(0.8)' : 'translateX(0) scale(1)'
        }}>
          📄
        </div>

        {/* Transfer Arrow or Email Icon */}
        <div style={{
          fontSize: '32px',
          animation: stage === 'attaching' || stage === 'sending' ? 'flyEmail 1s ease-in-out infinite' : 'none',
          opacity: stage === 'delivered' ? 0 : 1,
          transition: 'opacity 0.3s ease-out'
        }}>
          {stage === 'attaching' ? '📋' : stage === 'sending' ? '📧' : '➡️'}
        </div>

        {/* Email Box Icon */}
        <div style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          background: stage === 'delivered' 
            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
            : 'linear-gradient(135deg, #94a3b8, #64748b)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '36px',
          boxShadow: stage === 'delivered' 
            ? '0 8px 25px rgba(34, 197, 94, 0.4)' 
            : '0 4px 15px rgba(148, 163, 184, 0.2)',
          transition: 'all 0.5s ease-out',
          transform: stage === 'delivered' ? 'scale(1.1)' : 'scale(1)',
          animation: stage === 'delivered' ? 'pulse 1.5s ease-in-out infinite' : 'none'
        }}>
          📬
        </div>

        {/* Connecting Waves during attaching/sending */}
        {(stage === 'attaching' || stage === 'sending') && (
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
          {stage === 'composing' && `📝 Composing Email${dots}`}
          {stage === 'attaching' && `📋 Attaching Summary${dots}`}
          {stage === 'sending' && `🚀 Sending Email${dots}`}
          {stage === 'delivered' && '✅ Email Delivered!'}
        </h2>
        
        <p style={{
          fontSize: '14px',
          color: '#64748b',
          lineHeight: '1.6',
          marginBottom: '16px'
        }}>
          {stage === 'composing' && 'Preparing confirmation email with call details'}
          {stage === 'attaching' && 'Adding call summary and conversation history to email'}
          {stage === 'sending' && 'Securely sending to your registered email address'}
          {stage === 'delivered' && 'Check your inbox for the complete summary'}
        </p>

        {/* Summary Attachment Indicator (shown during attaching stage) */}
        {stage === 'attaching' && (
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
                Including conversation details...
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

        {/* Email Sent Indicator (shown when delivered) */}
        {stage === 'delivered' && (
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
              ✓
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{
                fontSize: '16px',
                fontWeight: '600',
                color: '#16a34a'
              }}>
                Email Sent Successfully
              </div>
              <div style={{
                fontSize: '13px',
                color: '#64748b',
                marginTop: '2px'
              }}>
                {new Date().toLocaleString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
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
          {['Composing', 'Attaching', 'Sending', 'Delivered'].map((label, index) => {
            const isActive = 
              (stage === 'composing' && index === 0) ||
              (stage === 'attaching' && index === 1) ||
              (stage === 'sending' && index === 2) ||
              (stage === 'delivered' && index === 3);
            const isComplete = 
              (stage === 'attaching' && index === 0) ||
              (stage === 'sending' && index <= 1) ||
              (stage === 'delivered' && index <= 2);

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
            width: stage === 'composing' ? '0%' : stage === 'attaching' ? '33%' : stage === 'sending' ? '66%' : '100%',
            height: '100%',
            background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
            borderRadius: '999px',
            transition: 'width 1s ease-out'
          }} />
        </div>
      </div>

      {/* Estimated Wait Time */}
      {stage !== 'delivered' && (
        <div style={{
          fontSize: '13px',
          color: '#64748b',
          padding: '12px 20px',
          background: 'rgba(59, 130, 246, 0.05)',
          borderRadius: '8px',
          animation: 'fadeIn 0.5s ease-out'
        }}>
          ⏱️ Processing: <strong style={{ color: '#3b82f6' }}>~5 seconds</strong>
        </div>
      )}

      <style>{`
        @keyframes flyEmail {
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
        
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
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
