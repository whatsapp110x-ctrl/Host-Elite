import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

export class FileManager {
  private readonly botsDir = path.join(process.cwd(), 'deployed_bots');

  async ensureBotsDirectory(): Promise<void> {
    try {
      await fs.access(this.botsDir);
    } catch {
      await fs.mkdir(this.botsDir, { recursive: true });
    }
  }

  async extractZipFile(zipBuffer: Buffer, botName: string): Promise<{ 
    botDir: string; 
    envVars: Record<string, string>;
    analysis: {
      language?: 'python' | 'nodejs';
      entryFile?: string;
      hasRequirements: boolean;
      hasDockerfile: boolean;
      hasEnvFile: boolean;
      suggestedCommand?: string;
    }
  }> {
    // Validate bot name for security
    if (!botName || !/^[a-zA-Z0-9_-]+$/.test(botName)) {
      throw new Error('Invalid bot name. Only letters, numbers, underscores, and hyphens allowed.');
    }

    // Validate ZIP file size (max 100MB)
    if (zipBuffer.length > 100 * 1024 * 1024) {
      throw new Error(`ZIP file too large. Maximum size: 100MB, received: ${(zipBuffer.length / 1024 / 1024).toFixed(2)}MB`);
    }

    await this.ensureBotsDirectory();
    
    const botDir = path.join(this.botsDir, botName);
    
    // Security check: Ensure botDir is within botsDir
    const resolvedBotDir = path.resolve(botDir);
    const resolvedBotsDir = path.resolve(this.botsDir);
    if (!resolvedBotDir.startsWith(resolvedBotsDir)) {
      throw new Error('Invalid bot directory path');
    }
    
    // Remove existing directory if it exists
    try {
      await fs.rm(botDir, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist, continue
    }
    
    // Create bot directory
    await fs.mkdir(botDir, { recursive: true });
    
    // Extract ZIP file with security checks
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    
    // Security checks for ZIP file
    let totalUncompressedSize = 0;
    const maxFileSize = 10 * 1024 * 1024; // 10MB per file
    const maxTotalSize = 200 * 1024 * 1024; // 200MB total
    const maxFiles = 1000;
    
    if (entries.length > maxFiles) {
      throw new Error(`ZIP file contains too many files. Maximum: ${maxFiles}, found: ${entries.length}`);
    }
    
    // Validate each entry before extraction
    for (const entry of entries) {
      const entryName = entry.entryName;
      
      // Check for path traversal attempts
      if (entryName.includes('..') || entryName.startsWith('/') || entryName.includes('\\')) {
        throw new Error(`Potentially dangerous file path detected: ${entryName}`);
      }
      
      // Check uncompressed size
      const uncompressedSize = entry.header.size;
      if (uncompressedSize > maxFileSize) {
        throw new Error(`File ${entryName} too large: ${(uncompressedSize / 1024 / 1024).toFixed(2)}MB (max: ${maxFileSize / 1024 / 1024}MB)`);
      }
      
      totalUncompressedSize += uncompressedSize;
      if (totalUncompressedSize > maxTotalSize) {
        throw new Error(`ZIP file too large when extracted: ${(totalUncompressedSize / 1024 / 1024).toFixed(2)}MB (max: ${maxTotalSize / 1024 / 1024}MB)`);
      }
    }
    
    // Extract safely
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
    
    // Perform comprehensive analysis
    const analysis = await this.analyzeProjectStructure(botDir);
    
    return { botDir, envVars, analysis };
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
        const envVars = this.parseEnvContent(envContent, `ZIP ${envFile} file`);
        
        // Merge variables (.env has priority over config.env if both exist)
        if (envFile === '.env') {
          allEnvVars = { ...allEnvVars, ...envVars };
        } else {
          allEnvVars = { ...envVars, ...allEnvVars };
        }
      } catch (error) {
        // File doesn't exist or can't be read, that's okay
        console.log(`No ${envFile} file found in ZIP or error reading it:`, error instanceof Error ? error.message : 'Unknown error');
      }
    }
    
