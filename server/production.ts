import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import { fileURLToPath } from 'url';
import { registerRoutes } from "./routes.js";
import { telegramBotService } from "./services/telegramBotService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Serve static files
app.use(express.static(path.join(__dirname, '../dist')));

const log = (message: string) => {
  console.log(`${new Date().toLocaleTimeString()} [express] ${message}`);
};

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
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
    console.error(err);
  });

  // Serve React app for all non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });

  const port = parseInt(process.env.PORT || '5000', 10);
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`🌐 Bot Hosting Dashboard: http://localhost:${port}`);
    
    // Initialize Telegram bot service if token is available
    const botService = telegramBotService.getInstance();
    if (botService) {
      log('🤖 Telegram Bot Service initialized successfully');
    } else {
      log('⚠️  Telegram Bot Service disabled (no TELEGRAM_BOT_TOKEN)');
    }
  });
})();
