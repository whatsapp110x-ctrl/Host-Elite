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

# Copy all source files at once
COPY . .

# Create required directories if they don't exist
RUN mkdir -p attached_assets bots deployed_bots dist

# Build the application
RUN npm run build

# Remove dev dependencies after build to reduce image size
RUN npm prune --production

# Expose port
EXPOSE $PORT

# Start the application  
CMD ["npm", "start"]
