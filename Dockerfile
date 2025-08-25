# Use Node.js official image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Create directories for bot files
RUN mkdir -p bots deployed_bots

# Expose port
EXPOSE $PORT

# Start the application
CMD ["npm", "start"]