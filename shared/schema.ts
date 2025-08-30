import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const bots = pgTable("bots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  language: text("language").notNull(),
  status: text("status").notNull().default("stopped"), // stopped, running, error, deploying
  buildCommand: text("build_command"),
  runCommand: text("run_command").notNull(),
  userId: text("user_id").notNull().default("web_user"),
  autoRestart: boolean("auto_restart").default(true),
  processId: integer("process_id"),
  filePath: text("file_path"),
  environmentVars: text("environment_vars"), // JSON string of environment variables
  deploymentSource: text("deployment_source").notNull().default("zip"), // zip, github, docker
  githubRepoUrl: text("github_repo_url"),
  deploymentUrl: text("deployment_url"), // Unique URL for accessing the deployed bot
  telegramUserId: text("telegram_user_id"), // Telegram user ID who owns this bot
  autoDetectedEntryFile: text("auto_detected_entry_file"), // Auto-detected main file
  hasDockerfile: boolean("has_dockerfile").default(false),
  hasRequirements: boolean("has_requirements").default(false),
  lastLogLines: text("last_log_lines"), // Store last 20 lines of logs
  uptime: integer("uptime").default(0), // Uptime in seconds
  createdAt: timestamp("created_at").default(sql`now()`),
  updatedAt: timestamp("updated_at").default(sql`now()`),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export const insertBotSchema = createInsertSchema(bots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  processId: true,
}).extend({
  name: z.string().min(1, "Bot name is required").regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, underscores, and hyphens allowed"),
  language: z.enum(["python", "nodejs"], { required_error: "Language is required" }),
  runCommand: z.string().min(1, "Run command is required"),
  deploymentSource: z.enum(["zip", "github", "docker"], { required_error: "Deployment source is required" }),
  githubRepoUrl: z.string().url("Invalid GitHub repository URL").optional().or(z.literal("")),
}).refine((data) => {
  if (data.deploymentSource === "github" || data.deploymentSource === "docker") {
    return data.githubRepoUrl && data.githubRepoUrl.length > 0;
  }
  return true;
}, {
  message: "GitHub repository URL is required when using GitHub or Docker deployment",
  path: ["githubRepoUrl"],
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof bots.$inferSelect;
