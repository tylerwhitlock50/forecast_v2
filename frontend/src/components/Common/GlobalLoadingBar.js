import React from 'react';
import { useForecast } from '../../context/ForecastContext';

/**
 * Thin top-of-viewport progress bar tied to the single `loading` flag in
 * ForecastContext. Every CRUD action in the context toggles that flag,
 * so any async work produces a consistent visual signal without each
 * module rolling its own spinner.
 */
const GlobalLoadingBar = () => {
  const { loading } = useForecast();

  return (
    <div
      aria-hidden={!loading}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 60,
        pointerEvents: 'none',
        opacity: loading ? 1 : 0,
        transition: 'opacity 150ms ease-out',
      }}
    >
      <div
        style={{
          height: '100%',
          width: '100%',
          background: 'linear-gradient(90deg, transparent, #ea580c 30%, #ea580c 70%, transparent)',
          backgroundSize: '200% 100%',
          animation: loading ? 'global-loading-shimmer 1.2s linear infinite' : 'none',
        }}
      />
      <style>{`
        @keyframes global-loading-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

export default GlobalLoadingBar;
