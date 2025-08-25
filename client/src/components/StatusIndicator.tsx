import { useState, useEffect } from 'react';

interface StatusIndicatorProps {
  status: 'running' | 'stopped' | 'error' | 'deploying';
  className?: string;
}

export function StatusIndicator({ status, className = "" }: StatusIndicatorProps) {
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (status === 'running' || status === 'deploying') {
      const interval = setInterval(() => {
        setPulse(prev => !prev);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [status]);

  const getStatusConfig = () => {
    switch (status) {
      case 'running':
        return {
          color: 'bg-green-400',
          label: 'Running',
          icon: 'fa-play-circle',
          animation: pulse ? 'animate-pulse' : ''
        };
      case 'stopped':
        return {
          color: 'bg-slate-400',
          label: 'Stopped',
          icon: 'fa-stop-circle',
          animation: ''
        };
      case 'error':
        return {
          color: 'bg-red-400',
          label: 'Error',
          icon: 'fa-exclamation-triangle',
          animation: 'animate-pulse'
        };
      case 'deploying':
        return {
          color: 'bg-yellow-400',
          label: 'Deploying',
          icon: 'fa-cog',
          animation: 'animate-spin'
        };
      default:
        return {
          color: 'bg-slate-400',
          label: 'Unknown',
          icon: 'fa-question-circle',
          animation: ''
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <div className={`w-3 h-3 rounded-full ${config.color} ${config.animation}`} />
      <span className="text-sm text-slate-300 capitalize">
        <i className={`fas ${config.icon} mr-1`}></i>
        {config.label}
      </span>
    </div>
  );
}