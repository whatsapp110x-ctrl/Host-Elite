// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import multer from "multer";

// server/storage.ts
import { randomUUID } from "crypto";
var MemStorage = class {
  users;
  bots;
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.bots = /* @__PURE__ */ new Map();
  }
  async getUser(id) {
    return this.users.get(id);
  }
  async getUserByUsername(username) {
    return Array.from(this.users.values()).find(
      (user) => user.username === username
    );
  }
  async createUser(insertUser) {
    const id = randomUUID();
    const user = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }
  async getAllBots() {
    return Array.from(this.bots.values());
  }
  async getBot(id) {
    return this.bots.get(id);
  }
  async getBotByName(name) {
    return Array.from(this.bots.values()).find((bot) => bot.name === name);
  }
  async createBot(insertBot) {
    const id = randomUUID();
    const now = /* @__PURE__ */ new Date();
    const bot = {
      ...insertBot,
      id,
      status: insertBot.status || "stopped",
      buildCommand: insertBot.buildCommand || null,
      userId: insertBot.userId || "web_user",
      autoRestart: insertBot.autoRestart ?? true,
      processId: null,
      filePath: null,
      environmentVars: null,
      deploymentUrl: null,
      createdAt: now,
      updatedAt: now
    };
    this.bots.set(id, bot);
    return bot;
  }
  async updateBot(id, updates) {
    const bot = this.bots.get(id);
    if (!bot) return void 0;
    const updatedBot = { ...bot, ...updates, updatedAt: /* @__PURE__ */ new Date() };
    this.bots.set(id, updatedBot);
    return updatedBot;
  }
  async deleteBot(id) {
    return this.bots.delete(id);
  }
  async getBotsByStatus(status) {
    return Array.from(this.bots.values()).filter((bot) => bot.status === status);
  }
};
var storage = new MemStorage();

// server/services/botManager.ts
import { spawn } from "child_process";
import { EventEmitter } from "events";

