import React, { useEffect, useState } from 'react';

interface VoiceWaveformProps {
  isActive: boolean;
}

export const VoiceWaveform: React.FC<VoiceWaveformProps> = ({ isActive }) => {
  const [bars] = useState([0, 1, 2, 3, 4]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      padding: '20px',
      position: 'relative'
    }}>
      {/* Sound wave bars */}
      {bars.map((index) => (
        <div
          key={index}
          style={{
            width: '6px',
            height: isActive ? '40px' : '8px',
            background: 'linear-gradient(180deg, #60a5fa 0%, #3b82f6 50%, #2563eb 100%)',
            borderRadius: '3px',
            transition: 'height 0.3s ease',
            animation: isActive ? `wave 2s ease-in-out ${index * 0.15}s infinite` : 'none',
            transformOrigin: 'center'
          }}
        />
      ))}

      {/* CSS keyframes for wave animation */}
      <style>{`
        @keyframes wave {
          0%, 100% {
            height: 10px;
          }
          25% {
            height: 35px;
          }
          50% {
            height: 18px;
          }
          75% {
            height: 28px;
          }
        }
      `}</style>

      {/* Pulse circles when active */}
      {isActive && (
        <>
          <div style={{
            position: 'absolute',
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            border: '2px solid rgba(59, 130, 246, 0.3)',
            animation: 'pulse-ring 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
            pointerEvents: 'none'
          }} />
          <div style={{
            position: 'absolute',
            width: '100px',
            height: '100px',
            borderRadius: '50%',
            border: '2px solid rgba(59, 130, 246, 0.2)',
            animation: 'pulse-ring 3s cubic-bezier(0.4, 0, 0.6, 1) 0.8s infinite',
            pointerEvents: 'none'
          }} />
          
          <style>{`
            @keyframes pulse-ring {
              0% {
                transform: scale(0.5);
                opacity: 1;
              }
              100% {
                transform: scale(1.5);
                opacity: 0;
              }
            }
          `}</style>
        </>
      )}

      {/* Status text */}
      {isActive && (
        <div style={{
          position: 'absolute',
          bottom: '-20px',
          fontSize: '11px',
          color: '#3b82f6',
          fontWeight: '600',
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          animation: 'fadeIn 0.3s ease'
        }}>
          Active
        </div>
      )}
    </div>
  );
};
