import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { StatsCard } from '../components/StatsCard';
import { CodeEditor } from '../components/CodeEditor';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import type { Bot } from '@shared/schema';
import customVideo from '@assets/20240216_143627-CINEMATIC_1756127896143.mp4';

interface BotStats {
  totalBots: number;
  runningBots: number;
  stoppedBots: number;
  errorBots: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<BotStats>({
    totalBots: 0,
    runningBots: 0,
    stoppedBots: 0,
    errorBots: 0,
  });
  const [editingBot, setEditingBot] = useState<Bot | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: bots = [], isLoading: botsLoading } = useQuery<Bot[]>({
    queryKey: ['/api/bots'],
    refetchInterval: 5000,
  });

  const { data: statsData } = useQuery<BotStats>({
    queryKey: ['/api/stats'],
    refetchInterval: 5000,
  });

  const { subscribe } = useWebSocket();

  // Bot control mutations
  const startBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const response = await apiRequest('POST', `/api/bots/${botId}/start`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Success', description: 'Bot started successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const stopBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const response = await apiRequest('POST', `/api/bots/${botId}/stop`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Success', description: 'Bot stopped successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const restartBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const response = await apiRequest('POST', `/api/bots/${botId}/restart`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Success', description: 'Bot restarted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const forceStopBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const response = await apiRequest('POST', `/api/bots/${botId}/force-stop`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Success', description: 'Bot force stopped successfully', variant: 'default' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteBotMutation = useMutation({
    mutationFn: async (botId: string) => {
      const response = await apiRequest('DELETE', `/api/bots/${botId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      toast({ title: 'Success', description: 'Bot deleted successfully' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    if (statsData) {
      setStats(statsData);
    }
  }, [statsData]);

  useEffect(() => {
    const unsubscribe = subscribe('bot_status_changed', () => {
      // Refetch stats when bot status changes
    });
    return unsubscribe;
  }, [subscribe]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center animate-fade-in">
          <div className="inline-block mb-4">
            <div className="w-16 h-16 rounded-full overflow-hidden bg-gradient-to-r from-purple-600 to-blue-600 p-0.5 shadow-lg">
              <video
                src={customVideo}
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-cover rounded-full"
              />
            </div>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-100 mb-2 bg-gradient-to-r from-white via-blue-100 to-purple-100 bg-clip-text text-transparent drop-shadow-lg">
            Owner-Ashish
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto">
            Professional bot hosting with 24/7 uptime and real-time monitoring
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-8 animate-slide-up">
          <Link href="/deploy">
            <div 
              className="btn-primary px-6 py-3 text-center cursor-pointer hover-lift"
              data-testid="button-deploy-new-bot"
            >
              <i className="fas fa-upload mr-2"></i>
              Deploy New Bot
            </div>
          </Link>
          <a
            href="https://t.me/fightermonk110"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary px-6 py-3 text-center hover-lift"
            data-testid="button-open-telegram-bot"
          >
            <i className="fab fa-telegram mr-2"></i>
            Contact Developer
          </a>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8 animate-scale-in">
          <div className="card-professional p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Total Bots</p>
                <p className="text-2xl font-bold text-slate-100">{stats.totalBots}</p>
              </div>
              <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">
                <i className="fas fa-server text-slate-300 text-sm"></i>
              </div>
            </div>
          </div>

          <div className="card-professional p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Running</p>
                <p className="text-2xl font-bold text-green-400">{stats.runningBots}</p>
              </div>
              <div className="w-10 h-10 bg-green-900/50 rounded-lg flex items-center justify-center">
                <i className="fas fa-play-circle text-green-400 text-sm"></i>
              </div>
            </div>
          </div>

          <div className="card-professional p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Stopped</p>
                <p className="text-2xl font-bold text-slate-300">{stats.stoppedBots}</p>
              </div>
              <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">
                <i className="fas fa-stop-circle text-slate-400 text-sm"></i>
              </div>
            </div>
          </div>

          <div className="card-professional p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Errors</p>
                <p className="text-2xl font-bold text-red-400">{stats.errorBots}</p>
              </div>
              <div className="w-10 h-10 bg-red-900/50 rounded-lg flex items-center justify-center">
                <i className="fas fa-exclamation-triangle text-red-400 text-sm"></i>
              </div>
            </div>
          </div>
        </div>


        {/* Deployed Bots Section */}
        <div className="card-professional p-6 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <h2 className="text-xl font-bold text-slate-100 flex items-center">
              <i className="fas fa-list mr-3 text-purple-brand"></i>
              Deployed Bots
              <span className="ml-3 text-sm bg-slate-700 text-slate-300 px-3 py-1 rounded-full">
                {bots.length}
              </span>
            </h2>
            <button 
              className="btn-secondary px-4 py-2 text-sm"
              data-testid="button-refresh-bots"
              onClick={() => window.location.reload()}
            >
              <i className="fas fa-sync-alt mr-2"></i>
              Refresh
            </button>
          </div>
          
          {botsLoading ? (
            <div className="text-center py-16 animate-fade-in">
              <div className="w-8 h-8 border-2 border-slate-600 border-t-purple-brand rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-slate-300 font-medium">Loading bots...</p>
            </div>
          ) : bots.length === 0 ? (
            <div className="text-center py-16 animate-fade-in" data-testid="no-bots-message">
              <i className="fas fa-inbox text-slate-600 text-6xl mb-6"></i>
              <h3 className="text-xl font-bold text-slate-300 mb-3">No bots deployed yet</h3>
              <p className="text-slate-400 mb-6 max-w-lg mx-auto">
                Deploy your first bot to get started with 24/7 hosting. Supports Python and Node.js environments.
              </p>
              <Link href="/deploy">
                <div className="btn-primary px-6 py-3 inline-flex items-center cursor-pointer hover-lift">
                  <i className="fas fa-plus mr-2"></i>
                  Deploy Your First Bot
                </div>
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {bots.map((bot) => (
                <div
                  key={bot.id}
                  className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover-lift"
                  data-testid={`bot-item-${bot.name}`}
                >
                  <div className="flex items-center space-x-4">
                    <div className={`status-indicator ${
                      bot.status === 'running' ? 'status-running' :
                      bot.status === 'error' ? 'status-error' :
                      bot.status === 'deploying' ? 'status-deploying' : 
                      'status-stopped'
                    }`}></div>
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-slate-100">{bot.name}</h3>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${
                          bot.language === 'python' ? 'bg-blue-900/50 text-blue-300' : 'bg-green-900/50 text-green-300'
                        }`}>
                          <i className={`fas ${bot.language === 'python' ? 'fa-python' : 'fa-node-js'} mr-1`}></i>
                          {bot.language}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-medium capitalize px-2 py-1 rounded ${
                          bot.status === 'running' ? 'text-green-300 bg-green-900/30' :
                          bot.status === 'error' ? 'text-red-300 bg-red-900/30' :
                          bot.status === 'deploying' ? 'text-yellow-300 bg-yellow-900/30' : 
                          'text-slate-400 bg-slate-800/50'
                        }`}>
                          {bot.status}
                        </span>
                        {bot.status === 'running' && (
                          <span className="text-xs bg-green-900/30 text-green-300 px-2 py-1 rounded">
                            Online
                          </span>
                        )}
                        {bot.autoRestart && (
                          <span className="text-xs bg-blue-900/30 text-blue-300 px-2 py-1 rounded">
                            Auto-restart
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    {bot.status === 'stopped' && (
                      <button 
                        onClick={() => startBotMutation.mutate(bot.id)}
                        disabled={startBotMutation.isPending}
                        className="btn-success px-3 py-2 text-xs"
                        data-testid={`button-start-${bot.name}`}
                      >
                        <i className={`fas ${startBotMutation.isPending ? 'fa-spinner fa-spin' : 'fa-play'} mr-1`}></i>
                        Start
                      </button>
                    )}
                    {bot.status === 'running' && (
                      <>
                        <button 
                          onClick={() => stopBotMutation.mutate(bot.id)}
                          disabled={stopBotMutation.isPending}
                          className="btn-warning px-3 py-2 text-xs"
                          data-testid={`button-stop-${bot.name}`}
                        >
                          <i className={`fas ${stopBotMutation.isPending ? 'fa-spinner fa-spin' : 'fa-pause'} mr-1`}></i>
                          Stop
                        </button>
                        <button 
                          onClick={() => forceStopBotMutation.mutate(bot.id)}
                          disabled={forceStopBotMutation.isPending}
                          className="btn-danger px-3 py-2 text-xs"
                          data-testid={`button-force-stop-${bot.name}`}
                        >
                          <i className={`fas ${forceStopBotMutation.isPending ? 'fa-spinner fa-spin' : 'fa-stop'} mr-1`}></i>
                          Kill
                        </button>
                      </>
                    )}
                    {(bot.status === 'running' || bot.status === 'stopped') && (
                      <button 
                        onClick={() => restartBotMutation.mutate(bot.id)}
                        disabled={restartBotMutation.isPending}
                        className="btn-primary px-3 py-2 text-xs"
                        data-testid={`button-restart-${bot.name}`}
                      >
                        <i className={`fas ${restartBotMutation.isPending ? 'fa-spinner fa-spin' : 'fa-redo'} mr-1`}></i>
                        Restart
                      </button>
                    )}
                    <button 
                      onClick={() => setEditingBot(bot)}
                      className="btn-secondary px-3 py-2 text-xs"
                      data-testid={`button-edit-${bot.name}`}
                    >
                      <i className="fas fa-edit mr-1"></i>
                      Edit
                    </button>
                    <Link href={`/logs?bot=${bot.id}`}>
                      <button 
                        className="btn-secondary px-3 py-2 text-xs"
                        data-testid={`button-logs-${bot.name}`}
                      >
                        <i className="fas fa-terminal mr-1"></i>
                        Logs
                      </button>
                    </Link>
                    <button 
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete bot "${bot.name}"? This action cannot be undone.`)) {
                          deleteBotMutation.mutate(bot.id);
                        }
                      }}
                      disabled={deleteBotMutation.isPending}
                      className="btn-danger w-9 h-9 flex items-center justify-center"
                      data-testid={`button-delete-${bot.name}`}
                      title="Delete bot"
                    >
                      <i className={`fas ${deleteBotMutation.isPending ? 'fa-spinner fa-spin' : 'fa-trash'} text-xs`}></i>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Features Section */}
        <div className="mt-8 card-professional p-6 animate-fade-in">
          <h2 className="text-xl font-bold text-slate-100 mb-6 text-center">
            Why Choose Host-Elite?
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center mx-auto mb-3">
                <i className="fas fa-clock text-slate-300"></i>
              </div>
              <h3 className="font-semibold text-slate-200 mb-2">24/7 Uptime</h3>
              <p className="text-slate-400 text-sm">Continuous bot operation with automatic restart on crashes.</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center mx-auto mb-3">
                <i className="fas fa-zap text-slate-300"></i>
              </div>
              <h3 className="font-semibold text-slate-200 mb-2">Instant Deployment</h3>
              <p className="text-slate-400 text-sm">Upload and deploy in seconds with custom commands.</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center mx-auto mb-3">
                <i className="fas fa-chart-line text-slate-300"></i>
              </div>
              <h3 className="font-semibold text-slate-200 mb-2">Real-time Monitoring</h3>
              <p className="text-slate-400 text-sm">Monitor logs and performance with live dashboard.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Code Editor Modal */}
      {editingBot && (
        <CodeEditor
          botId={editingBot.id}
          botName={editingBot.name}
          isOpen={!!editingBot}
          onClose={() => setEditingBot(null)}
        />
      )}
    </div>
  );
}