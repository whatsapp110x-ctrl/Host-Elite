import { EventEmitter } from 'events';
import { ChildProcess, spawn } from 'child_process';
import { storage } from '../storage';
import { fileManager } from './fileManager';
import simpleGit from 'simple-git';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs/promises';

interface BotProcess {
  bot: any;
  process: ChildProcess;
  logs: string[];
  startTime: Date;
  restartCount: number;
  healthStatus: string;
  isDockerContainer: boolean;
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
      addDeploymentLog('Starting deployment...');

      addDeploymentLog('Extracting ZIP file...');
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
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
      }

      // FIXED: Actually run build commands
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        
        try {
          let enhancedBuildCommand = bot.buildCommand.replace(/\bpython\b/g, 'python3');
          enhancedBuildCommand = enhancedBuildCommand.replace(/\bpip\b/g, 'python3 -m pip');
          
          addDeploymentLog(`Executing enhanced build command: ${enhancedBuildCommand}`);
          await this.runCommandWithLogs(enhancedBuildCommand, botDir, addDeploymentLog);
          addDeploymentLog('Build command completed successfully');
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown build error';
          addDeploymentLog(`Build command failed: ${errorMsg}`);
          addDeploymentLog('Continuing with deployment - some dependencies may be missing');
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
    if (this.activeProcesses.has(botId)) throw new Error('Bot is already running');

    try {
      const isDockerDeployment = bot.deploymentSource === 'docker' && bot.filePath.includes('host-elite-bot-');
      let childProcess: ChildProcess;
      
      if (isDockerDeployment) {
        // Docker deployment logic
        const containerName = `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}`;
        const imageName = bot.filePath;
        const botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
        
        let botEnvVars: Record<string, string> = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        
        const envArgs: string[] = [];
        for (const [key, value] of Object.entries(botEnvVars)) {
          envArgs.push('-e', `${key}=${value}`);
        }
        envArgs.push('-e', `PORT=${botPort}`, '-e', `BOT_PORT=${botPort}`);
        
        const dockerArgs = [
          'run', '--name', containerName, '--rm',
          '-p', `${botPort}:${botPort}`,
          ...envArgs, imageName
        ];
        
        childProcess = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
        console.log(`[${bot.name}] Starting Docker container: ${containerName} from image ${imageName}`);
      } else {
        // FIXED: Regular process deployment with proper spawning
        let enhancedRunCommand = bot.runCommand.replace(/\bpython\b/g, 'python3');
        enhancedRunCommand = enhancedRunCommand.replace(/\bpip\b/g, 'python3 -m pip');
        
        const botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
        let botEnvVars: Record<string, string> = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        
        // FIXED: Better command parsing
        const commandParts = enhancedRunCommand.trim().split(/\s+/);
        const executable = commandParts[0];
        const args = commandParts.slice(1);

        childProcess = spawn(executable, args, {
          cwd: bot.filePath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...botEnvVars,
            PORT: botPort.toString(),
            BOT_PORT: botPort.toString(),
            NODE_ENV: 'production'
          }
        });
      }

      const botProcess: BotProcess = {
        bot,
        process: childProcess,
        logs: [],
        startTime: new Date(),
        restartCount: 0,
        healthStatus: 'unknown',
        isDockerContainer: isDockerDeployment,
        containerName: isDockerDeployment ? `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}` : undefined
      };

      this.activeProcesses.set(botId, botProcess);

      // FIXED: Enhanced process event handling
      childProcess.stdout?.on('data', (data) => {
        const log = `[${new Date().toISOString()}] ${data.toString().trim()}`;
        botProcess.logs.push(log);
        this.emitLog(botId, log);
      });

      childProcess.stderr?.on('data', (data) => {
        const log = `[${new Date().toISOString()}] ERROR: ${data.toString().trim()}`;
        botProcess.logs.push(log);
        this.emitLog(botId, log);
      });

      childProcess.on('spawn', async () => {
        console.log(`[${bot.name}] Bot process started successfully with PID ${childProcess.pid}`);
        await storage.updateBot(botId, { 
          status: 'running', 
          processId: childProcess.pid?.toString() || null 
        });
        this.emit('botStatusChanged', { botId, status: 'running' });
      });

      childProcess.on('error', async (error) => {
        console.error(`[${bot.name}] Process error: ${error.message}`);
        this.activeProcesses.delete(botId);
        await storage.updateBot(botId, { status: 'error', processId: null });
        this.emit('botStatusChanged', { botId, status: 'error' });
      });

      childProcess.on('exit', async (code, signal) => {
        console.log(`[${bot.name}] Process exited with code ${code} and signal ${signal}`);
        this.activeProcesses.delete(botId);
        
        let status: 'stopped' | 'error' = 'stopped';
        if (code !== 0 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
          status = 'error';
        }
        
        await storage.updateBot(botId, { status, processId: null });
        this.emit('botStatusChanged', { botId, status });
        
        if (bot.autoRestart && status === 'error') {
          const restartDelay = Math.min(5000 * (botProcess.restartCount || 0) + 5000, 30000);
          setTimeout(() => {
            this.startBot(botId).catch(console.error);
          }, restartDelay);
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[${bot.name}] Failed to start bot: ${errorMessage}`);
      await storage.updateBot(botId, { status: 'error' });
      this.emit('botStatusChanged', { botId, status: 'error' });
      throw error;
    }
  }

  async stopBot(botId: string, immediate = false): Promise<void> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error('Bot is not running');

    if (immediate) {
      botProcess.process.kill('SIGKILL');
    } else {
      botProcess.process.kill('SIGTERM');
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (botProcess.process.killed === false) {
          botProcess.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      botProcess.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  async restartBot(botId: string): Promise<void> {
    try {
      await this.stopBot(botId);
    } catch (error) {
      // Bot might not be running
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.startBot(botId);
  }

  async forceStopBot(botId: string): Promise<void> {
    return this.stopBot(botId, true);
  }

  async deleteBot(botId: string): Promise<void> {
    try {
      await this.forceStopBot(botId);
    } catch (error) {
      // Bot might not be running
    }

    const bot = await storage.getBot(botId);
    if (bot && bot.filePath) {
      try {
        await fs.rm(bot.filePath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to remove bot files: ${error}`);
      }
    }

    await storage.deleteBot(botId);
    this.deploymentLogs.delete(botId);
    this.activeProcesses.delete(botId);
    this.emit('botStatusChanged', { botId, status: 'deleted' });
  }

  getBotLogs(botId: string): string[] {
    const deploymentLogs = this.deploymentLogs.get(botId) || [];
    const botProcess = this.activeProcesses.get(botId);
    const runtimeLogs = botProcess ? botProcess.logs : [];
    return [...deploymentLogs, ...runtimeLogs];
  }

  emitLog(botId: string, log: string): void {
    this.emit('botLog', { botId, log });
  }

  async getSystemStats() {
    const allBots = await storage.getAllBots();
    const runningBots = Array.from(this.activeProcesses.keys());
    
    return {
      totalBots: allBots.length,
      runningBots: runningBots.length,
      stoppedBots: allBots.filter(bot => bot.status === 'stopped').length,
      errorBots: allBots.filter(bot => bot.status === 'error').length,
      deployingBots: allBots.filter(bot => bot.status === 'deploying').length,
      activeProcesses: runningBots,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  async performHealthCheck(botId: string): Promise<string> {
    const bot = await storage.getBot(botId);
    if (!bot) return 'not_found';
    
    const isRunning = this.activeProcesses.has(botId);
    return isRunning ? 'healthy' : 'stopped';
  }

  private async runCommandWithLogs(command: string, workingDir: string, logFunction: (message: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      logFunction(`Running: ${command}`);
      
      const [cmd, ...args] = command.trim().split(/\s+/);
      const childProcess = spawn(cmd, args, {
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' }
      });

      let output = '';
      let errorOutput = '';

      childProcess.stdout?.on('data', (data) => {
        const text = data.toString();
        output += text;
        logFunction(`STDOUT: ${text.trim()}`);
      });

      childProcess.stderr?.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        logFunction(`STDERR: ${text.trim()}`);
      });

      childProcess.on('exit', (code) => {
        if (code === 0) {
          logFunction(`Command completed successfully`);
          resolve();
        } else {
          logFunction(`Command failed with exit code ${code}`);
          reject(new Error(`Command failed: ${errorOutput || 'Unknown error'}`));
        }
      });

      childProcess.on('error', (error) => {
        logFunction(`Command error: ${error.message}`);
        reject(error);
      });
    });
  }

  async deployBotFromGitHub(botId: string, additionalEnvBuffer?: Buffer): Promise<void> {
    throw new Error('GitHub deployment not yet implemented');
  }

  async deployBotFromDocker(botId: string, additionalEnvBuffer?: Buffer): Promise<void> {
    throw new Error('Docker deployment not yet implemented');
  }
}

export const botManager = new BotManager();
