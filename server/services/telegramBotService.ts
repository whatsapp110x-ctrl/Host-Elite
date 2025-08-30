import TelegramBot from 'node-telegram-bot-api';
import { storage } from '../storage';
import { botManager } from './botManager';
import { fileManager } from './fileManager';
import type { Bot } from '@shared/schema';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';

interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

interface BotUploadSession {
  userId: number;
  zipBuffer?: Buffer;
  codeFiles?: Array<{ name: string; content: string; }>;
  tempBotData?: Partial<Bot>;
  awaitingCommand?: boolean;
  awaitingBotName?: boolean;
  lastMessageId?: number;
  // File editing session data
  editingBot?: string;
  currentFilePath?: string;
  awaitingFileContent?: boolean;
  currentFilesList?: any[];
  currentDirectory?: string;
}

export class TelegramBotService {
  private bot: TelegramBot;
  private uploadSessions = new Map<number, BotUploadSession>();
  
  // Removed stickers to avoid errors

  constructor() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
    }

    this.bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
    this.setupEventHandlers();
    this.setupCommands();
    console.log('🤖 Telegram Bot Service initialized and ready!');
  }

  private setupEventHandlers() {
    this.bot.on('message', this.handleMessage.bind(this));
    this.bot.on('document', this.handleDocument.bind(this));
    this.bot.on('callback_query', this.handleCallbackQuery.bind(this));
    this.bot.on('polling_error', (error) => {
      console.error('Telegram polling error:', error);
    });
  }

  private setupCommands() {
    // Set bot commands for better UX
    this.bot.setMyCommands([
      { command: 'start', description: 'Welcome message and bot introduction' },
      { command: 'upload', description: 'Upload ZIP file or raw code (.py, .js)' },
      { command: 'cmd', description: 'Set custom run command for uploaded bot' },
      { command: 'deploy', description: 'Deploy uploaded code as bot' },
      { command: 'startbot', description: 'Start a hosted bot' },
      { command: 'stopbot', description: 'Stop a running bot' },
      { command: 'restartbot', description: 'Restart a bot' },
      { command: 'logs', description: 'Show last 20 lines of bot logs' },
      { command: 'status', description: 'Show bot status and uptime' },
      { command: 'env', description: 'Upload .env file for environment variables' },
      { command: 'edit', description: 'Edit bot source code directly' },
      { command: 'files', description: 'Browse bot files and folders' },
      { command: 'viewfile', description: 'View contents of a specific file' },
      { command: 'savefile', description: 'Save edited content to a file' },
      { command: 'listbots', description: 'Show all your hosted bots' },
      { command: 'deletebot', description: 'Remove bot completely' },
      { command: 'help', description: 'Show all available commands' }
    ]);
  }

  // Removed sticker functionality

  private async sendMessage(chatId: number, message: string, options?: any) {
    try {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      });
    } catch (error) {
      console.error('Error sending message:', error);
      // Fallback to basic message
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...options
      });
    }
  }

  private async sendRandomSticker(chatId: number) {
    // Collection of fun animated emojis that create visual feedback
    const animations = ['🎉', '🚀', '⭐', '🔥', '💫', '✨', '🌟', '⚡', '💯', '🎊', '🌈'];

    try {
      console.log('Sending random animation...');
      const randomAnimation = animations[Math.floor(Math.random() * animations.length)];
      console.log('Selected animation:', randomAnimation);
      
      const animationMessage = await this.bot.sendMessage(chatId, randomAnimation);
      console.log('Animation sent successfully, message ID:', animationMessage.message_id);
      
      // Auto-delete the animation after 3 seconds
      setTimeout(async () => {
        try {
          console.log('Auto-deleting animation...');
          await this.bot.deleteMessage(chatId, animationMessage.message_id);
          console.log('Animation deleted successfully');
        } catch (error) {
          // Silently handle animation deletion errors (message may already be deleted)
          console.log('Could not delete animation (this is normal):', (error as any)?.message || 'unknown error');
        }
      }, 3000);
      
    } catch (error) {
      console.log('Animation send failed:', error);
    }
  }

  private async handleMessage(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const text = msg.text;
    
    if (!userId || !text) return;

    // Handle different command cases
    if (text.startsWith('/')) {
      await this.handleCommand(chatId, userId, text, msg.from!);
    } else {
      // Handle non-command messages during upload sessions
      await this.handleNonCommandMessage(chatId, userId, text);
    }
  }

  private async handleCommand(chatId: number, userId: number, command: string, user: TelegramUser) {
    const [cmd, ...args] = command.split(' ');
    const botName = args[0];

    try {
      console.log('Command received:', cmd);
      // Send random animated sticker after any command (except /help)
      if (cmd !== '/help') {
        console.log('About to send random sticker for command:', cmd);
        await this.sendRandomSticker(chatId);
      }

      switch (cmd) {
        case '/start':
          await this.handleStartCommand(chatId, user);
          break;

        case '/upload':
          await this.handleUploadCommand(chatId, userId);
          break;

        case '/cmd':
          await this.handleCmdCommandWithButtons(chatId, userId, args.join(' '));
          break;

        case '/deploy':
          await this.handleDeployCommandWithButtons(chatId, userId, botName);
          break;

        case '/startbot':
          await this.handleStartBotCommandWithButtons(chatId, userId, botName);
          break;

        case '/stopbot':
          await this.handleStopBotCommandWithButtons(chatId, userId, botName);
          break;

        case '/restartbot':
          await this.handleRestartBotCommandWithButtons(chatId, userId, botName);
          break;

        case '/logs':
          await this.handleLogsCommandWithButtons(chatId, userId, botName);
          break;

        case '/status':
          await this.handleStatusCommandWithButtons(chatId, userId, botName);
          break;

        case '/env':
          await this.handleEnvCommandWithButtons(chatId, userId);
          break;

        case '/edit':
          await this.handleEditCommandWithButtons(chatId, userId, botName);
          break;

        case '/files':
          await this.handleFilesCommandWithButtons(chatId, userId, botName);
          break;

        case '/viewfile':
          await this.handleViewFileCommand(chatId, userId, args.join(' '));
          break;

        case '/savefile':
          await this.handleSaveFileCommand(chatId, userId, args.join(' '));
          break;

        case '/listbots':
          await this.handleListBotsCommand(chatId, userId);
          break;

        case '/deletebot':
          await this.handleDeleteBotCommandWithButtons(chatId, userId, botName);
          break;

        case '/help':
          await this.handleHelpCommand(chatId);
          break;

        default:
          await this.sendMessage(chatId, 
            `❌ Unknown command: <code>${cmd}</code>\n\nType /help to see all available commands.`
          );
      }
    } catch (error) {
      console.error('Command error:', error);
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error occurred'}`
      );
    }
  }

  private async handleStartCommand(chatId: number, user: TelegramUser) {
    const publicUrl = this.getPublicUrl();
    
    // Debug logging to track URL detection across all platforms
    const platformInfo = this.detectHostingPlatform();
    console.log('🔍 Universal URL Detection Debug:', {
      platform: platformInfo.platform,
      source: platformInfo.source,
      detectedUrl: publicUrl,
      environmentVars: platformInfo.vars
    });
    
    const welcomeMessage = `
🎉 <b>Welcome to Host-Elite Bot Platform!</b>

👋 Hello <b>${user.first_name}</b>! I'm your personal bot hosting assistant.

🌐 <b>📱 DASHBOARD ACCESS 📱</b>
🔗 <code>${publicUrl}</code>
☁️ <b>Hosted on:</b> ${platformInfo.platform}
🌍 <b>Available everywhere:</b> Works on any device!

🚀 <b>What I can do for you:</b>
• 🤖 Host your Python and Node.js bots 24/7
• 🔄 Auto-detect entry files and install dependencies  
• 📊 Real-time log monitoring and management
• ✏️ Direct code editing capabilities
• 🌐 Access from any device via dashboard link above

📝 <b>Quick Start Guide:</b>
1️⃣ Use /upload to send your bot files
2️⃣ Use /deploy to activate your bot
3️⃣ Use /startbot to run it live!
4️⃣ Visit dashboard: <code>${publicUrl}</code>

🎯 <b>Pro Tips:</b>
• Bookmark the dashboard URL for quick access
• Works seamlessly on Replit, Heroku, Render, Koyeb, DigitalOcean & more
• Your bots stay online 24/7 regardless of hosting platform

Type /help to see all commands! 🛠️
    `;

    await this.sendMessage(chatId, welcomeMessage.trim());
  }

  private async handleUploadCommand(chatId: number, userId: number) {
    // Initialize upload session
    this.uploadSessions.set(userId, { userId });

    const uploadMessage = `
📤 <b>Upload Your Bot Files</b>

🎯 <b>What you can upload:</b>
• ZIP files containing your bot project
• Raw Python files (.py)
• Raw JavaScript/Node.js files (.js)
• Environment files (.env, config.env, env.txt)

🔍 <b>Auto-Detection Features:</b>
• Entry files: main.py, bot.py, index.js, app.js
• Dependencies: requirements.txt, package.json
• Docker: Dockerfile for containerized deployment
• Environment: .env files for configuration

📎 <b>Just send your file(s) now!</b>
    `;

    await this.sendMessage(chatId, uploadMessage.trim());
  }

  private async handleDocument(msg: TelegramBot.Message) {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;
    const document = msg.document;

    if (!userId || !document) return;

    const session = this.uploadSessions.get(userId);
    if (!session) {
      await this.sendMessage(chatId, 
        `❌ <b>No active upload session!</b>\n\nUse /upload first to start uploading files.`
      );
      return;
    }

    try {
      await this.sendMessage(chatId, 
        `🔄 <b>Processing file...</b>\n\nFile: <code>${document.file_name}</code>\nSize: ${(document.file_size || 0 / 1024).toFixed(2)} KB`
      );

      // Get file from Telegram with timeout
      const fileLink = await this.bot.getFileLink(document.file_id);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      try {
        const response = await fetch(fileLink, { 
          signal: controller.signal,
          headers: {
            'User-Agent': 'Host-Elite-Bot/1.0'
          }
        });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
        }
        
        const fileBuffer = Buffer.from(await response.arrayBuffer());
        
        // Enhanced file size validation with specific limits
        let maxSize: number;
        const isZipFile = document.file_name?.endsWith('.zip');
        const isTextFile = document.file_name?.match(/\.(py|js|env|txt|json|yaml|yml|md|cfg|ini|toml)$/);
        
        if (isZipFile) {
          maxSize = 100 * 1024 * 1024; // 100MB for ZIP files
        } else if (isTextFile) {
          maxSize = 5 * 1024 * 1024; // 5MB for text files
        } else {
          maxSize = 1024 * 1024; // 1MB for other files
        }
        
        if (fileBuffer.length > maxSize) {
          await this.sendMessage(chatId, 
            `❌ <b>File too large!</b>\n\n📊 <b>File:</b> ${document.file_name}\n📏 <b>Size:</b> ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB\n🚫 <b>Limit:</b> ${(maxSize / 1024 / 1024)}MB${isZipFile ? ' (ZIP)' : isTextFile ? ' (Text)' : ' (Other)'}\n\n💡 <b>Tip:</b> Try compressing your files or removing unnecessary files.`
          );
          return;
        }
        
        // Additional security validation for file names
        const fileName = document.file_name || 'unknown';
        if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\\\')) {
          await this.sendMessage(chatId, 
            `❌ <b>Invalid file name!</b>\n\nFile name contains dangerous characters: <code>${fileName}</code>`
          );
          return;
        }

      if (document.file_name?.endsWith('.zip')) {
        // Handle ZIP file
        session.zipBuffer = fileBuffer;
        
        // Auto-analyze ZIP content
        const analysis = await this.analyzeZipContent(fileBuffer);
        
        const analysisMessage = `
✅ <b>ZIP File Uploaded Successfully!</b>

📊 <b>Auto-Analysis Results:</b>
${analysis.language ? `• Language: <b>${analysis.language}</b>` : ''}
${analysis.entryFile ? `• Entry File: <code>${analysis.entryFile}</code>` : ''}
${analysis.hasRequirements ? '• ✅ Dependencies file found' : '• ⚠️ No dependencies file found'}
${analysis.hasDockerfile ? '• 🐳 Dockerfile detected' : ''}
${analysis.hasEnvFile ? '• ⚙️ Environment file found' : ''}

🎯 <b>Auto-Detected Command:</b>
<code>${analysis.suggestedCommand || 'Command will be auto-detected'}</code>
        `;

        // Store analysis results
        session.tempBotData = {
          language: analysis.language,
          runCommand: analysis.suggestedCommand || 'auto-detect',
          deploymentSource: 'zip',
          autoDetectedEntryFile: analysis.entryFile,
          hasDockerfile: analysis.hasDockerfile,
          hasRequirements: analysis.hasRequirements
        };

        await this.sendMessage(chatId, analysisMessage.trim());

        // Immediately prompt for custom command after ZIP upload
        const cmdMessage = `⚙️ <b>Set Run Command</b>\n\nChoose how to run your bot:`;
        
        const cmdKeyboard = {
          inline_keyboard: [] as Array<Array<any>>
        };
        
        // Set session timeout to clean up after 10 minutes of inactivity
        setTimeout(() => {
          const currentSession = this.uploadSessions.get(userId);
          if (currentSession === session) {
            this.cleanupUserSession(userId);
            this.sendMessage(chatId, '⌛ <b>Session expired</b>\n\nYour upload session has timed out. Please start over with /upload.');
          }
        }, 600000); // 10 minutes

        // Only add auto-detected button if command is short enough for Telegram callback data
        const autoCmd = analysis.suggestedCommand || 'auto-detect';
        const fullCallbackData = `use_auto_cmd:${autoCmd}`;
        console.log(`Callback data length: ${fullCallbackData.length}, content: ${fullCallbackData}`);
        if (fullCallbackData.length <= 64) { // Telegram's exact limit
          cmdKeyboard.inline_keyboard.push([{ text: '✅ Use Auto-Detected', callback_data: fullCallbackData }]);
          console.log('Added auto-detected button');
        } else {
          console.log('Skipped auto-detected button due to length');
          // Show truncated version instead
          const truncatedCmd = autoCmd.length > 40 ? autoCmd.substring(0, 37) + '...' : autoCmd;
          cmdKeyboard.inline_keyboard.push([{ text: `✨ ${truncatedCmd}`, callback_data: 'use_auto_truncated' }]);
        }

        // Add standard command options
        cmdKeyboard.inline_keyboard.push(
          [{ text: '🐍 python main.py', callback_data: 'set_cmd:python main.py' }],
          [{ text: '🐍 python bot.py', callback_data: 'set_cmd:python bot.py' }],
          [{ text: '🟨 node index.js', callback_data: 'set_cmd:node index.js' }],
          [{ text: '🟨 node app.js', callback_data: 'set_cmd:node app.js' }],
          [{ text: '📦 npm start', callback_data: 'set_cmd:npm start' }],
          [{ text: '✏️ Type Custom Command', callback_data: 'custom_cmd_input' }]
        );

        await this.bot.sendMessage(chatId, cmdMessage, {
          parse_mode: 'HTML',
          reply_markup: cmdKeyboard
        });

      } else if (document.file_name?.match(/\.(py|js|env|txt)$/)) {
        // Handle raw code files or env files
        const fileContent = fileBuffer.toString('utf-8');
        
        // Validate file size for non-zip files (max 1MB)
        if (fileBuffer.length > 1024 * 1024) {
          await this.sendMessage(chatId, 
            `❌ <b>File too large!</b>\n\nMaximum file size: 1MB\nReceived: ${(fileBuffer.length / 1024 / 1024).toFixed(2)}MB`
          );
          return;
        }
        
        if (!session.codeFiles) session.codeFiles = [];
        session.codeFiles.push({
          name: document.file_name,
          content: fileContent
        });

        const fileMessage = `
📄 <b>File Added Successfully!</b>

• File: <code>${document.file_name}</code>
• Size: ${fileBuffer.length} bytes
• Type: ${document.file_name.endsWith('.py') ? 'Python' : document.file_name.endsWith('.js') ? 'JavaScript' : 'Configuration'}

📎 Upload more files or use <b>/deploy &lt;bot_name&gt;</b> when ready!
        `;

        await this.sendMessage(chatId, fileMessage.trim());
      } else {
        await this.sendMessage(chatId, 
          `❌ <b>Unsupported file type!</b>\n\nSupported: ZIP, .py, .js, .env, .txt\nReceived: <code>${document.file_name}</code>`
        );
      }

      } catch (fetchError) {
        clearTimeout(timeoutId);
        if ((fetchError as any)?.name === 'AbortError') {
          await this.sendMessage(chatId, '❌ <b>Download timeout!</b>\n\nFile download took too long. Please try with a smaller file.');
          return;
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('Document handling error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.sendMessage(chatId, 
        `❌ <b>Upload failed:</b> ${errorMessage}`
      );
    }
  }

  private async analyzeZipContent(zipBuffer: Buffer): Promise<{
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
      const AdmZip = (await import('adm-zip')).default;
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      let language: 'python' | 'nodejs' | undefined;
      let entryFile: string | undefined;
      let hasRequirements = false;
      let hasDockerfile = false;
      let hasProcfile = false;
      let hasEnvFile = false;
      let procfileCommand: string | undefined;
      let dockerfileCommand: string | undefined;

      // Check for specific files
      for (const entry of entries) {
        const fileName = entry.entryName.toLowerCase();
        
        // Check for entry files
        if (['main.py', 'bot.py', 'app.py'].includes(fileName)) {
          language = 'python';
          entryFile = entry.entryName;
        } else if (['index.js', 'app.js', 'bot.js', 'main.js'].includes(fileName)) {
          language = 'nodejs';
          entryFile = entry.entryName;
        }

        // Check for dependency files
        if (fileName === 'requirements.txt') hasRequirements = true;
        if (fileName === 'package.json') {
          language = 'nodejs';
          hasRequirements = true;
        }

        // Check for Docker, Procfile, and env files
        if (fileName === 'dockerfile') hasDockerfile = true;
        if (fileName === 'procfile') hasProcfile = true;
        if (['.env', 'config.env', 'env.txt'].includes(fileName)) hasEnvFile = true;
      }

      // Auto-detect language and entry if not found
      if (!language || !entryFile) {
        for (const entry of entries) {
          const fileName = entry.entryName;
          if (fileName.endsWith('.py') && !language) {
            language = 'python';
            entryFile = entryFile || fileName;
          } else if (fileName.endsWith('.js') && !language) {
            language = 'nodejs';
            entryFile = entryFile || fileName;
          }
        }
      }

      // Try to parse Procfile for web command
      if (hasProcfile) {
        try {
          const procfileEntry = entries.find(entry => entry.entryName.toLowerCase() === 'procfile');
          if (procfileEntry) {
            const procfileContent = procfileEntry.getData().toString('utf8');
            const lines = procfileContent.split('\n');
            const webLine = lines.find(line => line.trim().startsWith('web:'));
            if (webLine) {
              procfileCommand = webLine.split('web:')[1]?.trim();
            }
          }
        } catch (error) {
          console.error('Error parsing Procfile:', error);
        }
      }

      // Try to parse Dockerfile for CMD instruction
      if (hasDockerfile) {
        try {
          const dockerfileEntry = entries.find(entry => entry.entryName.toLowerCase() === 'dockerfile');
          if (dockerfileEntry) {
            const dockerfileContent = dockerfileEntry.getData().toString('utf8');
            const lines = dockerfileContent.split('\n');
            const cmdLine = lines.reverse().find(line => line.trim().startsWith('CMD'));
            if (cmdLine) {
              dockerfileCommand = cmdLine.replace(/^CMD\s*\[?/, '').replace(/\]?$/, '').replace(/"/g, '').trim();
            }
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
        suggestedCommand = 'docker run -p 80:80 .';
      } else if (language === 'python' && entryFile) {
        suggestedCommand = `python3 ${entryFile}`;
      } else if (language === 'nodejs' && entryFile) {
        suggestedCommand = `node ${entryFile}`;
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
      console.error('ZIP analysis error:', error);
      return {
        hasRequirements: false,
        hasDockerfile: false,
        hasProcfile: false,
        hasEnvFile: false
      };
    }
  }


  private async handleCmdCommandWithButtons(chatId: number, userId: number, customCommand?: string) {
    const session = this.uploadSessions.get(userId);
    if (!session || (!session.zipBuffer && !session.codeFiles)) {
      const keyboard = {
        inline_keyboard: [
          [{ text: '📤 Upload Files First', callback_data: 'upload_zip' }],
          [{ text: '📚 View Guide', callback_data: 'show_guide' }]
        ]
      };

      await this.sendMessage(chatId, 
        `❌ <b>No files uploaded!</b>\n\nUse /upload first to upload your bot files.`,
        { reply_markup: keyboard }
      );
      return;
    }

    if (!customCommand?.trim()) {
      const message = `⚙️ <b>Set Run Command</b>\n\nChoose a common run command or send a custom one:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '🐍 python main.py', callback_data: 'set_cmd:python main.py' }],
          [{ text: '🐍 python bot.py', callback_data: 'set_cmd:python bot.py' }],
          [{ text: '🟨 node index.js', callback_data: 'set_cmd:node index.js' }],
          [{ text: '🟨 node app.js', callback_data: 'set_cmd:node app.js' }],
          [{ text: '📦 npm start', callback_data: 'set_cmd:npm start' }],
          [{ text: '✏️ Type Custom Command', callback_data: 'custom_cmd_input' }]
        ]
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });
      return;
    }

    // Update session with custom command
    if (!session.tempBotData) session.tempBotData = {};
    session.tempBotData.runCommand = customCommand;

    const keyboard = {
      inline_keyboard: [
        [{ text: '🚀 Deploy Bot Now', callback_data: 'deploy_with_cmd' }],
        [{ text: '⚙️ Change Command', callback_data: 'custom_cmd_input' }]
      ]
    };

    await this.sendMessage(chatId, 
      `✅ <b>Command Set Successfully!</b>\n\n🎯 <b>Your run command:</b>\n<code>${customCommand}</code>`,
      { reply_markup: keyboard }
    );
  }

  private async handleDeployCommandWithButtons(chatId: number, userId: number, botName?: string) {
    const session = this.uploadSessions.get(userId);
    if (!session || (!session.zipBuffer && !session.codeFiles)) {
      const keyboard = {
        inline_keyboard: [
          [{ text: '📤 Upload Files First', callback_data: 'upload_zip' }],
          [{ text: '📚 View Guide', callback_data: 'show_guide' }]
        ]
      };

      await this.sendMessage(chatId, 
        `❌ <b>No files to deploy!</b>\n\nUse /upload first to upload your bot files.`,
        { reply_markup: keyboard }
      );
      return;
    }

    if (!botName) {
      const message = `🚀 <b>Deploy Your Bot</b>\n\nChoose deployment options:`;
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '🎯 Quick Deploy (Auto-name)', callback_data: 'quick_deploy' }],
          [{ text: '✏️ Custom Bot Name', callback_data: 'custom_deploy_name' }],
          [{ text: '⚙️ Set Command First', callback_data: 'custom_cmd_input' }]
        ]
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });
      return;
    }

    // Deploy with specific bot name
    await this.handleDeployCommand(chatId, userId, botName);
  }

  private async handleCmdCommand(chatId: number, userId: number, customCommand: string) {
    await this.handleCmdCommandWithButtons(chatId, userId, customCommand);
  }

  private async handleDeployCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /deploy my_awesome_bot\n\n📝 <b>Rules:</b>\n• Only letters, numbers, underscore, hyphen\n• No spaces or special characters`
      );
      return;
    }

    const session = this.uploadSessions.get(userId);
    if (!session || (!session.zipBuffer && !session.codeFiles)) {
      await this.sendMessage(chatId, 
        `❌ <b>No files to deploy!</b>\n\nUse /upload first to upload your bot files.`
      );
      return;
    }

    // Check if custom command has been set
    if (!session.tempBotData?.runCommand || session.tempBotData.runCommand === 'auto-detect') {
      const cmdMessage = `⚙️ <b>Custom Command Required!</b>\n\nPlease set a run command first:`;
      
      const cmdKeyboard = {
        inline_keyboard: [
          [{ text: '🐍 python main.py', callback_data: 'set_cmd:python main.py' }],
          [{ text: '🐍 python bot.py', callback_data: 'set_cmd:python bot.py' }],
          [{ text: '🟨 node index.js', callback_data: 'set_cmd:node index.js' }],
          [{ text: '🟨 node app.js', callback_data: 'set_cmd:node app.js' }],
          [{ text: '📦 npm start', callback_data: 'set_cmd:npm start' }],
          [{ text: '✏️ Type Custom Command', callback_data: 'custom_cmd_input' }]
        ]
      };

      await this.bot.sendMessage(chatId, cmdMessage, {
        parse_mode: 'HTML',
        reply_markup: cmdKeyboard
      });
      return;
    }

    try {
      await this.sendMessage(chatId, 
        `🚀 <b>Starting Deployment...</b>\n\nBot: <code>${botName}</code>\n⏳ Please wait while I set up everything!`
      );

      // Check if bot name already exists
      const existingBot = await storage.getBotByName(botName);
      if (existingBot && existingBot.telegramUserId !== userId.toString()) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot name taken!</b>\n\nTry a different name like: <code>${botName}_${userId.toString().slice(-4)}</code>`
        );
        return;
      }

      let bot: Bot;

      if (session.zipBuffer) {
        // Deploy from ZIP file with auto-installation
        bot = await this.deployFromZip(userId, botName, session.zipBuffer, session.tempBotData);
      } else if (session.codeFiles) {
        // Deploy from raw files
        bot = await this.deployFromRawFiles(userId, botName, session.codeFiles);
      } else {
        throw new Error('No valid files found for deployment');
      }

      // Clear upload session
      this.uploadSessions.delete(userId);

      const successMessage = `
🎉 <b>Deployment Successful!</b>

🤖 <b>Bot Details:</b>
• Name: <code>${bot.name}</code>
• Language: <b>${bot.language}</b>
• Status: <b>${bot.status}</b>
• Run Command: <code>${bot.runCommand}</code>

🎮 <b>Next Steps:</b>
• /startbot ${bot.name} - Start your bot
• /logs ${bot.name} - View logs
• /status ${bot.name} - Check status

🔥 Your bot is ready to rock!
      `;

      await this.sendMessage(chatId, successMessage.trim());

    } catch (error) {
      console.error('Deployment error:', error);
      await this.sendMessage(chatId, 
        `❌ <b>Deployment Failed!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async deployFromZip(userId: number, botName: string, zipBuffer: Buffer, tempData?: Partial<Bot>): Promise<Bot> {
    // Create bot in database
    const botData = {
      name: botName,
      language: (tempData?.language as 'python' | 'nodejs') || 'python',
      runCommand: tempData?.runCommand || 'python3 main.py',
      telegramUserId: userId.toString(),
      deploymentSource: 'zip' as const,
      autoDetectedEntryFile: tempData?.autoDetectedEntryFile,
      hasDockerfile: tempData?.hasDockerfile || false,
      hasRequirements: tempData?.hasRequirements || false,
      autoRestart: true
    };

    const bot = await storage.createBot(botData);

    // Deploy with auto-installation
    await this.deployWithAutoInstall(bot.id, zipBuffer);
    
    return bot;
  }

  private async deployFromRawFiles(userId: number, botName: string, codeFiles: Array<{ name: string; content: string; }>): Promise<Bot> {
    // Auto-detect language and entry file
    let language: 'python' | 'nodejs' = 'python';
    let entryFile = 'main.py';
    let runCommand = 'python3 main.py';

    // Check file extensions to determine language
    const hasJsFiles = codeFiles.some(f => f.name.endsWith('.js'));
    const hasPyFiles = codeFiles.some(f => f.name.endsWith('.py'));

    if (hasJsFiles && !hasPyFiles) {
      language = 'nodejs';
      entryFile = 'index.js';
      runCommand = 'node index.js';
    }

    // Look for specific entry files
    for (const file of codeFiles) {
      if (['main.py', 'bot.py'].includes(file.name)) {
        language = 'python';
        entryFile = file.name;
        runCommand = `python3 ${file.name}`;
        break;
      } else if (['index.js', 'app.js', 'bot.js'].includes(file.name)) {
        language = 'nodejs';
        entryFile = file.name;
        runCommand = `node ${file.name}`;
        break;
      }
    }

    // Create bot in database
    const botData = {
      name: botName,
      language,
      runCommand,
      telegramUserId: userId.toString(),
      deploymentSource: 'zip' as const,
      autoDetectedEntryFile: entryFile,
      hasDockerfile: false,
      hasRequirements: false,
      autoRestart: true
    };

    const bot = await storage.createBot(botData);

    // Create ZIP from raw files and deploy
    const zipBuffer = await this.createZipFromFiles(codeFiles);
    await this.deployWithAutoInstall(bot.id, zipBuffer);
    
    return bot;
  }

  private async createZipFromFiles(files: Array<{ name: string; content: string; }>): Promise<Buffer> {
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip();

    for (const file of files) {
      zip.addFile(file.name, Buffer.from(file.content, 'utf-8'));
    }

    return zip.toBuffer();
  }

  private async deployWithAutoInstall(botId: string, zipBuffer: Buffer): Promise<void> {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error('Bot not found');

    // Extract and analyze files
    const { botDir, envVars } = await fileManager.extractZipFile(zipBuffer, bot.name);
    
    // Auto-install dependencies
    await this.autoInstallDependencies(botDir, bot.language);

    // Update bot with file path and env vars
    await storage.updateBot(botId, { 
      filePath: botDir,
      environmentVars: Object.keys(envVars).length > 0 ? JSON.stringify(envVars) : null,
      status: 'stopped'
    });
  }

  private async autoInstallDependencies(botDir: string, language: string): Promise<void> {
    try {
      if (language === 'python') {
        // Check for requirements.txt
        const requirementsPath = path.join(botDir, 'requirements.txt');
        try {
          await fs.access(requirementsPath);
          console.log(`Installing Python dependencies for ${botDir}...`);
          await this.runInstallCommand('pip3 install -r requirements.txt', botDir);
        } catch (error) {
          console.log('No requirements.txt found, skipping Python dependency installation');
        }
      } else if (language === 'nodejs') {
        // Check for package.json
        const packagePath = path.join(botDir, 'package.json');
        try {
          await fs.access(packagePath);
          console.log(`Installing Node.js dependencies for ${botDir}...`);
          await this.runInstallCommand('npm install', botDir);
        } catch (error) {
          console.log('No package.json found, skipping Node.js dependency installation');
        }
      }
    } catch (error) {
      console.warn(`Dependency installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async runInstallCommand(command: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const process = spawn('sh', ['-c', command], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';
      let errorOutput = '';

      process.stdout?.on('data', (data) => {
        output += data.toString();
      });

      process.stderr?.on('data', (data) => {
        errorOutput += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          console.log(`Install completed: ${output}`);
          resolve();
        } else {
          console.error(`Install failed: ${errorOutput}`);
          reject(new Error(`Installation failed with code ${code}: ${errorOutput}`));
        }
      });
    });
  }

  private async handleStartBotCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /startbot my_bot_name\n\nUse /listbots to see your bots.`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>\nUse /listbots to see your bots.`
        );
        return;
      }

      await botManager.startBot(bot.id);

      const startMessage = `
🚀 <b>Bot Started Successfully!</b>

🤖 <b>Bot:</b> <code>${bot.name}</code>
⚡ <b>Status:</b> Running
🔥 <b>Language:</b> ${bot.language}

📊 Use /status ${bot.name} to monitor!
      `;

      await this.sendMessage(chatId, startMessage.trim());

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to start bot!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleStopBotCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /stopbot my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      await botManager.stopBot(bot.id);

      await this.sendMessage(chatId, 
        `⏹️ <b>Bot Stopped!</b>\n\n🤖 Bot: <code>${bot.name}</code>\n✅ Stopped gracefully`
      );

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to stop bot!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleRestartBotCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /restartbot my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      await this.sendMessage(chatId, 
        `🔄 <b>Restarting bot...</b>\n\n🤖 Bot: <code>${bot.name}</code>`
      );

      await botManager.restartBot(bot.id);

      await this.sendMessage(chatId, 
        `🔄 <b>Bot Restarted!</b>\n\n🤖 Bot: <code>${bot.name}</code>\n✅ Fresh start completed`
      );

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to restart bot!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleLogsCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /logs my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      const logs = botManager.getBotLogs(bot.id);
      const recentLogs = logs.slice(-20); // Last 20 lines

      if (recentLogs.length === 0) {
        await this.sendMessage(chatId, 
          `📝 <b>No logs yet!</b>\n\n🤖 Bot: <code>${bot.name}</code>\n💡 Start your bot to see logs.`
        );
        return;
      }

      const logText = recentLogs.join('\n');
      const truncatedLogs = logText.length > 3000 ? logText.slice(-3000) + '...' : logText;

      await this.sendMessage(chatId, 
        `📝 <b>Recent Logs (${recentLogs.length} lines)</b>\n\n🤖 Bot: <code>${bot.name}</code>\n\n<pre>${truncatedLogs}</pre>`
      );

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to get logs!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleStatusCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /status my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      const publicUrl = this.getPublicUrl();
      const platformInfo = this.detectHostingPlatform();
      const statusEmoji = bot.status === 'running' ? '🟢' : bot.status === 'stopped' ? '🔴' : bot.status === 'error' ? '💥' : '🟡';
      const uptimeText = bot.status === 'running' ? this.formatUptime(bot.uptime || 0) : 'Not running';

      const statusMessage = `
📊 <b>Bot Status Report</b>

🤖 <b>Name:</b> <code>${bot.name}</code>
${statusEmoji} <b>Status:</b> ${bot.status.toUpperCase()}
⏱️ <b>Uptime:</b> ${uptimeText}
🗂️ <b>Language:</b> ${bot.language}
⚙️ <b>Run Command:</b> <code>${bot.runCommand}</code>
🔄 <b>Auto-restart:</b> ${bot.autoRestart ? 'Enabled' : 'Disabled'}

📅 <b>Created:</b> ${new Date(bot.createdAt!).toLocaleDateString()}

🌐 <b>📱 DASHBOARD ACCESS 📱</b>
🔗 <code>${publicUrl}</code>
☁️ <b>Platform:</b> ${platformInfo.platform}
💡 <b>Tip:</b> Manage this bot via web dashboard!
      `;

      const keyboard = {
        inline_keyboard: [
          [{ text: `🌐 Open Dashboard`, url: publicUrl }]
        ]
      };

      await this.sendMessage(chatId, statusMessage.trim(), {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to get status!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleListBotsCommand(chatId: number, userId: number) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (userBots.length === 0) {
        const publicUrl = this.getPublicUrl();
        await this.sendMessage(chatId, 
          `📋 <b>No bots yet!</b>\n\n🚀 Use /upload to create your first bot!\n\n🌐 <b>Dashboard:</b> <code>${publicUrl}</code>`
        );
        return;
      }

      const publicUrl = this.getPublicUrl();
      const platformInfo = this.detectHostingPlatform();

      let botsList = `📋 <b>Your Hosted Bots (${userBots.length})</b>\n\n`;
      
      userBots.forEach((bot, index) => {
        const statusEmoji = bot.status === 'running' ? '🟢' : bot.status === 'stopped' ? '🔴' : bot.status === 'error' ? '💥' : '🟡';
        botsList += `${index + 1}. ${statusEmoji} <code>${bot.name}</code> (${bot.language})\n`;
      });

      botsList += `\n🌐 <b>📱 DASHBOARD ACCESS 📱</b>\n`;
      botsList += `🔗 <code>${publicUrl}</code>\n`;
      botsList += `☁️ <b>Platform:</b> ${platformInfo.platform}\n`;
      botsList += `💡 <b>Tip:</b> Manage all bots in the web dashboard!`;

      // Create inline keyboard with action buttons for each bot
      const keyboard = {
        inline_keyboard: [] as Array<Array<any>>
      };

      // Add buttons for each bot (limit to first 3 for UI)
      userBots.slice(0, 3).forEach(bot => {
        const botActions = [
          { text: `🎮 Start ${bot.name}`, callback_data: `start_bot:${bot.name}` },
          { text: `⏹️ Stop ${bot.name}`, callback_data: `stop_bot:${bot.name}` }
        ];
        keyboard.inline_keyboard.push(botActions);
        
        const moreActions = [
          { text: `📊 Status ${bot.name}`, callback_data: `view_status:${bot.name}` },
          { text: `📝 Logs ${bot.name}`, callback_data: `view_logs:${bot.name}` }
        ];
        keyboard.inline_keyboard.push(moreActions);
      });

      // Add dashboard link button
      keyboard.inline_keyboard.push([
        { text: `🌐 Open Dashboard`, url: publicUrl }
      ]);

      await this.sendMessage(chatId, botsList.trim(), {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to list bots!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleStartBotCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString() && bot.status !== 'running');

      if (botName) {
        // Direct bot name provided - start specific bot
        await this.handleStartBotCommand(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots available to start!</b>\n\nEither you have no bots or all are already running.`
        );
        return;
      }

      const message = `🎮 <b>Start Bot</b>\n\nChoose which bot to start:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `▶️ Start ${bot.name} (${bot.language})`, callback_data: `start_bot:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleStopBotCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString() && bot.status === 'running');

      if (botName) {
        // Direct bot name provided - stop specific bot
        await this.handleStopBotCommand(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No running bots to stop!</b>\n\nAll your bots are already stopped.`
        );
        return;
      }

      const message = `⏹️ <b>Stop Bot</b>\n\nChoose which bot to stop:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `⏹️ Stop ${bot.name} (${bot.language})`, callback_data: `stop_bot:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleRestartBotCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - restart specific bot
        await this.handleRestartBotCommand(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to restart!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      const message = `🔄 <b>Restart Bot</b>\n\nChoose which bot to restart:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `🔄 Restart ${bot.name} (${bot.language})`, callback_data: `restart_bot:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleLogsCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - show logs for specific bot
        await this.handleLogsCommand(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to view logs!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      const message = `📝 <b>View Bot Logs</b>\n\nChoose which bot's logs to view:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `📝 Logs for ${bot.name} (${bot.language})`, callback_data: `view_logs:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleStatusCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - show status for specific bot
        await this.handleStatusCommand(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to check status!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      const message = `📊 <b>Check Bot Status</b>\n\nChoose which bot's status to view:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `📊 Status for ${bot.name} (${bot.language})`, callback_data: `view_status:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDeleteBotCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - show confirmation for specific bot
        const bot = await this.getUserBot(userId, botName);
        if (!bot) {
          await this.sendMessage(chatId, 
            `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
          );
          return;
        }

        const confirmMessage = `🗑️ <b>Confirm Deletion</b>\n\n⚠️ Are you sure you want to permanently delete:\n\n🤖 <b>Bot:</b> <code>${bot.name}</code>\n💻 <b>Language:</b> ${bot.language}\n📊 <b>Status:</b> ${bot.status}\n\n<b>This action cannot be undone!</b>`;
        
        const keyboard = {
          inline_keyboard: [
            [{ text: '✅ Yes, Delete It', callback_data: `delete_bot:${bot.name}` }],
            [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
          ]
        };

        await this.sendMessage(chatId, confirmMessage, {
          reply_markup: keyboard
        });
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to delete!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      const message = `🗑️ <b>Delete Bot</b>\n\n⚠️ <b>Choose bot to delete (PERMANENT):</b>`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `🗑️ Delete ${bot.name} (${bot.language})`, callback_data: `delete_bot:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleDeleteBotCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /deletebot my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      // Stop and delete bot
      try {
        await botManager.stopBot(bot.id);
      } catch (error) {
        // Bot might not be running, continue with deletion
      }

      await botManager.deleteBot(bot.id);

      await this.sendMessage(chatId, 
        `🗑️ <b>Bot Deleted!</b>\n\n🤖 Bot: <code>${bot.name}</code>\n✅ Completely removed from hosting`
      );

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to delete bot!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleEnvCommandWithButtons(chatId: number, userId: number) {
    const session = this.uploadSessions.get(userId);
    if (!session) {
      this.uploadSessions.set(userId, { userId });
    }

    const message = `⚙️ <b>Upload Environment Variables</b>\n\nChoose how to upload your environment configuration:`;
    
    const keyboard = {
      inline_keyboard: [
        [{ text: '📄 Upload .env File', callback_data: 'upload_env_file' }],
        [{ text: '📝 Upload config.env File', callback_data: 'upload_config_env' }],
        [{ text: '📋 Upload env.txt File', callback_data: 'upload_env_txt' }],
        [{ text: '💬 Send as Text Message', callback_data: 'upload_env_text' }]
      ]
    };

    await this.sendMessage(chatId, message, {
      reply_markup: keyboard
    });
  }

  private async handleEnvCommand(chatId: number, userId: number) {
    const session = this.uploadSessions.get(userId);
    if (!session) {
      this.uploadSessions.set(userId, { userId });
    }

    await this.sendMessage(chatId, 
      `⚙️ <b>Upload Environment File</b>\n\n📄 <b>Supported formats:</b>\n• .env files\n• config.env\n• env.txt\n• Plain text files\n\n📎 <b>Send your environment file now!</b>`
    );
  }

  private async handleEditCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - start file browsing for direct editing
        const bot = await this.getUserBot(userId, botName);
        if (!bot) {
          await this.sendMessage(chatId, 
            `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
          );
          return;
        }
        
        // Start file browsing for direct editing
        await this.handleFilesBrowse(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to edit!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      if (userBots.length === 1) {
        // Only one bot, start file browsing directly
        await this.handleFilesBrowse(chatId, userId, userBots[0].name);
        return;
      }

      const message = `✏️ <b>Direct Code Editing</b>\n\n📂 Choose bot to browse and edit files:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `📂 Browse ${bot.name} (${bot.language})`, callback_data: `browse_files:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleEditCommand(chatId: number, userId: number, botName: string) {
    if (!botName) {
      await this.sendMessage(chatId, 
        `❌ <b>Bot name required!</b>\n\n<b>Usage:</b> /edit my_bot_name`
      );
      return;
    }

    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      // Start file browsing for direct in-chat editing
      await this.handleFilesBrowse(chatId, userId, botName);

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to browse files!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleHelpCommand(chatId: number) {
    const publicUrl = this.getPublicUrl();
    const platformInfo = this.detectHostingPlatform();
    
    const helpMessage = `
🤖 <b>Host-Elite Bot Platform Commands</b>

🌐 <b>📱 DASHBOARD ACCESS 📱</b>
🔗 <code>${publicUrl}</code>
☁️ <b>Platform:</b> ${platformInfo.platform}

📤 <b>File Management:</b>
/upload - Upload ZIP or raw files (.py, .js)
/env - Upload environment variables file
/cmd &lt;command&gt; - Set custom run command

🚀 <b>Bot Deployment:</b>
/deploy &lt;name&gt; - Deploy uploaded code as bot
/startbot &lt;name&gt; - Start a hosted bot
/stopbot &lt;name&gt; - Stop a running bot
/restartbot &lt;name&gt; - Restart bot

📊 <b>Monitoring:</b>
/logs &lt;name&gt; - Show last 20 log lines
/status &lt;name&gt; - Show status and uptime
/listbots - List all your bots

✏️ <b>Direct Code Editing (NEW!):</b>
/edit &lt;name&gt; - Browse and edit files directly in chat
/files &lt;name&gt; - Browse bot files and folders
/viewfile &lt;path&gt; - View file contents

⚙️ <b>Management:</b>
/deletebot &lt;name&gt; - Remove bot completely

🎯 <b>Features:</b>
• Auto-detects entry files (main.py, index.js, etc.)
• Auto-installs requirements.txt & package.json
• Supports Dockerfile deployment
• 24/7 hosting with auto-restart
• Real-time log monitoring
• <b>Direct code editing through Telegram chat!</b>
• 🌐 Web dashboard: <code>${publicUrl}</code>

💡 <b>Example workflow:</b>
1. /upload (send your bot ZIP)
2. /deploy my_awesome_bot
3. /startbot my_awesome_bot
4. /files my_awesome_bot (browse & edit files)
5. /logs my_awesome_bot
6. 🌐 Visit dashboard for web interface

🔥 <b>Ready to host and edit your bots directly from Telegram!</b>
🌍 <b>Dashboard works on any platform:</b> Replit, Heroku, Render, Koyeb, DigitalOcean & more!
    `;

    await this.sendMessage(chatId, helpMessage.trim());
  }

  private async handleCallbackQuery(callbackQuery: TelegramBot.CallbackQuery) {
    const chatId = callbackQuery.message?.chat.id;
    const userId = callbackQuery.from.id;
    const data = callbackQuery.data;

    if (!chatId || !data) return;

    try {
      // Answer the callback query to stop loading animation
      await this.bot.answerCallbackQuery(callbackQuery.id);

      const [action, ...params] = data.split(':');
      
      switch (action) {
        case 'upload_zip':
          await this.sendMessage(chatId, 
            `📁 <b>Send ZIP File</b>\n\nPlease send your ZIP file containing your bot project.\n\n💡 I'll auto-detect entry files and dependencies!`
          );
          break;

        case 'upload_py':
          await this.sendMessage(chatId, 'upload',
            `🐍 <b>Send Python File</b>\n\nPlease send your Python bot file (.py).\n\n📝 Supported: main.py, bot.py, app.py or any .py file`
          );
          break;

        case 'upload_js':
          await this.sendMessage(chatId, 'upload',
            `🟨 <b>Send JavaScript File</b>\n\nPlease send your JavaScript bot file (.js).\n\n📝 Supported: index.js, app.js, bot.js or any .js file`
          );
          break;

        case 'deploy_bot':
          const deployBotName = params[0];
          if (deployBotName) {
            await this.handleDeployCommand(chatId, userId, deployBotName);
          }
          break;

        case 'start_bot':
          const startBotName = params[0];
          if (startBotName) {
            await this.handleStartBotCommand(chatId, userId, startBotName);
          }
          break;

        case 'stop_bot':
          const stopBotName = params[0];
          if (stopBotName) {
            await this.handleStopBotCommand(chatId, userId, stopBotName);
          }
          break;

        case 'restart_bot':
          const restartBotName = params[0];
          if (restartBotName) {
            await this.handleRestartBotCommand(chatId, userId, restartBotName);
          }
          break;

        case 'view_logs':
          const logsBotName = params[0];
          if (logsBotName) {
            await this.handleLogsCommand(chatId, userId, logsBotName);
          }
          break;

        case 'view_status':
          const statusBotName = params[0];
          if (statusBotName) {
            await this.handleStatusCommand(chatId, userId, statusBotName);
          }
          break;

        case 'delete_bot':
          const deleteBotName = params[0];
          if (deleteBotName) {
            await this.handleDeleteBotCommand(chatId, userId, deleteBotName);
          }
          break;

        case 'list_bots':
          await this.handleListBotsCommand(chatId, userId);
          break;

        case 'cancel_action':
          await this.sendMessage(chatId, 
            `✅ <b>Action cancelled!</b>\n\nType /help to see available commands.`
          );
          break;

        case 'show_guide':
          await this.handleHelpCommand(chatId);
          break;

        case 'upload_env_file':
        case 'upload_config_env':
        case 'upload_env_txt':
        case 'upload_env_text':
          await this.sendMessage(chatId, 
            `📄 <b>Send Environment File</b>\n\nPlease send your environment variables file.\n\n💡 Supported formats: .env, config.env, env.txt, or plain text`
          );
          break;

        case 'edit_bot':
          const editBotName = params[0];
          if (editBotName) {
            await this.handleFilesBrowse(chatId, userId, editBotName);
          }
          break;

        // New file editing callback handlers
        case 'browse_files':
          const browseBotName = params[0];
          if (browseBotName) {
            await this.handleFilesBrowse(chatId, userId, browseBotName);
          }
          break;

        case 'browse_dir':
          const dirBotName = params[0];
          const directory = params[1] || '';
          if (dirBotName) {
            await this.handleFilesBrowse(chatId, userId, dirBotName, directory);
          }
          break;

        case 'view_file':
          const viewBotName = params[0];
          const viewFilePath = params[1];
          if (viewBotName && viewFilePath) {
            await this.viewFile(chatId, userId, viewBotName, viewFilePath);
          }
          break;

        case 'edit_file':
          const editFileBotName = params[0];
          const editFilePath = params[1];
          if (editFileBotName && editFilePath) {
            // Set up file editing session
            const session = this.uploadSessions.get(userId) || { userId };
            session.editingBot = editFileBotName;
            session.currentFilePath = editFilePath;
            session.awaitingFileContent = true;
            this.uploadSessions.set(userId, session);

            const fileName = editFilePath.split('/').pop();
            const fileIcon = this.getFileIcon(fileName || '');

            await this.sendMessage(chatId, 
              `✏️ <b>Edit File Mode</b>\n\n🤖 <b>Bot:</b> <code>${editFileBotName}</code>\n${fileIcon} <b>File:</b> <code>${editFilePath}</code>\n\n📝 <b>Send your new file content as your next message.</b>\n\n⚠️ This will completely replace the file content!`
            );
          }
          break;

        case 'set_cmd':
          const command = params.join(':');
          if (command) {
            await this.handleCmdCommand(chatId, userId, command);
          }
          break;

        case 'use_auto_cmd':
          const autoCommand = params.join(':');
          if (autoCommand) {
            await this.handleCmdCommand(chatId, userId, autoCommand);
          }
          break;

        case 'deploy_with_cmd':
          // User wants to deploy after setting command
          await this.sendMessage(chatId, 
            `🚀 <b>Deploy Bot</b>\n\nEnter a name for your bot:`
          );
          const sessionDeploy = this.uploadSessions.get(userId);
          if (sessionDeploy) {
            sessionDeploy.awaitingBotName = true;
          }
          break;

        case 'custom_cmd_input':
          await this.sendMessage(chatId, 
            `⚙️ <b>Custom Run Command</b>\n\nType your custom run command as a message.\n\n💡 <b>Examples:</b>\n• <code>python main.py</code>\n• <code>node app.js</code>\n• <code>npm run start</code>\n• <code>python3 -u bot.py</code>`
          );
          
          // Set flag to expect custom command input
          const sessionCmd = this.uploadSessions.get(userId);
          if (sessionCmd) {
            sessionCmd.awaitingCommand = true;
          }
          break;

        case 'deploy_with_cmd':
          // Auto-generate bot name and deploy
          const autoName = `bot_${userId}_${Date.now().toString().slice(-6)}`;
          await this.handleDeployCommand(chatId, userId, autoName);
          break;

        case 'quick_deploy':
          // Quick deploy with auto-generated name
          const quickName = `bot_${userId}_${Date.now().toString().slice(-6)}`;
          await this.handleDeployCommand(chatId, userId, quickName);
          break;

        case 'custom_deploy_name':
          await this.sendMessage(chatId, 
            `✏️ <b>Custom Bot Name</b>\n\nSend me the name for your bot.\n\n📝 <b>Rules:</b>\n• Only letters, numbers, underscore, hyphen\n• No spaces or special characters\n• Example: <code>my_awesome_bot</code>`
          );
          
          // Set flag to expect bot name
          const deploySession = this.uploadSessions.get(userId);
          if (deploySession) {
            deploySession.awaitingBotName = true;
          }
          break;

        default:
          await this.sendMessage(chatId, 
            `❌ <b>Unknown action:</b> ${action}`
          );
      }
    } catch (error) {
      console.error('Callback query error:', error);
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleNonCommandMessage(chatId: number, userId: number, text: string) {
    const session = this.uploadSessions.get(userId);
    
    if (!session) {
      await this.sendMessage(chatId, 
        `💬 <b>Hi there!</b>\n\nI understand commands only. Type /help to see what I can do for you! 🚀`
      );
      return;
    }

    try {
      // Handle bot name input
      if (session.awaitingBotName) {
        session.awaitingBotName = false;
        const botName = text.trim();
        
        // Validate bot name
        if (!botName || !/^[a-zA-Z0-9_-]+$/.test(botName) || botName.length > 50) {
          await this.sendMessage(chatId, 
            `❌ <b>Invalid bot name!</b>\n\nBot name must:\n• Only contain letters, numbers, underscores, and hyphens\n• Be 1-50 characters long\n• Not be empty\n\nTry again:`
          );
          session.awaitingBotName = true; // Reset waiting state
          return;
        }
        
        await this.handleDeployCommand(chatId, userId, botName);
        // Clean up session after deployment
        this.cleanupUserSession(userId);
        return;
      }

      // Handle custom command input
      if (session.awaitingCommand) {
        session.awaitingCommand = false;
        const command = text.trim();
        
        // Validate command length
        if (!command || command.length > 500) {
          await this.sendMessage(chatId, 
            `❌ <b>Invalid command!</b>\n\nCommand must be 1-500 characters. Try again:`
          );
          session.awaitingCommand = true; // Reset waiting state
          return;
        }
        
        await this.handleCmdCommand(chatId, userId, command);
        // Partial cleanup - keep session for potential deployment
        if (session) {
          session.awaitingCommand = false;
        }
        return;
      }

      // Handle file content input for editing
      if (session.awaitingFileContent && session.currentFilePath && session.editingBot) {
        session.awaitingFileContent = false;
        
        // Validate file content size (max 1MB)
        if (text.length > 1024 * 1024) {
          await this.sendMessage(chatId, 
            `❌ <b>File too large!</b>\n\nMaximum file size: 1MB\nYour content: ${(text.length / 1024 / 1024).toFixed(2)}MB\n\nPlease reduce the file size and try again.`
          );
          session.awaitingFileContent = true; // Reset waiting state
          return;
        }
        
        await this.saveFileContent(chatId, userId, session.editingBot, session.currentFilePath, text);
        // Clean up session after successful file save
        this.cleanupEditingSession(session);
        return;
      }

      // Handle any pending inputs during upload session
      await this.sendMessage(chatId, 
        `📎 <b>Please upload your files!</b>\n\nI'm waiting for:\n• ZIP files\n• Raw code files (.py, .js)\n• Environment files (.env)\n\nOr use /help for commands! 🛠️`
      );
      
    } catch (error) {
      console.error('Error handling non-command message:', error);
      await this.sendMessage(chatId, 
        `❌ <b>Error processing your input.</b>\n\nPlease try again or use /help for available commands.`
      );
      // Clean up potentially corrupted session state
      this.cleanupUserSession(userId);
    }
  }

  private async getUserBot(userId: number, botName: string): Promise<Bot | undefined> {
    const bot = await storage.getBotByName(botName);
    if (!bot || bot.telegramUserId !== userId.toString()) {
      return undefined;
    }
    return bot;
  }

  // Session cleanup helpers
  private cleanupEditingSession(session: BotUploadSession): void {
    session.editingBot = undefined;
    session.currentFilePath = undefined;
    session.awaitingFileContent = false;
  }

  private cleanupUserSession(userId: number): void {
    const session = this.uploadSessions.get(userId);
    if (session) {
      // Clean up all session state
      session.awaitingBotName = false;
      session.awaitingCommand = false;
      session.awaitingFileContent = false;
      session.editingBot = undefined;
      session.currentFilePath = undefined;
      session.currentFilesList = undefined;
      session.currentDirectory = undefined;
      
      // Keep basic session info but clear sensitive data
      session.zipBuffer = undefined;
      session.codeFiles = undefined;
      session.tempBotData = undefined;
      
      console.log(`Cleaned up session for user ${userId}`);
    }
  }

  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  public async broadcastMessage(message: string, targetUserId?: string) {
    // Method for sending broadcast messages if needed
    // This could be used by the web interface to send notifications
    try {
      if (targetUserId) {
        await this.bot.sendMessage(parseInt(targetUserId), message, { parse_mode: 'HTML' });
      }
    } catch (error) {
      console.error('Broadcast error:', error);
    }
  }

  public getBotInstance(): TelegramBot {
    return this.bot;
  }

  // Enhanced File Management Methods for Direct Telegram Editing

  private async handleFilesCommandWithButtons(chatId: number, userId: number, botName?: string) {
    try {
      const allBots = await storage.getAllBots();
      const userBots = allBots.filter(bot => bot.telegramUserId === userId.toString());

      if (botName) {
        // Direct bot name provided - show files for specific bot
        await this.handleFilesBrowse(chatId, userId, botName);
        return;
      }

      if (userBots.length === 0) {
        await this.sendMessage(chatId, 
          `❌ <b>No bots to browse!</b>\n\nUse /upload to create your first bot.`
        );
        return;
      }

      const message = `📁 <b>Browse Bot Files</b>\n\nChoose which bot's files to browse:`;
      
      const keyboard = {
        inline_keyboard: userBots.map(bot => [
          { text: `📂 Browse ${bot.name} (${bot.language})`, callback_data: `browse_files:${bot.name}` }
        ])
      };

      await this.sendMessage(chatId, message, {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleFilesBrowse(chatId: number, userId: number, botName: string, directory: string = '') {
    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      // Get bot files using the fileManager
      const files = await fileManager.listBotFiles(bot.name);
      
      // Filter files by directory if specified
      const currentDirFiles = files.filter((file: any) => {
        if (directory === '') {
          // Root directory - show files and immediate subdirectories only
          return !file.path.includes('/') || (file.path.indexOf('/') === file.path.lastIndexOf('/') && file.type === 'directory');
        } else {
          // Inside a directory
          const normalizedDir = directory.endsWith('/') ? directory : directory + '/';
          return file.path.startsWith(normalizedDir) && 
                 (file.path === directory || file.path.substring(normalizedDir.length).indexOf('/') === -1);
        }
      });

      // Update user session
      const session = this.uploadSessions.get(userId) || { userId };
      session.editingBot = botName;
      session.currentFilesList = currentDirFiles;
      session.currentDirectory = directory;
      this.uploadSessions.set(userId, session);

      if (currentDirFiles.length === 0) {
        await this.sendMessage(chatId, 
          `📂 <b>Empty Directory</b>\n\n🤖 Bot: <code>${bot.name}</code>\n📁 Directory: <code>${directory || '/'}</code>\n\n💡 No files found in this directory.`
        );
        return;
      }

      let filesList = `📂 <b>Bot Files Browser</b>\n\n🤖 <b>Bot:</b> <code>${bot.name}</code>\n📁 <b>Directory:</b> <code>${directory || '/'}</code>\n\n`;
      
      const keyboard = {
        inline_keyboard: [] as Array<Array<any>>
      };

      // Add parent directory button if not in root
      if (directory) {
        const parentDir = directory.includes('/') ? directory.substring(0, directory.lastIndexOf('/')) : '';
        keyboard.inline_keyboard.push([
          { text: '🔙 Parent Directory', callback_data: `browse_dir:${bot.name}:${parentDir}` }
        ]);
      }

      // Group directories first, then files
      const directories = currentDirFiles.filter((f: any) => f.type === 'directory').slice(0, 5);
      const regularFiles = currentDirFiles.filter((f: any) => f.type === 'file').slice(0, 10);

      directories.forEach((file: any, index: number) => {
        filesList += `${index + 1}. 📁 <b>${file.name}</b>/\n`;
        keyboard.inline_keyboard.push([
          { text: `📂 Open ${file.name}`, callback_data: `browse_dir:${bot.name}:${file.path}` }
        ]);
      });

      regularFiles.forEach((file: any, index: number) => {
        const size = file.size ? ` (${(file.size / 1024).toFixed(1)}KB)` : '';
        const icon = this.getFileIcon(file.name);
        filesList += `${directories.length + index + 1}. ${icon} <code>${file.name}</code>${size}\n`;
        
        // Add buttons for each file (max 2 per row)
        const fileButtons = [
          { text: `👁️ View ${file.name.split('.').pop()}`, callback_data: `view_file:${bot.name}:${file.path}` },
          { text: `✏️ Edit ${file.name.split('.').pop()}`, callback_data: `edit_file:${bot.name}:${file.path}` }
        ];
        keyboard.inline_keyboard.push(fileButtons);
      });

      // Add refresh button
      keyboard.inline_keyboard.push([
        { text: '🔄 Refresh Files', callback_data: `browse_files:${bot.name}` }
      ]);

      await this.sendMessage(chatId, filesList.trim(), {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to browse files!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleViewFileCommand(chatId: number, userId: number, filePath?: string) {
    try {
      const session = this.uploadSessions.get(userId);
      if (!session?.editingBot || !filePath) {
        await this.sendMessage(chatId, 
          `❌ <b>Usage:</b> /viewfile &lt;file_path&gt;\n\n💡 First use /files to browse your bot files.`
        );
        return;
      }

      await this.viewFile(chatId, userId, session.editingBot, filePath);

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async viewFile(chatId: number, userId: number, botName: string, filePath: string) {
    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      const fileData = await fileManager.readBotFile(bot.name, filePath);
      
      if (!fileData.isText) {
        await this.sendMessage(chatId, 
          `❌ <b>Binary file detected!</b>\n\n📄 File: <code>${filePath}</code>\n💡 Only text files can be viewed.`
        );
        return;
      }

      // Limit content display to avoid Telegram message limits
      let content = fileData.content;
      const maxLength = 3000;
      
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n... (truncated, file is larger)';
      }

      const fileName = filePath.split('/').pop();
      const fileIcon = this.getFileIcon(fileName || '');
      const syntaxInfo = this.getSyntaxHighlightInfo(fileName || '');

      const viewMessage = `
📖 <b>Enhanced File Viewer</b>

🤖 <b>Bot:</b> <code>${botName}</code>
${fileIcon} <b>File:</b> <code>${filePath}</code>
${syntaxInfo.emoji} <b>Type:</b> ${syntaxInfo.type}
📏 <b>Size:</b> ${content.length} characters
🔤 <b>Language:</b> ${fileData.language}

<pre><code class="language-${fileData.language}">${content}</code></pre>

💡 <b>Available Actions:</b>
• ✏️ Edit file content directly
• 📁 Browse other files
• 🔄 Refresh to see latest changes
• 🗑️ Delete this file
• 📋 Copy file path
      `;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✏️ Edit File', callback_data: `edit_file:${botName}:${filePath}` },
            { text: '📋 Copy Path', callback_data: `copy_path:${filePath}` }
          ],
          [
            { text: '🗑️ Delete File', callback_data: `delete_file:${botName}:${filePath}` },
            { text: '🔄 Refresh', callback_data: `view_file:${botName}:${filePath}` }
          ],
          [
            { text: '📁 Back to Files', callback_data: `browse_files:${botName}` },
            { text: '🏠 Main Menu', callback_data: 'main_menu' }
          ]
        ]
      };

      await this.sendMessage(chatId, viewMessage.trim(), {
        reply_markup: keyboard
      });

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Failed to read file!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async handleSaveFileCommand(chatId: number, userId: number, filePath?: string) {
    try {
      const session = this.uploadSessions.get(userId);
      if (!session?.editingBot || !filePath) {
        await this.sendMessage(chatId, 
          `❌ <b>Usage:</b> /savefile &lt;file_path&gt;\n\n💡 First use /files to browse your bot files, then edit them.`
        );
        return;
      }

      // Set up for file editing
      session.currentFilePath = filePath;
      session.awaitingFileContent = true;
      this.uploadSessions.set(userId, session);

      const fileName = filePath.split('/').pop();
      const fileIcon = this.getFileIcon(fileName || '');

      await this.sendMessage(chatId, 
        `✏️ <b>Edit File Mode</b>\n\n🤖 <b>Bot:</b> <code>${session.editingBot}</code>\n${fileIcon} <b>File:</b> <code>${filePath}</code>\n\n📝 <b>Send your new file content as your next message.</b>\n\n⚠️ This will completely replace the file content!`
      );

    } catch (error) {
      await this.sendMessage(chatId, 
        `❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private async saveFileContent(chatId: number, userId: number, botName: string, filePath: string, content: string) {
    try {
      const bot = await this.getUserBot(userId, botName);
      if (!bot) {
        await this.sendMessage(chatId, 
          `❌ <b>Bot not found!</b>\n\nBot: <code>${botName}</code>`
        );
        return;
      }

      // Validate content size (max 1MB)
      if (content.length > 1024 * 1024) {
        await this.sendMessage(chatId, 
          `❌ <b>File too large!</b>\n\nMaximum file size: 1MB\nYour content: ${(content.length / 1024 / 1024).toFixed(2)}MB`
        );
        return;
      }

      // Save the file
      await fileManager.writeBotFile(bot.name, filePath, content);

      const fileName = filePath.split('/').pop();
      const fileIcon = this.getFileIcon(fileName || '');

      const successMessage = `
✅ <b>File Saved Successfully!</b>

🤖 <b>Bot:</b> <code>${botName}</code>
${fileIcon} <b>File:</b> <code>${filePath}</code>
📏 <b>Size:</b> ${content.length} characters
💾 <b>Status:</b> Saved to filesystem

🔄 <b>Next Steps:</b>
• View updated file content
• Restart your bot to apply changes
• Continue editing other files
      `;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '👁️ View Updated File', callback_data: `view_file:${botName}:${filePath}` },
            { text: '📁 Back to Files', callback_data: `browse_files:${botName}` }
          ],
          [
            { text: '🔄 Restart Bot', callback_data: `restart_bot:${botName}` },
            { text: '✏️ Edit Another File', callback_data: `browse_files:${botName}` }
          ]
        ]
      };

      await this.sendMessage(chatId, successMessage.trim(), {
        reply_markup: keyboard
      });

    } catch (error) {
      console.error('Error saving file:', error);
      await this.sendMessage(chatId, 
        `❌ <b>Failed to save file!</b>\n\n${error instanceof Error ? error.message : 'Unknown error'}`
      );
      
      // Clean up session on error
      const session = this.uploadSessions.get(userId);
      if (session) {
        this.cleanupEditingSession(session);
      }
    }
  }

  private getFileIcon(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'py': return '🐍';
      case 'js': case 'ts': return '🟨';
      case 'json': return '📋';
      case 'txt': case 'md': return '📝';
      case 'env': return '⚙️';
      case 'html': case 'htm': return '🌐';
      case 'css': return '🎨';
      case 'yml': case 'yaml': return '🔧';
      case 'dockerfile': return '🐳';
      case 'php': return '💜';
      case 'java': return '☕';
      case 'cpp': case 'c': return '⚙️';
      case 'go': return '🐹';
      case 'rs': return '🦀';
      case 'rb': return '💎';
      default: return '📄';
    }
  }

  private getSyntaxHighlightInfo(fileName: string): { emoji: string; type: string } {
    const ext = fileName.split('.').pop()?.toLowerCase();
    
    switch (ext) {
      case 'py': return { emoji: '🐍', type: 'Python Script' };
      case 'js': return { emoji: '💛', type: 'JavaScript' };
      case 'ts': return { emoji: '💙', type: 'TypeScript' };
      case 'json': return { emoji: '📊', type: 'JSON Data' };
      case 'txt': return { emoji: '📝', type: 'Plain Text' };
      case 'md': return { emoji: '📑', type: 'Markdown' };
      case 'env': return { emoji: '🔧', type: 'Environment Variables' };
      case 'html': case 'htm': return { emoji: '🌐', type: 'HTML Markup' };
      case 'css': return { emoji: '🎨', type: 'CSS Stylesheet' };
      case 'yml': case 'yaml': return { emoji: '⚙️', type: 'YAML Configuration' };
      case 'dockerfile': return { emoji: '🐳', type: 'Docker Container' };
      case 'php': return { emoji: '💜', type: 'PHP Script' };
      case 'java': return { emoji: '☕', type: 'Java Source' };
      case 'cpp': case 'c': return { emoji: '⚙️', type: 'C/C++ Source' };
      case 'go': return { emoji: '🐹', type: 'Go Source' };
      case 'rs': return { emoji: '🦀', type: 'Rust Source' };
      case 'rb': return { emoji: '💎', type: 'Ruby Script' };
      case 'sh': return { emoji: '🖥️', type: 'Shell Script' };
      case 'sql': return { emoji: '🗄️', type: 'SQL Database' };
      default: return { emoji: '📄', type: 'Unknown File Type' };
    }
  }

  private getPublicUrl(): string {
    // Universal URL detection for ALL hosting platforms
    
    // === PRODUCTION/DEPLOYMENT URLs (Highest Priority) ===
    
    // Heroku
    if (process.env.HEROKU_APP_NAME) {
      return `https://${process.env.HEROKU_APP_NAME}.herokuapp.com`;
    }
    
    // Render
    if (process.env.RENDER_EXTERNAL_URL) {
      return process.env.RENDER_EXTERNAL_URL;
    }
    if (process.env.RENDER_SERVICE_NAME) {
      return `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
    }
    
    // Koyeb
    if (process.env.KOYEB_PUBLIC_DOMAIN) {
      return `https://${process.env.KOYEB_PUBLIC_DOMAIN}`;
    }
    
    // Railway
    if (process.env.RAILWAY_STATIC_URL) {
      return process.env.RAILWAY_STATIC_URL;
    }
    if (process.env.RAILWAY_PUBLIC_DOMAIN) {
      return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    }
    
    // Vercel
    if (process.env.VERCEL_URL) {
      return `https://${process.env.VERCEL_URL}`;
    }
    
    // Netlify
    if (process.env.DEPLOY_PRIME_URL) {
      return process.env.DEPLOY_PRIME_URL;
    }
    if (process.env.NETLIFY_APP_NAME) {
      return `https://${process.env.NETLIFY_APP_NAME}.netlify.app`;
    }
    
    // DigitalOcean App Platform
    if (process.env.APP_URL) {
      return process.env.APP_URL;
    }
    
    // Google Cloud Run
    if (process.env.GOOGLE_CLOUD_PROJECT && process.env.K_SERVICE) {
      return `https://${process.env.K_SERVICE}-${process.env.GOOGLE_CLOUD_PROJECT}.a.run.app`;
    }
    
    // AWS App Runner
    if (process.env.AWS_APP_RUNNER_DOMAIN) {
      return `https://${process.env.AWS_APP_RUNNER_DOMAIN}`;
    }
    
    // === REPLIT (Development Environment) ===
    
    // Replit Deployment URL (production deployments)
    if (process.env.REPLIT_DEPLOYMENT_URL && this.isValidUrl(process.env.REPLIT_DEPLOYMENT_URL)) {
      return process.env.REPLIT_DEPLOYMENT_URL;
    }
    
    // Replit Dev Domain (development environment - most reliable)
    if (process.env.REPLIT_DEV_DOMAIN) {
      const url = `https://${process.env.REPLIT_DEV_DOMAIN}`;
      if (this.isValidUrl(url)) {
        return url;
      }
    }
    
    // Modern Replit URL format using REPL_ID
    if (process.env.REPL_ID) {
      const patterns = [
        `https://${process.env.REPL_ID}-00-2jruz94h8eejr.sisko.replit.dev`, // Current detected pattern
        `https://${process.env.REPL_ID}.id.repl.co`,
        `https://${process.env.REPL_ID}.replit.app`
      ];
      
      for (const url of patterns) {
        if (this.isValidUrl(url)) {
          return url;
        }
      }
    }
    
    // Legacy Replit format using REPL_SLUG and REPL_OWNER
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      const url = `https://${process.env.REPL_SLUG}-${process.env.REPL_OWNER}.replit.app`;
      if (this.isValidUrl(url)) {
        return url;
      }
    }
    
    // === GENERIC PATTERNS ===
    
    // Try common generic environment variables
    const genericVars = [
      'PUBLIC_URL',
      'EXTERNAL_URL', 
      'BASE_URL',
      'SITE_URL',
      'WEB_URL',
      'HOST_URL'
    ];
    
    for (const varName of genericVars) {
      const url = process.env[varName];
      if (url && this.isValidUrl(url)) {
        return url;
      }
    }
    
    // === DYNAMIC DETECTION (Last Resort) ===
    
    // Try to use HOST and PORT environment variables
    if (process.env.HOST && !process.env.HOST.includes('localhost')) {
      const port = process.env.PORT ? `:${process.env.PORT}` : '';
      const protocol = process.env.HTTPS === 'true' || process.env.PORT === '443' ? 'https' : 'http';
      const url = `${protocol}://${process.env.HOST}${port}`;
      if (this.isValidUrl(url)) {
        return url;
      }
    }
    
    // Fallback: localhost (development only)
    const port = parseInt(process.env.PORT || '5000', 10);
    return `http://localhost:${port}`;
  }
  
  private isValidUrl(urlString: string): boolean {
    try {
      const url = new URL(urlString);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }
  
  private detectHostingPlatform(): { platform: string, source: string, vars: any } {
    // Detect which hosting platform we're running on
    
    if (process.env.HEROKU_APP_NAME) {
      return {
        platform: 'Heroku',
        source: 'HEROKU_APP_NAME',
        vars: { HEROKU_APP_NAME: process.env.HEROKU_APP_NAME }
      };
    }
    
    if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_NAME) {
      return {
        platform: 'Render',
        source: process.env.RENDER_EXTERNAL_URL ? 'RENDER_EXTERNAL_URL' : 'RENDER_SERVICE_NAME',
        vars: { 
          RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL || 'not set',
          RENDER_SERVICE_NAME: process.env.RENDER_SERVICE_NAME || 'not set'
        }
      };
    }
    
    if (process.env.KOYEB_PUBLIC_DOMAIN) {
      return {
        platform: 'Koyeb',
        source: 'KOYEB_PUBLIC_DOMAIN',
        vars: { KOYEB_PUBLIC_DOMAIN: process.env.KOYEB_PUBLIC_DOMAIN }
      };
    }
    
    if (process.env.RAILWAY_STATIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN) {
      return {
        platform: 'Railway',
        source: process.env.RAILWAY_STATIC_URL ? 'RAILWAY_STATIC_URL' : 'RAILWAY_PUBLIC_DOMAIN',
        vars: { 
          RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL || 'not set',
          RAILWAY_PUBLIC_DOMAIN: process.env.RAILWAY_PUBLIC_DOMAIN || 'not set'
        }
      };
    }
    
    if (process.env.VERCEL_URL) {
      return {
        platform: 'Vercel',
        source: 'VERCEL_URL',
        vars: { VERCEL_URL: process.env.VERCEL_URL }
      };
    }
    
    if (process.env.DEPLOY_PRIME_URL || process.env.NETLIFY_APP_NAME) {
      return {
        platform: 'Netlify',
        source: process.env.DEPLOY_PRIME_URL ? 'DEPLOY_PRIME_URL' : 'NETLIFY_APP_NAME',
        vars: { 
          DEPLOY_PRIME_URL: process.env.DEPLOY_PRIME_URL || 'not set',
          NETLIFY_APP_NAME: process.env.NETLIFY_APP_NAME || 'not set'
        }
      };
    }
    
    if (process.env.GOOGLE_CLOUD_PROJECT && process.env.K_SERVICE) {
      return {
        platform: 'Google Cloud Run',
        source: 'GOOGLE_CLOUD_PROJECT + K_SERVICE',
        vars: { 
          GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
          K_SERVICE: process.env.K_SERVICE
        }
      };
    }
    
    if (process.env.AWS_APP_RUNNER_DOMAIN) {
      return {
        platform: 'AWS App Runner',
        source: 'AWS_APP_RUNNER_DOMAIN',
        vars: { AWS_APP_RUNNER_DOMAIN: process.env.AWS_APP_RUNNER_DOMAIN }
      };
    }
    
    if (process.env.REPLIT_DEV_DOMAIN || process.env.REPL_ID) {
      return {
        platform: 'Replit',
        source: 'REPLIT_DEV_DOMAIN',
        vars: {
          REPLIT_DEPLOYMENT_URL: process.env.REPLIT_DEPLOYMENT_URL || 'not set',
          REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN || 'not set',
          REPL_SLUG: process.env.REPL_SLUG || 'not set',
          REPL_OWNER: process.env.REPL_OWNER || 'not set',
          REPL_ID: process.env.REPL_ID || 'not set'
        }
      };
    }
    
    // Check generic environment variables
    const genericVars = ['PUBLIC_URL', 'EXTERNAL_URL', 'BASE_URL', 'SITE_URL', 'WEB_URL', 'HOST_URL'];
    for (const varName of genericVars) {
      if (process.env[varName]) {
        return {
          platform: 'Generic Platform',
          source: varName,
          vars: { [varName]: process.env[varName] }
        };
      }
    }
    
    return {
      platform: 'Unknown/Development',
      source: 'localhost fallback',
      vars: { 
        PORT: process.env.PORT || '5000',
        HOST: process.env.HOST || 'localhost'
      }
    };
  }
}

// Export a function to create the service only when needed
export const createTelegramBotService = () => new TelegramBotService();

// Lazy initialization
let _telegramBotService: TelegramBotService | null = null;

export const telegramBotService = {
  getInstance(): TelegramBotService | null {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.log('⚠️  TELEGRAM_BOT_TOKEN not set - Telegram bot service disabled');
      return null;
    }
    
    if (!_telegramBotService) {
      try {
        _telegramBotService = new TelegramBotService();
        console.log('🤖 Telegram bot service initialized');
      } catch (error) {
        console.error('❌ Failed to initialize Telegram bot:', error);
        return null;
      }
    }
    return _telegramBotService;
  },
  
  // Forward methods for convenience
  broadcastMessage(message: string, targetUserId?: string) {
    const instance = this.getInstance();
    return instance?.broadcastMessage(message, targetUserId);
  },
  
  getBotInstance() {
    const instance = this.getInstance();
    return instance?.getBotInstance();
  }
};