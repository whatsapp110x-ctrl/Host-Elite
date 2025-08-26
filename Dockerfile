# Use Node.js official image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

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

# Verify build output
RUN ls -la dist/ && ls -la dist/public/ && echo "Build verification complete"

# Create additional required directories
RUN mkdir -p bots deployed_bots

# Expose port (Render will set PORT environment variable)
EXPOSE 5000

# Start the application with explicit production mode
CMD ["sh", "-c", "NODE_ENV=production npm start"]
