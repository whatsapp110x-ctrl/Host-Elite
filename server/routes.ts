// Add these health check endpoints after line 127 in your routes.ts file

// Health check endpoints for Render deployment
app.get('/api/health', async (req, res) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    const healthStatus = {
      status: 'healthy',
      service: 'host-elite-platform',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(uptime),
      uptime_human: formatUptime(uptime),
      memory: {
        used_mb: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total_mb: Math.round(memoryUsage.heapTotal / 1024 / 1024)
      },
      environment: {
        node_env: process.env.NODE_ENV || 'development',
        port: process.env.PORT || '5000',
        platform: 'render'
      }
    };

    // Test basic functionality
    try {
      const bots = await storage.getAllBots();
      healthStatus.database = {
        status: 'connected',
        total_bots: bots.length
      };
    } catch (dbError) {
      healthStatus.database = {
        status: 'disconnected',
        error: dbError instanceof Error ? dbError.message : 'Database error'
      };
    }

    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'host-elite-platform',
      error: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const allBots = await storage.getAllBots();
    const stats = {
      platform: 'Host-Elite',
      status: 'running',
      version: '1.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      bots: {
        total: allBots.length,
        running: allBots.filter(bot => bot.status === 'running').length,
        stopped: allBots.filter(bot => bot.status === 'stopped').length,
        error: allBots.filter(bot => bot.status === 'error').length
      },
      services: {
        websocket: 'active',
        telegram_bot: process.env.TELEGRAM_BOT_TOKEN ? 'enabled' : 'disabled',
        file_manager: 'active'
      },
      timestamp: new Date().toISOString()
    };
    res.json(stats);
  } catch (error) {
    res.status(500).json({
      platform: 'Host-Elite',
      status: 'error',
      error: error instanceof Error ? error.message : 'Status check failed'
    });
  }
});

app.get('/api/ping', (req, res) => {
  res.json({
    pong: true,
    service: 'host-elite-platform',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime())
  });
});

app.get('/api/keepalive', (req, res) => {
  res.json({
    alive: true,
    service: 'host-elite-platform',
    status: 'running',
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    timestamp: new Date().toISOString()
  });
});

// Ready check for container orchestration
app.get('/api/ready', (req, res) => {
  // Check if the platform is ready to serve requests
  try {
    res.json({
      status: 'ready',
      service: 'host-elite-platform',
      checks: {
        storage: 'ok',
        bot_manager: 'ok',
        websocket: 'ok'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'not_ready',
      error: error instanceof Error ? error.message : 'Readiness check failed'
    });
  }
});

// Helper function to format uptime
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

// Continue with existing API routes...
