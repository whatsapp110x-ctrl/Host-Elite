import { type User, type InsertUser, type Bot, type InsertBot } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Bot operations
  getAllBots(): Promise<Bot[]>;
  getBot(id: string): Promise<Bot | undefined>;
  getBotByName(name: string): Promise<Bot | undefined>;
  createBot(bot: InsertBot): Promise<Bot>;
  updateBot(id: string, updates: Partial<Bot>): Promise<Bot | undefined>;
  deleteBot(id: string): Promise<boolean>;
  getBotsByStatus(status: string): Promise<Bot[]>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private bots: Map<string, Bot>;

  constructor() {
    this.users = new Map();
    this.bots = new Map();
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  async getAllBots(): Promise<Bot[]> {
    return Array.from(this.bots.values());
  }

  async getBot(id: string): Promise<Bot | undefined> {
    return this.bots.get(id);
  }

  async getBotByName(name: string): Promise<Bot | undefined> {
    return Array.from(this.bots.values()).find(bot => bot.name === name);
  }

  async createBot(insertBot: InsertBot): Promise<Bot> {
    const id = randomUUID();
    const now = new Date();
    const bot: Bot = { 
      ...insertBot, 
      id,
      status: insertBot.status || 'stopped',
      buildCommand: insertBot.buildCommand || null,
      userId: insertBot.userId || 'web_user',
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

  async updateBot(id: string, updates: Partial<Bot>): Promise<Bot | undefined> {
    const bot = this.bots.get(id);
    if (!bot) return undefined;
    
    const updatedBot = { ...bot, ...updates, updatedAt: new Date() };
    this.bots.set(id, updatedBot);
    return updatedBot;
  }

  async deleteBot(id: string): Promise<boolean> {
    return this.bots.delete(id);
  }

  async getBotsByStatus(status: string): Promise<Bot[]> {
    return Array.from(this.bots.values()).filter(bot => bot.status === status);
  }
}

export const storage = new MemStorage();
