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
      addDeploymentLog('Starting deployment...');

      // Extract ZIP with enhanced error handling
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

      // Skip build commands for faster deployment
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        if (bot.buildCommand.includes('pip install') || bot.buildCommand.includes('npm install')) {
          addDeploymentLog('Skipping package installation - using pre-installed packages');
        }
      }

      await storage.updateBot(botId, { status: 'stopped' });
      this.emit('botStatusChanged', { botId, status: 'stopped' });
      addDeploymentLog('Deployment completed successfully');
      
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

    // Verify bot files exist
    try {
      await fs.access(bot.filePath);
    } catch (error) {
      console.error(`Bot directory not accessible: ${bot.filePath}`);
      throw new Error(`Bot files not found at: ${bot.filePath}`);
    }

    // Parse environment variables
    let botEnvVars: Record<string, string> = {};
    if (bot.environmentVars) {
      try {
        botEnvVars = JSON.parse(bot.environmentVars);
      } catch (error) {
        console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
      }
    }

    // Enhanced command for different environments
    let enhancedRunCommand = bot.runCommand;
    
    // Python command fixes for Render
    if (bot.runCommand.includes('python')) {
      if (process.env.RENDER) {
        // Render specific Python handling
        const pythonPaths = [
          '/opt/render/project/.render/python/bin/python3',
          '/usr/local/bin/python3', 
          '/usr/bin/python3',
          'python3'
        ];
        
        const pythonArgs = bot.runCommand.split(' ').slice(1).join(' ');
        enhancedRunCommand = `(${pythonPaths.map(p => `command -v ${p} >/dev/null 2>&1 && exec ${p}`).join(' || ')}) ${pythonArgs}`;
      } else {
        // Replace python with python3 for better compatibility
        enhancedRunCommand = enhancedRunCommand.replace(/\bpython\b/g, 'python3');
      }
    }

    // Node.js command fixes
    if (bot.runCommand.includes('node')) {
      if (process.env.RENDER) {
        enhancedRunCommand = enhancedRunCommand.replace(/\bnode\b/g, '/opt/render/project/.render/node/bin/node');
      }
    }
    
    // Generate unique port for bot
    let botPort: number;
    if (process.env.RENDER && process.env.PORT) {
      // On Render, use main port + offset based on bot ID
      const basePort = parseInt(process.env.PORT, 10);
      const portOffset = parseInt(botId.slice(-3), 16) % 100; // Use last 3 chars as offset
      botPort = basePort + portOffset + 1; // Avoid main port
    } else {
      // Development environment
      botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
    }
    
    console.log(`[${bot.name}] Starting with enhanced command: ${enhancedRunCommand}`);
    console.log(`[${bot.name}] Port: ${botPort}, Directory: ${bot.filePath}`);
    
    // Enhanced environment variables for Render
    const processEnv = {
      ...process.env,
      ...botEnvVars,
      PORT: botPort.toString(),
      BOT_PORT: botPort.toString(),
      RENDER: process.env.RENDER || 'false',
      PYTHONPATH: `${bot.filePath}:${process.env.PYTHONPATH || ''}`,
      PYTHONUNBUFFERED: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONIOENCODING: 'utf-8',
      // Enhanced for Pyrogram bots
      PYROGRAM_WORKDIR: bot.filePath,
      SESSION_NAME: `bot_${botId}`,
      // Disable warnings
      PYTHONWARNINGS: 'ignore',
      NODE_ENV: 'production'
    };

    // Add Render-specific paths
    if (process.env.RENDER) {
      processEnv.PATH = `/opt/render/project/.render/python/bin:/opt/render/project/.render/node/bin:${process.env.PATH}`;
      processEnv.LD_LIBRARY_PATH = '/opt/render/project/.render/python/lib';
    }

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

    // Enhanced logging with error detection
    childProcess.stdout?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        const log = `[${new Date().toISOString()}] ${output}`;
        botProcess.logs.push(log);
        console.log(`[${bot.name}] STDOUT: ${output}`);
        this.emitLog(botId, log);
        
        // Detect success patterns
        if (output.includes('Started Successfully') || 
            output.includes('Bot started') || 
            output.includes('Running on') ||
            output.includes('* Running on http')) {
          botProcess.healthStatus = 'healthy';
        }
      }
    });

    childProcess.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      if (output) {
        const log = `[${new Date().toISOString()}] ERROR: ${output}`;
        botProcess.logs.push(log);
        
        // Filter out common warnings that aren't real errors
        if (!output.includes('DeprecationWarning') && 
            !output.includes('InsecureRequestWarning') &&
            !output.includes('WARNING') &&
            !output.includes('UserWarning')) {
          console.error(`[${bot.name}] STDERR: ${output}`);
          botProcess.healthStatus = 'unhealthy';
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

    // Update bot status to running
    await storage.updateBot(botId, { status: 'running', processId: childProcess.pid });
    this.emit('botStatusChanged', { botId, status: 'running' });

    // Health check after startup delay
    setTimeout(() => {
      if (this.activeProcesses.has(botId)) {
        const currentProcess = this.activeProcesses.get(botId);
        if (currentProcess && currentProcess.healthStatus === 'unknown') {
          currentProcess.healthStatus = 'healthy'; // Assume healthy if no errors
        }
      }
    }, 10000); // 10 second startup grace period
  }

  async stopBot(botId: string, immediate: boolean = false): Promise<void> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error('Bot is not running');

    const signal = immediate ? 'SIGKILL' : 'SIGTERM';
    
    try {
      // Try graceful shutdown first
      if (!immediate) {
        botProcess.process.kill('SIGTERM');
        
        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (botProcess.process.killed || botProcess.process.exitCode !== null) {
              resolve();
            } else {
              // Force kill if not stopped gracefully
              botProcess.process.kill('SIGKILL');
              resolve();
            }
          }, 5000);

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
        await this.stopBot(botId, true);
        // Wait for clean shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      await this.startBot(botId);
    } catch (error) {
      console.error(`Error restarting bot ${botId}:`, error);
      // Try starting anyway
      try {
        await this.startBot(botId);
      } catch (startError) {
        console.error(`Failed to start bot after restart attempt:`, startError);
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
