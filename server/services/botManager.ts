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
      const { botDir, envVars: zipEnvVars, analysis } = await fileManager.extractZipFile(zipBuffer, bot.name);
      
      // Update bot with analysis results
      await storage.updateBot(botId, {
        autoDetectedEntryFile: analysis.entryFile,
        hasDockerfile: analysis.hasDockerfile,
        hasRequirements: analysis.hasRequirements,
        language: analysis.language || bot.language
      });
      
      // Auto-update run command only if not explicitly set by user
      if (analysis.suggestedCommand && (bot.runCommand === 'auto-detect' || bot.runCommand?.includes('auto-detect'))) {
        await storage.updateBot(botId, { runCommand: analysis.suggestedCommand });
        addDeploymentLog(`Auto-detected run command: ${analysis.suggestedCommand}`);
      } else if (bot.runCommand && bot.runCommand !== 'auto-detect') {
        addDeploymentLog(`Using custom run command: ${bot.runCommand}`);
      }
      
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

      // Auto-install dependencies based on analysis
      if (analysis.hasRequirements) {
        if (analysis.language === 'python') {
          addDeploymentLog('Auto-installing Python dependencies...');
          await this.autoInstallPythonDeps(botDir, addDeploymentLog);
        } else if (analysis.language === 'nodejs') {
          addDeploymentLog('Auto-installing Node.js dependencies...');
          await this.autoInstallNodeDeps(botDir, addDeploymentLog);
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
        if (Object.keys(additionalEnvVars).length > 0) {
          addDeploymentLog(`Additional .env file overrode ${Object.keys(additionalEnvVars).length} variables`);
        }
      }

      // Handle build command - skip pip installs in Replit environment
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        
        // Check if it's a pip install command
        if (bot.buildCommand.includes('pip install') || bot.buildCommand.includes('requirements.txt')) {
          addDeploymentLog('Skipping pip install commands in Replit environment (packages are pre-installed)');
        } else {
          addDeploymentLog('Executing custom build command...');
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
    const botsDir = path.join(process.cwd(), 'bots');
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
        
        childProcess = spawn('sh', ['-c', enhancedRunCommand], {
          cwd: bot.filePath,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: {
            ...process.env,
            ...botEnvVars, // Apply bot-specific environment variables
            PORT: botPort.toString(),
            BOT_PORT: botPort.toString(),
            NODE_ENV: 'production',
            PYTHONUNBUFFERED: '1', // Enable Python real-time output
            PYTHONIOENCODING: 'utf-8' // Ensure UTF-8 encoding
          }
        });
      }

      const botProcess: BotProcess = {
        bot,
        process: childProcess,
        logs: [],
        startTime: new Date(),
        restartCount: 0,
        lastHealthCheck: new Date(),
        healthStatus: 'unknown',
        isDockerContainer: isDockerDeployment,
        containerName: isDockerDeployment ? `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}` : undefined
      };

      this.activeProcesses.set(botId, botProcess);

      // Handle process output with better encoding and log management
      childProcess.stdout?.on('data', (data) => {
        const logMessage = data.toString('utf8').trim();
        if (logMessage.length > 0) {
          const log = `[${new Date().toISOString()}] ${logMessage}`;
          botProcess.logs.push(log);
          
          // Keep only last 200 lines for better performance
          if (botProcess.logs.length > 200) {
            botProcess.logs.splice(0, botProcess.logs.length - 200);
          }
          
          this.emitLog(botId, log);
        }
      });

      childProcess.stderr?.on('data', (data) => {
        const errorMessage = data.toString('utf8').trim();
        if (errorMessage.length > 0) {
          const log = `[${new Date().toISOString()}] ERROR: ${errorMessage}`;
          botProcess.logs.push(log);
          
          // Keep only last 200 lines for better performance
          if (botProcess.logs.length > 200) {
            botProcess.logs.splice(0, botProcess.logs.length - 200);
          }
          
          this.emitLog(botId, log);
        }
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
    botProcess.process.kill(signal);
    
    // Wait for process to actually terminate if using SIGTERM
    if (!immediate) {
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          // Force kill if process doesn't respond to SIGTERM within 3 seconds
          if (!botProcess.process.killed) {
            botProcess.process.kill('SIGKILL');
          }
          resolve(undefined);
        }, 3000);
        
        botProcess.process.on('exit', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      });
    }
    
    this.activeProcesses.delete(botId);
    await storage.updateBot(botId, { status: 'stopped', processId: null });
    this.emit('botStatusChanged', { botId, status: 'stopped' });
  }

  async restartBot(botId: string): Promise<void> {
    if (this.activeProcesses.has(botId)) {
      await this.stopBot(botId, true); // Force immediate stop on restart
      // Wait a bit before restarting
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    await this.startBot(botId);
  }

  // Enhanced bot management methods
  async forceStopBot(botId: string): Promise<void> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error('Bot is not running');

    try {
      // Force kill immediately with SIGKILL
      botProcess.process.kill('SIGKILL');
      
      // Immediately cleanup without waiting
      this.activeProcesses.delete(botId);
      await storage.updateBot(botId, { status: 'stopped', processId: null });
      this.emit('botStatusChanged', { botId, status: 'stopped' });
      
      console.log(`Bot ${botId} force stopped immediately with SIGKILL`);
    } catch (error) {
      console.error(`Failed to force stop bot ${botId}:`, error);
      throw error;
    }
  }

  async getSystemStats(): Promise<{memoryUsage: NodeJS.MemoryUsage, uptime: number}> {
    return {
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  async performHealthCheck(botId: string): Promise<'healthy' | 'unhealthy' | 'unknown'> {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) return 'unknown';
    
    // Check if process is still alive and responsive
    try {
      const isAlive = !botProcess.process.killed && botProcess.process.pid;
      botProcess.lastHealthCheck = new Date();
      botProcess.healthStatus = isAlive ? 'healthy' : 'unhealthy';
      return botProcess.healthStatus;
    } catch (error) {
      botProcess.healthStatus = 'unhealthy';
      return 'unhealthy';
    }
  }

  async deleteBot(botId: string): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    // Stop bot if running
    if (this.activeProcesses.has(botId)) {
      await this.stopBot(botId);
    }

    // Delete files
    await fileManager.deleteBotFiles(bot.name);

    // Remove from storage
    await storage.deleteBot(botId);
  }

  getBotLogs(botId: string): string[] {
    const botProcess = this.activeProcesses.get(botId);
    const deploymentLogs = this.deploymentLogs.get(botId) || [];
    const runtimeLogs = botProcess?.logs || [];
    return [...deploymentLogs, ...runtimeLogs];
  }

  addLogListener(botId: string, callback: (log: string) => void): void {
    if (!this.logListeners.has(botId)) {
      this.logListeners.set(botId, new Set());
    }
    this.logListeners.get(botId)!.add(callback);
  }

  removeLogListener(botId: string, callback: (log: string) => void): void {
    this.logListeners.get(botId)?.delete(callback);
  }

  private emitLog(botId: string, log: string): void {
    const listeners = this.logListeners.get(botId);
    if (listeners) {
      listeners.forEach(callback => callback(log));
    }
    this.emit('botLog', { botId, log });
  }

  private async runCommand(command: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const childProcess = spawn('sh', ['-c', command], { cwd });
      
      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      childProcess.on('error', reject);
    });
  }

  private async runCommandWithLogs(command: string, cwd: string, logCallback: (message: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      // Replace pip with python3 -m pip for Python installations  
      let enhancedCommand = command.replace(/\bpython\b/g, 'python3');
      enhancedCommand = enhancedCommand.replace(/\bpip\b/g, 'python3 -m pip');
      
      const childProcess = spawn('sh', ['-c', enhancedCommand], { 
        cwd, 
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env
      });
      
      childProcess.stdout?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logCallback(`STDOUT: ${output}`);
        }
      });

      childProcess.stderr?.on('data', (data) => {
        const output = data.toString().trim();
        if (output) {
          logCallback(`STDERR: ${output}`);
        }
      });
      
      childProcess.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });

      childProcess.on('error', (error) => {
        logCallback(`PROCESS ERROR: ${error.message}`);
        reject(error);
      });
    });
  }
  // Auto-installation methods
  private async autoInstallPythonDeps(botDir: string, logFunction: (message: string) => void): Promise<void> {
    try {
      const requirementsPath = path.join(botDir, 'requirements.txt');
      const fs = await import('fs/promises');
      
      try {
        await fs.access(requirementsPath);
        logFunction('Found requirements.txt - installing Python dependencies...');
        
        // Try multiple pip methods for maximum compatibility
        const pipCommands = [
          'python3 -m pip install -r requirements.txt --user --break-system-packages',
          'python3 -m pip install -r requirements.txt --user',
          'pip3 install -r requirements.txt --user',
          'pip install -r requirements.txt --user'
        ];
        
        let installSuccess = false;
        for (const pipCmd of pipCommands) {
          try {
            logFunction(`Trying: ${pipCmd}`);
            await this.runCommandWithLogs(pipCmd, botDir, logFunction);
            logFunction('✅ Python dependencies installed successfully');
            installSuccess = true;
            break;
          } catch (error) {
            logFunction(`Failed with ${pipCmd.split(' ')[0]}: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }
        
        if (!installSuccess) {
          logFunction('⚠️ All pip methods failed - checking pre-installed packages...');
          const commonPackages = ['pyrogram', 'flask', 'aiohttp', 'requests', 'pymongo', 'motor', 'pyrofork'];
          const missingPackages = [];
          
          for (const pkg of commonPackages) {
            try {
              await this.runCommandWithLogs(`python3 -c "import ${pkg}"`, botDir, () => {});
              logFunction(`✅ ${pkg} available`);
            } catch {
              missingPackages.push(pkg);
              logFunction(`❌ ${pkg} missing`);
            }
          }
          
          if (missingPackages.length > 0) {
            logFunction(`⚠️ Missing packages: ${missingPackages.join(', ')} - bot may not work properly`);
          } else {
            logFunction('✅ All common packages available - proceeding with deployment');
          }
        }
      } catch (error) {
        logFunction('No requirements.txt found - skipping dependency installation');
      }
    } catch (error) {
      logFunction(`Warning: Python dependency installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async autoInstallNodeDeps(botDir: string, logFunction: (message: string) => void): Promise<void> {
    try {
      const packagePath = path.join(botDir, 'package.json');
      const fs = await import('fs/promises');
      
      try {
        await fs.access(packagePath);
        logFunction('Found package.json - installing Node.js dependencies...');
        
        await this.runCommandWithLogs('npm install', botDir, logFunction);
        logFunction('✅ Node.js dependencies installed successfully');
      } catch (error) {
        logFunction('No package.json found or installation failed');
      }
    } catch (error) {
      logFunction(`Warning: Node.js dependency installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export const botManager = new BotManager();
