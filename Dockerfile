# Use Node.js official image
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies in development mode for build
RUN npm ci

# Copy all files 
COPY . .

# Create required directories
RUN mkdir -p attached_assets bots deployed_bots dist

# Set NODE_ENV for build
ENV NODE_ENV=development

# Build frontend
RUN npx vite build

# Build backend with explicit options to handle import.meta.dirname
RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist --define:import.meta.dirname='"/app"'

# Verify and fix build structure - the server expects public directory next to the compiled server
RUN ls -la dist/ && \
    if [ -d "dist/public" ]; then \
      echo "Build structure is correct"; \
    else \
      echo "Creating missing directories" && mkdir -p dist/public; \
    fi

# Set production environment for runtime
ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Start the application with explicit environment and working directory
WORKDIR /app
CMD ["sh", "-c", "PORT=${PORT:-5000} NODE_ENV=production node dist/index.js"]
