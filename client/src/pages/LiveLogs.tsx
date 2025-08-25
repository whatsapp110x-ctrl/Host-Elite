import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Bot } from '@shared/schema';

export default function LiveLogs() {
  const [selectedBotId, setSelectedBotId] = useState<string>('');
  const [logs, setLogs] = useState<Array<{id: string, content: string, timestamp: string, type: string}>>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  const [newLogCount, setNewLogCount] = useState(0);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const hasInitialized = useRef(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout>();
  const logBufferRef = useRef<Array<{id: string, content: string, timestamp: string, type: string}>>([]);
  const flushTimeoutRef = useRef<NodeJS.Timeout>();

  // Get bot ID from URL query parameter only once
  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;
    
    const urlParams = new URLSearchParams(window.location.search);
    const botParam = urlParams.get('bot');
    if (botParam) {
      setSelectedBotId(botParam);
    }
  }, []);

  const { data: bots = [] } = useQuery<Bot[]>({
    queryKey: ['/api/bots'],
  });

  const { subscribe, subscribeToLogs, unsubscribeFromLogs } = useWebSocket();

  // Fetch logs for selected bot
  const fetchLogs = useCallback(async (botId: string) => {
    if (!botId) return;
    
    try {
      const response = await fetch(`/api/bots/${botId}/logs`);
      if (response.ok) {
        const data = await response.json();
        if (data.logs) {
          const formattedLogs = data.logs.map((log: string, index: number) => ({
            id: `existing-${index}`,
            content: log,
            timestamp: new Date().toLocaleTimeString(),
            type: getLogType(log)
          }));
          setLogs(formattedLogs);
        }
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    }
  }, []);

  useEffect(() => {
    if (!selectedBotId) {
      setLogs([]);
      return;
    }

    subscribeToLogs(selectedBotId);
    fetchLogs(selectedBotId);

    return () => {
      unsubscribeFromLogs(selectedBotId);
    };
  }, [selectedBotId]);

  // Buffer logs for smooth updates
  const bufferLog = useCallback((log: {id: string, content: string, timestamp: string, type: string}) => {
    if (isPaused) {
      setNewLogCount(prev => prev + 1);
      return;
    }

    logBufferRef.current.push(log);

    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
    }

    flushTimeoutRef.current = setTimeout(() => {
      if (logBufferRef.current.length > 0) {
        setLogs(prevLogs => {
          const newLogs = [...prevLogs, ...logBufferRef.current];
          if (newLogs.length > 1000) {
            return newLogs.slice(-500);
          }
          return newLogs;
        });
        logBufferRef.current = [];
      }
    }, 100);
  }, [isPaused]);

  useEffect(() => {
    const unsubscribe = subscribe('bot_log', (data: any) => {
      if (data.botId === selectedBotId && data.log) {
        const logEntry = {
          id: `${Date.now()}-${Math.random()}`,
          content: data.log,
          timestamp: new Date().toLocaleTimeString(),
          type: getLogType(data.log)
        };
        bufferLog(logEntry);
      }
    });

    return unsubscribe;
  }, [subscribe, selectedBotId, bufferLog]);

  // Auto-scroll functionality
  useEffect(() => {
    if (!autoScroll || isScrolling || isPaused) return;

    const container = logsContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [logs, autoScroll, isScrolling, isPaused]);

  const handleScroll = () => {
    const container = logsContainerRef.current;
    if (!container) return;

    setIsScrolling(true);
    
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrolling(false);
      
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      setAutoScroll(isAtBottom);
    }, 150);
  };

  const clearLogs = () => {
    setLogs([]);
    setNewLogCount(0);
    logBufferRef.current = [];
  };

  const resumeLogs = () => {
    setIsPaused(false);
    setNewLogCount(0);
    
    if (logBufferRef.current.length > 0) {
      setLogs(prevLogs => {
        const newLogs = [...prevLogs, ...logBufferRef.current];
        if (newLogs.length > 1000) {
          return newLogs.slice(-500);
        }
        return newLogs;
      });
      logBufferRef.current = [];
    }
  };

  const getLogType = (logContent: string): string => {
    const content = logContent.toLowerCase();
    
    if (content.includes('error') || content.includes('exception') || content.includes('failed')) {
      return 'error';
    }
    if (content.includes('success') || content.includes('completed') || content.includes('done')) {
      return 'success';
    }
    if (content.includes('warn') || content.includes('warning')) {
      return 'warning';
    }
    if (content.includes('debug')) {
      return 'debug';
    }
    if (content.includes('info') || content.includes('starting')) {
      return 'info';
    }
    
    return 'default';
  };

  const getLogStyling = (type: string) => {
    switch (type) {
      case 'error': return 'text-red-300 bg-red-900/20 border-l-4 border-l-red-500';
      case 'success': return 'text-green-300 bg-green-900/20 border-l-4 border-l-green-500';
      case 'warning': return 'text-yellow-300 bg-yellow-900/20 border-l-4 border-l-yellow-500';
      case 'debug': return 'text-blue-300 bg-blue-900/20 border-l-4 border-l-blue-500';
      case 'info': return 'text-cyan-300 bg-cyan-900/20 border-l-4 border-l-cyan-500';
      default: return 'text-slate-300 bg-slate-800/30 border-l-4 border-l-slate-600';
    }
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTo({
        top: logsContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="card-professional p-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h1 className="text-xl font-bold flex items-center text-slate-100">
              <i className="fas fa-terminal text-purple-brand mr-3"></i>
              Live Logs
              {newLogCount > 0 && (
                <span className="ml-3 bg-red-600/80 text-red-100 px-2 py-1 rounded text-sm font-medium">
                  +{newLogCount}
                </span>
              )}
            </h1>
            <div className="flex items-center gap-3">
              <select
                value={selectedBotId}
                onChange={(e) => setSelectedBotId(e.target.value)}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-purple-brand"
                data-testid="select-bot-logs"
              >
                <option value="">Select Bot</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name} ({bot.status})
                  </option>
                ))}
              </select>
              <button
                onClick={() => isPaused ? resumeLogs() : setIsPaused(!isPaused)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isPaused 
                    ? 'btn-success' 
                    : 'btn-warning'
                }`}
                data-testid="button-pause-logs"
              >
                <i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'} mr-2`}></i>
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={clearLogs}
                className="btn-danger px-4 py-2 text-sm"
                data-testid="button-clear-logs"
              >
                <i className="fas fa-trash mr-2"></i>
                Clear
              </button>
            </div>
          </div>
          
          <div className="relative">
            <div
              ref={logsContainerRef}
              onScroll={handleScroll}
              className="bg-slate-900/60 border border-slate-700/50 rounded-lg p-4 h-96 overflow-y-auto font-mono text-sm scrollbar-thin"
              data-testid="logs-container"
            >
              {logs.length === 0 ? (
                <div className="text-center py-16 flex flex-col items-center">
                  <i className="fas fa-terminal text-slate-600 text-4xl mb-4"></i>
                  <p className="text-slate-400 font-medium mb-2">
                    {selectedBotId ? 'No logs available yet' : 'Select a bot to view logs'}
                  </p>
                  <p className="text-slate-500 text-sm">
                    {selectedBotId ? 
                      'Logs will appear here when your bot starts running' : 
                      'Choose a bot from the dropdown to start monitoring'
                    }
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div 
                      key={log.id} 
                      className={`p-3 rounded ${getLogStyling(log.type)}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs opacity-70 font-medium">
                              {log.timestamp}
                            </span>
                            <span className={`px-2 py-1 rounded text-xs font-medium uppercase ${
                              log.type === 'error' ? 'bg-red-600/60 text-red-200' :
                              log.type === 'success' ? 'bg-green-600/60 text-green-200' :
                              log.type === 'warning' ? 'bg-yellow-600/60 text-yellow-200' :
                              log.type === 'info' ? 'bg-blue-600/60 text-blue-200' :
                              log.type === 'debug' ? 'bg-purple-600/60 text-purple-200' :
                              'bg-slate-600/60 text-slate-200'
                            }`}>
                              {log.type}
                            </span>
                          </div>
                          <pre className="whitespace-pre-wrap break-words text-sm">
                            {log.content}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {!autoScroll && logs.length > 0 && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-4 right-4 bg-purple-600 hover:bg-purple-700 text-white w-10 h-10 rounded-full flex items-center justify-center transition-colors"
                title="Scroll to bottom"
              >
                <i className="fas fa-chevron-down text-sm"></i>
              </button>
            )}
          </div>
          
          {logs.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <div className="flex items-center gap-4">
                <span>
                  Total: <strong className="text-slate-300">{logs.length}</strong>
                </span>
                {newLogCount > 0 && (
                  <span className="text-red-400">
                    Buffered: <strong>{newLogCount}</strong>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 rounded text-xs ${
                  autoScroll ? 'bg-green-900/40 text-green-400' : 'bg-slate-700/40 text-slate-400'
                }`}>
                  Auto-scroll {autoScroll ? 'ON' : 'OFF'}
                </span>
                <span className={`px-2 py-1 rounded text-xs ${
                  isPaused ? 'bg-yellow-900/40 text-yellow-400' : 'bg-blue-900/40 text-blue-400'
                }`}>
                  {isPaused ? 'PAUSED' : 'LIVE'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}