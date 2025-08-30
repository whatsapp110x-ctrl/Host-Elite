import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { telegramBotService } from "./services/telegramBotService";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Production vs Development setup
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    
    // Display public URL information
    const publicUrl = getPublicUrl();
    log(`🌐 Bot Hosting Dashboard: ${publicUrl}`);
    log(`📱 Direct Access URL: ${publicUrl}`);
    log(`🔗 Share this URL to access your dashboard from anywhere!`);
    
    // Initialize Telegram bot service if token is available
    const botService = telegramBotService.getInstance();
    if (botService) {
      log('🤖 Telegram Bot Service initialized successfully');
    } else {
      log('⚠️  Telegram Bot Service disabled (no TELEGRAM_BOT_TOKEN)');
    }
  });

  function getPublicUrl(): string {
    // Check for Render environment
    if (process.env.RENDER) {
      return `https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'your-app.onrender.com'}`;
    }
    
    // Multiple ways to detect the public URL
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
