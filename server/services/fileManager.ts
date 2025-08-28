import AdmZip from 'adm-zip';
import fs from 'fs/promises';
import path from 'path';

export class FileManager {
  private readonly botsDir = process.env.RENDER 
    ? path.join('/opt/render/project/src', 'deployed_bots')
    : path.join(process.cwd(), 'deployed_bots');

  async ensureBotsDirectory(): Promise<void> {
    try {
      await fs.access(this.botsDir);
      console.log(`[FileManager] Bots directory exists: ${this.botsDir}`);
    } catch {
      await fs.mkdir(this.botsDir, { recursive: true, mode: 0o755 });
      console.log(`[FileManager] Created bots directory: ${this.botsDir}`);
    }
  }

  async extractZipFile(zipBuffer: Buffer, botName: string): Promise<{ botDir: string; envVars: Record<string, string> }> {
    await this.ensureBotsDirectory();
    
    // Create safe bot name for directory
    const safeBotName = botName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const botDir = path.join(this.botsDir, safeBotName);
    
    console.log(`[FileManager] Starting ZIP extraction for: ${botName}`);
    console.log(`[FileManager] Target directory: ${botDir}`);
    
    // Remove existing directory
    try {
      await fs.rm(botDir, { recursive: true, force: true });
      console.log(`[FileManager] Removed existing directory`);
    } catch (error) {
      // Directory doesn't exist
    }
    
    // Create bot directory with full permissions
    await fs.mkdir(botDir, { recursive: true, mode: 0o755 });
    console.log(`[FileManager] Created bot directory with permissions 755`);
    
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      
      if (entries.length === 0) {
        throw new Error('ZIP file is empty or corrupted');
      }

      console.log(`[FileManager] Found ${entries.length} entries in ZIP file`);
      
      let extractedFileCount = 0;
      
      // Extract files manually for better error handling
      for (const entry of entries) {
        if (!entry.isDirectory) {
          try {
            const entryPath = path.join(botDir, entry.entryName);
            const entryDir = path.dirname(entryPath);
            
            // Ensure directory structure exists
            await fs.mkdir(entryDir, { recursive: true, mode: 0o755 });
            
            // Extract file content
            const content = entry.getData();
            if (content && content.length > 0) {
              await fs.writeFile(entryPath, content, { mode: 0o644 });
              extractedFileCount++;
            }
          } catch (entryError) {
            console.warn(`[FileManager] Failed to extract ${entry.entryName}: ${entryError}`);
          }
        }
      }

      console.log(`[FileManager] Successfully extracted ${extractedFileCount} files`);

      // Handle common GitHub ZIP structure (single root directory)
      await this.handleNestedStructure(botDir);

      // Parse environment variables
      const envVars = await this.parseAllEnvFiles(botDir);
      
      // Set executable permissions on important files
      await this.setExecutablePermissions(botDir);

      // Verify bot structure
      const structureInfo = await this.validateBotStructure(botDir);
      console.log(`[FileManager] Bot type detected: ${structureInfo.botType}`);
      if (structureInfo.issues.length > 0) {
        console.warn(`[FileManager] Structure issues: ${structureInfo.issues.join(', ')}`);
      }

      return { botDir, envVars };
      
    } catch (error) {
      console.error(`[FileManager] ZIP extraction failed: ${error}`);
      
      // Cleanup on failure
      try {
        await fs.rm(botDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`[FileManager] Failed to cleanup after error: ${cleanupError}`);
      }
      
      throw new Error(`ZIP extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleNestedStructure(botDir: string): Promise<void> {
    try {
      const items = await fs.readdir(botDir);
      
      // Check if there's only one item and it's a directory
      if (items.length === 1) {
        const singleItemPath = path.join(botDir, items[0]);
        const stats = await fs.stat(singleItemPath);
        
        if (stats.isDirectory()) {
          console.log(`[FileManager] Flattening nested structure from: ${items[0]}`);
          
          const nestedFiles = await fs.readdir(singleItemPath, { recursive: true });
          
          for (const nestedFile of nestedFiles) {
            const srcPath = path.join(singleItemPath, nestedFile.toString());
            const destPath = path.join(botDir, nestedFile.toString());
            const destDir = path.dirname(destPath);
            
            try {
              const srcStats = await fs.stat(srcPath);
              if (srcStats.isFile()) {
                await fs.mkdir(destDir, { recursive: true, mode: 0o755 });
                await fs.copyFile(srcPath, destPath);
              }
            } catch (copyError) {
              console.warn(`[FileManager] Failed to copy ${nestedFile}: ${copyError}`);
            }
          }
          
          // Remove the original nested directory
          try {
            await fs.rm(singleItemPath, { recursive: true, force: true });
            console.log(`[FileManager] Removed nested directory structure`);
          } catch (rmError) {
            console.warn(`[FileManager] Failed to remove nested directory: ${rmError}`);
          }
        }
      }
    } catch (error) {
      console.warn(`[FileManager] Error handling nested structure: ${error}`);
    }
  }

  private async setExecutablePermissions(botDir: string): Promise<void> {
    try {
      const executablePatterns = [
        /\.py$/,
        /\.js$/,
        /\.sh$/,
        /^main\./,
        /^bot\./,
        /^app\./,
        /^index\./,
        /^server\./,
        /^start\./,
        /^run\./
      ];
      
      const files = await fs.readdir(botDir, { recursive: true });
      let executableCount = 0;
      
      for (const file of files) {
        const filePath = path.join(botDir, file.toString());
        
        try {
          const stats = await fs.stat(filePath);
          
          if (stats.isFile()) {
            const fileName = path.basename(file.toString());
            const shouldBeExecutable = executablePatterns.some(pattern => pattern.test(fileName));
            
            if (shouldBeExecutable) {
              await fs.chmod(filePath, 0o755);
              executableCount++;
            }
          }
        } catch (chmodError) {
          console.warn(`[FileManager] Failed to set permissions for ${file}: ${chmodError}`);
        }
      }
      
      console.log(`[FileManager] Set executable permissions on ${executableCount} files`);
    } catch (error) {
      console.warn(`[FileManager] Error setting executable permissions: ${error}`);
    }
  }

  async deleteBotFiles(botName: string): Promise<void> {
    const safeBotName = botName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
    const botDir = path.join(this.botsDir, safeBotName);
    
    try {
      console.log(`[FileManager] Deleting bot files at: ${botDir}`);
      await fs.rm(botDir, { recursive: true, force: true });
      console.log(`[FileManager] Successfully deleted bot files for: ${botName}`);
    } catch (error) {
      console.error(`[FileManager] Failed to delete bot files: ${error}`);
      throw new Error(`Failed to delete bot files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async parseAllEnvFiles(botDir: string): Promise<Record<string, string>> {
    const envFiles = [
      '.env',
      '.env.local', 
      '.env.production',
      'config.env',
      '.env.example',
      'sample.env'
    ];
    
    let allEnvVars: Record<string, string> = {};
    
    for (const envFile of envFiles) {
      const envPath = path.join(botDir, envFile);
      
      try {
        console.log(`[FileManager] Checking for: ${envFile}`);
        const envContent = await fs.readFile(envPath, 'utf8');
        
        if (envContent.trim().length > 0) {
          const envVars = this.parseEnvContent(envContent, envFile);
          
          console.log(`[FileManager] Found ${Object.keys(envVars).length} variables in ${envFile}`);
          
          // Merge with priority: .env > .env.local > .env.production > others
          const priority = envFile === '.env' ? 3 : envFile === '.env.local' ? 2 : envFile === '.env.production' ? 1 : 0;
          
          if (priority >= 1) {
            allEnvVars = { ...allEnvVars, ...envVars }; // Higher priority files override
          } else {
            allEnvVars = { ...envVars, ...allEnvVars }; // Lower priority files don't override
          }
        }
      } catch (error) {
        // File doesn't exist - that's normal
      }
    }
    
    const totalVars = Object.keys(allEnvVars).length;
    if (totalVars > 0) {
      console.log(`[FileManager] Total environment variables loaded: ${totalVars}`);
      console.log(`[FileManager] Variables: ${Object.keys(allEnvVars).slice(0, 10).join(', ')}${totalVars > 10 ? '...' : ''}`);
    } else {
      console.log(`[FileManager] No environment variables found`);
    }
    
    return allEnvVars;
  }

  parseEnvContent(envContent: string, source: string): Record<string, string> {
    const envVars: Record<string, string> = {};
    
    if (!envContent || typeof envContent !== 'string') {
      console.warn(`[FileManager] Invalid content from ${source}`);
      return envVars;
    }

    const lines = envContent.split('\n');
    let lineNumber = 0;
    
    for (let i = 0; i < lines.length; i++) {
      lineNumber++;
      const line = lines[i];
      const trimmedLine = line.trim();
      
      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('//')) {
        continue;
      }
      
      // Find the first equals sign
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex <= 0) {
        continue; // Invalid format
      }
      
      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();
      
      // Handle quoted values
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      // Handle multiline values (lines ending with \)
      while (value.endsWith('\\') && i + 1 < lines.length) {
        value = value.slice(0, -1); // Remove backslash
        i++; // Move to next line
        lineNumber++;
        const nextLine = lines[i].trim();
        value += '\n' + nextLine;
      }
      
      // Handle variable substitution
      value = this.expandVariables(value, envVars);
      
      if (key && key.length > 0) {
        envVars[key] = value;
      }
    }
    
    console.log(`[FileManager] Parsed ${Object.keys(envVars).length} variables from ${source}`);
    return envVars;
  }

