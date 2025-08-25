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
