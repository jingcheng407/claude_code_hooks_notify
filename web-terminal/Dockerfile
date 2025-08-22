# Use official Node.js runtime as base image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install system dependencies for node-pty
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    bash \
    zsh \
    fish

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S terminal -u 1001 -G nodejs

# Create necessary directories
RUN mkdir -p /app/logs && \
    chown -R terminal:nodejs /app

# Switch to non-root user
USER terminal

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "const http = require('http'); \
        const options = { hostname: 'localhost', port: 3000, path: '/health', timeout: 2000 }; \
        const req = http.request(options, (res) => { \
            process.exit(res.statusCode === 200 ? 0 : 1); \
        }); \
        req.on('error', () => process.exit(1)); \
        req.end();"

# Start the application
CMD ["npm", "start"]