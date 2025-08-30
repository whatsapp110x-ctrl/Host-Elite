# Use Node.js 18 LTS Alpine
FROM node:18-alpine AS base

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create directories for bot files and logs
RUN mkdir -p bots deployed_bots logs temp

# Set proper permissions
RUN chmod -R 755 bots deployed_bots logs temp

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S hostElite -u 1001
RUN chown -R hostElite:nodejs /app
USER hostElite

# Expose port
EXPOSE $PORT

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/api/health || exit 1

# Start the application
CMD ["npm", "start"]
