import React from 'react';
import './ValidationIndicator.css';

const ValidationIndicator = ({ type = 'error', message, size = 'small' }) => {
  const getIcon = () => {
    switch (type) {
      case 'error':
        return '❌';
      case 'warning':
        return '⚠️';
      case 'info':
        return 'ℹ️';
      case 'success':
        return '✅';
      default:
        return '❌';
    }
  };

  const getColor = () => {
    switch (type) {
      case 'error':
        return '#EF4444';
      case 'warning':
        return '#F59E0B';
      case 'info':
        return '#3B82F6';
      case 'success':
        return '#10B981';
      default:
        return '#EF4444';
    }
  };

  return (
    <div 
      className={`validation-indicator ${type} ${size}`}
      title={message}
      style={{ color: getColor() }}
    >
      <span className="validation-icon">{getIcon()}</span>
      {size === 'large' && message && (
        <span className="validation-message">{message}</span>
      )}
    </div>
  );
};

export default ValidationIndicator;