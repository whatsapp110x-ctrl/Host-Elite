import type { Express } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";
import { storage } from "./storage";
import { botManager } from "./services/botManager";
import { fileManager } from "./services/fileManager";
import { insertBotSchema } from "@shared/schema";

// Generate unique deployment URL for bots
function generateDeploymentUrl(botId: string, botName: string): string {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN 
    ? `https://${process.env.REPLIT_DEV_DOMAIN}` 
    : process.env.REPLIT_DEPLOYMENT_URL || 'http://localhost:5000';
  
  // Create a unique path using bot name and short bot ID
  const shortId = botId.slice(0, 8);
  const safeName = botName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return `${baseUrl}/bot/${safeName}-${shortId}`;
}

// Configure multer for ZIP file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || 
        file.originalname.endsWith('.zip') || 
        file.originalname.endsWith('.env') || 
        file.originalname.endsWith('config.env')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP, .env, and config.env files are allowed'));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for ZIP, but we'll check .env separately
  },
});

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);

  // WebSocket server for real-time updates
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  interface ExtendedWebSocket extends WebSocket {
    isAlive?: boolean;
    subscribedToLogs?: Set<string>;
  }

  wss.on('connection', (ws: ExtendedWebSocket) => {
    ws.isAlive = true;
    ws.subscribedToLogs = new Set();

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        if (data.type === 'subscribe_logs' && data.botId) {
          ws.subscribedToLogs?.add(data.botId);
          
          // Send existing logs
          const logs = botManager.getBotLogs(data.botId);
          logs.forEach(log => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bot_log',
                botId: data.botId,
                log
              }));
            }
          });
        }

        if (data.type === 'unsubscribe_logs' && data.botId) {
          ws.subscribedToLogs?.delete(data.botId);
        }
      } catch (error) {
        console.error('WebSocket message error:', error);
      }
    });

    ws.on('close', () => {
      // Clean up log subscriptions
    });
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Bot manager event handlers
  botManager.on('botStatusChanged', (data) => {
    broadcast({ type: 'bot_status_changed', ...data });
  });

  botManager.on('botLog', (data) => {
    wss.clients.forEach((ws: ExtendedWebSocket) => {
      if (ws.readyState === WebSocket.OPEN && ws.subscribedToLogs?.has(data.botId)) {
        ws.send(JSON.stringify({
          type: 'bot_log',
          botId: data.botId,
          log: data.log
        }));
      }
    });
  });

  function broadcast(data: any) {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }

  // API Routes
  
  // Get all bots
  app.get('/api/bots', async (req, res) => {
    try {
      const bots = await storage.getAllBots();
      res.json(bots);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch bots' });
    }
  });

  // Get bot statistics
  app.get('/api/stats', async (req, res) => {
    try {
      const allBots = await storage.getAllBots();
      const stats = {
        totalBots: allBots.length,
        runningBots: allBots.filter(bot => bot.status === 'running').length,
        stoppedBots: allBots.filter(bot => bot.status === 'stopped').length,
        errorBots: allBots.filter(bot => bot.status === 'error').length,
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch statistics' });
    }
  });

  // Create and deploy bot
  app.post('/api/bots', upload.fields([{name: 'zipFile', maxCount: 1}, {name: 'envFile', maxCount: 1}]), async (req, res) => {
    try {
      console.log('Request body:', req.body);
      console.log('Files info:', req.files);
      
      // Convert autoRestart to boolean if it's a string
      if (req.body.autoRestart === 'true') req.body.autoRestart = true;
      if (req.body.autoRestart === 'false') req.body.autoRestart = false;
      
      const botData = insertBotSchema.parse(req.body);
      
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const zipFile = files?.zipFile?.[0];
      const envFile = files?.envFile?.[0];
      
      // Validate based on deployment source
      if (botData.deploymentSource === 'zip' && !zipFile) {
        return res.status(400).json({ message: 'ZIP file is required for ZIP deployment' });
      }
      
      if ((botData.deploymentSource === 'github' || botData.deploymentSource === 'docker') && !botData.githubRepoUrl) {
        return res.status(400).json({ message: 'Repository URL is required for GitHub/Docker deployment' });
      }

      // Validate .env file size if provided
      if (envFile && envFile.size > 1024 * 1024) { // 1MB limit for .env files
        return res.status(400).json({ message: 'Env file size must be less than 1MB' });
      }

      // Check if bot name already exists
      const existingBot = await storage.getBotByName(botData.name);
      if (existingBot) {
        return res.status(400).json({ message: 'Bot name already exists' });
      }

      // Create bot in database
      const bot = await storage.createBot(botData);

      // Generate unique deployment URL
      const deploymentUrl = generateDeploymentUrl(bot.id, bot.name);
      
      // Update bot with deployment URL
      await storage.updateBot(bot.id, { deploymentUrl });

      // Deploy bot based on source type
      if (botData.deploymentSource === 'zip') {
        // Deploy from ZIP file with optional additional .env file
        botManager.deployBotWithEnv(bot.id, zipFile!.buffer, envFile?.buffer).catch(console.error);
      } else if (botData.deploymentSource === 'github') {
        // Deploy from GitHub repository
        botManager.deployBotFromGitHub(bot.id, envFile?.buffer).catch(console.error);
      } else if (botData.deploymentSource === 'docker') {
        // Deploy from Docker repository
        botManager.deployBotFromDocker(bot.id, envFile?.buffer).catch(console.error);
      }

      // Return bot with deployment URL
      const botWithUrl = { ...bot, deploymentUrl };
      res.status(201).json(botWithUrl);
    } catch (error) {
      console.error('Bot creation error:', error);
      console.error('Request body was:', req.body);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to create bot' 
      });
    }
  });

  // Start bot
  app.post('/api/bots/:id/start', async (req, res) => {
    try {
      await botManager.startBot(req.params.id);
      res.json({ message: 'Bot started successfully' });
    } catch (error) {
      console.error('Start bot error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to start bot' 
      });
    }
  });

  // Stop bot
  app.post('/api/bots/:id/stop', async (req, res) => {
    try {
      const immediate = req.body.immediate === true;
      await botManager.stopBot(req.params.id, immediate);
      res.json({ message: immediate ? 'Bot force stopped successfully' : 'Bot stopped successfully' });
    } catch (error) {
      console.error('Stop bot error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to stop bot' 
      });
    }
  });

  // Restart bot
  app.post('/api/bots/:id/restart', async (req, res) => {
    try {
      await botManager.restartBot(req.params.id);
      res.json({ message: 'Bot restarted successfully' });
    } catch (error) {
      console.error('Restart bot error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to restart bot' 
      });
    }
  });

  // Delete bot
  app.delete('/api/bots/:id', async (req, res) => {
    try {
      await botManager.deleteBot(req.params.id);
      res.json({ message: 'Bot deleted successfully' });
    } catch (error) {
      console.error('Delete bot error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to delete bot' 
      });
    }
  });

  // Get bot logs
  app.get('/api/bots/:id/logs', async (req, res) => {
    try {
      const logs = botManager.getBotLogs(req.params.id);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ message: 'Failed to fetch logs' });
    }
  });

  // Force stop bot (immediate)
  app.post('/api/bots/:id/force-stop', async (req, res) => {
    try {
      await botManager.forceStopBot(req.params.id);
      res.json({ message: 'Bot force stopped successfully' });
    } catch (error) {
      console.error('Force stop bot error:', error);
      res.status(400).json({ 
        message: error instanceof Error ? error.message : 'Failed to force stop bot' 
      });
    }
  });

  // Get system stats
  app.get('/api/system/stats', async (req, res) => {
    try {
      const stats = await botManager.getSystemStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get system stats' });
    }
  });

  // Health check for specific bot
  app.get('/api/bots/:id/health', async (req, res) => {
    try {
      const status = await botManager.performHealthCheck(req.params.id);
      res.json({ health: status, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(400).json({ 
        error: error instanceof Error ? error.message : 'Failed to check bot health' 
      });
    }
  });








  // File management endpoints
  
  // List bot files
  app.get('/api/bots/:botId/files', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const files = await fileManager.listBotFiles(bot.name);
      res.json(files);
    } catch (error) {
      console.error('Error listing bot files:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to list files'
      });
    }
  });

  // Read bot file content
  app.get('/api/bots/:botId/files/:filePath(*)', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const filePath = decodeURIComponent(req.params.filePath);
      const fileData = await fileManager.readBotFile(bot.name, filePath);
      res.json(fileData);
    } catch (error) {
      console.error('Error reading bot file:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to read file'
      });
    }
  });

  // Update bot file content
  app.put('/api/bots/:botId/files/:filePath(*)', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const filePath = decodeURIComponent(req.params.filePath);
      const { content } = req.body;

      if (typeof content !== 'string') {
        return res.status(400).json({ message: 'Content must be a string' });
      }

      await fileManager.writeBotFile(bot.name, filePath, content);
      
      res.json({ 
        message: 'File saved successfully',
        filePath,
        size: Buffer.byteLength(content, 'utf-8')
      });
    } catch (error) {
      console.error('Error saving bot file:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to save file'
      });
    }
  });

  // Create new bot file
  app.post('/api/bots/:botId/files', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const { filePath, content = '', type = 'file' } = req.body;

      if (!filePath || typeof filePath !== 'string') {
        return res.status(400).json({ message: 'File path is required' });
      }

      if (type === 'directory') {
        await fileManager.createBotDirectory(bot.name, filePath);
        res.json({ 
          message: 'Directory created successfully',
          filePath,
          type: 'directory'
        });
      } else {
        await fileManager.createBotFile(bot.name, filePath, content);
        res.json({ 
          message: 'File created successfully',
          filePath,
          type: 'file',
          size: Buffer.byteLength(content, 'utf-8')
        });
      }
    } catch (error) {
      console.error('Error creating bot file:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to create file'
      });
    }
  });

  // Delete bot file or directory
  app.delete('/api/bots/:botId/files/:filePath(*)', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const filePath = decodeURIComponent(req.params.filePath);
      await fileManager.deleteBotFile(bot.name, filePath);
      
      res.json({ 
        message: 'File deleted successfully',
        filePath
      });
    } catch (error) {
      console.error('Error deleting bot file:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to delete file'
      });
    }
  });

  // Rename bot file or directory
  app.patch('/api/bots/:botId/files/:filePath(*)', async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: 'Bot not found' });
      }

      const oldPath = decodeURIComponent(req.params.filePath);
      const { newPath } = req.body;

      if (!newPath || typeof newPath !== 'string') {
        return res.status(400).json({ message: 'New path is required' });
      }

      await fileManager.renameBotFile(bot.name, oldPath, newPath);
      
      res.json({ 
        message: 'File renamed successfully',
        oldPath,
        newPath
      });
    } catch (error) {
      console.error('Error renaming bot file:', error);
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to rename file'
      });
    }
  });

  // Telegram bot API routes
  app.get('/api/telegram/status', async (req, res) => {
    try {
      const { telegramBotService } = await import('./services/telegramBotService');
      const bot = telegramBotService.getBotInstance();
      if (!bot) {
        return res.status(500).json({ 
          status: 'error',
          message: 'Telegram bot not available'
        });
      }
      const me = await bot.getMe();
      res.json({ 
        status: 'active',
        botInfo: {
          id: me.id,
          username: me.username,
          first_name: me.first_name
        }
      });
    } catch (error) {
      res.status(500).json({ 
        status: 'error',
        message: error instanceof Error ? error.message : 'Telegram bot not available'
      });
    }
  });

  app.post('/api/telegram/broadcast', async (req, res) => {
    try {
      const { message, targetUserId } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: 'Message is required' });
      }

      const { telegramBotService } = await import('./services/telegramBotService');
      await telegramBotService.broadcastMessage(message, targetUserId);
      
      res.json({ message: 'Message sent successfully' });
    } catch (error) {
      res.status(500).json({ 
        message: error instanceof Error ? error.message : 'Failed to send message'
      });
    }
  });

  // Bot access endpoint - serves the deployed bot via its unique URL
  app.get('/bot/:botPath', async (req, res) => {
    try {
      const botPath = req.params.botPath;
      
      // Find bot by deployment URL path
      const allBots = await storage.getAllBots();
      const bot = allBots.find(b => b.deploymentUrl?.endsWith(`/bot/${botPath}`));
      
      if (!bot) {
        return res.status(404).json({ 
          error: 'Bot not found',
          message: 'The bot you are looking for does not exist or has been removed.'
        });
      }

      // Check if bot is running
      if (bot.status !== 'running') {
        return res.status(503).json({
          error: 'Bot unavailable',
          message: `Bot "${bot.name}" is currently ${bot.status}. Please contact the bot owner.`,
          botName: bot.name,
          status: bot.status
        });
      }

      // Return bot information and access details
      res.json({
        botName: bot.name,
        language: bot.language,
        status: bot.status,
        deployedAt: bot.createdAt,
        uptime: bot.status === 'running' ? 'Online' : 'Offline',
        message: `Welcome to ${bot.name}! This bot is running on our 24/7 hosting platform.`,
        accessInfo: {
          platform: 'HostElite Bot Platform',
          botType: bot.language === 'python' ? 'Python Bot' : 'Node.js Bot',
          deploymentMethod: bot.deploymentSource,
          autoRestart: bot.autoRestart
        },
        contact: 'For support or issues, contact the bot owner.'
      });
    } catch (error) {
      console.error('Bot access error:', error);
      res.status(500).json({ 
        error: 'Server error',
        message: 'Unable to access bot information at this time.'
      });
    }
  });

  // Add new endpoint to analyze ZIP file for auto-command generation
  app.post('/api/analyze-zip', upload.single('zipFile'), async (req, res) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: 'ZIP file is required' });
      }

      // Analyze ZIP file content using similar logic to Telegram bot
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(file.buffer);
      const entries = zip.getEntries();

      let language: 'python' | 'nodejs' | undefined;
      let entryFile: string | undefined;
      let hasRequirements = false;
      let hasDockerfile = false;
      let hasProcfile = false;
      let hasEnvFile = false;
      let procfileCommand: string | undefined;
      let dockerfileCommand: string | undefined;

      // Check for specific files
      for (const entry of entries) {
        const fileName = entry.entryName.toLowerCase();
        
        // Check for entry files
        if (['main.py', 'bot.py', 'app.py'].includes(fileName)) {
          language = 'python';
          entryFile = entry.entryName;
        } else if (['index.js', 'app.js', 'bot.js', 'main.js'].includes(fileName)) {
          language = 'nodejs';
          entryFile = entry.entryName;
        }

        // Check for dependency files
        if (fileName === 'requirements.txt') hasRequirements = true;
        if (fileName === 'package.json') {
          language = 'nodejs';
          hasRequirements = true;
        }

        // Check for Docker, Procfile, and env files
        if (fileName === 'dockerfile') hasDockerfile = true;
        if (fileName === 'procfile') hasProcfile = true;
        if (['.env', 'config.env', 'env.txt'].includes(fileName)) hasEnvFile = true;
      }

      // Try to parse Procfile for web command
      if (hasProcfile) {
        try {
          const procfileEntry = entries.find(entry => entry.entryName.toLowerCase() === 'procfile');
          if (procfileEntry) {
            const procfileContent = procfileEntry.getData().toString('utf8');
            const lines = procfileContent.split('\\n');
            const webLine = lines.find(line => line.trim().startsWith('web:'));
            if (webLine) {
              procfileCommand = webLine.split('web:')[1]?.trim();
            }
          }
        } catch (error) {
          console.error('Error parsing Procfile:', error);
        }
      }

      // Try to parse Dockerfile for CMD instruction
      if (hasDockerfile) {
        try {
          const dockerfileEntry = entries.find(entry => entry.entryName.toLowerCase() === 'dockerfile');
          if (dockerfileEntry) {
            const dockerfileContent = dockerfileEntry.getData().toString('utf8');
            const lines = dockerfileContent.split('\\n');
            const cmdLine = lines.reverse().find(line => line.trim().startsWith('CMD'));
            if (cmdLine) {
              dockerfileCommand = cmdLine.replace(/^CMD\\s*\\[?/, '').replace(/\\]?$/, '').replace(/\"/g, '').trim();
            }
          }
        } catch (error) {
          console.error('Error parsing Dockerfile:', error);
        }
      }

      // Auto-detect language and entry if not found
      if (!language || !entryFile) {
        for (const entry of entries) {
          const fileName = entry.entryName;
          if (fileName.endsWith('.py') && !language) {
            language = 'python';
            entryFile = entryFile || fileName;
          } else if (fileName.endsWith('.js') && !language) {
            language = 'nodejs';
            entryFile = entryFile || fileName;
          }
        }
      }

      // Generate suggested command with priority order
      let suggestedCommand: string | undefined;
      if (procfileCommand) {
        suggestedCommand = procfileCommand;
      } else if (dockerfileCommand) {
        suggestedCommand = dockerfileCommand;
      } else if (hasDockerfile) {
        suggestedCommand = 'docker run -p 80:80 .';
      } else if (language === 'python' && entryFile) {
        suggestedCommand = `python3 ${entryFile}`;
      } else if (language === 'nodejs' && entryFile) {
        suggestedCommand = `node ${entryFile}`;
      }

      const analysisResult = {
        language,
        entryFile,
        hasRequirements,
        hasDockerfile,
        hasProcfile,
        hasEnvFile,
        suggestedCommand,
        procfileCommand,
        dockerfileCommand
      };
      
      res.json(analysisResult);
    } catch (error) {
      console.error('ZIP analysis error:', error);
      res.status(500).json({
        message: error instanceof Error ? error.message : 'Failed to analyze ZIP file'
      });
    }
  });

  // Enhanced health check and monitoring endpoints
  app.get('/api/health', async (req, res) => {
    try {
      const stats = await botManager.getSystemStats();
      const activeBots = await storage.getBotsByStatus('running');
      
      res.json({
        status: 'healthy',
        uptime: stats.uptime,
        memoryUsage: stats.memoryUsage,
        activeBots: activeBots.length,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  app.get('/api/keepalive', (req, res) => {
    res.json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      message: 'Host-Elite Bot Platform is running'
    });
  });

  app.get('/api/ping', (req, res) => {
    res.json({
      pong: true,
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/status', async (req, res) => {
    try {
      const allBots = await storage.getAllBots();
      const stats = await botManager.getSystemStats();
      
      res.json({
        platform: 'Host-Elite',
        version: '1.0.0',
        status: 'operational',
        bots: {
          total: allBots.length,
          running: allBots.filter(bot => bot.status === 'running').length,
          stopped: allBots.filter(bot => bot.status === 'stopped').length,
          error: allBots.filter(bot => bot.status === 'error').length
        },
        system: {
          uptime: stats.uptime,
          memory: stats.memoryUsage
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return httpServer;
}
