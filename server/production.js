const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Basic logging
const log = (message) => {
  console.log(`${new Date().toLocaleTimeString()} [express] ${message}`);
};

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Host-Elite Bot Platform',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024)
    },
    environment: process.env.NODE_ENV || 'production'
  });
});

// Status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    platform: 'Host-Elite',
    version: '2.0.0',
    status: 'operational',
    timestamp: new Date().toISOString()
  });
});

// Ping endpoint
app.get('/api/ping', (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

// Main dashboard
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Host-Elite Bot Platform</title>
        <style>
            body { 
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                margin: 0; 
                padding: 0; 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
            }
            .container { 
                text-align: center; 
                padding: 2rem;
                background: rgba(255,255,255,0.1);
                border-radius: 20px;
                backdrop-filter: blur(10px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.3);
            }
            h1 { 
                font-size: 3rem; 
                margin-bottom: 1rem;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            }
            .status { 
                color: #4ade80; 
                font-weight: bold; 
                font-size: 1.2rem;
            }
            .features {
                margin-top: 2rem;
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 1rem;
            }
            .feature {
                background: rgba(255,255,255,0.1);
                padding: 1rem;
                border-radius: 10px;
                border: 1px solid rgba(255,255,255,0.2);
            }
            .api-links {
                margin-top: 2rem;
            }
            .api-links a {
                color: #60a5fa;
                text-decoration: none;
                margin: 0 1rem;
                padding: 0.5rem 1rem;
                border: 1px solid #60a5fa;
                border-radius: 5px;
                display: inline-block;
                margin-bottom: 0.5rem;
            }
            .api-links a:hover {
                background: #60a5fa;
                color: white;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🤖 Host-Elite Bot Platform</h1>
            <p>Advanced bot hosting and management platform</p>
            <p class="status">Platform Status: Operational ✅</p>
            
            <div class="features">
                <div class="feature">
                    <h3>🚀 Bot Deployment</h3>
                    <p>Deploy Python & Node.js bots</p>
                </div>
                <div class="feature">
                    <h3>📊 Real-time Monitoring</h3>
                    <p>Live logs and status tracking</p>
                </div>
                <div class="feature">
                    <h3>🔧 Management API</h3>
                    <p>Full REST API access</p>
                </div>
                <div class="feature">
                    <h3>🔒 Secure Hosting</h3>
                    <p>Environment variables & security</p>
                </div>
            </div>
            
            <div class="api-links">
                <a href="/api/health">Health Check</a>
                <a href="/api/status">Platform Status</a>
                <a href="/api/ping">Ping Test</a>
            </div>
            
            <p style="margin-top: 2rem; opacity: 0.8;">
                Platform Version: 2.0.0 | Runtime: Node.js ${process.version}
            </p>
        </div>
    </body>
    </html>
  `);
});

// Start server
const port = parseInt(process.env.PORT || '5000', 10);
app.listen(port, '0.0.0.0', () => {
  log(`🌐 Host-Elite Platform serving on port ${port}`);
  log(`📱 Dashboard: http://localhost:${port}`);
  log(`🔗 Platform is ready for bot hosting!`);
});
