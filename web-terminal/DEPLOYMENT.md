# Web Terminal Deployment Guide

## Overview

This guide covers deploying the Web Terminal application in production environments using Docker.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 2GB+ RAM recommended
- 1GB+ disk space

## Quick Start with Docker Compose

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd web-terminal
   ```

2. **Configure environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your production settings
   ```

3. **Generate secure JWT secret**
   ```bash
   # Generate a secure random string (32+ characters)
   openssl rand -base64 32
   ```

4. **Start the application**
   ```bash
   docker-compose up -d
   ```

5. **Access the application**
   - Open http://localhost:3000
   - Default login: admin / admin123 (change this!)

## Production Configuration

### Environment Variables

Create a `.env` file with the following variables:

```bash
# Required - Generate a secure random string
JWT_SECRET=your-super-secret-jwt-key-change-in-production-min-32-chars

# Required - Set a secure admin password
ADMIN_PASSWORD=your-secure-admin-password

# Optional - Configure CORS origins
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Optional - Terminal limits
MAX_TERMINALS_PER_USER=5
MAX_CONCURRENT_USERS=50
TERMINAL_TIMEOUT=7200000

# Optional - Redis connection
REDIS_URL=redis://redis:6379
```

### Security Configuration

1. **Change default credentials**
   - Set a strong `ADMIN_PASSWORD`
   - Use a random 32+ character `JWT_SECRET`

2. **Configure CORS origins**
   - Set `CORS_ORIGINS` to your domain(s)
   - Remove localhost origins in production

3. **Use HTTPS**
   - Configure reverse proxy (nginx/Apache)
   - Use SSL certificates (Let's Encrypt recommended)

4. **Network security**
   - Use Docker networks to isolate services
   - Don't expose Redis port publicly
   - Consider firewall rules

## Manual Docker Deployment

### Build the image

```bash
docker build -t web-terminal .
```

### Run with Redis

```bash
# Start Redis
docker run -d --name redis-terminal \
  -v redis_data:/data \
  redis:7-alpine redis-server --appendonly yes

# Start Web Terminal
docker run -d --name web-terminal \
  --link redis-terminal:redis \
  -p 3000:3000 \
  -e JWT_SECRET="your-secret-key" \
  -e ADMIN_PASSWORD="your-admin-password" \
  -e REDIS_URL="redis://redis:6379" \
  web-terminal
```

## Reverse Proxy Configuration

### Nginx Example

```nginx
upstream web-terminal {
    server localhost:3000;
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/certificate.pem;
    ssl_certificate_key /path/to/private-key.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";

    location / {
        proxy_pass http://web-terminal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

## Health Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "checks": {
    "redis": { "status": "healthy", "message": "Redis connected" },
    "memory": { "status": "healthy", "usage": "45MB" },
    "disk": { "status": "healthy", "usage": "23%" },
    "terminals": { "status": "healthy", "count": 0 }
  }
}
```

### Docker Health Checks

The container includes built-in health checks:

```bash
docker ps  # Check health status
docker logs web-terminal  # View logs
```

### Monitoring with Docker Compose

```yaml
version: '3.8'
services:
  web-terminal:
    # ... existing configuration
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

## Logging

### Application Logs

```bash
# View live logs
docker-compose logs -f web-terminal

# View last 100 lines
docker-compose logs --tail=100 web-terminal
```

### Log Rotation

Configure log rotation for production:

```bash
# Add to docker-compose.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## Scaling

### Horizontal Scaling

To scale to multiple instances:

1. **Use external Redis**
   ```bash
   # Use managed Redis service
   REDIS_URL=redis://your-redis-server:6379
   ```

2. **Load balancer configuration**
   ```nginx
   upstream web-terminal {
       server terminal-1:3000;
       server terminal-2:3000;
       server terminal-3:3000;
   }
   ```

3. **Session affinity**
   - Configure sticky sessions for WebSocket connections
   - Use Redis for session storage

### Vertical Scaling

Adjust resource limits:

```yaml
services:
  web-terminal:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

## Backup and Recovery

### Redis Data Backup

```bash
# Backup Redis data
docker exec redis-terminal redis-cli BGSAVE
docker cp redis-terminal:/data/dump.rdb ./redis-backup-$(date +%Y%m%d).rdb

# Restore from backup
docker cp ./redis-backup.rdb redis-terminal:/data/dump.rdb
docker restart redis-terminal
```

### Configuration Backup

```bash
# Backup configuration
tar -czf config-backup-$(date +%Y%m%d).tar.gz .env docker-compose.yml
```

## Troubleshooting

### Common Issues

1. **Connection refused**
   ```bash
   # Check if services are running
   docker-compose ps
   
   # Check logs
   docker-compose logs web-terminal
   ```

2. **WebSocket connection failures**
   ```bash
   # Check proxy configuration
   # Ensure WebSocket headers are set
   # Verify firewall/network settings
   ```

3. **Terminal creation failures**
   ```bash
   # Check container permissions
   # Verify shell availability in container
   # Check resource limits
   ```

### Debug Mode

Enable debug logging:

```bash
# Set log level
LOG_LEVEL=debug

# View detailed logs
docker-compose logs -f web-terminal
```

### Performance Issues

1. **High memory usage**
   - Reduce `MAX_TERMINALS_PER_USER`
   - Reduce `TERMINAL_TIMEOUT`
   - Monitor with `docker stats`

2. **Slow response times**
   - Check Redis connectivity
   - Monitor network latency
   - Scale horizontally if needed

## Security Checklist

- [ ] Changed default admin password
- [ ] Generated secure JWT secret (32+ chars)
- [ ] Configured CORS origins for production
- [ ] Enabled HTTPS with valid certificates
- [ ] Set up firewall rules
- [ ] Configured reverse proxy security headers
- [ ] Regular security updates
- [ ] Monitor logs for suspicious activity
- [ ] Implement rate limiting at proxy level
- [ ] Use non-root user in containers

## Maintenance

### Regular Tasks

1. **Update dependencies**
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

2. **Clean up old images**
   ```bash
   docker system prune -a
   ```

3. **Monitor disk usage**
   ```bash
   docker system df
   ```

4. **Backup data**
   ```bash
   # Run backup script weekly
   ./backup.sh
   ```

### Updates

1. **Pull latest changes**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart**
   ```bash
   docker-compose up -d --build
   ```

3. **Verify health**
   ```bash
   curl http://localhost:3000/health
   ```

## Support

For issues and support:

1. Check application logs
2. Verify configuration
3. Test with minimal setup
4. Report issues with logs and configuration