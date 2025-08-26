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

# Build the frontend and backend separately
RUN cd client && npx vite build
RUN npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

# Set production environment for runtime
ENV NODE_ENV=production

# Expose port
EXPOSE 5000

# Start the application
CMD ["node", "dist/index.js"]