  private expandVariables(value: string, existingVars: Record<string, string>): string {
    // Simple variable expansion for ${VAR} and $VAR patterns
    return value.replace(/\$\{([^}]+)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, unbraced) => {
      const varName = braced || unbraced;
      return existingVars[varName] || process.env[varName] || match;
    });
  }

  mergeEnvVars(zipEnvVars: Record<string, string>, additionalEnvVars: Record<string, string>): Record<string, string> {
    console.log(`[FileManager] Merging environment variables:`);
    console.log(`[FileManager] - From ZIP: ${Object.keys(zipEnvVars).length} variables`);
    console.log(`[FileManager] - Additional: ${Object.keys(additionalEnvVars).length} variables`);
    
    // Additional env vars have highest priority
    const merged = { ...zipEnvVars, ...additionalEnvVars };
    
    const totalMerged = Object.keys(merged).length;
    console.log(`[FileManager] - Final total: ${totalMerged} variables`);
    
    // Log which variables were overridden
    if (Object.keys(additionalEnvVars).length > 0) {
      const overridden = Object.keys(additionalEnvVars).filter(key => key in zipEnvVars);
      if (overridden.length > 0) {
        console.log(`[FileManager] - Overridden by additional file: ${overridden.join(', ')}`);
      }
    }
    
    return merged;
  }

  async validateBotStructure(botDir: string): Promise<{
    isValid: boolean;
    issues: string[];
    botType: 'python' | 'nodejs' | 'unknown';
    mainFile?: string;
  }> {
    const issues: string[] = [];
    let botType: 'python' | 'nodejs' | 'unknown' = 'unknown';
    let mainFile: string | undefined;
    
    try {
      const files = await fs.readdir(botDir, { recursive: true });
      const fileNames = files.map(f => f.toString());
      
      // Check for Python bot
      const pythonFiles = fileNames.filter(f => f.endsWith('.py'));
      const pythonMainFiles = fileNames.filter(f => 
        f === 'main.py' || f === 'bot.py' || f === 'app.py' || f === 'run.py'
      );
      const hasRequirements = fileNames.includes('requirements.txt');
      
      // Check for Node.js bot
      const hasPackageJson = fileNames.includes('package.json');
      const nodeMainFiles = fileNames.filter(f => 
        f === 'index.js' || f === 'server.js' || f === 'app.js' || f === 'main.js'
      );
      
      if (pythonFiles.length > 0 || pythonMainFiles.length > 0) {
        botType = 'python';
        mainFile = pythonMainFiles[0];
        
        if (pythonMainFiles.length === 0) {
          issues.push('No Python main file found (main.py, bot.py, app.py, run.py)');
        }
        
        if (!hasRequirements) {
          issues.push('No requirements.txt found - dependencies may fail');
        }
        
        // Check for common Python bot patterns
        const hasPyrogramFiles = pythonFiles.some(f => f.includes('pyrogram') || f.includes('telegram'));
        const hasFlaskFiles = pythonFiles.some(f => f.includes('flask') || f.includes('app'));
        
        if (hasPyrogramFiles) {
          console.log(`[FileManager] Detected Pyrogram/Telegram bot`);
        }
        if (hasFlaskFiles) {
          console.log(`[FileManager] Detected Flask web application`);
        }
        
      } else if (hasPackageJson || nodeMainFiles.length > 0) {
        botType = 'nodejs';
        mainFile = nodeMainFiles[0];
        
        if (!hasPackageJson) {
          issues.push('No package.json found');
        }
        
        if (nodeMainFiles.length === 0) {
          issues.push('No Node.js main file found (index.js, server.js, app.js, main.js)');
        }
        
      } else {
        issues.push('Unable to determine bot type - no recognizable main file found');
      }
      
      // Check for environment configuration
      const hasEnvFile = fileNames.some(f => 
        f.startsWith('.env') || f === 'config.env' || f === 'sample.env'
      );
      
      if (!hasEnvFile) {
        issues.push('No environment file found - bot may need manual configuration');
      }
      
      // Check for common required files
      if (botType === 'python') {
        const hasConfigFile = fileNames.some(f => f.includes('config.py') || f.includes('settings.py'));
        if (!hasConfigFile) {
          console.log(`[FileManager] No config file detected - may use environment variables`);
        }
      }
      
      const isValid = issues.length === 0;
      console.log(`[FileManager] Bot validation: ${botType} bot, ${isValid ? 'valid' : 'has issues'}`);
      
      return {
        isValid,
        issues,
        botType,
        mainFile
      };
      
    } catch (error) {
      console.error(`[FileManager] Validation error: ${error}`);
      return {
        isValid: false,
        issues: [`Structure validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
        botType: 'unknown'
      };
    }
  }

  // Legacy method for compatibility
  async parseEnvFile(botDir: string): Promise<Record<string, string>> {
    return this.parseAllEnvFiles(botDir);
  }
}

export const fileManager = new FileManager();
