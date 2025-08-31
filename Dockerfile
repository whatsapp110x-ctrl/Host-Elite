# Multi-stage Dockerfile for Host-Elite Bot Hosting Platform
FROM node:18-alpine AS base

# Install necessary dependencies for building
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git \
    curl

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies including dev dependencies for build
RUN npm install

# Copy source code and config files
COPY . .

# Build stage - Build the frontend
FROM base AS builder

# Set environment variables for production build
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=4096"
ENV VITE_NODE_ENV=production

# Build the application (frontend + backend)
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    python3 \
    make \
    g++ \
    git

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hostapp -u 1001 -G nodejs

# Set production environment variables
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder --chown=hostapp:nodejs /app/dist ./dist

# Copy necessary runtime files from builder stage
COPY --from=builder --chown=hostapp:nodejs /app/shared ./shared
COPY --from=builder --chown=hostapp:nodejs /app/templates ./templates

# Create directories for bot files with proper permissions
RUN mkdir -p bots deployed_bots logs && \
    chown -R hostapp:nodejs bots deployed_bots logs

# Switch to non-root user
USER hostapp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/api/health || exit 1

# Expose port (Render will set PORT environment variable)
EXPOSE ${PORT:-5000}

# Start the application
CMD ["node", "dist/index.js"]