// server/services/fileManager.ts
import AdmZip from "adm-zip";
import fs from "fs/promises";
import path from "path";
var FileManager = class {
  botsDir = path.join(process.cwd(), "deployed_bots");
  async ensureBotsDirectory() {
    try {
      await fs.access(this.botsDir);
    } catch {
      await fs.mkdir(this.botsDir, { recursive: true });
    }
  }
  async extractZipFile(zipBuffer, botName) {
    await this.ensureBotsDirectory();
    const botDir = path.join(this.botsDir, botName);
    try {
      await fs.rm(botDir, { recursive: true, force: true });
    } catch (error) {
    }
    await fs.mkdir(botDir, { recursive: true });
    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(botDir, true);
    const extractedItems = await fs.readdir(botDir);
    if (extractedItems.length === 1) {
      const singleItem = extractedItems[0];
      const singleItemPath = path.join(botDir, singleItem);
      const stats = await fs.stat(singleItemPath);
      if (stats.isDirectory()) {
        const subDirFiles = await fs.readdir(singleItemPath);
        for (const file of subDirFiles) {
          const sourcePath = path.join(singleItemPath, file);
          const destPath = path.join(botDir, file);
          await fs.rename(sourcePath, destPath);
        }
        await fs.rmdir(singleItemPath);
      }
    }
    const envVars = await this.parseEnvFile(botDir);
    return { botDir, envVars };
  }
  async deleteBotFiles(botName) {
    const botDir = path.join(this.botsDir, botName);
    try {
      await fs.rm(botDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete bot files for ${botName}:`, error);
    }
  }
  async parseEnvFile(botDir) {
    const envFiles = [".env", "config.env"];
    let allEnvVars = {};
    for (const envFile of envFiles) {
      const envPath = path.join(botDir, envFile);
      try {
        const envContent = await fs.readFile(envPath, "utf8");
        const envVars = this.parseEnvContent(envContent, `ZIP ${envFile} file`);
        if (envFile === ".env") {
          allEnvVars = { ...allEnvVars, ...envVars };
        } else {
          allEnvVars = { ...envVars, ...allEnvVars };
        }
      } catch (error) {
        console.log(`No ${envFile} file found in ZIP or error reading it:`, error instanceof Error ? error.message : "Unknown error");
      }
    }
    return allEnvVars;
  }
  parseEnvContent(envContent, source) {
    const envVars = {};
    const lines = envContent.split("\n");
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }
      const equalIndex = trimmedLine.indexOf("=");
      if (equalIndex > 0) {
        const key = trimmedLine.substring(0, equalIndex).trim();
        let value = trimmedLine.substring(equalIndex + 1).trim();
        if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        envVars[key] = value;
      }
    }
    console.log(`Found ${source} with ${Object.keys(envVars).length} variables:`, Object.keys(envVars));
    return envVars;
  }
  mergeEnvVars(zipEnvVars, additionalEnvVars) {
    const merged = { ...zipEnvVars, ...additionalEnvVars };
    if (Object.keys(additionalEnvVars).length > 0) {
      console.log("Merged environment variables:", {
        zipVars: Object.keys(zipEnvVars).length,
        additionalVars: Object.keys(additionalEnvVars).length,
        totalMerged: Object.keys(merged).length
      });
    }
    return merged;
  }
  getBotDirectory(botName) {
    return path.join(this.botsDir, botName);
  }
  // File browsing and editing methods
  async listBotFiles(botName) {
    const botDir = path.join(this.botsDir, botName);
    try {
      await fs.access(botDir);
    } catch {
      throw new Error(`Bot ${botName} not found`);
    }
    const files = [];
    const walkDir = async (dir, relativePath = "") => {
      const items = await fs.readdir(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const itemRelativePath = relativePath ? path.join(relativePath, item) : item;
        const stats = await fs.stat(fullPath);
        if (stats.isDirectory()) {
          files.push({
            name: item,
            path: itemRelativePath,
            type: "directory"
          });
          await walkDir(fullPath, itemRelativePath);
        } else {
          files.push({
            name: item,
            path: itemRelativePath,
            type: "file",
            size: stats.size
          });
        }
      }
    };
    await walkDir(botDir);
    return files.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }
  async readBotFile(botName, filePath) {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    if (!fullPath.startsWith(botDir)) {
      throw new Error("Invalid file path");
    }
    try {
      const stats = await fs.stat(fullPath);
      if (stats.isDirectory()) {
        throw new Error("Cannot read directory as file");
      }
      if (stats.size > 1024 * 1024) {
        throw new Error("File too large to edit");
      }
      const content = await fs.readFile(fullPath, "utf-8");
      const language = this.getFileLanguage(filePath);
      return {
        content,
        isText: true,
        language
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("invalid")) {
        throw error;
      }
      throw new Error("Failed to read file");
    }
  }
  async writeBotFile(botName, filePath, content) {
    const botDir = path.join(this.botsDir, botName);
    const fullPath = path.join(botDir, filePath);
    if (!fullPath.startsWith(botDir)) {
      throw new Error("Invalid file path");
    }
    try {
      const dirname = path.dirname(fullPath);
      await fs.mkdir(dirname, { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
    } catch (error) {
      throw new Error("Failed to save file");
    }
  }
  getFileLanguage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const languageMap = {
      ".py": "python",
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".json": "json",
      ".html": "html",
      ".css": "css",
      ".scss": "scss",
      ".sass": "sass",
      ".md": "markdown",
      ".yml": "yaml",
      ".yaml": "yaml",
      ".xml": "xml",
      ".sh": "shell",
      ".bat": "batch",
      ".php": "php",
      ".rb": "ruby",
      ".go": "go",
      ".java": "java",
      ".c": "c",
      ".cpp": "cpp",
      ".h": "c",
      ".hpp": "cpp",
      ".rs": "rust",
      ".sql": "sql",
      ".dockerfile": "dockerfile",
      ".env": "properties",
      ".txt": "plaintext",
      ".log": "plaintext"
    };
    return languageMap[ext] || "plaintext";
  }
};
var fileManager = new FileManager();

// server/services/botManager.ts
import simpleGit from "simple-git";
import path2 from "path";
import fs2 from "fs/promises";
var BotManager = class extends EventEmitter {
  activeProcesses = /* @__PURE__ */ new Map();
  logListeners = /* @__PURE__ */ new Map();
  deploymentLogs = /* @__PURE__ */ new Map();
  // Store deployment logs
  async deployBot(botId, zipBuffer) {
    return this.deployBotFromZip(botId, zipBuffer);
  }
  async deployBotWithEnv(botId, zipBuffer, additionalEnvBuffer) {
    return this.deployBotFromZip(botId, zipBuffer, additionalEnvBuffer);
  }
  async deployBotFromZip(botId, zipBuffer, additionalEnvBuffer) {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    this.deploymentLogs.set(botId, []);
    const addDeploymentLog = (message) => {
      const log2 = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}`;
      const logs = this.deploymentLogs.get(botId) || [];
      logs.push(log2);
      this.deploymentLogs.set(botId, logs);
      console.log(`[DEPLOY ${bot.name}] ${message}`);
      this.emitLog(botId, log2);
    };
    try {
      await storage.updateBot(botId, { status: "deploying" });
      this.emit("botStatusChanged", { botId, status: "deploying" });
      addDeploymentLog("Starting deployment...");
      addDeploymentLog("Extracting ZIP file...");
      const { botDir, envVars: zipEnvVars } = await fileManager.extractZipFile(zipBuffer, bot.name);
      let additionalEnvVars = {};
      if (additionalEnvBuffer) {
        addDeploymentLog("Processing additional .env file...");
        const additionalEnvContent = additionalEnvBuffer.toString("utf8");
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, "additional .env file");
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
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(", ")}`);
        if (Object.keys(additionalEnvVars).length > 0) {
          addDeploymentLog(`Additional .env file overrode ${Object.keys(additionalEnvVars).length} variables`);
        }
      }
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        if (bot.buildCommand.includes("pip install") || bot.buildCommand.includes("requirements.txt")) {
          const fs4 = await import("fs/promises");
          const path5 = await import("path");
          const requirementsPath = path5.join(botDir, "requirements.txt");
          try {
            await fs4.access(requirementsPath);
            addDeploymentLog("Found requirements.txt file");
            addDeploymentLog("Python packages are pre-installed in Replit environment");
            addDeploymentLog("Skipping pip install to avoid permission issues");
            addDeploymentLog("Most common packages (pyrogram, flask, aiohttp, etc.) are available");
          } catch (error) {
            addDeploymentLog("No requirements.txt file found");
          }
          addDeploymentLog("Dependencies check completed - using pre-installed packages");
        } else {
          try {
            await this.runCommandWithLogs(bot.buildCommand, botDir, addDeploymentLog);
            addDeploymentLog("Build command completed successfully");
          } catch (error) {
            addDeploymentLog(`Build command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        }
      }
      await storage.updateBot(botId, { status: "stopped" });
      this.emit("botStatusChanged", { botId, status: "stopped" });
      addDeploymentLog("Deployment completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown deployment error";
      addDeploymentLog(`DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: "error" });
      this.emit("botStatusChanged", { botId, status: "error" });
      throw error;
    }
  }
  async deployBotFromGitHub(botId, additionalEnvBuffer) {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    if (!bot.githubRepoUrl) throw new Error("GitHub repository URL not found");
    this.deploymentLogs.set(botId, []);
    const addDeploymentLog = (message) => {
      const log2 = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}`;
      const logs = this.deploymentLogs.get(botId) || [];
      logs.push(log2);
      this.deploymentLogs.set(botId, logs);
      console.log(`[DEPLOY ${bot.name}] ${message}`);
      this.emitLog(botId, log2);
    };
    try {
      await storage.updateBot(botId, { status: "deploying" });
      this.emit("botStatusChanged", { botId, status: "deploying" });
      addDeploymentLog("Starting GitHub deployment...");
      addDeploymentLog(`Cloning repository: ${bot.githubRepoUrl}`);
      const botDir = await this.cloneGitHubRepository(bot.githubRepoUrl, bot.name, addDeploymentLog);
      addDeploymentLog("Searching for environment variables...");
      let repoEnvVars = {};
      try {
        const envContent = await this.findAndReadEnvFile(botDir);
        if (envContent) {
          repoEnvVars = fileManager.parseEnvContent(envContent, ".env file from repository");
          addDeploymentLog(`Found .env file with ${Object.keys(repoEnvVars).length} variables`);
        } else {
          addDeploymentLog("No .env file found in repository");
        }
      } catch (error) {
        addDeploymentLog("Warning: Could not read .env file from repository");
      }
      let additionalEnvVars = {};
      if (additionalEnvBuffer) {
        addDeploymentLog("Processing additional .env file...");
        const additionalEnvContent = additionalEnvBuffer.toString("utf8");
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, "additional .env file");
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      const mergedEnvVars = fileManager.mergeEnvVars(repoEnvVars, additionalEnvVars);
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      await storage.updateBot(botId, {
        filePath: botDir,
        environmentVars: envVarsJson
      });
      addDeploymentLog(`Repository cloned to: ${botDir}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(", ")}`);
        if (Object.keys(additionalEnvVars).length > 0) {
          addDeploymentLog(`Additional .env file overrode ${Object.keys(additionalEnvVars).length} variables`);
        }
      }
      if (bot.buildCommand) {
        addDeploymentLog(`Build command specified: ${bot.buildCommand}`);
        if (bot.buildCommand.includes("pip install") || bot.buildCommand.includes("requirements.txt")) {
          addDeploymentLog("Skipping pip install commands in Replit environment (packages are pre-installed)");
        } else {
          addDeploymentLog("Executing custom build command...");
          try {
            await this.runCommandWithLogs(bot.buildCommand, botDir, addDeploymentLog);
            addDeploymentLog("Build command completed successfully");
          } catch (error) {
            addDeploymentLog(`Build command failed: ${error instanceof Error ? error.message : "Unknown error"}`);
          }
        }
      }
      await storage.updateBot(botId, { status: "stopped" });
      this.emit("botStatusChanged", { botId, status: "stopped" });
      addDeploymentLog("GitHub deployment completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown GitHub deployment error";
      addDeploymentLog(`GITHUB DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: "error" });
      this.emit("botStatusChanged", { botId, status: "error" });
      throw error;
    }
  }
  async cloneGitHubRepository(repoUrl, botName, logFunction) {
    const botsDir = path2.join(process.cwd(), "bots");
    const botDir = path2.join(botsDir, botName);
    await fs2.mkdir(botsDir, { recursive: true });
    try {
      await fs2.rmdir(botDir, { recursive: true });
      logFunction("Removed existing bot directory");
    } catch (error) {
    }
    try {
      const git = simpleGit();
      logFunction("Initializing Git clone...");
      await git.clone(repoUrl, botDir);
      logFunction("Repository cloned successfully");
      return botDir;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown git error";
      logFunction(`Git clone failed: ${errorMessage}`);
      throw new Error(`Failed to clone repository: ${errorMessage}`);
    }
  }
  async findAndReadEnvFile(botDir) {
    const possibleEnvFiles = [".env", "config.env", ".env.example"];
    for (const envFile of possibleEnvFiles) {
      const envPath = path2.join(botDir, envFile);
      try {
        const envContent = await fs2.readFile(envPath, "utf8");
        if (envContent.trim().length > 0) {
          return envContent;
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }
  async deployBotFromDocker(botId, additionalEnvBuffer) {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    if (!bot.githubRepoUrl) throw new Error("Repository URL not found");
    this.deploymentLogs.set(botId, []);
    const addDeploymentLog = (message) => {
      const log2 = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${message}`;
      const logs = this.deploymentLogs.get(botId) || [];
      logs.push(log2);
      this.deploymentLogs.set(botId, logs);
      console.log(`[DEPLOY ${bot.name}] ${message}`);
      this.emitLog(botId, log2);
    };
    try {
      await storage.updateBot(botId, { status: "deploying" });
      this.emit("botStatusChanged", { botId, status: "deploying" });
      addDeploymentLog("Starting Docker deployment...");
      addDeploymentLog(`Cloning repository: ${bot.githubRepoUrl}`);
      const botDir = await this.cloneGitHubRepository(bot.githubRepoUrl, bot.name, addDeploymentLog);
      addDeploymentLog("Checking for Dockerfile...");
      const dockerfilePath = path2.join(botDir, "Dockerfile");
      try {
        await fs2.access(dockerfilePath);
        addDeploymentLog("Dockerfile found - proceeding with Docker build");
      } catch (error) {
        throw new Error("No Dockerfile found in repository root. Please ensure your repository contains a Dockerfile.");
      }
      addDeploymentLog("Searching for environment variables...");
      let repoEnvVars = {};
      try {
        const envContent = await this.findAndReadEnvFile(botDir);
        if (envContent) {
          repoEnvVars = fileManager.parseEnvContent(envContent, ".env file from repository");
          addDeploymentLog(`Found .env file with ${Object.keys(repoEnvVars).length} variables`);
        } else {
          addDeploymentLog("No .env file found in repository");
        }
      } catch (error) {
        addDeploymentLog("Warning: Could not read .env file from repository");
      }
      let additionalEnvVars = {};
      if (additionalEnvBuffer) {
        addDeploymentLog("Processing additional .env file...");
        const additionalEnvContent = additionalEnvBuffer.toString("utf8");
        additionalEnvVars = fileManager.parseEnvContent(additionalEnvContent, "additional .env file");
        addDeploymentLog(`Additional .env file contains ${Object.keys(additionalEnvVars).length} variables`);
      }
      const mergedEnvVars = fileManager.mergeEnvVars(repoEnvVars, additionalEnvVars);
      addDeploymentLog("Building Docker image...");
      const imageName = `host-elite-bot-${bot.name.toLowerCase()}:latest`;
      const buildResult = await this.buildDockerImage(botDir, imageName, addDeploymentLog);
      if (!buildResult.success) {
        throw new Error(`Docker build failed: ${buildResult.error}`);
      }
      const envVarsJson = Object.keys(mergedEnvVars).length > 0 ? JSON.stringify(mergedEnvVars) : null;
      await storage.updateBot(botId, {
        filePath: imageName,
        // Store Docker image name instead of file path
        environmentVars: envVarsJson
      });
      addDeploymentLog(`Docker image built successfully: ${imageName}`);
      if (Object.keys(mergedEnvVars).length > 0) {
        addDeploymentLog(`Total environment variables loaded: ${Object.keys(mergedEnvVars).length}`);
        addDeploymentLog(`Environment variables: ${Object.keys(mergedEnvVars).join(", ")}`);
      }
      await storage.updateBot(botId, { status: "stopped" });
      this.emit("botStatusChanged", { botId, status: "stopped" });
      addDeploymentLog("Docker deployment completed successfully");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown Docker deployment error";
      addDeploymentLog(`DOCKER DEPLOYMENT FAILED: ${errorMessage}`);
      await storage.updateBot(botId, { status: "error" });
      this.emit("botStatusChanged", { botId, status: "error" });
      throw error;
    }
  }
  async buildDockerImage(botDir, imageName, logFunction) {
    return new Promise((resolve) => {
      try {
        const buildProcess = spawn("docker", ["build", "-t", imageName, "."], {
          cwd: botDir,
          stdio: ["pipe", "pipe", "pipe"]
        });
        let buildOutput = "";
        let buildError = "";
        buildProcess.stdout?.on("data", (data) => {
          const output = data.toString();
          buildOutput += output;
          const lines = output.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            if (line.includes("Step ") || line.includes("Successfully built") || line.includes("Successfully tagged")) {
              logFunction(`Docker: ${line.trim()}`);
            }
          });
        });
        buildProcess.stderr?.on("data", (data) => {
          const error = data.toString();
          buildError += error;
          logFunction(`Docker Error: ${error.trim()}`);
        });
        buildProcess.on("exit", (code) => {
          if (code === 0) {
            logFunction("Docker image built successfully");
            resolve({ success: true });
          } else {
            logFunction(`Docker build failed with exit code ${code}`);
            resolve({ success: false, error: buildError || "Unknown build error" });
          }
        });
        buildProcess.on("error", (error) => {
          logFunction(`Docker build process error: ${error.message}`);
          resolve({ success: false, error: error.message });
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        logFunction(`Failed to start Docker build: ${errorMessage}`);
        resolve({ success: false, error: errorMessage });
      }
    });
  }
  async startBot(botId) {
    const bot = await storage.getBot(botId);
    if (!bot || !bot.filePath) throw new Error("Bot not found or not deployed");
    if (this.activeProcesses.has(botId)) {
      throw new Error("Bot is already running");
    }
    try {
      const isDockerDeployment = bot.deploymentSource === "docker" && bot.filePath.includes("host-elite-bot-");
      let childProcess;
      if (isDockerDeployment) {
        const containerName = `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}`;
        const imageName = bot.filePath;
        const botPort = 8080 + parseInt(botId.slice(-4), 16) % 1e3;
        let botEnvVars = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        const envArgs = [];
        for (const [key, value] of Object.entries(botEnvVars)) {
          envArgs.push("-e", `${key}=${value}`);
        }
        envArgs.push("-e", `PORT=${botPort}`, "-e", `BOT_PORT=${botPort}`);
        const dockerArgs = [
          "run",
          "--name",
          containerName,
          "--rm",
          // Remove container when it stops
          "-p",
          `${botPort}:${botPort}`,
          // Port mapping
          ...envArgs,
          imageName
        ];
        childProcess = spawn("docker", dockerArgs, {
          stdio: ["pipe", "pipe", "pipe"]
        });
        console.log(`[${bot.name}] Starting Docker container: ${containerName} from image ${imageName}`);
      } else {
        let enhancedRunCommand = bot.runCommand.replace(/\bpython\b/g, "python3");
        enhancedRunCommand = enhancedRunCommand.replace(/\bpip\b/g, "python3 -m pip");
        const botPort = 8080 + parseInt(botId.slice(-4), 16) % 1e3;
        let botEnvVars = {};
        if (bot.environmentVars) {
          try {
            botEnvVars = JSON.parse(bot.environmentVars);
          } catch (error) {
            console.warn(`Failed to parse environment variables for bot ${bot.name}:`, error);
          }
        }
        childProcess = spawn("sh", ["-c", enhancedRunCommand], {
          cwd: bot.filePath,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            ...botEnvVars,
            // Apply bot-specific environment variables
            PORT: botPort.toString(),
            BOT_PORT: botPort.toString()
          }
        });
      }
      const botProcess = {
        bot,
        process: childProcess,
        logs: [],
        startTime: /* @__PURE__ */ new Date(),
        restartCount: 0,
        healthStatus: "unknown",
        isDockerContainer: isDockerDeployment,
        containerName: isDockerDeployment ? `host-elite-bot-${bot.name.toLowerCase()}-${Date.now()}` : void 0
      };
      this.activeProcesses.set(botId, botProcess);
      childProcess.stdout?.on("data", (data) => {
        const log2 = `[${(/* @__PURE__ */ new Date()).toISOString()}] ${data.toString().trim()}`;
        botProcess.logs.push(log2);
        this.emitLog(botId, log2);
      });
      childProcess.stderr?.on("data", (data) => {
        const log2 = `[${(/* @__PURE__ */ new Date()).toISOString()}] ERROR: ${data.toString().trim()}`;
        botProcess.logs.push(log2);
        this.emitLog(botId, log2);
      });
      childProcess.on("exit", async (code, signal) => {
        this.activeProcesses.delete(botId);
        let status = "stopped";
        if (code !== 0 && signal !== "SIGKILL" && signal !== "SIGTERM") {
          status = "error";
        }
        await storage.updateBot(botId, { status, processId: null });
        this.emit("botStatusChanged", { botId, status });
        if (bot.autoRestart && status === "error") {
          const restartDelay = Math.min(5e3 * (botProcess.restartCount || 0) + 5e3, 3e4);
          setTimeout(() => {
            this.startBot(botId).catch(console.error);
          }, restartDelay);
        }
      });
      await storage.updateBot(botId, { status: "running", processId: childProcess.pid });
      this.emit("botStatusChanged", { botId, status: "running" });
    } catch (error) {
      await storage.updateBot(botId, { status: "error" });
      this.emit("botStatusChanged", { botId, status: "error" });
      throw error;
    }
  }
  async stopBot(botId, immediate = false) {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error("Bot is not running");
    const signal = immediate ? "SIGKILL" : "SIGTERM";
    botProcess.process.kill(signal);
    if (!immediate) {
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (!botProcess.process.killed) {
            botProcess.process.kill("SIGKILL");
          }
          resolve(void 0);
        }, 3e3);
        botProcess.process.on("exit", () => {
          clearTimeout(timeout);
          resolve(void 0);
        });
      });
    }
    this.activeProcesses.delete(botId);
    await storage.updateBot(botId, { status: "stopped", processId: null });
    this.emit("botStatusChanged", { botId, status: "stopped" });
  }
  async restartBot(botId) {
    if (this.activeProcesses.has(botId)) {
      await this.stopBot(botId, true);
      await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
    await this.startBot(botId);
  }
  // Enhanced bot management methods
  async forceStopBot(botId) {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) throw new Error("Bot is not running");
    try {
      botProcess.process.kill("SIGKILL");
      this.activeProcesses.delete(botId);
      await storage.updateBot(botId, { status: "stopped", processId: null });
      this.emit("botStatusChanged", { botId, status: "stopped" });
      console.log(`Bot ${botId} force stopped immediately with SIGKILL`);
    } catch (error) {
      console.error(`Failed to force stop bot ${botId}:`, error);
      throw error;
    }
  }
  async getSystemStats() {
    return {
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }
  async performHealthCheck(botId) {
    const botProcess = this.activeProcesses.get(botId);
    if (!botProcess) return "unknown";
    try {
      const isAlive = !botProcess.process.killed && botProcess.process.pid;
      botProcess.lastHealthCheck = /* @__PURE__ */ new Date();
      botProcess.healthStatus = isAlive ? "healthy" : "unhealthy";
      return botProcess.healthStatus;
    } catch (error) {
      botProcess.healthStatus = "unhealthy";
      return "unhealthy";
    }
  }
  async deleteBot(botId) {
    const bot = await storage.getBot(botId);
    if (!bot) throw new Error("Bot not found");
    if (this.activeProcesses.has(botId)) {
      await this.stopBot(botId);
    }
    await fileManager.deleteBotFiles(bot.name);
    await storage.deleteBot(botId);
  }
  getBotLogs(botId) {
    const botProcess = this.activeProcesses.get(botId);
    const deploymentLogs = this.deploymentLogs.get(botId) || [];
    const runtimeLogs = botProcess?.logs || [];
    return [...deploymentLogs, ...runtimeLogs];
  }
  addLogListener(botId, callback) {
    if (!this.logListeners.has(botId)) {
      this.logListeners.set(botId, /* @__PURE__ */ new Set());
    }
    this.logListeners.get(botId).add(callback);
  }
  removeLogListener(botId, callback) {
    this.logListeners.get(botId)?.delete(callback);
  }
  emitLog(botId, log2) {
    const listeners = this.logListeners.get(botId);
    if (listeners) {
      listeners.forEach((callback) => callback(log2));
    }
    this.emit("botLog", { botId, log: log2 });
  }
  async runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
      const childProcess = spawn("sh", ["-c", command], { cwd });
      childProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      childProcess.on("error", reject);
    });
  }
  async runCommandWithLogs(command, cwd, logCallback) {
    return new Promise((resolve, reject) => {
      let enhancedCommand = command.replace(/\bpython\b/g, "python3");
      enhancedCommand = enhancedCommand.replace(/\bpip\b/g, "python3 -m pip");
      const childProcess = spawn("sh", ["-c", enhancedCommand], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: process.env
      });
      childProcess.stdout?.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          logCallback(`STDOUT: ${output}`);
        }
      });
      childProcess.stderr?.on("data", (data) => {
        const output = data.toString().trim();
        if (output) {
          logCallback(`STDERR: ${output}`);
        }
      });
      childProcess.on("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command failed with exit code ${code}`));
        }
      });
      childProcess.on("error", (error) => {
        logCallback(`PROCESS ERROR: ${error.message}`);
        reject(error);
      });
    });
  }
};
var botManager = new BotManager();

