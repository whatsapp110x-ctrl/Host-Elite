# Use Node.js official image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Create directories for bot files
RUN mkdir -p bots deployed_bots

# Expose port
EXPOSE 5000

# Set production environment and memory limit
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=400"

# Start the application directly with node for better memory efficiency
CMD ["node", "dist/index.js"]
