FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (uses npm install, not npm ci)
RUN npm install

# Copy the rest of the code
COPY . .

# Build the application
RUN npm run build

# Expose the port
EXPOSE 5000

# Start the application
CMD ["npm", "start"]