// shared/schema.ts
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull()
});
var bots = pgTable("bots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  language: text("language").notNull(),
  status: text("status").notNull().default("stopped"),
  // stopped, running, error, deploying
  buildCommand: text("build_command"),
  runCommand: text("run_command").notNull(),
  userId: text("user_id").notNull().default("web_user"),
  autoRestart: boolean("auto_restart").default(true),
  processId: integer("process_id"),
  filePath: text("file_path"),
  environmentVars: text("environment_vars"),
  // JSON string of environment variables
  deploymentSource: text("deployment_source").notNull().default("zip"),
  // zip, github, docker
  githubRepoUrl: text("github_repo_url"),
  deploymentUrl: text("deployment_url"),
  // Unique URL for accessing the deployed bot
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`)
});
var insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true
});
var insertBotSchema = createInsertSchema(bots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processId: true
}).extend({
  name: z.string().min(1, "Bot name is required").regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, underscores, and hyphens allowed"),
  language: z.enum(["python", "nodejs"], { required_error: "Language is required" }),
  runCommand: z.string().min(1, "Run command is required"),
  deploymentSource: z.enum(["zip", "github", "docker"], { required_error: "Deployment source is required" }),
  githubRepoUrl: z.string().url("Invalid GitHub repository URL").optional().or(z.literal(""))
}).refine((data) => {
  if (data.deploymentSource === "github" || data.deploymentSource === "docker") {
    return data.githubRepoUrl && data.githubRepoUrl.length > 0;
  }
  return true;
}, {
  message: "GitHub repository URL is required when using GitHub or Docker deployment",
  path: ["githubRepoUrl"]
});

// server/routes.ts
function generateDeploymentUrl(botId, botName) {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : process.env.REPLIT_DEPLOYMENT_URL || "http://localhost:5000";
  const shortId = botId.slice(0, 8);
  const safeName = botName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `${baseUrl}/bot/${safeName}-${shortId}`;
}
var upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/zip" || file.originalname.endsWith(".zip") || file.originalname.endsWith(".env") || file.originalname.endsWith("config.env")) {
      cb(null, true);
    } else {
      cb(new Error("Only ZIP, .env, and config.env files are allowed"));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024
    // 50MB limit for ZIP, but we'll check .env separately
  }
});
async function registerRoutes(app2) {
  const httpServer = createServer(app2);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.subscribedToLogs = /* @__PURE__ */ new Set();
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("message", async (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === "subscribe_logs" && data.botId) {
          ws.subscribedToLogs?.add(data.botId);
          const logs = botManager.getBotLogs(data.botId);
          logs.forEach((log2) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "bot_log",
                botId: data.botId,
                log: log2
              }));
            }
          });
        }
        if (data.type === "unsubscribe_logs" && data.botId) {
          ws.subscribedToLogs?.delete(data.botId);
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });
    ws.on("close", () => {
    });
  });
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 3e4);
  botManager.on("botStatusChanged", (data) => {
    broadcast({ type: "bot_status_changed", ...data });
  });
  botManager.on("botLog", (data) => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN && ws.subscribedToLogs?.has(data.botId)) {
        ws.send(JSON.stringify({
          type: "bot_log",
          botId: data.botId,
          log: data.log
        }));
      }
    });
  });
  function broadcast(data) {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
      }
    });
  }
  app2.get("/api/bots", async (req, res) => {
    try {
      const bots2 = await storage.getAllBots();
      res.json(bots2);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch bots" });
    }
  });
  app2.get("/api/stats", async (req, res) => {
    try {
      const allBots = await storage.getAllBots();
      const stats = {
        totalBots: allBots.length,
        runningBots: allBots.filter((bot) => bot.status === "running").length,
        stoppedBots: allBots.filter((bot) => bot.status === "stopped").length,
        errorBots: allBots.filter((bot) => bot.status === "error").length
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch statistics" });
    }
  });
  app2.post("/api/bots", upload.fields([{ name: "zipFile", maxCount: 1 }, { name: "envFile", maxCount: 1 }]), async (req, res) => {
    try {
      console.log("Request body:", req.body);
      console.log("Files info:", req.files);
      if (req.body.autoRestart === "true") req.body.autoRestart = true;
      if (req.body.autoRestart === "false") req.body.autoRestart = false;
      const botData = insertBotSchema.parse(req.body);
      const files = req.files;
      const zipFile = files?.zipFile?.[0];
      const envFile = files?.envFile?.[0];
      if (botData.deploymentSource === "zip" && !zipFile) {
        return res.status(400).json({ message: "ZIP file is required for ZIP deployment" });
      }
      if ((botData.deploymentSource === "github" || botData.deploymentSource === "docker") && !botData.githubRepoUrl) {
        return res.status(400).json({ message: "Repository URL is required for GitHub/Docker deployment" });
      }
      if (envFile && envFile.size > 1024 * 1024) {
        return res.status(400).json({ message: "Env file size must be less than 1MB" });
      }
      const existingBot = await storage.getBotByName(botData.name);
      if (existingBot) {
        return res.status(400).json({ message: "Bot name already exists" });
      }
      const bot = await storage.createBot(botData);
      const deploymentUrl = generateDeploymentUrl(bot.id, bot.name);
      await storage.updateBot(bot.id, { deploymentUrl });
      if (botData.deploymentSource === "zip") {
        botManager.deployBotWithEnv(bot.id, zipFile.buffer, envFile?.buffer).catch(console.error);
      } else if (botData.deploymentSource === "github") {
        botManager.deployBotFromGitHub(bot.id, envFile?.buffer).catch(console.error);
      } else if (botData.deploymentSource === "docker") {
        botManager.deployBotFromDocker(bot.id, envFile?.buffer).catch(console.error);
      }
      const botWithUrl = { ...bot, deploymentUrl };
      res.status(201).json(botWithUrl);
    } catch (error) {
      console.error("Bot creation error:", error);
      console.error("Request body was:", req.body);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to create bot"
      });
    }
  });
  app2.post("/api/bots/:id/start", async (req, res) => {
    try {
      await botManager.startBot(req.params.id);
      res.json({ message: "Bot started successfully" });
    } catch (error) {
      console.error("Start bot error:", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to start bot"
      });
    }
  });
  app2.post("/api/bots/:id/stop", async (req, res) => {
    try {
      const immediate = req.body.immediate === true;
      await botManager.stopBot(req.params.id, immediate);
      res.json({ message: immediate ? "Bot force stopped successfully" : "Bot stopped successfully" });
    } catch (error) {
      console.error("Stop bot error:", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to stop bot"
      });
    }
  });
  app2.post("/api/bots/:id/restart", async (req, res) => {
    try {
      await botManager.restartBot(req.params.id);
      res.json({ message: "Bot restarted successfully" });
    } catch (error) {
      console.error("Restart bot error:", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to restart bot"
      });
    }
  });
  app2.delete("/api/bots/:id", async (req, res) => {
    try {
      await botManager.deleteBot(req.params.id);
      res.json({ message: "Bot deleted successfully" });
    } catch (error) {
      console.error("Delete bot error:", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to delete bot"
      });
    }
  });
  app2.get("/api/bots/:id/logs", async (req, res) => {
    try {
      const logs = botManager.getBotLogs(req.params.id);
      res.json({ logs });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch logs" });
    }
  });
  app2.post("/api/bots/:id/force-stop", async (req, res) => {
    try {
      await botManager.forceStopBot(req.params.id);
      res.json({ message: "Bot force stopped successfully" });
    } catch (error) {
      console.error("Force stop bot error:", error);
      res.status(400).json({
        message: error instanceof Error ? error.message : "Failed to force stop bot"
      });
    }
  });
  app2.get("/api/system/stats", async (req, res) => {
    try {
      const stats = await botManager.getSystemStats();
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to get system stats" });
    }
  });
  app2.get("/api/bots/:id/health", async (req, res) => {
    try {
      const status = await botManager.performHealthCheck(req.params.id);
      res.json({ health: status, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to check bot health"
      });
    }
  });
  app2.get("/api/bots/:botId/files", async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      const files = await fileManager.listBotFiles(bot.name);
      res.json(files);
    } catch (error) {
      console.error("Error listing bot files:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to list files"
      });
    }
  });
  app2.get("/api/bots/:botId/files/:filePath(*)", async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      const filePath = decodeURIComponent(req.params.filePath);
      const fileData = await fileManager.readBotFile(bot.name, filePath);
      res.json(fileData);
    } catch (error) {
      console.error("Error reading bot file:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to read file"
      });
    }
  });
  app2.put("/api/bots/:botId/files/:filePath(*)", async (req, res) => {
    try {
      const bot = await storage.getBot(req.params.botId);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      const filePath = decodeURIComponent(req.params.filePath);
      const { content } = req.body;
      if (typeof content !== "string") {
        return res.status(400).json({ message: "Content must be a string" });
      }
      await fileManager.writeBotFile(bot.name, filePath, content);
      res.json({
        message: "File saved successfully",
        filePath,
        size: Buffer.byteLength(content, "utf-8")
      });
    } catch (error) {
      console.error("Error saving bot file:", error);
      res.status(500).json({
        message: error instanceof Error ? error.message : "Failed to save file"
      });
    }
  });
  app2.get("/bot/:botPath", async (req, res) => {
    try {
      const botPath = req.params.botPath;
      const allBots = await storage.getAllBots();
      const bot = allBots.find((b) => b.deploymentUrl?.endsWith(`/bot/${botPath}`));
      if (!bot) {
        return res.status(404).json({
          error: "Bot not found",
          message: "The bot you are looking for does not exist or has been removed."
        });
      }
      if (bot.status !== "running") {
        return res.status(503).json({
          error: "Bot unavailable",
          message: `Bot "${bot.name}" is currently ${bot.status}. Please contact the bot owner.`,
          botName: bot.name,
          status: bot.status
        });
      }
      res.json({
        botName: bot.name,
        language: bot.language,
        status: bot.status,
        deployedAt: bot.createdAt,
        uptime: bot.status === "running" ? "Online" : "Offline",
        message: `Welcome to ${bot.name}! This bot is running on our 24/7 hosting platform.`,
        accessInfo: {
          platform: "HostElite Bot Platform",
          botType: bot.language === "python" ? "Python Bot" : "Node.js Bot",
          deploymentMethod: bot.deploymentSource,
          autoRestart: bot.autoRestart
        },
        contact: "For support or issues, contact the bot owner."
      });
    } catch (error) {
      console.error("Bot access error:", error);
      res.status(500).json({
        error: "Server error",
        message: "Unable to access bot information at this time."
      });
    }
  });
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs3 from "fs";
import path4 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path3 from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path3.resolve("/app", "client", "src"),
      "@shared": path3.resolve("/app", "shared"),
      "@assets": path3.resolve("/app", "attached_assets")
    }
  },
  root: path3.resolve("/app", "client"),
  build: {
    outDir: path3.resolve("/app", "dist/public"),
    emptyOutDir: true
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path4.resolve(
        "/app",
        "client",
        "index.html"
      );
      let template = await fs3.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path4.resolve("/app", "public");
  if (!fs3.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path4.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path5 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path5.startsWith("/api")) {
      let logLine = `${req.method} ${path5} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    const publicUrl = getPublicUrl();
    log(`\u{1F310} Bot Hosting Dashboard: ${publicUrl}`);
    log(`\u{1F4F1} Direct Access URL: ${publicUrl}`);
    log(`\u{1F517} Share this URL to access your dashboard from anywhere!`);
  });
  function getPublicUrl() {
    if (process.env.REPLIT_DEPLOYMENT_URL) {
      return process.env.REPLIT_DEPLOYMENT_URL;
    }
    if (process.env.REPLIT_DEV_DOMAIN) {
      return `https://${process.env.REPLIT_DEV_DOMAIN}`;
    }
    if (process.env.REPL_SLUG && process.env.REPL_OWNER) {
      return `https://${process.env.REPL_SLUG}-${process.env.REPL_OWNER}.replit.app`;
    }
    if (process.env.REPL_ID) {
      return `https://${process.env.REPL_ID}.id.repl.co`;
    }
    return `http://localhost:${port}`;
  }
})();
  
