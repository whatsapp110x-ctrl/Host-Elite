import { useQuery } from '@tanstack/react-query';

interface SystemStatsData {
  memoryUsage: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  uptime: number;
}

export function SystemStats() {
  const { data: stats, isLoading } = useQuery<SystemStatsData>({
    queryKey: ['/api/system/stats'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  if (isLoading || !stats) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
        <h3 className="text-lg font-semibold text-slate-200 mb-2">
          <i className="fas fa-chart-line mr-2 text-blue-400"></i>
          System Performance
        </h3>
        <div className="animate-pulse">
          <div className="h-4 bg-slate-600 rounded mb-2"></div>
          <div className="h-4 bg-slate-600 rounded mb-2"></div>
          <div className="h-4 bg-slate-600 rounded"></div>
        </div>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    const sizes = ['B', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 B';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const memoryUsagePercent = Math.round((stats.memoryUsage.heapUsed / stats.memoryUsage.heapTotal) * 100);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
      <h3 className="text-lg font-semibold text-slate-200 mb-4">
        <i className="fas fa-chart-line mr-2 text-blue-400"></i>
        System Performance
      </h3>
      
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Uptime</span>
          <span className="text-green-400 font-medium">
            <i className="fas fa-clock mr-1"></i>
            {formatUptime(stats.uptime)}
          </span>
        </div>
        
        <div className="flex justify-between items-center">
          <span className="text-slate-400">Memory Usage</span>
          <span className="text-blue-400 font-medium">
            {formatBytes(stats.memoryUsage.heapUsed)} / {formatBytes(stats.memoryUsage.heapTotal)}
          </span>
        </div>
        
        <div className="w-full bg-slate-700 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${
              memoryUsagePercent > 80 ? 'bg-red-500' : 
              memoryUsagePercent > 60 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${memoryUsagePercent}%` }}
          ></div>
        </div>
        
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-500">RSS: {formatBytes(stats.memoryUsage.rss)}</span>
          <span className="text-slate-500">{memoryUsagePercent}% used</span>
        </div>
      </div>
    </div>
  );
}