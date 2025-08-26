# Use Node.js official image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy only production dependencies first
COPY package*.json ./

# Install all dependencies (server imports vite at runtime)
RUN npm ci

# Copy the pre-built dist folder
COPY dist ./dist

# Copy the public folder to the expected location (server looks for /app/public)
COPY dist/public ./public

# Copy other necessary folders
COPY attached_assets ./attached_assets
COPY bots ./bots
COPY deployed_bots ./deployed_bots

# Create any missing directories
RUN mkdir -p bots deployed_bots

# Set production environment
ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Start the application
CMD ["sh", "-c", "PORT=${PORT:-5000} node dist/index.js"]
