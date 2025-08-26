import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';

interface KeepAliveStatus {
  lastPing: string;
  failCount: number;
  isHealthy: boolean;
  totalPings: number;
  successfulPings: number;
  uptimeSeconds: number;
  lastPingAgo: number;
  successRate: string;
  isRunning: boolean;
  activeStrategies: number;
  pingUrls: string[];
  currentUrl: string;
  healthStatus: string;
}

interface HealthData {
  status: string;
  timestamp: string;
  uptime: number;
  keepAlive: KeepAliveStatus;
  environment: string;
}

export default function SystemHealth() {
  const [refreshInterval, setRefreshInterval] = useState(5000);

  const { data: healthData, isLoading } = useQuery<HealthData>({
    queryKey: ['/api/health'],
    refetchInterval: refreshInterval,
  });

  const { data: statusData } = useQuery({
    queryKey: ['/api/status'],
    refetchInterval: refreshInterval,
  });

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  const getHealthColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'excellent': return 'text-green-400 bg-green-900/20';
      case 'good': return 'text-blue-400 bg-blue-900/20';
      case 'warning': return 'text-yellow-400 bg-yellow-900/20';
      case 'critical': return 'text-red-400 bg-red-900/20';
      default: return 'text-slate-400 bg-slate-800/20';
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status.toLowerCase()) {
      case 'excellent': return 'fas fa-check-circle';
      case 'good': return 'fas fa-thumbs-up';
      case 'warning': return 'fas fa-exclamation-triangle';
      case 'critical': return 'fas fa-exclamation-circle';
      default: return 'fas fa-question-circle';
    }
  };

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <div className="text-center py-12">
              <i className="fas fa-spinner fa-spin text-4xl text-purple-brand mb-4"></i>
              <p className="text-slate-300">Loading system health data...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold flex items-center">
              <i className="fas fa-heartbeat text-purple-brand text-xl mr-3"></i>
              System Health & 24/7 Monitoring
            </h1>
            <div className="flex items-center space-x-3">
              <label className="flex items-center text-sm text-slate-300">
                Refresh:
                <select
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="ml-2 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-slate-100"
                  data-testid="select-refresh-interval"
                >
                  <option value={1000}>1s</option>
                  <option value={5000}>5s</option>
                  <option value={10000}>10s</option>
                  <option value={30000}>30s</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        {/* Keep-Alive Status */}
        {healthData?.keepAlive && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6 flex items-center">
              <i className="fas fa-shield-alt text-green-400 mr-3"></i>
              Advanced Keep-Alive System
            </h2>
            
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              <div className="text-center">
                <div className={`${getHealthColor(healthData.keepAlive.healthStatus)} p-4 rounded-lg border`}>
                  <i className={`${getHealthIcon(healthData.keepAlive.healthStatus)} text-3xl mb-2`}></i>
                  <p className="font-bold text-lg">{healthData.keepAlive.healthStatus}</p>
                  <p className="text-sm opacity-75">Health Status</p>
                </div>
              </div>
              
              <div className="text-center">
                <div className="bg-blue-900/20 border border-blue-700 text-blue-400 p-4 rounded-lg">
                  <i className="fas fa-clock text-3xl mb-2"></i>
                  <p className="font-bold text-lg">{formatUptime(healthData.keepAlive.uptimeSeconds)}</p>
                  <p className="text-sm opacity-75">System Uptime</p>
                </div>
              </div>
              
              <div className="text-center">
                <div className="bg-purple-900/20 border border-purple-700 text-purple-400 p-4 rounded-lg">
                  <i className="fas fa-percentage text-3xl mb-2"></i>
                  <p className="font-bold text-lg">{healthData.keepAlive.successRate}</p>
                  <p className="text-sm opacity-75">Success Rate</p>
                </div>
              </div>
              
              <div className="text-center">
                <div className="bg-amber-900/20 border border-amber-700 text-amber-400 p-4 rounded-lg">
                  <i className="fas fa-layers text-3xl mb-2"></i>
                  <p className="font-bold text-lg">{healthData.keepAlive.activeStrategies}</p>
                  <p className="text-sm opacity-75">Active Strategies</p>
                </div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="bg-slate-750 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 flex items-center">
                  <i className="fas fa-chart-line text-green-400 mr-2"></i>
                  Ping Statistics
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Total Pings:</span>
                    <span className="text-slate-200">{healthData.keepAlive.totalPings}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Successful:</span>
                    <span className="text-green-400">{healthData.keepAlive.successfulPings}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Failed:</span>
                    <span className="text-red-400">{healthData.keepAlive.failCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Last Ping:</span>
                    <span className="text-slate-200">{healthData.keepAlive.lastPingAgo}s ago</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-750 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 flex items-center">
                  <i className="fas fa-network-wired text-blue-400 mr-2"></i>
                  System Status
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Running:</span>
                    <span className={`${healthData.keepAlive.isRunning ? 'text-green-400' : 'text-red-400'}`}>
                      {healthData.keepAlive.isRunning ? 'Yes' : 'No'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Environment:</span>
                    <span className="text-slate-200">{healthData.environment}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Health Check:</span>
                    <span className={`${healthData.keepAlive.isHealthy ? 'text-green-400' : 'text-red-400'}`}>
                      {healthData.keepAlive.isHealthy ? 'Healthy' : 'Unhealthy'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Monitoring Endpoints */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <i className="fas fa-globe text-blue-400 mr-3"></i>
            Monitoring Endpoints
          </h2>
          
          <div className="grid md:grid-cols-2 gap-4">
            {healthData?.keepAlive.pingUrls.map((url, index) => (
              <div key={index} className="bg-slate-750 p-4 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <i className="fas fa-link text-purple-400 mr-2"></i>
                    <span className="font-mono text-sm">{url.split('/').pop()}</span>
                  </div>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 text-sm"
                    data-testid={`link-endpoint-${index}`}
                  >
                    <i className="fas fa-external-link-alt"></i>
                  </a>
                </div>
                <p className="text-slate-400 text-xs mt-1 font-mono">{url}</p>
              </div>
            ))}
          </div>
        </div>

        {/* External Monitoring Setup */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
          <h2 className="text-xl font-semibold mb-6 flex items-center">
            <i className="fas fa-satellite-dish text-amber-400 mr-3"></i>
            External Monitoring Setup
          </h2>
          
          <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4 mb-6">
            <p className="text-amber-300 mb-2">
              <i className="fas fa-lightbulb mr-2"></i>
              <strong>24/7 Uptime Guarantee:</strong>
            </p>
            <p className="text-sm text-slate-300">
              Set up external monitoring services to ping your platform and ensure it never goes to sleep.
              Even when you close Replit, these services will keep your app alive 24/7.
            </p>
          </div>

          <div className="grid gap-4">
            {[
              { name: 'UptimeRobot', url: 'https://uptimerobot.com', free: 'Free', interval: '5 min' },
              { name: 'Better Uptime', url: 'https://betteruptime.com', free: 'Free Tier', interval: '3 min' },
              { name: 'Pingdom', url: 'https://pingdom.com', free: 'Trial', interval: '1 min' },
              { name: 'StatusCake', url: 'https://statuscake.com', free: 'Free', interval: '5 min' }
            ].map((service, index) => (
              <div key={index} className="bg-slate-750 p-4 rounded-lg flex items-center justify-between">
                <div className="flex items-center">
                  <i className="fas fa-satellite text-green-400 mr-3"></i>
                  <div>
                    <p className="font-semibold text-slate-200">{service.name}</p>
                    <p className="text-xs text-slate-400">Monitor URL: {healthData?.keepAlive.currentUrl}/api/keepalive</p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className="text-xs bg-green-900/30 text-green-400 px-2 py-1 rounded">{service.free}</span>
                  <span className="text-xs bg-blue-900/30 text-blue-400 px-2 py-1 rounded">{service.interval}</span>
                  <a
                    href={service.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-purple-brand hover:bg-purple-600 text-white px-3 py-1 rounded text-sm transition-colors"
                    data-testid={`link-service-${index}`}
                  >
                    Setup
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Performance */}
        {statusData && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
            <h2 className="text-xl font-semibold mb-6 flex items-center">
              <i className="fas fa-tachometer-alt text-cyan-400 mr-3"></i>
              Live Performance Metrics
            </h2>
            
            <div className="grid md:grid-cols-3 gap-6">
              <div className="bg-slate-750 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 text-cyan-400">Memory Usage</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Heap Used:</span>
                    <span className="text-slate-200">{(statusData.memory.heapUsed / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Heap Total:</span>
                    <span className="text-slate-200">{(statusData.memory.heapTotal / 1024 / 1024).toFixed(1)} MB</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-slate-750 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 text-cyan-400">System Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Platform:</span>
                    <span className="text-slate-200">{statusData.platform}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Node.js:</span>
                    <span className="text-slate-200">{statusData.nodeVersion}</span>
                  </div>
                </div>
              </div>
              
              <div className="bg-slate-750 p-4 rounded-lg">
                <h3 className="font-semibold mb-3 text-cyan-400">CPU Usage</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">User:</span>
                    <span className="text-slate-200">{(statusData.cpuUsage.user / 1000).toFixed(2)}ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">System:</span>
                    <span className="text-slate-200">{(statusData.cpuUsage.system / 1000).toFixed(2)}ms</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}