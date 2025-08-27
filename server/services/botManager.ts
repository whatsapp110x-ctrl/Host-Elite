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
  private deploymentLogs = new Map<string, string[]>(); // Store deployment logs

  async deployBot(botId: string, zipBuffer: Buffer): Promise<void> {
    return this.deployBotFromZip(botId, zipBuffer);
  }

  async deployBotWithEnv(botId: string, zipBuffer: Buffer, additionalEnvBuffer?: Buffer): Promise<void> {
    return this.deployBotFromZip(botId, zipBuffer, additionalEnvBuffer);
  }

  async deployBotFromZip(botId: string, zipBuffer: Buffer, additionalEnvBuffer?: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    // Initialize deployment logs for this bot
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
      // Update status to deploying
      await storage.updateBot(botId, { status: 'deploying' });
      this.emit('botStatusChanged', { botId, status: 'deploying' });
      addDeploymentLog('Starting deployment...');

      // Extract ZIP file
      addDeploymentLog('Extracting ZIP file...');
      const { botDir, envVars: zipEnvVars } = await fileManager.extractZipFile(zipBuffer, bot.name);
      
      // Parse additional .env file if provided
      let additionalEnvVars: Record<string, string> = {};
      if (additionalEnvBuffer) {
        addDeploymentLog('Processing additional .env file...');
        const additionalEnvContent = additionalEnvBuffer.toString('utf8');
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, 'additional .env file');
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      
      // Merge environment variables (additional overrides ZIP)
      const mergedEnvVars = fileManager.mergeEnvVars(zipEnvVars, additionalEnvVars);
      
      // Store merged environment variables
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      await storage.updateBot(botId, { 
        filePath: botDir,
        environmentVars: envVarsJson
      });
      
      addDeploymentLog(`Files extracted to: ${botDir}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(', ')}`);
        if (Object.keys(additionalEnvVars).length > 0) {
          addDeploymentLog(`Additional .env file overrode ${Object.keys(additionalEnvVars).length} variables`);
        }
      }

      // Handle build command - skip pip installs in Replit environment
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        
        // Check if it's a pip install command
        if (bot.buildCommand.includes('pip install') || bot.buildCommand.includes('requirements.txt')) {
          const fs = await import('fs/promises');
          const path = await import('path');
          const requirementsPath = path.join(botDir, 'requirements.txt');
          
          try {
            await fs.access(requirementsPath);
            addDeploymentLog('Found requirements.txt file');
            addDeploymentLog('Python packages are pre-installed in Replit environment');
            addDeploymentLog('Skipping pip install to avoid permission issues');
            addDeploymentLog('Most common packages (pyrogram, flask, aiohttp, etc.) are available');
          } catch (error) {
            addDeploymentLog('No requirements.txt file found');
          }
          addDeploymentLog('Dependencies check completed - using pre-installed packages');
        } else {
          // Run non-pip build commands normally
          try {
            await this.runCommandWithLogs(bot.buildCommand, botDir, addDeploymentLog);
            addDeploymentLog('Build command completed successfully');
          } catch (error) {
            addDeploymentLog(`Build command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            // Don't fail deployment for build command errors
          }
        }
      }

      // Update status to stopped (ready to start)
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

  async deployBotFromGitHub(botId: string, additionalEnvBuffer?: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');
    if (!bot.githubRepoUrl) throw new Error('GitHub repository URL not found');

    // Initialize deployment logs for this bot
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
      // Update status to deploying
      await storage.updateBot(botId, { status: 'deploying' });
      this.emit('botStatusChanged', { botId, status: 'deploying' });
      addDeploymentLog('Starting GitHub deployment...');

      // Clone the repository
      addDeploymentLog(`Cloning repository: ${bot.githubRepoUrl}`);
      const botDir = await this.cloneGitHubRepository(bot.githubRepoUrl, bot.name, addDeploymentLog);
      
      // Look for and parse .env files in the repository
      addDeploymentLog('Searching for environment variables...');
      let repoEnvVars: Record<string, string> = {};
      try {
        const envContent = await this.findAndReadEnvFile(botDir);
        if (envContent) {
          repoEnvVars = fileManager.parseEnvContent(envContent, '.env file from repository');
          addDeploymentLog(`Found .env file with ${Object.keys(repoEnvVars).length} variables`);
        } else {
          addDeploymentLog('No .env file found in repository');
        }
      } catch (error) {
        addDeploymentLog('Warning: Could not read .env file from repository');
      }
      
      // Parse additional .env file if provided
      let additionalEnvVars: Record<string, string> = {};
      if (additionalEnvBuffer) {
        addDeploymentLog('Processing additional .env file...');
        const additionalEnvContent = additionalEnvBuffer.toString('utf8');
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, 'additional .env file');
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      
      // Merge environment variables (additional overrides repository)
      const mergedEnvVars = fileManager.mergeEnvVars(repoEnvVars, additionalEnvVars);
      
      // Store merged environment variables
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      await storage.updateBot(botId, { 
        filePath: botDir,
        environmentVars: envVarsJson
      });
      
      addDeploymentLog(`Repository cloned to: ${botDir}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(', ')}`);
      }

      // Handle build command
      if (bot.buildCommand) {
        addDeploymentLog(`Executing build command: ${bot.buildCommand}`);
        try {
          await this.runCommandWithLogs(bot.buildCommand, botDir, addDeploymentLog);
          addDeploymentLog('Build command completed successfully');
        } catch (error) {
          addDeploymentLog(`Build command failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          // Don't fail deployment for build command errors
        }
      }

      // Update status to stopped (ready to start)
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
    
    // Ensure bots directory exists
    await fs.mkdir(botsDir, { recursive: true });
    
    // Remove existing directory if it exists
    try {
      await fs.rmdir(botDir, { recursive: true });
      logFunction('Removed existing bot directory');
    } catch (error) {
      // Directory doesn't exist, which is fine
    }
    
    try {
      const git = simpleGit();
      logFunction('Initializing Git clone...');
      
      // Clone the repository
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
        // File doesn't exist or can't be read, continue to next file
        continue;
      }
    }
    
    return null;
  }

  async deployBotFromDocker(botId: string, additionalEnvBuffer?: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');
    if (!bot.githubRepoUrl) throw new Error('Repository URL not found');

    // Initialize deployment logs for this bot
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
      // Update status to deploying
      await storage.updateBot(botId, { status: 'deploying' });
      this.emit('botStatusChanged', { botId, status: 'deploying' });
      addDeploymentLog('Starting Docker deployment...');

      // Clone the repository
      addDeploymentLog(`Cloning repository: ${bot.githubRepoUrl}`);
      const botDir = await this.cloneGitHubRepository(bot.githubRepoUrl, bot.name, addDeploymentLog);
      
      // Check for Dockerfile
      addDeploymentLog('Checking for Dockerfile...');
      const dockerfilePath = path.join(botDir, 'Dockerfile');
      try {
        await fs.access(dockerfilePath);
        addDeploymentLog('Dockerfile found - proceeding with Docker build');
      } catch (error) {
        throw new Error('No Dockerfile found in repository root. Please ensure your repository contains a Dockerfile.');
      }
      
      // Look for and parse .env files in the repository
      addDeploymentLog('Searching for environment variables...');
      let repoEnvVars: Record<string, string> = {};
      try {
        const envContent = await this.findAndReadEnvFile(botDir);
        if (envContent) {
          repoEnvVars = fileManager.parseEnvContent(envContent, '.env file from repository');
          addDeploymentLog(`Found .env file with ${Object.keys(repoEnvVars).length} variables`);
        } else {
          addDeploymentLog('No .env file found in repository');
        }
      } catch (error) {
        addDeploymentLog('Warning: Could not read .env file from repository');
      }
      
      // Parse additional .env file if provided
      let additionalEnvVars: Record<string, string> = {};
      if (additionalEnvBuffer) {
        addDeploymentLog('Processing additional .env file...');
        const additionalEnvContent = additionalEnvBuffer.toString('utf8');
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, 'additional .env file');
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      
      // Merge environment variables (additional overrides repository)
      const mergedEnvVars = fileManager.mergeEnvVars(repoEnvVars, additionalEnvVars);
      
      // Build Docker image
      addDeploymentLog('Building Docker image...');
      const imageName = `host-elite-bot-${bot.name.toLowerCase()}:latest`;
      const buildResult = await this.buildDockerImage(botDir, imageName, addDeploymentLog);
      
      if (!buildResult.success) {
        throw new Error(`Docker build failed: ${buildResult.error}`);
      }
      
      // Store merged environment variables and Docker image name
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      await storage.updateBot(botId, { 
        filePath: imageName, // Store Docker image name instead of file path
        environmentVars: envVarsJson
      });
      
      addDeploymentLog(`Docker image built successfully: ${imageName}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(', ')}`);
      }

      // Update status to stopped (ready to start)
      await storage.updateBot(botId, { status: 'stopped' });
      this.emit('botStatusChanged', { botId, status: 'stopped' });
      addDeploymentLog('Docker deployment completed successfully');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Docker deployment error';
      addDeploymentLog(`DOCKER DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: 'error' });
      this.emit('botStatusChanged', { botId, status: 'error' });
      throw error;
    }
  }

  private async buildDockerImage(botDir: string, imageName: string, logFunction: (message: string) => void): Promise<{success: boolean, error?: string}> {
    return new Promise((resolve) => {
      try {
        const buildProcess = spawn('docker', ['build', '-t', imageName, '.'], {
          cwd: botDir,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let buildOutput = '';
        let buildError = '';

        buildProcess.stdout?.on('data', (data) => {
          const output = data.toString();
          buildOutput += output;
          // Log key build steps
          const lines = output.split('\n').filter((line: string) => line.trim());
          lines.forEach((line: string) => {
            if (line.includes('Step ') || line.includes('Successfully built') || line.includes('Successfully tagged')) {
              logFunction(`Docker: ${line.trim()}`);
            }
          });
        });

        buildProcess.stderr?.on('data', (data) => {
          const error = data.toString();
          buildError += error;
          logFunction(`Docker Error: ${error.trim()}`);
        });

        buildProcess.on('exit', (code) => {
          if (code === 0) {
            logFunction('Docker image built successfully');
            resolve({ success: true });
          } else {
            logFunction(`Docker build failed with exit code ${code}`);
            resolve({ success: false, error: buildError || 'Unknown build error' });
          }
        });

        buildProcess.on('error', (error) => {
          logFunction(`Docker build process error: ${error.message}`);
          resolve({ success: false, error: error.message });
        });

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logFunction(`Failed to start Docker build: ${errorMessage}`);
        resolve({ success: false, error: errorMessage });
      }
    });
  }

  async startBot(botId: string): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot || !bot.filePath) throw new Error('Bot not found or not deployed');

    if (this.activeProcesses.has(botId)) {
      throw new Error('Bot is already running');
    }

    try {
      // Check if this is a Docker deployment (filePath contains Docker image name)
      const isDockerDeployment = bot.deploymentSource === 'docker' && bot.filePath.includes('host-elite-bot-');
      
      let childProcess: ChildProcess;
      
      if (isDockerDeployment) {
        // Start Docker container
        const containerName = `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}`;
        const imageName = bot.filePath; // Docker image name is stored in filePath
        
        // Generate a unique port for each bot (starting from 8080)
        const botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
        
        // Parse stored environment variables
        let botEnvVars: Record<string, string> = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        
        // Build Docker run command with environment variables
        const envArgs: string[] = [];
        for (const [key, value] of Object.entries(botEnvVars)) {
          envArgs.push('-e', `${key}=${value}`);
        }
        
        // Add default environment variables
        envArgs.push('-e', `PORT=${botPort}`, '-e', `BOT_PORT=${botPort}`);
        
        const dockerArgs = [
          'run',
          '--name', containerName,
          '--rm', // Remove container when it stops
          '-p', `${botPort}:${botPort}`, // Port mapping
          ...envArgs,
          imageName
        ];
        
        childProcess = spawn('docker', dockerArgs, {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        console.log(`[${bot.name}] Starting Docker container: ${containerName} from image ${imageName}`);
      } else {
        // Start regular process (ZIP or GitHub deployment)
        // Replace python/pip with python3/python3 -m pip for compatibility
        let enhancedRunCommand = bot.runCommand.replace(/\bpython\b/g, 'python3');
        enhancedRunCommand = enhancedRunCommand.replace(/\bpip\b/g, 'python3 -m pip');
        
        // For Render, ensure we use the correct Python interpreter
        if (process.env.RENDER) {
          // On Render, python3 should be available in PATH
          enhancedRunCommand = enhancedRunCommand.replace(/^python3/g, '/opt/render/project/.render/python/bin/python3 || python3');
        }
        
        console.log(`[${bot.name}] Enhanced run command: ${enhancedRunCommand}`);
        
        // For Render deployment, use PORT from environment if available, otherwise generate unique port
        let botPort: number;
        if (process.env.RENDER && process.env.PORT) {
          // On Render, use the provided PORT
          botPort = parseInt(process.env.PORT, 10);
        } else {
          // Generate a unique port for each bot (starting from 8080)
          botPort = 8080 + parseInt(botId.slice(-4), 16) % 1000;
        }
        
        // Parse stored environment variables
        let botEnvVars: Record<string, string> = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        
        // Ensure the bot directory exists and is accessible
        const fs = await import('fs/promises');
        try {
          await fs.access(bot.filePath);
        } catch (error) {
          console.error(`Bot directory not accessible: ${bot.filePath}`);
          throw new Error(`Bot files not found at: ${bot.filePath}`);
        }
        
        console.log(`[${bot.name}] Starting bot from directory: ${bot.filePath}`);
        console.log(`[${bot.name}] Bot port: ${botPort}`);
        console.log(`[${bot.name}] Environment variables: ${Object.keys(botEnvVars).join(', ')}`);
        
        childProcess = spawn('sh', ['-c', enhancedRunCommand], {
          cwd: bot.filePath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...botEnvVars, // Apply bot-specific environment variables
            PORT: botPort.toString(),
            BOT_PORT: botPort.toString(),
            // Add Render-specific environment variables
            RENDER: process.env.RENDER || 'false',
            NODE_ENV: process.env.NODE_ENV || 'production',
            // Python-specific environment variables for Render
            PYTHONPATH: bot.filePath,
            PYTHONUNBUFFERED: '1'
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

      // Handle process output with better logging
      childProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        const log = `[${new Date().toISOString()}] ${output}`;
        botProcess.logs.push(log);
        console.log(`[${bot.name}] STDOUT: ${output}`);
        this.emitLog(botId, log);
      });

      childProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        const log = `[${new Date().toISOString()}] ERROR: ${output}`;
        botProcess.logs.push(log);
        console.error(`[${bot.name}] STDERR: ${output}`);
        this.emitLog(botId, log);
      });

      childProcess.on('exit', async (code, signal) => {
        this.activeProcesses.delete(botId);
        
        // Determine status based on exit conditions
        let status: 'stopped' | 'error' = 'stopped';
        if (code !== 0 && signal !== 'SIGKILL' && signal !== 'SIGTERM') {
          status = 'error';
        }
        
        await storage.updateBot(botId, { status, processId: null });
        this.emit('botStatusChanged', { botId, status });
        
        // Enhanced auto-restart logic
        if (bot.autoRestart && status === 'error') {
          const restartDelay = Math.min(5000 * (botProcess.restartCount || 0) + 5000, 30000);
          setTimeout(() => {
            this.startBot(botId).catch(console.error);
          }, restartDelay);
        }
      });

      await storage.updateBot(botId, { status: 'running', processId: childProcess.pid });
      this.emit('botStatusChanged', { botId, status: 'running' });

    } catch (error) {
      await storage.updateBot(botId, { status: 'error' });
      this.emit('botStatusChanged', { botId, status: 'error' });
      throw error;
    }
  }

  async stopBot(botId: string, immediate: boolean = false): Promise<void> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error('Bot is not running');

    // Use SIGKILL for immediate stop, SIGTERM for graceful stop
    const signal = immediate ? 'SIGKILL' : 'SIGTERM';
    
    if (botProcess.isDockerContainer && botProcess.containerName) {
      // Stop Docker container
      const stopProcess = spawn('docker', ['stop', botProcess.containerName], {
        stdio: 'pipe'
      });
      
      stopProcess.on('exit', () => {
        console.log(`[${botProcess.bot.name}] Docker container stopped: ${botProcess.containerName}`);
      });
    } else {
      // Stop regular process
      botProcess.process.kill(signal);
    }
    
    // Clean up
    this.activeProcesses.delete(botId);
    await storage.updateBot(botId, { status: 'stopped', processId: null });
    this.emit('botStatusChanged', { botId, status: 'stopped' });
  }

  async restartBot(botId: string): Promise<void> {
    try {
      await this.stopBot(botId, true); // Force stop
      setTimeout(async () => {
        await this.startBot(botId);
      }, 2000); // Wait 2 seconds before restart
    } catch (error) {
      // If bot is not running, just start it
      await this.startBot(botId);
    }
  }

  async deleteBot(botId: string): Promise<void> {
    try {
      // Stop bot if running
      if (this.activeProcesses.has(botId)) {
        await this.stopBot(botId, true);
      }

      // Delete bot files
      const bot = await storage.getBot(botId);
      if (bot && bot.filePath) {
        // Check if it's a Docker image or file path
        if (bot.deploymentSource === 'docker' && bot.filePath.includes('host-elite-bot-')) {
          // Remove Docker image
          const removeImageProcess = spawn('docker', ['rmi', bot.filePath], {
            stdio: 'pipe'
          });
          
          removeImageProcess.on('exit', (code) => {
            if (code === 0) {
              console.log(`[${bot.name}] Docker image removed: ${bot.filePath}`);
            } else {
              console.warn(`[${bot.name}] Failed to remove Docker image: ${bot.filePath}`);
            }
          });
        } else {
          // Delete bot files
          await fileManager.deleteBotFiles(bot.name);
        }
      }

      // Clean up logs
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
      return 'running';
    }
    return null; // Will be fetched from storage
  }

  getActiveBots(): string[] {
    return Array.from(this.activeProcesses.keys());
  }

  emitLog(botId: string, log: string): void {
    this.emit('botLog', { botId, log });
    
    // Also emit to specific listeners
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

  private async runCommandWithLogs(command: string, cwd: string, logFunction: (message: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('sh', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      process.stdout?.on('data', (data) => {
        logFunction(`BUILD: ${data.toString().trim()}`);
      });

      process.stderr?.on('data', (data) => {
        logFunction(`BUILD ERROR: ${data.toString().trim()}`);
      });

      process.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      process.on('error', (error) => {
        reject(error);
      });
    });
  }
}

export const botManager = new BotManager();
