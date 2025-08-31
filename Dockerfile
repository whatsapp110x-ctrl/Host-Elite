# Use Node.js 20 LTS
FROM node:20-alpine AS builder

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl \
    && ln -sf python3 /usr/bin/python

# Set npm configuration
RUN npm config set legacy-peer-deps true
RUN npm config set fund false
RUN npm config set audit false

# Copy package files first for better caching
COPY package*.json ./
COPY .npmrc ./

# Clear npm cache and install dependencies
RUN npm cache clean --force
RUN npm install --legacy-peer-deps --silent

# Copy configuration files
COPY tailwind.config.js ./
COPY postcss.config.js ./
COPY tsconfig.json ./
COPY vite.config.ts ./

# Copy all source code
COPY . .

# Create client directory structure if missing
RUN mkdir -p client/src client/dist client/public

# Ensure index.html exists in client directory
RUN if [ ! -f client/index.html ]; then \
    echo '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Host-Elite Platform</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>' > client/index.html; \
    fi

# Build the application with better error handling
RUN npm run build || (echo "Build failed, checking errors:" && ls -la && exit 1)

# Production stage
FROM node:20-alpine AS production

# Install curl for health checks
RUN apk add --no-cache curl

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S hostElite -u 1001

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=hostElite:nodejs /app/dist ./dist
COPY --from=builder --chown=hostElite:nodejs /app/client/dist ./client/dist
COPY --from=builder --chown=hostElite:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=hostElite:nodejs /app/package*.json ./

# Create necessary directories
RUN mkdir -p bots deployed_bots logs temp uploads && \
    chown -R hostElite:nodejs /app

# Switch to non-root user
USER hostElite

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT}/api/health || exit 1

# Start the application
CMD ["node", "dist/index.js"]
