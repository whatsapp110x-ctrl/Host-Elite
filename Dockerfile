# Use Node.js official image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies needed for build)
RUN npm ci

# Copy configuration files first
COPY vite.config.ts ./
COPY tsconfig.json ./
COPY tailwind.config.ts ./
COPY postcss.config.js ./
COPY components.json ./
COPY drizzle.config.ts ./

# Create and copy required directories
COPY client/ ./client/
COPY server/ ./server/
COPY shared/ ./shared/
COPY bots/ ./bots/
COPY deployed_bots/ ./deployed_bots/

# Create attached_assets directory and copy any assets (create empty if not exists)
RUN mkdir -p attached_assets
COPY attached_assets/ ./attached_assets/ 2>/dev/null || true

# Build the application
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Expose port
EXPOSE $PORT

# Start the application
CMD ["npm", "start"]
