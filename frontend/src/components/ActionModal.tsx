import React from 'react';
import { EmailAnimation } from './EmailAnimation';
import { HumanTransferAnimation } from './HumanTransferAnimation';

interface ActionModalProps {
  isVisible: boolean;
  actionType: 'email' | 'human_transfer' | null;
  onClose: () => void;
  callSummary?: string;
}

export const ActionModal: React.FC<ActionModalProps> = ({ 
  isVisible, 
  actionType, 
  onClose,
  callSummary = ''
}) => {
  if (!isVisible || !actionType) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(8px)',
          zIndex: 9998,
          animation: 'fadeIn 0.3s ease-out'
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        background: '#ffffff',
        borderRadius: '24px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        zIndex: 9999,
        animation: 'modalSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        maxWidth: '90vw',
        maxHeight: '90vh',
        overflow: 'auto'
      }}>
        {/* Close Button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(148, 163, 184, 0.1)',
            color: '#64748b',
            fontSize: '20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
            zIndex: 10
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(148, 163, 184, 0.2)';
            e.currentTarget.style.transform = 'scale(1.1)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(148, 163, 184, 0.1)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
        >
          ✕
        </button>

        {/* Animation Content */}
        <div style={{
          padding: '20px'
        }}>
          {actionType === 'email' && (
            <EmailAnimation onComplete={onClose} />
          )}
          {actionType === 'human_transfer' && (
            <HumanTransferAnimation onComplete={onClose} callSummary={callSummary} />
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: translate(-50%, -45%);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%);
          }
        }
      `}</style>
    </>
  );
};