    return allEnvVars;
  }

  parseEnvContent(envContent: string, source: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    // Parse .env file line by line
    const lines = envContent.split('\n');
    
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
        
        envVars[key] = value;
      }
    }
    
    console.log(`Found ${source} with ${Object.keys(envVars).length} variables:`, Object.keys(envVars));
    return envVars;
  }

  mergeEnvVars(zipEnvVars: Record<string, string>, additionalEnvVars: Record<string, string>): Record<string, string> {
    // Additional env vars override ZIP env vars
    const merged = { ...zipEnvVars, ...additionalEnvVars };
    
    if (Object.keys(additionalEnvVars).length > 0) {
      console.log('Merged environment variables:', {
        zipVars: Object.keys(zipEnvVars).length,
        additionalVars: Object.keys(additionalEnvVars).length,
        totalMerged: Object.keys(merged).length
      });
    }
    
    return merged;
  }

  getBotDirectory(botName: string): string {
    return path.join(this.botsDir, botName);
  }

  async analyzeProjectStructure(botDir: string): Promise<{
    language?: 'python' | 'nodejs';
    entryFile?: string;
    hasRequirements: boolean;
    hasDockerfile: boolean;
    hasProcfile: boolean;
    hasEnvFile: boolean;
    suggestedCommand?: string;
    procfileCommand?: string;
    dockerfileCommand?: string;
  }> {
    try {
      const files = await fs.readdir(botDir);
      const fileNames = files.map(f => f.toLowerCase());
      
      let language: 'python' | 'nodejs' | undefined;
      let entryFile: string | undefined;
      let hasRequirements = false;
      let hasDockerfile = false;
      let hasEnvFile = false;

      // Check for dependency and config files
      hasRequirements = fileNames.includes('requirements.txt') || fileNames.includes('package.json');
      hasDockerfile = fileNames.includes('dockerfile');
      const hasProcfile = fileNames.includes('procfile');
      hasEnvFile = fileNames.includes('.env') || fileNames.includes('config.env') || fileNames.includes('env.txt');
      
      // Enhanced dependency detection
      const hasPackageLock = fileNames.includes('package-lock.json');
      const hasYarnLock = fileNames.includes('yarn.lock');
      const hasPipfile = fileNames.includes('pipfile');
      const hasPoetryLock = fileNames.includes('poetry.lock');
      const hasCondaEnv = fileNames.includes('environment.yml') || fileNames.includes('conda.yml');
      
      let procfileCommand: string | undefined;
      let dockerfileCommand: string | undefined;

      // Enhanced entry file detection with priority order
      const pythonEntryFiles = ['main.py', 'bot.py', 'app.py', 'run.py', 'start.py', '__main__.py'];
      const nodejsEntryFiles = ['index.js', 'app.js', 'bot.js', 'main.js', 'server.js', 'start.js'];
      const typescriptEntryFiles = ['index.ts', 'app.ts', 'bot.ts', 'main.ts', 'server.ts'];

      // Check for Python entry files
      for (const pyFile of pythonEntryFiles) {
        if (fileNames.includes(pyFile)) {
          language = 'python';
          entryFile = files.find(f => f.toLowerCase() === pyFile);
          break;
        }
      }

      // Check for Node.js/TypeScript entry files
      if (!language) {
        // Check TypeScript files first
        for (const tsFile of typescriptEntryFiles) {
          if (fileNames.includes(tsFile)) {
            language = 'nodejs';
            entryFile = files.find(f => f.toLowerCase() === tsFile);
            break;
          }
        }
        
        // Then check JavaScript files
        if (!language) {
          for (const jsFile of nodejsEntryFiles) {
            if (fileNames.includes(jsFile)) {
              language = 'nodejs';
              entryFile = files.find(f => f.toLowerCase() === jsFile);
              break;
            }
          }
        }
      }

      // Fallback: look for any .py or .js files
      if (!language) {
        const pyFiles = files.filter(f => f.endsWith('.py'));
        const jsFiles = files.filter(f => f.endsWith('.js'));
        const tsFiles = files.filter(f => f.endsWith('.ts'));
        
        if (pyFiles.length > 0) {
          language = 'python';
          entryFile = pyFiles[0];
        } else if (tsFiles.length > 0) {
          language = 'nodejs';
          entryFile = tsFiles[0];
        } else if (jsFiles.length > 0) {
          language = 'nodejs';
          entryFile = jsFiles[0];
        }
      }

      // Check package.json for Node.js specific info
      if (fileNames.includes('package.json')) {
        try {
          const packageContent = await fs.readFile(path.join(botDir, 'package.json'), 'utf-8');
          const packageJson = JSON.parse(packageContent);
          
          if (packageJson.main) {
            language = 'nodejs';
            entryFile = packageJson.main;
          }
          
          if (packageJson.scripts?.start) {
            // Extract entry file from start script if possible
            const startScript = packageJson.scripts.start;
            const nodeMatch = startScript.match(/node\s+([\w\.\-\/]+)/i);
            if (nodeMatch) {
              entryFile = nodeMatch[1];
            }
          }
        } catch (error) {
          console.warn('Failed to parse package.json:', error);
        }
      }

      // Try to parse Procfile for web command
      if (hasProcfile) {
        try {
          const procfilePath = path.join(botDir, 'Procfile');
          const procfileContent = await fs.readFile(procfilePath, 'utf8');
          const lines = procfileContent.split('\n');
          const webLine = lines.find(line => line.trim().startsWith('web:'));
          if (webLine) {
            procfileCommand = webLine.split('web:')[1]?.trim();
          }
        } catch (error) {
          console.error('Error parsing Procfile:', error);
        }
      }
      
      // Try to parse Dockerfile for CMD instruction
      if (hasDockerfile) {
        try {
          const dockerfilePath = path.join(botDir, 'Dockerfile');
          const dockerfileContent = await fs.readFile(dockerfilePath, 'utf8');
          const lines = dockerfileContent.split('\n');
          const cmdLine = lines.reverse().find(line => line.trim().startsWith('CMD'));
          if (cmdLine) {
            dockerfileCommand = cmdLine.replace(/^CMD\s*\[?/, '').replace(/\]?$/, '').replace(/"/g, '').trim();
          }
        } catch (error) {
          console.error('Error parsing Dockerfile:', error);
        }
      }

      // Generate suggested command with priority order
      let suggestedCommand: string | undefined;
      if (procfileCommand) {
        suggestedCommand = procfileCommand;
      } else if (dockerfileCommand) {
        suggestedCommand = dockerfileCommand;
      } else if (hasDockerfile) {
        suggestedCommand = 'docker build -t bot . && docker run bot';
      } else if (language === 'python' && entryFile) {
        suggestedCommand = `python3 ${entryFile}`;
      } else if (language === 'nodejs' && entryFile) {
        // Handle TypeScript files
        if (entryFile.endsWith('.ts')) {
          suggestedCommand = `npx tsx ${entryFile}`;
        } else {
          suggestedCommand = `node ${entryFile}`;
        }
      } else if (language === 'nodejs' && hasRequirements) {
        suggestedCommand = 'npm start';
      }

      return {
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
    } catch (error) {
      console.error('Project analysis error:', error);
      return {
        hasRequirements: false,
        hasDockerfile: false,
        hasProcfile: false,
        hasEnvFile: false
      };
    }
  }

  // File browsing and editing methods
  async listBotFiles(botName: string): Promise<Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }>> {
    const botDir = path.join(this.botsDir, botName);
    
    try {
      await fs.access(botDir);
    } catch {
      throw new Error(`Bot ${botName} not found`);
    }

    const files: Array<{ name: string; path: string; type: 'file' | 'directory'; size?: number }> = [];
    
    const walkDir = async (dir: string, relativePath: string = '') => {
      const items = await fs.readdir(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
        const stats = await fs.stat(fullPath);
        
        if (stats.isDirectory()) {
          files.push({
            name: item,
            path: itemRelativePath,
            type: 'directory'
          });
          await walkDir(fullPath, itemRelativePath);
        } else {
          files.push({
            name: item,
            path: itemRelativePath,
            type: 'file',
            size: stats.size
          });
        }
      }
    };

    await walkDir(botDir);
    return files.sort((a, b) => {
      // Directories first, then files, both alphabetically
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  async readBotFile(botName: string, filePath: string): Promise<{ content: string; isText: boolean; language: string }> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path');
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        throw new Error('Cannot read directory as file');
      }

      // Check if file is too large (limit to 1MB for text files)
      if (stats.size > 1024 * 1024) {
        throw new Error('File too large to edit');
      }

      const content = await fs.readFile(fullPath, 'utf-8');
      const language = this.getFileLanguage(filePath);
      
      return {
        content,
        isText: true,
        language
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('invalid')) {
        throw error;
      }
      throw new Error('Failed to read file');
    }
  }

  async writeBotFile(botName: string, filePath: string, content: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path');
    }

    try {
      // Ensure directory exists
      const dirname = path.dirname(fullPath);
      await fs.mkdir(dirname, { recursive: true });
      
      // Write file
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error('Failed to save file');
    }
  }

  async createBotFile(botName: string, filePath: string, content: string = ''): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path');
    }

    try {
      // Check if file already exists
      try {
        await fs.access(fullPath);
        throw new Error('File already exists');
      } catch (error) {
        // File doesn't exist, continue
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }

      // Ensure directory exists
      const dirname = path.dirname(fullPath);
      await fs.mkdir(dirname, { recursive: true });
      
      // Create file
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      if (error instanceof Error && error.message === 'File already exists') {
        throw error;
      }
      throw new Error('Failed to create file');
    }
  }

  async createBotDirectory(botName: string, dirPath: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, dirPath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid directory path');
    }

    try {
      await fs.mkdir(fullPath, { recursive: true });
    } catch (error) {
      throw new Error('Failed to create directory');
    }
  }

  async deleteBotFile(botName: string, filePath: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    
    // Security check to prevent path traversal
    if (!fullPath.startsWith(botDir)) {
      throw new Error('Invalid file path');
    }

    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        await fs.rm(fullPath, { recursive: true });
      } else {
        await fs.unlink(fullPath);
      }
    } catch (error) {
      throw new Error('Failed to delete file');
    }
  }

  async renameBotFile(botName: string, oldPath: string, newPath: string): Promise<void> {
    const botDir = path.join(this.botsDir, botName);
    const oldFullPath = path.join(botDir, oldPath);
    const newFullPath = path.join(botDir, newPath);
    
    // Security check to prevent path traversal
    if (!oldFullPath.startsWith(botDir) || !newFullPath.startsWith(botDir)) {
      throw new Error('Invalid file path');
    }

    try {
      // Check if target already exists
      try {
        await fs.access(newFullPath);
        throw new Error('Target file already exists');
      } catch (error) {
        // File doesn't exist, continue
        if ((error as any).code !== 'ENOENT') {
          throw error;
        }
      }

      // Ensure target directory exists
      const dirname = path.dirname(newFullPath);
      await fs.mkdir(dirname, { recursive: true });
      
      // Rename file
      await fs.rename(oldFullPath, newFullPath);
    } catch (error) {
      if (error instanceof Error && error.message === 'Target file already exists') {
        throw error;
      }
      throw new Error('Failed to rename file');
    }
  }

  private getFileLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    
    const languageMap: Record<string, string> = {
      '.py': 'python',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.sass': 'sass',
      '.md': 'markdown',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.xml': 'xml',
      '.sh': 'shell',
      '.bat': 'batch',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.java': 'java',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.rs': 'rust',
      '.sql': 'sql',
      '.dockerfile': 'dockerfile',
      '.env': 'properties',
      '.txt': 'plaintext',
      '.log': 'plaintext'
    };

    return languageMap[ext] || 'plaintext';
  }
}

export const fileManager = new FileManager();
