import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { storage } from '../storage';
import { fileManager } from './fileManager';
import type { Bot } from '@shared/schema';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

interface BotProcess {
  bot: Bot;
  process: ChildProcess;
  logs: string[];
  startTime: Date;
  restartCount?: number;
  lastHealthCheck?: Date;
  healthStatus?: 'healthy' | 'unhealthy' | 'unknown';
  isDockerContainer?: boolean;
  containerName?: string;
}

export class BotManager extends EventEmitter {
  private activeProcesses = new Map<string, BotProcess>();
  private logListeners = new Map<string, Set<(log: string) => void>>();
  private deploymentLogs = new Map<string, string[]>();

  async deployBot(botId: string, zipBuffer: Buffer): Promise<void> {
    return this.deployBotFromZip(botId, zipBuffer);
  }

  async deployBotWithEnv(botId: string, zipBuffer: Buffer, additionalEnvBuffer?: Buffer): Promise<void> {
    return this.deployBotFromZip(botId, zipBuffer, additionalEnvBuffer);
  }

  async deployBotFromZip(botId: string, zipBuffer: Buffer, additionalEnvBuffer?: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    this.deploymentLogs.set(botId, []);
    const addDeploymentLog = (message: string) => {
      const log = `[${new Date().toISOString()}] ${message}`;
      const logs = this.deploymentLogs.get(botId) || [];
      logs.push(log);
      this.deploymentLogs.set(botId, logs);
      console.log(`[DEPLOY ${bot.name}] ${message}`);
      this.emitLog(botId, log);
    };

    try {
      await storage.updateBot(botId, { status: 'deploying' });
      this.emit('botStatusChanged', { botId, status: 'deploying' });
      addDeploymentLog('Starting Render-optimized deployment...');

      const { botDir, envVars: zipEnvVars } = await fileManager.extractZipFile(zipBuffer, bot.name);
      
      let additionalEnvVars: Record<string, string> = {};
      if (additionalEnvBuffer) {
        addDeploymentLog('Processing additional .env file...');
        const additionalEnvContent = additionalEnvBuffer.toString('utf8');
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, 'additional .env file');
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      
      const mergedEnvVars = fileManager.mergeEnvVars(zipEnvVars, additionalEnvVars);
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      
      await storage.updateBot(botId, { 
        filePath: botDir,
        environmentVars: envVarsJson
      });
      
      addDeploymentLog(`Files extracted to: ${botDir}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
      }

      // Skip build commands in Render - use pre-installed packages
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        if (bot.buildCommand.includes('pip install') || bot.buildCommand.includes('npm install')) {
          addDeploymentLog('Skipping package installation - using Render pre-installed packages');
        }
      }

      await storage.updateBot(botId, { status: 'stopped' });
      this.emit('botStatusChanged', { botId, status: 'stopped' });
      addDeploymentLog('Deployment completed successfully - ready to start');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown deployment error';
      addDeploymentLog(`DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: 'error' });
      this.emit('botStatusChanged', { botId, status: 'error' });
      throw error;
    }
  }

  async startBot(botId: string): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot || !bot.filePath) throw new Error('Bot not found or not deployed');

    if (this.activeProcesses.has(botId)) {
      throw new Error('Bot is already running');
    }

    try {
      await fs.access(bot.filePath);
    } catch (error) {
      console.error(`Bot directory not accessible: ${bot.filePath}`);
      throw new Error(`Bot files not found at: ${bot.filePath}`);
    }

    let botEnvVars: Record<string, string> = {};
    if (bot.environmentVars) {
      try {
        botEnvVars = JSON.parse(bot.environmentVars);
      } catch (error) {
        console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
      }
    }

    // Enhanced command execution for Render
    let enhancedRunCommand = bot.runCommand;
    
    if (bot.runCommand.includes('python')) {
      if (process.env.RENDER) {
        // Render-specific Python path resolution
        const renderPythonPaths = [
          '/opt/render/project/.render/python/bin/python3',
          '/opt/render/project/.render/python/bin/python',
          '/usr/local/bin/python3',
          '/usr/bin/python3',
          'python3'
        ];
        
        const args = bot.runCommand.split(' ').slice(1);
        enhancedRunCommand = `for python_bin in ${renderPythonPaths.join(' ')}; do if command -v "$python_bin" >/dev/null 2>&1; then exec "$python_bin" ${args.join(' ')}; fi; done; echo "Python interpreter not found" && exit 1`;
      } else {
        enhancedRunCommand = enhancedRunCommand.replace(/\bpython\b/g, 'python3');
      }
    }

    if (bot.runCommand.includes('node')) {
      if (process.env.RENDER) {
        enhancedRunCommand = enhancedRunCommand.replace(/\bnode\b/g, '/opt/render/project/.render/node/bin/node');
      }
    }
    
    // Generate unique ports for Render
    let botPort: number;
    if (process.env.RENDER && process.env.PORT) {
      const basePort = parseInt(process.env.PORT, 10);
      const hashCode = botId.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
      botPort = basePort + Math.abs(hashCode % 100) + 1;
    } else {
      botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
    }
    
    console.log(`[${bot.name}] Starting with Render-optimized command: ${enhancedRunCommand}`);
    console.log(`[${bot.name}] Assigned Port: ${botPort}, Directory: ${bot.filePath}`);
    
    // Comprehensive environment setup for Render
    const processEnv = {
      ...process.env,
      ...botEnvVars,
      PORT: botPort.toString(),
      BOT_PORT: botPort.toString(),
      HOST: '0.0.0.0',
      RENDER: 'true',
      NODE_ENV: 'production',
      
      // Python-specific environment
      PYTHONPATH: `${bot.filePath}:${process.env.PYTHONPATH || ''}`,
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      PYTHONWARNINGS: 'ignore',
      
      // Bot-specific paths for session storage
      BOT_WORKDIR: bot.filePath,
      PYROGRAM_WORKDIR: bot.filePath,
      SESSION_DIR: bot.filePath,
      DATA_DIR: bot.filePath,
      
      // Render-specific paths
      ...(process.env.RENDER && {
        PATH: `/opt/render/project/.render/python/bin:/opt/render/project/.render/node/bin:${process.env.PATH}`,
        LD_LIBRARY_PATH: '/opt/render/project/.render/python/lib:/opt/render/project/.render/node/lib',
        PYTHON_PATH: '/opt/render/project/.render/python/bin/python3',
        NODE_PATH: '/opt/render/project/.render/node/bin/node'
      })
    };

    const childProcess = spawn('bash', ['-c', enhancedRunCommand], {
      cwd: bot.filePath,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: processEnv,
      detached: false
    });

    const botProcess: BotProcess = {
      bot,
      process: childProcess,
      logs: [],
      startTime: new Date(),
      restartCount: 0,
      healthStatus: 'unknown'
    };

    this.activeProcesses.set(botId, botProcess);

    // Enhanced logging with better error detection
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        const log = `[${new Date().toISOString()}] ${output}`;
        botProcess.logs.push(log);
        console.log(`[${bot.name}] STDOUT: ${output}`);
        this.emitLog(botId, log);
        
        // Detect successful startup patterns
        const successPatterns = [
          'Started Successfully', 'Bot started', 'Running on', 
          '* Running on http', 'Server started', 'listening on port',
          'Bot is ready', 'Application started', 'Ready to receive'
        ];
        
        if (successPatterns.some(pattern => output.includes(pattern))) {
          botProcess.healthStatus = 'healthy';
        }
      }
    });

    childProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        const log = `[${new Date().toISOString()}] ERROR: ${output}`;
        botProcess.logs.push(log);
        
        // Filter out warnings and non-critical errors
        const ignoredPatterns = [
          'DeprecationWarning', 'InsecureRequestWarning', 'UserWarning',
          'WARNING', 'FutureWarning', 'RuntimeWarning', 'PendingDeprecationWarning'
        ];
        
        const isCriticalError = !ignoredPatterns.some(pattern => output.includes(pattern));
        
        if (isCriticalError) {
          console.error(`[${bot.name}] STDERR: ${output}`);
          // Only mark as unhealthy for truly critical errors
          const criticalPatterns = [
            'ImportError', 'ModuleNotFoundError', 'SyntaxError', 
            'ConnectionError', 'TimeoutError', 'AuthenticationError',
            'Permission denied', 'No such file or directory'
          ];
          
          if (criticalPatterns.some(pattern => output.includes(pattern))) {
            botProcess.healthStatus = 'unhealthy';
          }
        }
        
        this.emitLog(botId, log);
      }
    });

    childProcess.on('spawn', () => {
      console.log(`[${bot.name}] Process spawned successfully with PID: ${childProcess.pid}`);
      const spawnLog = `[${new Date().toISOString()}] Bot process started with PID: ${childProcess.pid}`;
      botProcess.logs.push(spawnLog);
      this.emitLog(botId, spawnLog);
    });

    childProcess.on('exit', async (code, signal) => {
      console.log(`[${bot.name}] Process exited with code ${code}, signal ${signal}`);
      this.activeProcesses.delete(botId);
      
      let status: 'stopped' | 'error' = 'stopped';
      if (code !== 0 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
        status = 'error';
        console.error(`[${bot.name}] Bot crashed with exit code ${code}`);
      }
      
      await storage.updateBot(botId, { status, processId: null });
      this.emit('botStatusChanged', { botId, status });
    });

    childProcess.on('error', async (error) => {
      console.error(`[${bot.name}] Process error: ${error.message}`);
      const log = `[${new Date().toISOString()}] PROCESS ERROR: ${error.message}`;
      botProcess.logs.push(log);
      this.emitLog(botId, log);
      
      this.activeProcesses.delete(botId);
      await storage.updateBot(botId, { status: 'error', processId: null });
      this.emit('botStatusChanged', { botId, status: 'error' });
    });

    // Set status to running immediately
    await storage.updateBot(botId, { status: 'running', processId: childProcess.pid });
    this.emit('botStatusChanged', { botId, status: 'running' });

    // Health check with longer timeout for slow startup
    setTimeout(() => {
      if (this.activeProcesses.has(botId)) {
        const currentProcess = this.activeProcesses.get(botId);
        if (currentProcess && currentProcess.healthStatus === 'unknown') {
          currentProcess.healthStatus = 'healthy';
          console.log(`[${bot.name}] Health check: Assuming healthy after startup period`);
        }
      }
    }, 15000); // 15 second grace period for Render
  }

  async stopBot(botId: string, immediate: boolean = false): Promise<void> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error('Bot is not running');

    try {
      if (!immediate) {
        // Graceful shutdown
        botProcess.process.kill('SIGTERM');
        
        // Wait up to 10 seconds for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (!botProcess.process.killed && botProcess.process.exitCode === null) {
              console.log(`[${botProcess.bot.name}] Force killing after timeout`);
              botProcess.process.kill('SIGKILL');
            }
            resolve();
          }, 10000);

          botProcess.process.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      } else {
        botProcess.process.kill('SIGKILL');
      }
    } catch (error) {
      console.error(`Error stopping bot ${botId}:`, error);
    }
    
    this.activeProcesses.delete(botId);
    await storage.updateBot(botId, { status: 'stopped', processId: null });
    this.emit('botStatusChanged', { botId, status: 'stopped' });
  }

  async restartBot(botId: string): Promise<void> {
    try {
      if (this.activeProcesses.has(botId)) {
        await this.stopBot(botId, false);
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
      }
      await this.startBot(botId);
    } catch (error) {
      console.error(`Error restarting bot ${botId}:`, error);
      try {
        await this.startBot(botId);
      } catch (startError) {
        console.error(`Failed to start bot after restart:`, startError);
        throw startError;
      }
    }
  }

  async deleteBot(botId: string): Promise<void> {
    try {
      if (this.activeProcesses.has(botId)) {
        await this.stopBot(botId, true);
      }

      const bot = await storage.getBot(botId);
      if (bot && bot.filePath) {
        await fileManager.deleteBotFiles(bot.name);
      }

      this.deploymentLogs.delete(botId);
      this.logListeners.delete(botId);
    } catch (error) {
      console.error(`Error deleting bot ${botId}:`, error);
      throw error;
    }
  }

  getBotLogs(botId: string): string[] {
    const botProcess = this.activeProcesses.get(botId);
    const deploymentLogs = this.deploymentLogs.get(botId) || [];
    const runtimeLogs = botProcess ? botProcess.logs : [];
    return [...deploymentLogs, ...runtimeLogs];
  }

  getBotStatus(botId: string): 'running' | 'stopped' | 'error' | 'deploying' | null {
    if (this.activeProcesses.has(botId)) {
      const process = this.activeProcesses.get(botId);
      return process?.healthStatus === 'unhealthy' ? 'error' : 'running';
    }
    return null;
  }

  getActiveBots(): string[] {
    return Array.from(this.activeProcesses.keys());
  }

  emitLog(botId: string, log: string): void {
    this.emit('botLog', { botId, log });
    
    const listeners = this.logListeners.get(botId);
    if (listeners) {
      listeners.forEach(listener => listener(log));
    }
  }

  addLogListener(botId: string, listener: (log: string) => void): void {
    if (!this.logListeners.has(botId)) {
      this.logListeners.set(botId, new Set());
    }
    this.logListeners.get(botId)!.add(listener);
  }

  removeLogListener(botId: string, listener: (log: string) => void): void {
    const listeners = this.logListeners.get(botId);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.logListeners.delete(botId);
      }
    }
  }

  // Legacy methods maintained for compatibility
  async deployBotFromGitHub(botId: string, additionalEnvBuffer?: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');
    if (!bot.githubRepoUrl) throw new Error('Repository URL not found');

    this.deploymentLogs.set(botId, []);
    const addDeploymentLog = (message: string) => {
      const log = `[${new Date().toISOString()}] ${message}`;
      const logs = this.deploymentLogs.get(botId) || [];
      logs.push(log);
      this.deploymentLogs.set(botId, logs);
      console.log(`[DEPLOY ${bot.name}] ${message}`);
      this.emitLog(botId, log);
    };

    try {
      await storage.updateBot(botId, { status: 'deploying' });
      this.emit('botStatusChanged', { botId, status: 'deploying' });
      addDeploymentLog('Starting GitHub deployment...');

      const botDir = await this.cloneGitHubRepository(bot.githubRepoUrl, bot.name, addDeploymentLog);
      
      const repoEnvContent = await this.findAndReadEnvFile(botDir);
      let repoEnvVars: Record<string, string> = {};
      if (repoEnvContent) {
        repoEnvVars = fileManager.parseEnvContent(repoEnvContent, 'repository .env file');
      }
      
      let additionalEnvVars: Record<string, string> = {};
      if (additionalEnvBuffer) {
        const additionalEnvContent = additionalEnvBuffer.toString('utf8');
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, 'additional .env file');
      }
      
      const mergedEnvVars = fileManager.mergeEnvVars(repoEnvVars, additionalEnvVars);
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      
      await storage.updateBot(botId, { 
        filePath: botDir,
        environmentVars: envVarsJson
      });

      await storage.updateBot(botId, { status: 'stopped' });
      this.emit('botStatusChanged', { botId, status: 'stopped' });
      addDeploymentLog('GitHub deployment completed successfully');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown GitHub deployment error';
      addDeploymentLog(`GITHUB DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: 'error' });
      this.emit('botStatusChanged', { botId, status: 'error' });
      throw error;
    }
  }

  private async cloneGitHubRepository(repoUrl: string, botName: string, logFunction: (message: string) => void): Promise<string> {
    const botsDir = process.env.RENDER 
      ? path.join('/opt/render/project/src', 'deployed_bots')
      : path.join(process.cwd(), 'deployed_bots');
    const botDir = path.join(botsDir, botName);
    
    await fs.mkdir(botsDir, { recursive: true });
    
    try {
      await fs.rm(botDir, { recursive: true, force: true });
      logFunction('Removed existing bot directory');
    } catch (error) {
      // Directory doesn't exist
    }
    
    try {
      const git = simpleGit();
      logFunction('Cloning repository...');
      await git.clone(repoUrl, botDir);
      logFunction('Repository cloned successfully');
      return botDir;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown git error';
      logFunction(`Git clone failed: ${errorMessage}`);
      throw new Error(`Failed to clone repository: ${errorMessage}`);
    }
  }

  private async findAndReadEnvFile(botDir: string): Promise<string | null> {
    const possibleEnvFiles = ['.env', 'config.env', '.env.example'];
    
    for (const envFile of possibleEnvFiles) {
      const envPath = path.join(botDir, envFile);
      try {
        const envContent = await fs.readFile(envPath, 'utf8');
        if (envContent.trim().length > 0) {
          return envContent;
        }
      } catch (error) {
        continue;
      }
    }
    
    return null;
  }

  private async runCommandWithLogs(command: string, cwd: string, logFn: (message: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('sh', ['-c', command], { cwd, stdio: 'pipe' });
      
      process.stdout?.on('data', (data) => {
        logFn(`BUILD: ${data.toString().trim()}`);
      });
      
      process.stderr?.on('data', (data) => {
        logFn(`BUILD ERROR: ${data.toString().trim()}`);
      });
      
      process.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      
      process.on('error', reject);
    });
  }
}

export const botManager = new BotManager();
