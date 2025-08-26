# Use Node.js official image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev dependencies needed for build)
RUN npm ci

# Copy configuration files
COPY vite.config.ts tsconfig.json tailwind.config.ts postcss.config.js components.json drizzle.config.ts ./

# Copy source directories
COPY client/ ./client/
COPY server/ ./server/
COPY shared/ ./shared/
COPY bots/ ./bots/
COPY deployed_bots/ ./deployed_bots/
COPY attached_assets/ ./attached_assets/

# Build the application
RUN npm run build

# Don't remove dev dependencies - keep them for production server
# RUN npm prune --production

# Expose port
EXPOSE $PORT

# Start the application  
CMD ["npm", "start"]
