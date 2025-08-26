import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '../hooks/useWebSocket';
import type { Bot } from '@shared/schema';

interface LogEntry {
  id: string;
  content: string;
  timestamp: string;
  formattedTime: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  lineNumber: number;
}

export default function LiveLogs() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [selectedBotId, setSelectedBotId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLogType, setSelectedLogType] = useState('all');
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [newLogCount, setNewLogCount] = useState(0);
  const [logStats, setLogStats] = useState<{[key: string]: number}>({});

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const { data: bots = [] } = useQuery<Bot[]>({
    queryKey: ['/api/bots'],
    refetchInterval: 5000,
  });

  const { subscribe } = useWebSocket();

  // Simple log formatting
  const formatLog = (logContent: string, index: number): LogEntry => {
    const now = new Date();
    const content = logContent.toLowerCase();
    let type = 'default';
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';
    
    if (content.includes('error') || content.includes('failed')) {
      type = 'error';
      severity = 'high';
    } else if (content.includes('warn')) {
      type = 'warning';
      severity = 'medium';
    } else if (content.includes('success') || content.includes('completed')) {
      type = 'success';
    } else if (content.includes('info')) {
      type = 'info';
    } else if (content.includes('debug')) {
      type = 'debug';
    }
    
    return {
      id: `${Date.now()}-${Math.random()}-${index}`,
      content: logContent,
      timestamp: now.toLocaleTimeString(),
      formattedTime: now.toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      }),
      type,
      severity,
      lineNumber: index + 1
    };
  };

  // Fetch logs when bot changes
  useEffect(() => {
    if (!selectedBotId) {
      setLogs([]);
      setFilteredLogs([]);
      return;
    }

    const fetchLogs = async () => {
      try {
        const response = await fetch(`/api/bots/${selectedBotId}/logs`);
        if (response.ok) {
          const data = await response.json();
          if (data.logs) {
            const formattedLogs = data.logs.map((log: string, index: number) => 
              formatLog(log, index)
            );
            setLogs(formattedLogs);
          }
        }
      } catch (error) {
        console.error('Error fetching logs:', error);
      }
    };

    fetchLogs();
  }, [selectedBotId]);

  // Subscribe to new logs
  useEffect(() => {
    if (!selectedBotId) return;
    
    const unsubscribe = subscribe('bot_log', (data: any) => {
      if (data.botId === selectedBotId && data.log && !isPaused) {
        const logEntry = formatLog(data.log, Date.now());
        setLogs(prev => {
          const newLogs = [...prev, logEntry];
          return newLogs.length > 1000 ? newLogs.slice(-500) : newLogs;
        });
      }
    });

    return unsubscribe;
  }, [selectedBotId, isPaused, subscribe]);

  // Filter logs
  useEffect(() => {
    let filtered = logs;

    if (selectedLogType !== 'all') {
      filtered = filtered.filter(log => log.type === selectedLogType);
    }

    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      filtered = filtered.filter(log => 
        log.content.toLowerCase().includes(search) ||
        log.type.toLowerCase().includes(search)
      );
    }

    setFilteredLogs(filtered);
    
    const stats = filtered.reduce((acc, log) => {
      acc[log.type] = (acc[log.type] || 0) + 1;
      return acc;
    }, {} as {[key: string]: number});
    
    setLogStats(stats);
  }, [logs, selectedLogType, searchTerm]);

  // Auto scroll
  useEffect(() => {
    if (autoScroll && !isPaused && logsContainerRef.current) {
      const container = logsContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [filteredLogs, autoScroll, isPaused]);

  const handleScroll = () => {
    const container = logsContainerRef.current;
    if (!container) return;
    
    const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
    setAutoScroll(isAtBottom);
  };

  const clearLogs = () => {
    setLogs([]);
    setFilteredLogs([]);
    setNewLogCount(0);
    setLogStats({});
  };

  const scrollToBottom = () => {
    setAutoScroll(true);
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  };

  const getLogStyling = (log: LogEntry) => {
    const baseClasses = 'transition-all duration-200 hover:bg-opacity-80';
    
    switch (log.type) {
      case 'error': 
        return `text-red-100 bg-red-900/30 border-l-4 border-l-red-400 ${baseClasses}`;
      case 'success': 
        return `text-green-100 bg-green-900/30 border-l-4 border-l-green-400 ${baseClasses}`;
      case 'warning': 
        return `text-yellow-100 bg-yellow-900/30 border-l-4 border-l-yellow-400 ${baseClasses}`;
      case 'debug': 
        return `text-blue-100 bg-blue-900/30 border-l-4 border-l-blue-400 ${baseClasses}`;
      case 'info': 
        return `text-cyan-100 bg-cyan-900/30 border-l-4 border-l-cyan-400 ${baseClasses}`;
      default: 
        return `text-slate-100 bg-slate-800/40 border-l-4 border-l-slate-500 ${baseClasses}`;
    }
  };

  const containerClasses = isFullscreen 
    ? "fixed inset-0 z-50 bg-slate-950 p-2 sm:p-4 safe-area-top safe-area-bottom" 
    : "min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-2 sm:p-4 lg:p-6 safe-area-top safe-area-bottom";

  return (
    <div className={containerClasses}>
      <div className="max-w-7xl mx-auto h-full flex flex-col">
        <div className="card-enhanced p-3 sm:p-4 lg:p-6 animate-fade-in flex-1 flex flex-col">
          {/* Header */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
            <div className="flex items-center gap-4">
              <h1 className="text-lg sm:text-xl font-bold flex items-center text-slate-100">
                <i className="fas fa-terminal text-purple-brand mr-2 sm:mr-3"></i>
                <span className="hidden sm:inline">Live Logs Monitor</span>
                <span className="sm:hidden">Logs</span>
                {newLogCount > 0 && (
                  <span className="ml-3 bg-red-600/80 text-red-100 px-3 py-1 rounded-full text-sm font-medium animate-pulse">
                    +{newLogCount}
                  </span>
                )}
              </h1>
              
              {/* Log Statistics */}
              {Object.keys(logStats).length > 0 && (
                <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-xs">
                  {Object.entries(logStats).map(([type, count]) => (
                    <span 
                      key={type}
                      className={`px-2 py-1 rounded-full font-medium text-xs ${
                        type === 'error' ? 'bg-red-900/40 text-red-300' :
                        type === 'success' ? 'bg-green-900/40 text-green-300' :
                        type === 'warning' ? 'bg-yellow-900/40 text-yellow-300' :
                        type === 'info' ? 'bg-blue-900/40 text-blue-300' :
                        type === 'debug' ? 'bg-purple-900/40 text-purple-300' :
                        'bg-slate-700/40 text-slate-300'
                      }`}
                    >
                      <span className="hidden sm:inline">{type}: {count}</span>
                      <span className="sm:hidden">{count}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="btn-group-mobile gap-2 sm:gap-3">
              <select
                value={selectedBotId}
                onChange={(e) => setSelectedBotId(e.target.value)}
                className="select-mobile text-sm sm:text-base flex-1 sm:flex-none sm:min-w-48"
                data-testid="select-bot-logs"
              >
                <option value="">Select Bot</option>
                {bots.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name} ({bot.status})
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="btn-mobile-sm bg-slate-700 hover:bg-slate-600 text-slate-100 touch-target mobile-active"
                  title="Toggle Fullscreen (F11)"
                >
                  <i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
                </button>

                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className={`btn-mobile touch-target mobile-active ${
                    isPaused 
                      ? 'bg-green-600 hover:bg-green-700 text-white' 
                      : 'bg-yellow-600 hover:bg-yellow-700 text-white'
                  }`}
                  data-testid="button-pause-logs"
                  title="Pause/Resume"
                >
                  <i className={`fas ${isPaused ? 'fa-play' : 'fa-pause'} sm:mr-2`}></i>
                  <span className="hidden sm:inline">{isPaused ? 'Resume' : 'Pause'}</span>
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={clearLogs}
                  className="btn-mobile bg-red-600 hover:bg-red-700 text-white touch-target mobile-active"
                  data-testid="button-clear-logs"
                  title="Clear Logs"
                >
                  <i className="fas fa-trash sm:mr-2"></i>
                  <span className="hidden sm:inline">Clear</span>
                </button>
              </div>
            </div>
          </div>

          {/* Search and Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-3 sm:mb-4">
            <div className="flex-1 relative">
              <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 text-sm"></i>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-mobile pl-10 pr-4 text-sm sm:text-base"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <i className="fas fa-times"></i>
                </button>
              )}
            </div>

            <select
              value={selectedLogType}
              onChange={(e) => setSelectedLogType(e.target.value)}
              className="select-mobile text-sm sm:text-base min-w-32 sm:min-w-40"
              data-testid="select-log-type"
            >
              <option value="all">All Types</option>
              <option value="error">Errors</option>
              <option value="warning">Warnings</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>
          </div>
          
          {/* Logs Container */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={logsContainerRef}
              onScroll={handleScroll}
              className="bg-slate-900/60 border border-slate-700/50 rounded-lg sm:rounded-xl p-2 sm:p-4 h-full overflow-y-auto font-mono text-xs sm:text-sm scrollbar-mobile relative"
              data-testid="logs-container"
              style={{ 
                scrollBehavior: autoScroll ? 'smooth' : 'auto',
                height: isFullscreen ? 'calc(100vh - 200px)' : 'calc(100vh - 300px)'
              }}
            >
              {filteredLogs.length === 0 ? (
                <div className="text-center py-16 flex flex-col items-center">
                  <i className="fas fa-terminal text-slate-600 text-4xl mb-4"></i>
                  <p className="text-slate-400 font-medium mb-2">
                    {selectedBotId ? 
                      (searchTerm || selectedLogType !== 'all' ? 'No logs match your filters' : 'No logs available yet') 
                      : 'Select a bot to view logs'
                    }
                  </p>
                  <p className="text-slate-500 text-sm">
                    {selectedBotId ? 
                      (searchTerm || selectedLogType !== 'all' ? 'Try adjusting your search or filter criteria' : 'Logs will appear here when your bot starts running')
                      : 'Choose a bot from the dropdown to start monitoring'
                    }
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredLogs.map((log, index) => (
                    <div 
                      key={log.id} 
                      className={`p-2 sm:p-3 rounded-lg group ${getLogStyling(log)} transition-all duration-150 touch-target`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 flex flex-col items-center">
                          <span className="text-xs opacity-60 font-mono">
                            {String(log.lineNumber || index + 1).padStart(4, '0')}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs opacity-70 font-medium font-mono">
                              {log.formattedTime}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wide ${
                              log.type === 'error' ? 'bg-red-600/70 text-red-100' :
                              log.type === 'success' ? 'bg-green-600/70 text-green-100' :
                              log.type === 'warning' ? 'bg-yellow-600/70 text-yellow-100' :
                              log.type === 'info' ? 'bg-blue-600/70 text-blue-100' :
                              log.type === 'debug' ? 'bg-purple-600/70 text-purple-100' :
                              'bg-slate-600/70 text-slate-100'
                            }`}>
                              {log.type}
                            </span>
                          </div>
                          <div className="text-sm leading-relaxed">
                            {searchTerm ? (
                              <span dangerouslySetInnerHTML={{
                                __html: log.content.replace(
                                  new RegExp(`(${searchTerm})`, 'gi'),
                                  '<mark class="search-highlight">$1</mark>'
                                )
                              }} />
                            ) : (
                              log.content
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            {/* Scroll to Bottom Button - Enhanced mobile positioning */}
            {!autoScroll && filteredLogs.length > 0 && (
              <button
                onClick={scrollToBottom}
                className="fab w-12 h-12 sm:w-14 sm:h-14 bottom-4 right-4 hover:scale-105 mobile-active"
                title="Scroll to bottom"
              >
                <i className="fas fa-chevron-down text-sm"></i>
              </button>
            )}

            {/* Live Indicator - Enhanced mobile design */}
            {!isPaused && selectedBotId && (
              <div className="absolute top-2 left-2 sm:top-4 sm:left-4 flex items-center gap-1 sm:gap-2 bg-green-600/90 text-green-100 px-2 py-1 sm:px-3 rounded-full text-xs font-medium z-10 backdrop-blur-sm">
                <div className="status-dot status-running"></div>
                <span className="hidden sm:inline">LIVE</span>
                <span className="sm:hidden text-xs">●</span>
              </div>
            )}
          </div>
          
          {/* Status Bar - Mobile optimized */}
          {filteredLogs.length > 0 && (
            <div className="mt-2 sm:mt-4 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 bg-slate-800/30 px-3 py-2 rounded-lg gap-1 sm:gap-0">
              <span className="text-xs">
                {filteredLogs.length} {filteredLogs.length === 1 ? 'log' : 'logs'}
                {searchTerm && (
                  <span className="hidden sm:inline"> • Filtered by "{searchTerm}"</span>
                )}
                {selectedLogType !== 'all' && (
                  <span className="hidden sm:inline"> • {selectedLogType} only</span>
                )}
              </span>
              {isPaused && (
                <span className="text-yellow-400 font-medium text-xs">
                  Paused • {newLogCount} new
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}