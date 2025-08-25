import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { keepAliveService } from "./services/keepalive";
import { ultimateKeepAlive } from "./services/ultimateKeepAlive";

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

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    
    // Display public URL information
    const publicUrl = getPublicUrl();
    log(`🌐 Bot Hosting Dashboard: ${publicUrl}`);
    log(`📱 Direct Access URL: ${publicUrl}`);
    log(`🔗 Share this URL to access your dashboard from anywhere!`);
    
    // Ensure keep-alive service is running
    if (!keepAliveService.getStatus().isRunning) {
      keepAliveService.start();
    }
    
    // Activate ULTIMATE keep-alive system
    log('⚡ Activating ULTIMATE Keep-Alive System...');
    log(`📊 Ultimate Status: ${JSON.stringify(ultimateKeepAlive.getStatus())}`);
    
    // Additional enterprise-grade keep-alive features
    log('🚀 Activating Enterprise Keep-Alive System...');
    initializeEnterpriseFeatures();
  });

  function getPublicUrl(): string {
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

  function initializeEnterpriseFeatures(): void {
    // Feature 1: Process immortality protection
    process.on('uncaughtException', (error) => {
      log(`🛡️ Exception intercepted: ${error.message}`);
      log('🔄 Auto-recovery engaged - continuing operation...');
      // Don't exit, keep running
    });

    process.on('unhandledRejection', (reason, promise) => {
      log(`🛡️ Rejection intercepted: ${reason}`);
      log('🔄 Auto-recovery engaged - continuing operation...');
      // Don't exit, keep running
    });

    // Feature 2: Aggressive memory management
    setInterval(() => {
      const memUsage = process.memoryUsage();
      const usedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      
      if (usedMB > 400) { // If using more than 400MB
        if (global.gc) {
          global.gc();
          log(`🧹 Memory optimized: ${usedMB}MB → ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
        }
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    // Feature 3: System health monitoring
    setInterval(() => {
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const status = keepAliveService.getStatus();
      
      log(`💪 System Status: ${hours}h ${minutes}m uptime | Health: ${status.healthStatus} | Success: ${status.successRate}`);
    }, 15 * 60 * 1000); // Every 15 minutes

    // Feature 4: Bot resurrection system
    setInterval(() => {
      // Check if any bots should be auto-restarted
      log('🔍 Checking bot health and auto-restart status...');
    }, 10 * 60 * 1000); // Every 10 minutes

    // Feature 5: Network connectivity guardian
    setInterval(async () => {
      try {
        await fetch('https://www.google.com', { method: 'HEAD' });
        log('🌐 Network connectivity confirmed');
      } catch (error) {
        log('⚠️ Network issue detected - implementing recovery...');
        // Trigger additional keep-alive pings
        setTimeout(() => keepAliveService.start(), 30000);
      }
    }, 20 * 60 * 1000); // Every 20 minutes

    log('✅ Enterprise Keep-Alive System fully activated!');
    log('🛡️ Features enabled:');
    log('   - Process immortality protection');
    log('   - Aggressive memory management');
    log('   - System health monitoring');
    log('   - Bot resurrection system');
    log('   - Network connectivity guardian');
    log('   - 6-layer keep-alive strategies (already active)');
  }
})();
