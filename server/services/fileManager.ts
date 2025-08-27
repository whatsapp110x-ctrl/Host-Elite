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
    
    // Sanitize bot name for directory
    const safeBotName = botName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const botDir = path.join(this.botsDir, safeBotName);
    
    // Remove existing directory if it exists
    try {
      await fs.rm(botDir, { recursive: true, force: true });
      console.log(`[FileManager] Removed existing bot directory: ${botDir}`);
    } catch (error) {
      // Directory doesn't exist, continue
    }
    
    // Create bot directory with proper permissions
    await fs.mkdir(botDir, { recursive: true, mode: 0o755 });
    console.log(`[FileManager] Created bot directory: ${botDir}`);
    
    try {
      // Extract ZIP file with error handling
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      
      if (entries.length === 0) {
        throw new Error('ZIP file is empty');
      }

      console.log(`[FileManager] Extracting ${entries.length} files from ZIP`);
      
      // Extract with manual handling for better error control
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const entryPath = path.join(botDir, entry.entryName);
          const entryDir = path.dirname(entryPath);
          
          // Ensure directory exists
          await fs.mkdir(entryDir, { recursive: true, mode: 0o755 });
          
          // Write file
          const content = entry.getData();
          await fs.writeFile(entryPath, content, { mode: 0o644 });
        }
      }

      console.log(`[FileManager] Successfully extracted ZIP to: ${botDir}`);

      // Handle nested directory structure (common with GitHub downloads)
      await this.flattenIfNeeded(botDir);

      // Parse environment variables from .env files
      const envVars = await this.parseEnvFile(botDir);
      
      // Set execute permissions on common executable files
      await this.setExecutePermissions(botDir);

      return { botDir, envVars };
      
    } catch (error) {
      console.error(`[FileManager] Failed to extract ZIP for ${botName}:`, error);
      
      // Clean up failed extraction
      try {
        await fs.rm(botDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`[FileManager] Failed to clean up after extraction error:`, cleanupError);
      }
      
      throw new Error(`ZIP extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async flattenIfNeeded(botDir: string): Promise<void> {
    try {
      const extractedItems = await fs.readdir(botDir);
      
      // If there's only one item and it's a directory, move its contents up
      if (extractedItems.length === 1) {
        const singleItem = extractedItems[0];
        const singleItemPath = path.join(botDir, singleItem);
        const stats = await fs.stat(singleItemPath);
        
        if (stats.isDirectory()) {
          console.log(`[FileManager] Flattening nested directory structure`);
          const subDirFiles = await fs.readdir(singleItemPath);
          
          // Move all files from subdirectory to parent
          for (const file of subDirFiles) {
            const sourcePath = path.join(singleItemPath, file);
            const destPath = path.join(botDir, file);
            
            try {
              await fs.rename(sourcePath, destPath);
            } catch (renameError) {
              console.warn(`[FileManager] Failed to move ${file}:`, renameError);
            }
          }
          
          // Remove the now-empty subdirectory
          try {
            await fs.rmdir(singleItemPath);
          } catch (rmdirError) {
            console.warn(`[FileManager] Failed to remove empty directory:`, rmdirError);
          }
        }
      }
    } catch (error) {
      console.warn(`[FileManager] Error during directory flattening:`, error);
    }
  }

  private async setExecutePermissions(botDir: string): Promise<void> {
    try {
      const executableExtensions = ['.py', '.js', '.sh'];
      const executableFiles = ['main.py', 'bot.py', 'app.py', 'index.js', 'server.js', 'start.sh'];
      
      const files = await fs.readdir(botDir, { recursive: true });
      
      for (const file of files) {
        const filePath = path.join(botDir, file.toString());
        
        try {
          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            const shouldBeExecutable = executableFiles.includes(path.basename(file.toString())) ||
                                     executableExtensions.some(ext => file.toString().endsWith(ext));
            
            if (shouldBeExecutable) {
              await fs.chmod(filePath, 0o755);
              console.log(`[FileManager] Set execute permission for: ${file}`);
            }
          }
        } catch (chmodError) {
          console.warn(`[FileManager] Failed to set permissions for ${file}:`, chmodError);
        }
      }
    } catch (error) {
      console.warn(`[FileManager] Error setting execute permissions:`, error);
    }
  }

  async deleteBotFiles(botName: string): Promise<void> {
    const safeBotName = botName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const botDir = path.join(this.botsDir, safeBotName);
    
    try {
      console.log(`[FileManager] Deleting bot files: ${botDir}`);
      await fs.rm(botDir, { recursive: true, force: true });
      console.log(`[FileManager] Successfully deleted bot files for: ${botName}`);
    } catch (error) {
      console.error(`[FileManager] Failed to delete bot files for ${botName}:`, error);
      throw new Error(`Failed to delete bot files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async parseEnvFile(botDir: string): Promise<Record<string, string>> {
    const envFiles = ['.env', 'config.env', '.env.local', '.env.production'];
    let allEnvVars: Record<string, string> = {};
    
    for (const envFile of envFiles) {
      const envPath = path.join(botDir, envFile);
      
      try {
        console.log(`[FileManager] Looking for environment file: ${envFile}`);
        const envContent = await fs.readFile(envPath, 'utf8');
        const envVars = this.parseEnvContent(envContent, `ZIP ${envFile} file`);
        
        if (Object.keys(envVars).length > 0) {
          console.log(`[FileManager] Found ${Object.keys(envVars).length} variables in ${envFile}`);
          
          // Merge variables (.env has highest priority)
          if (envFile === '.env') {
            allEnvVars = { ...allEnvVars, ...envVars };
          } else {
            allEnvVars = { ...envVars, ...allEnvVars };
          }
        }
      } catch (error) {
        // File doesn't exist or can't be read - that's normal
        console.log(`[FileManager] No ${envFile} file found or error reading it`);
      }
    }
    
    if (Object.keys(allEnvVars).length > 0) {
      console.log(`[FileManager] Total environment variables found: ${Object.keys(allEnvVars).length}`);
      console.log(`[FileManager] Environment variables: ${Object.keys(allEnvVars).join(', ')}`);
    } else {
      console.log(`[FileManager] No environment variables found in bot files`);
    }
    
    return allEnvVars;
  }

  parseEnvContent(envContent: string, source: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    if (!envContent || typeof envContent !== 'string') {
      console.warn(`[FileManager] Invalid environment content from ${source}`);
      return envVars;
    }

    // Parse .env file line by line
    const lines = envContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
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
        
        // Handle multiline values (values ending with \)
        while (value.endsWith('\\') && i + 1 < lines.length) {
          value = value.slice(0, -1); // Remove the backslash
          i++; // Move to next line
          const nextLine = lines[i].trim();
          value += nextLine;
        }
        
        if (key) {
          envVars[key] = value;
          console.log(`[FileManager] Parsed env var from ${source}: ${key}=${value.length > 20 ? value.substring(0, 20) + '...' : value}`);
        }
      }
    }
    
    console.log(`[FileManager] Parsed ${Object.keys(envVars).length} environment variables from ${source}`);
    return envVars;
  }

  mergeEnvVars(zipEnvVars: Record<string, string>, additionalEnvVars: Record<string, string>): Record<string, string> {
    console.log(`[FileManager] Merging environment variables:`);
    console.log(`[FileManager] - ZIP env vars: ${Object.keys(zipEnvVars).length}`);
    console.log(`[FileManager] - Additional env vars: ${Object.keys(additionalEnvVars).length}`);
    
    // Additional env vars override ZIP env vars
    const merged = { ...zipEnvVars, ...additionalEnvVars };
    
    console.log(`[FileManager] - Final merged env vars: ${Object.keys(merged).length}`);
    
    if (Object.keys(additionalEnvVars).length > 0) {
      const overridden = Object.keys(additionalEnvVars).filter(key => key in zipEnvVars);
      if (overridden.length > 0) {
        console.log(`[FileManager] - Additional .env file overrode: ${overridden.join(', ')}`);
      }
    }
    
    return merged;
  }

  async validateBotStructure(botDir: string): Promise<{isValid: boolean, issues: string[], botType: 'python' | 'nodejs' | 'unknown'}> {
    const issues: string[] = [];
    let botType: 'python' | 'nodejs' | 'unknown' = 'unknown';
    
    try {
      const files = await fs.readdir(botDir);
      
      // Check for Python bot structure
      const pythonFiles = files.filter(f => f.endsWith('.py'));
      const hasMainPy = files.includes('main.py') || files.includes('bot.py') || files.includes('app.py');
      const hasRequirements = files.includes('requirements.txt');
      
      // Check for Node.js bot structure  
      const hasPackageJson = files.includes('package.json');
      const hasIndexJs = files.includes('index.js') || files.includes('server.js') || files.includes('app.js');
      
      if (pythonFiles.length > 0 || hasMainPy) {
        botType = 'python';
        
        if (!hasMainPy) {
          issues.push('No main Python file found (main.py, bot.py, or app.py)');
        }
        
        if (!hasRequirements) {
          issues.push('No requirements.txt found - may cause dependency issues');
        }
      } else if (hasPackageJson || hasIndexJs) {
        botType = 'nodejs';
        
        if (!hasPackageJson) {
          issues.push('No package.json found');
        }
        
        if (!hasIndexJs) {
          issues.push('No main JavaScript file found (index.js, server.js, or app.js)');
        }
      } else {
        issues.push('Unable to determine bot type - no recognizable entry point found');
      }
      
      // Check for environment files
      const hasEnvFile = files.some(f => f.startsWith('.env') || f === 'config.env');
      if (!hasEnvFile) {
        issues.push('No environment file found - bot may need configuration');
      }
      
      console.log(`[FileManager] Bot validation complete: ${botType}, ${issues.length} issues found`);
      
      return {
        isValid: issues.length === 0,
        issues,
        botType
      };
      
    } catch (error) {
      console.error(`[FileManager] Error validating bot structure:`, error);
      return {
        isValid: false,
        issues: [`Failed to validate bot structure: ${error instanceof Error ? error.message : 'Unknown error'}`],
        botType: 'unknown'
      };
    }
  }
}

export const fileManager = new FileManager();
