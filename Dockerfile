# Single-stage Dockerfile for Host-Elite Bot Hosting Platform
FROM node:18-alpine

# Install necessary dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hostapp -u 1001 -G nodejs

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install && npm cache clean --force

# Copy all application files
COPY --chown=hostapp:nodejs . .

# Create directories for bot files with proper permissions
RUN mkdir -p bots deployed_bots logs dist && \
    chown -R hostapp:nodejs bots deployed_bots logs dist

# Switch to non-root user
USER hostapp

# Set environment variables for production
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/api/health || exit 1

# Expose port (Render will set PORT environment variable)
EXPOSE ${PORT:-5000}

# Start the application using npx tsx directly
CMD ["npx", "tsx", "server/index.ts"]
