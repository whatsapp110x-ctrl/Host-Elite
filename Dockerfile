FROM node:18-alpine

WORKDIR /app

# Install only production dependencies first
COPY package*.json ./
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove node_modules and reinstall only production deps to save memory
RUN rm -rf node_modules && npm ci --only=production

# Expose port
EXPOSE 5000

# Set memory limit and optimize Node.js for production
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=400"

# Start the application
CMD ["node", "dist/index.js"]
