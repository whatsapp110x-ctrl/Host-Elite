# Multi-stage build for Host-Elite Platform
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install system dependencies including Python for native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl \
    && ln -sf python3 /usr/bin/python

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

FROM base AS deps

# Copy package files
COPY package*.json ./

# Install dependencies with verbose logging
RUN npm ci --only=production --verbose

FROM base AS builder

# Copy package files
COPY package*.json ./

# Install all dependencies including dev dependencies
RUN npm ci --verbose

# Copy source code
COPY . .

# Build the application with error handling
RUN npm run build || (echo "Build failed, showing logs..." && cat /app/dist/build.log 2>/dev/null || echo "No build log found" && exit 1)

FROM base AS runner

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 hostElite

# Copy built application
COPY --from=builder --chown=hostElite:nodejs /app/dist ./dist
COPY --from=builder --chown=hostElite:nodejs /app/client/dist ./client/dist
COPY --from=deps --chown=hostElite:nodejs /app/node_modules ./node_modules
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
