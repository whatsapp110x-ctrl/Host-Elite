import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Copy, Bot as BotIcon, MessageSquare, Users, Activity, Settings, ExternalLink } from 'lucide-react';
import type { Bot } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';

interface TelegramBotInfo {
  status: 'active' | 'error';
  botInfo?: {
    id: number;
    username: string;
    first_name: string;
  };
  message?: string;
}

export default function TelegramBotManager() {
  const { toast } = useToast();
  const [selectedTab, setSelectedTab] = useState('overview');

  // Fetch Telegram bot status
  const { data: telegramStatus, isLoading: statusLoading } = useQuery<TelegramBotInfo>({
    queryKey: ['/api/telegram/status'],
  });

  // Fetch all bots for Telegram management
  const { data: allBots = [], isLoading: botsLoading } = useQuery<Bot[]>({
    queryKey: ['/api/bots'],
    refetchInterval: 5000, // Refresh every 5 seconds for real-time updates
  });

  // Filter bots that have telegram user IDs (were created via Telegram)
  const telegramBots = allBots.filter(bot => bot.telegramUserId);

  const broadcastMutation = useMutation({
    mutationFn: async ({ message, targetUserId }: { message: string; targetUserId?: string }) => {
      const response = await fetch('/api/telegram/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, targetUserId })
      });
      
      if (!response.ok) {
        throw new Error('Failed to send broadcast message');
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Message Sent",
        description: "Broadcast message sent successfully to Telegram users",
      });
    },
    onError: (error) => {
      toast({
        title: "Broadcast Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const copyToClipboard = async (text: string, description: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied!",
        description: `${description} copied to clipboard`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'stopped': return 'bg-red-500';
      case 'error': return 'bg-red-600';
      case 'deploying': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  const formatUptime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  };

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <BotIcon className="mx-auto h-12 w-12 text-muted-foreground animate-pulse" />
          <p className="mt-2 text-muted-foreground">Loading Telegram Bot...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="telegram-bot-manager">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Telegram Bot Manager</h1>
          <p className="text-muted-foreground mt-1">
            Manage your Telegram bot hosting platform
          </p>
        </div>
        
        {telegramStatus?.status === 'active' && (
          <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950 rounded-lg">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm font-medium text-green-700 dark:text-green-400">Bot Active</span>
          </div>
        )}
      </div>

      {/* Telegram Bot Status */}
      <Card data-testid="card-telegram-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Telegram Bot Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {telegramStatus?.status === 'active' && telegramStatus.botInfo ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                <div>
                  <h3 className="font-semibold text-green-800 dark:text-green-200">
                    @{telegramStatus.botInfo.username}
                  </h3>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {telegramStatus.botInfo.first_name} (ID: {telegramStatus.botInfo.id})
                  </p>
                </div>
                <Badge variant="default" className="bg-green-500">
                  Active
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="space-y-1">
                  <p className="font-medium">Bot Username:</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs">@{telegramStatus.botInfo.username}</code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => copyToClipboard(`@${telegramStatus.botInfo?.username}`, 'Bot username')}
                      data-testid="button-copy-username"
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="font-medium">Telegram Link:</p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(`https://t.me/${telegramStatus.botInfo?.username}`, '_blank')}
                      data-testid="button-open-telegram"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      Open Bot
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>
                Telegram bot is not active. Check your bot token configuration.
                {telegramStatus?.message && (
                  <div className="mt-2">
                    <strong>Error:</strong> {telegramStatus.message}
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="bots" data-testid="tab-bots">Hosted Bots</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {/* Bot Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card data-testid="card-total-bots">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Total Bots</p>
                    <p className="text-2xl font-bold">{telegramBots.length}</p>
                  </div>
                  <BotIcon className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-running-bots">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Running</p>
                    <p className="text-2xl font-bold text-green-600">
                      {telegramBots.filter(bot => bot.status === 'running').length}
                    </p>
                  </div>
                  <Activity className="h-8 w-8 text-green-500" />
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-stopped-bots">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Stopped</p>
                    <p className="text-2xl font-bold text-red-600">
                      {telegramBots.filter(bot => bot.status === 'stopped').length}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-950 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card data-testid="card-unique-users">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Unique Users</p>
                    <p className="text-2xl font-bold">
                      {new Set(telegramBots.map(bot => bot.telegramUserId)).size}
                    </p>
                  </div>
                  <Users className="h-8 w-8 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Commands Guide */}
          <Card data-testid="card-commands-guide">
            <CardHeader>
              <CardTitle>Available Telegram Commands</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div className="space-y-2">
                  <h4 className="font-semibold">File Management:</h4>
                  <div className="space-y-1 text-muted-foreground">
                    <p><code>/upload</code> - Upload ZIP or raw files</p>
                    <p><code>/env</code> - Upload environment variables</p>
                    <p><code>/cmd &lt;command&gt;</code> - Set custom run command</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold">Bot Control:</h4>
                  <div className="space-y-1 text-muted-foreground">
                    <p><code>/deploy &lt;name&gt;</code> - Deploy bot</p>
                    <p><code>/startbot &lt;name&gt;</code> - Start bot</p>
                    <p><code>/stopbot &lt;name&gt;</code> - Stop bot</p>
                    <p><code>/restartbot &lt;name&gt;</code> - Restart bot</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold">Monitoring:</h4>
                  <div className="space-y-1 text-muted-foreground">
                    <p><code>/logs &lt;name&gt;</code> - View recent logs</p>
                    <p><code>/status &lt;name&gt;</code> - Check bot status</p>
                    <p><code>/listbots</code> - List all bots</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <h4 className="font-semibold">Management:</h4>
                  <div className="space-y-1 text-muted-foreground">
                    <p><code>/edit &lt;name&gt;</code> - Edit source code</p>
                    <p><code>/deletebot &lt;name&gt;</code> - Remove bot</p>
                    <p><code>/help</code> - Show all commands</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bots" className="space-y-4">
          {botsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="p-6">
                    <div className="space-y-3">
                      <div className="h-4 bg-muted rounded"></div>
                      <div className="h-3 bg-muted rounded w-3/4"></div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : telegramBots.length === 0 ? (
            <Card data-testid="card-no-bots">
              <CardContent className="p-12 text-center">
                <BotIcon className="mx-auto h-12 w-12 text-muted-foreground" />
                <h3 className="mt-4 text-lg font-semibold">No Telegram Bots Yet</h3>
                <p className="mt-2 text-muted-foreground">
                  Users haven't deployed any bots via Telegram yet.
                </p>
                <Button variant="outline" className="mt-4" asChild>
                  <a href={`https://t.me/${telegramStatus?.botInfo?.username}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Telegram Bot
                  </a>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {telegramBots.map((bot) => (
                <Card key={bot.id} className="relative" data-testid={`card-bot-${bot.name}`}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{bot.name}</CardTitle>
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(bot.status)}`}></div>
                        <Badge variant={bot.status === 'running' ? 'default' : 'secondary'}>
                          {bot.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{bot.language}</span>
                      <span>User: {bot.telegramUserId?.slice(-4)}</span>
                      {bot.status === 'running' && (
                        <span>Uptime: {formatUptime(bot.uptime || 0)}</span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {bot.autoDetectedEntryFile && (
                      <div className="text-sm">
                        <span className="font-medium">Entry File:</span>
                        <code className="ml-2 text-xs bg-muted px-1 py-0.5 rounded">
                          {bot.autoDetectedEntryFile}
                        </code>
                      </div>
                    )}
                    
                    <div className="text-sm">
                      <span className="font-medium">Command:</span>
                      <code className="ml-2 text-xs bg-muted px-1 py-0.5 rounded">
                        {bot.runCommand}
                      </code>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      {bot.hasRequirements && (
                        <Badge variant="outline" className="text-xs">
                          📦 Dependencies
                        </Badge>
                      )}
                      {bot.hasDockerfile && (
                        <Badge variant="outline" className="text-xs">
                          🐳 Docker
                        </Badge>
                      )}
                      {bot.autoRestart && (
                        <Badge variant="outline" className="text-xs">
                          🔄 Auto-restart
                        </Badge>
                      )}
                    </div>

                    <Separator />
                    
                    <div className="text-xs text-muted-foreground">
                      Created: {new Date(bot.createdAt!).toLocaleDateString()}
                      {bot.deploymentUrl && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="ml-2 h-6 px-2"
                          onClick={() => window.open(bot.deploymentUrl!, '_blank')}
                          data-testid={`button-open-bot-${bot.name}`}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="users" className="space-y-4">
          <Card data-testid="card-telegram-users">
            <CardHeader>
              <CardTitle>Telegram Users</CardTitle>
            </CardHeader>
            <CardContent>
              {telegramBots.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="mx-auto h-12 w-12 text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No Users Yet</h3>
                  <p className="mt-2 text-muted-foreground">
                    Share your bot link to get started!
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {Array.from(new Set(telegramBots.map(bot => bot.telegramUserId))).map((userId) => {
                    const userBots = telegramBots.filter(bot => bot.telegramUserId === userId);
                    const runningBots = userBots.filter(bot => bot.status === 'running').length;
                    
                    return (
                      <div key={userId} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`user-${userId}`}>
                        <div>
                          <div className="font-medium">User {userId?.slice(-8)}</div>
                          <div className="text-sm text-muted-foreground">
                            {userBots.length} bots • {runningBots} running
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {userBots.map(bot => bot.name).join(', ')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card data-testid="card-telegram-settings">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Telegram Bot Settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Broadcast Message */}
              <div className="space-y-3">
                <h4 className="font-semibold">Broadcast Message</h4>
                <div className="space-y-2">
                  <textarea
                    placeholder="Send a message to all Telegram users..."
                    className="w-full min-h-[100px] p-3 border rounded-lg resize-none"
                    data-testid="textarea-broadcast-message"
                    id="broadcastMessage"
                  />
                  <Button
                    onClick={() => {
                      const textarea = document.getElementById('broadcastMessage') as HTMLTextAreaElement;
                      const message = textarea?.value.trim();
                      if (message) {
                        broadcastMutation.mutate({ message });
                        textarea.value = '';
                      }
                    }}
                    disabled={broadcastMutation.isPending}
                    data-testid="button-send-broadcast"
                  >
                    {broadcastMutation.isPending ? 'Sending...' : 'Send Broadcast'}
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Bot Configuration */}
              <div className="space-y-3">
                <h4 className="font-semibold">Bot Configuration</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium">Polling Status:</p>
                    <Badge variant={telegramStatus?.status === 'active' ? 'default' : 'destructive'}>
                      {telegramStatus?.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                  <div>
                    <p className="font-medium">Auto-deployment:</p>
                    <Badge variant="outline">Enabled</Badge>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Bot Features */}
              <div className="space-y-3">
                <h4 className="font-semibold">Enabled Features</h4>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    '📤 File Upload (ZIP, .py, .js)',
                    '🔍 Auto-detect Entry Files',
                    '📦 Auto-install Dependencies',
                    '🐳 Docker Support',
                    '⚙️ Environment Variables',
                    '📝 Direct Code Editing',
                    '📊 Real-time Logs',
                    '🔄 Auto-restart',
                    '📱 Animated Responses',
                    '🎯 Command Validation'
                  ].map((feature, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}