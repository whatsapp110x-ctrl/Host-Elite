import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export class FileManager {
  private readonly botsDir = process.env.RENDER 
    ? path.join('/opt/render/project/src', 'deployed_bots')
    : path.join(process.cwd(), 'deployed_bots');

  async ensureBotsDirectory(): Promise<void> {
    try {
      await fs.access(this.botsDir);
    } catch {
      await fs.mkdir(this.botsDir, { recursive: true, mode: 0o755 });
      console.log(`[FileManager] Created bots directory: ${this.botsDir}`);
    }
  }

  async extractZipFile(zipBuffer: Buffer, botName: string): Promise<{ botDir: string; envVars: Record<string, string> }> {
    await this.ensureBotsDirectory();
    
    const botDir = path.join(this.botsDir, botName);
    
    // Remove existing directory if it exists
    try {
      await fs.rm(botDir, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist, continue
    }
    
    // Create bot directory
    await fs.mkdir(botDir, { recursive: true });
    
    // Extract ZIP file
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(botDir, true);

    // Check if extraction created a single subdirectory (common with GitHub downloads)
    const extractedItems = await fs.readdir(botDir);
    if (extractedItems.length === 1) {
      const singleItem = extractedItems[0];
      const singleItemPath = path.join(botDir, singleItem);
      const stats = await fs.stat(singleItemPath);
      
      if (stats.isDirectory()) {
        // Move all files from subdirectory to parent directory
        const subDirFiles = await fs.readdir(singleItemPath);
        
        for (const file of subDirFiles) {
          const sourcePath = path.join(singleItemPath, file);
          const destPath = path.join(botDir, file);
          await fs.rename(sourcePath, destPath);
        }
        
        // Remove the now-empty subdirectory
        await fs.rmdir(singleItemPath);
      }
    }
    
    // Parse .env file if it exists
    const envVars = await this.parseEnvFile(botDir);
    
    return { botDir, envVars };
  }

  async deleteBotFiles(botName: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    try {
      await fs.rm(botDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete bot files for ${botName}:`, error);
    }
  }


  async parseEnvFile(botDir: string): Promise<Record<string, string>> {
    const envFiles = ['.env', 'config.env'];
    let allEnvVars: Record<string, string> = {};
    
    for (const envFile of envFiles) {
      const envPath = path.join(botDir, envFile);
      
      try {
        const envContent = await fs.readFile(envPath, 'utf8');
        const envVars = this.parseEnvContent(envContent, envFile);
        allEnvVars = { ...allEnvVars, ...envVars };
      } catch (error) {
        // File doesn't exist, continue
      }
    }
    
    return allEnvVars;
  }

  parseEnvContent(content: string, source: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }
      
      // Parse KEY=VALUE format
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        let value = trimmedLine.substring(equalIndex + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || 
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        if (key && value) {
          envVars[key] = value;
        }
      }
    }
    
    console.log(`[FileManager] Parsed ${Object.keys(envVars).length} environment variables from ${source}`);
    return envVars;
  }

  mergeEnvVars(baseVars: Record<string, string>, overrideVars: Record<string, string>): Record<string, string> {
    const merged = { ...baseVars, ...overrideVars };
    
    // Log any overrides
    const overriddenKeys = Object.keys(overrideVars).filter(key => 
      baseVars.hasOwnProperty(key) && baseVars[key] !== overrideVars[key]
    );
    
    if (overriddenKeys.length > 0) {
      console.log(`[FileManager] Environment variables overridden: ${overriddenKeys.join(', ')}`);
    }
    
    return merged;
  }

  async generateRunScript(botDir: string, runCommand: string, envVars: Record<string, string>): Promise<string> {
    const scriptPath = path.join(botDir, 'run.sh');
    
    // Create environment variable exports
    const envExports = Object.entries(envVars)
      .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
      .join('\n');
    
    const scriptContent = `#!/bin/bash
# Auto-generated run script
set -e

# Set environment variables
${envExports}

# Execute the run command
cd "${botDir}"
${runCommand}
`;
    
    await fs.writeFile(scriptPath, scriptContent, { mode: 0o755 });
    return scriptPath;
  }

  async createDockerfile(botDir: string, language: string, runCommand: string): Promise<void> {
    let dockerfileContent: string;
    
    switch (language) {
      case 'python':
        dockerfileContent = `FROM python:3.11-slim

WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt* ./
RUN if [ -f requirements.txt ]; then pip install --no-cache-dir -r requirements.txt; fi

# Copy application files
COPY . .

# Create non-root user
RUN useradd -m -u 1000 botuser && chown -R botuser:botuser /app
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD python -c "import requests; requests.get('http://localhost:$PORT/health')" || exit 1

EXPOSE $PORT

CMD ${runCommand}
`;
        break;
        
      case 'nodejs':
        dockerfileContent = `FROM node:18-slim

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm ci --only=production

# Copy application files
COPY . .

# Create non-root user
RUN useradd -m -u 1000 botuser && chown -R botuser:botuser /app
USER botuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD curl -f http://localhost:$PORT/health || exit 1

EXPOSE $PORT

CMD ${runCommand}
`;
        break;
        
      default:
        throw new Error(`Unsupported language for Docker: ${language}`);
    }
    
    const dockerfilePath = path.join(botDir, 'Dockerfile');
    await fs.writeFile(dockerfilePath, dockerfileContent);
  }

  async installDependencies(botDir: string, language: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let command: string;
      let args: string[];
      
      switch (language) {
        case 'python':
          const requirementsPath = path.join(botDir, 'requirements.txt');
          fs.access(requirementsPath)
            .then(() => {
              command = 'pip';
              args = ['install', '-r', 'requirements.txt'];
            })
            .catch(() => {
              // No requirements.txt, skip installation
              resolve();
              return;
            });
          break;
          
        case 'nodejs':
          const packagePath = path.join(botDir, 'package.json');
          fs.access(packagePath)
            .then(() => {
              command = 'npm';
              args = ['install'];
            })
            .catch(() => {
              // No package.json, skip installation
              resolve();
              return;
            });
          break;
          
        default:
          resolve(); // Unknown language, skip
          return;
      }
      
      if (!command) {
        resolve();
        return;
      }
      
      const installProcess = spawn(command, args, {
        cwd: botDir,
        stdio: 'pipe'
      });
      
      let output = '';
      let error = '';
      
      installProcess.stdout?.on('data', (data) => {
        output += data.toString();
      });
      
      installProcess.stderr?.on('data', (data) => {
        error += data.toString();
      });
      
      installProcess.on('exit', (code) => {
        if (code === 0) {
          console.log(`[FileManager] Dependencies installed successfully for ${language}`);
          resolve();
        } else {
          console.error(`[FileManager] Failed to install dependencies: ${error}`);
          reject(new Error(`Dependency installation failed: ${error}`));
        }
      });
      
      installProcess.on('error', (err) => {
        console.error(`[FileManager] Process error during dependency installation: ${err}`);
        reject(err);
      });
    });
  }

  async listBotFiles(botName: string): Promise<string[]> {
    const botDir = path.join(this.botsDir, botName);
    
    try {
      const files = await fs.readdir(botDir, { recursive: true });
      return files.filter(file => typeof file === 'string') as string[];
    } catch (error) {
      throw new Error(`Failed to list files for bot ${botName}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async getBotFileContent(botName: string, filePath: string): Promise<string> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check - ensure path is within bot directory
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path - outside bot directory');
    }
    
    try {
      return await fs.readFile(fullPath, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateBotFile(botName: string, filePath: string, content: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check - ensure path is within bot directory
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path - outside bot directory');
    }
    
    try {
      // Ensure directory exists
      const dir = path.dirname(fullPath);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(fullPath, content, 'utf8');
      console.log(`[FileManager] Updated file: ${filePath} for bot ${botName}`);
    } catch (error) {
      throw new Error(`Failed to update file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getBotsDirectory(): string {
    return this.botsDir;
  }
}

export const fileManager = new FileManager();
