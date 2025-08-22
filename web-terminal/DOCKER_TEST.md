# Docker Deployment Test Instructions

## Prerequisites

1. Docker and Docker Compose installed
2. Docker daemon running

## Test Steps

### 1. Build and Run with Docker Compose

```bash
# Build and start all services
docker-compose up --build

# Or run in background
docker-compose up -d --build

# View logs
docker-compose logs -f web-terminal
```

### 2. Manual Docker Build (Alternative)

```bash
# Build the image
docker build -t web-terminal .

# Run the container
docker run -p 3000:3000 \
  -e NODE_ENV=production \
  -e ADMIN_PASSWORD=admin123 \
  -e JWT_SECRET=your-super-secret-jwt-key \
  --name web-terminal-test \
  web-terminal
```

### 3. Test Endpoints

Once the container is running, test the following endpoints:

```bash
# Health check
curl http://localhost:3000/health

# API info
curl http://localhost:3000/api

# Login test
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}'
```

### 4. Web Interface Test

1. Open browser to `http://localhost:3000`
2. Login with credentials: `admin` / `admin123`
3. Create a new terminal session
4. Test terminal functionality (commands, resizing, etc.)

### 5. Container Health Checks

```bash
# Check container status
docker ps

# Check health status
docker inspect web-terminal-test | grep -A 5 "Health"

# Check logs
docker logs web-terminal-test
```

### 6. Security Validation

Test security features:
1. Rate limiting on login endpoint
2. Authentication required for protected endpoints
3. CSP headers are present
4. No sensitive information in error responses

### 7. Cleanup

```bash
# Stop and remove containers
docker-compose down

# Remove volumes (optional)
docker-compose down -v

# Remove images (optional)
docker rmi web-terminal
```

## Expected Results

✅ Container builds successfully without errors
✅ Application starts and listens on port 3000
✅ Health check endpoint returns 200
✅ Login works with default credentials
✅ Web interface loads and functions properly
✅ WebSocket connections work
✅ Terminal sessions can be created and used
✅ Rate limiting is enforced
✅ Security headers are present

## Troubleshooting

### Common Issues

1. **Port already in use**
   ```bash
   # Change port mapping
   docker run -p 3001:3000 web-terminal
   ```

2. **Build fails due to node-pty dependencies**
   - Ensure Docker has enough memory allocated
   - Check if all system dependencies are installed in Dockerfile

3. **Container exits immediately**
   ```bash
   # Check logs for errors
   docker logs web-terminal-test
   ```

4. **WebSocket connections fail**
   - Check CORS configuration
   - Ensure proper port forwarding
   - Verify firewall settings

## Performance Testing

Test under load:
```bash
# Install Apache Bench
apt-get install apache2-utils

# Test login endpoint
ab -n 100 -c 10 -T 'application/json' -p login.json http://localhost:3000/api/auth/login

# Where login.json contains:
{"username":"admin","password":"admin123"}
```

## Docker Image Analysis

```bash
# Check image size
docker images web-terminal

# Analyze layers
docker history web-terminal

# Security scan (if available)
docker scout cves web-terminal
```