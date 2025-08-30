import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { telegramBotService } from "./services/telegramBotService";

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));

// Set trust proxy for Render
app.set('trust proxy', 1);

// CORS and security headers for production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    next();
  });
}

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

    log(`Error ${status}: ${message}`);
    res.status(status).json({ message });
  });

  // Setup Vite in development, serve static files in production
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`🚀 Host-Elite Platform serving on port ${port}`);
    
    // Display public URL information
    const publicUrl = getPublicUrl();
    log(`🌐 Bot Hosting Dashboard: ${publicUrl}`);
    log(`📱 Direct Access URL: ${publicUrl}`);
    log(`🔗 Share this URL to access your dashboard from anywhere!`);
    log(`💚 Health Check: ${publicUrl}/api/health`);
    
    // Initialize Telegram bot service if token is available
    const botService = telegramBotService.getInstance();
    if (botService) {
      log('🤖 Telegram Bot Service initialized successfully');
    } else {
      log('⚠️  Telegram Bot Service disabled (no TELEGRAM_BOT_TOKEN)');
    }
  });

  function getPublicUrl(): string {
    // Render-specific URL detection
    if (process.env.RENDER_SERVICE_NAME) {
      return `https://${process.env.RENDER_SERVICE_NAME}.onrender.com`;
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
      // Fallback URL pattern
      return `https://${process.env.REPL_ID}.id.repl.co`;
    }
    
    return `http://localhost:${port}`;
  }

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      log('Process terminated');
      process.exit(0);
    });
  });

})();
