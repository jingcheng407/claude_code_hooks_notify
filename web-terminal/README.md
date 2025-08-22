# Web Terminal

A secure, production-ready web-based terminal application built with Node.js, Socket.IO, and xterm.js.

## Features

- 🔐 **Secure Authentication** - JWT-based authentication with bcrypt password hashing
- 🌐 **Real-time Communication** - WebSocket-based bidirectional communication
- 💻 **Cross-platform Terminal** - Support for bash, zsh, fish shells
- 🎨 **Multiple Themes** - Dark, light, and custom terminal themes
- 📱 **Responsive Design** - Works on desktop, tablet, and mobile devices
- 🔒 **Security Hardened** - Rate limiting, CSP headers, input validation
- 🐳 **Docker Ready** - Complete containerization with docker-compose
- 📊 **Health Monitoring** - Built-in health checks and monitoring
- 🔄 **Session Recovery** - Terminal session persistence and recovery
- ⚡ **High Performance** - Optimized for low latency and high throughput

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone the repository
git clone <repository-url>
cd web-terminal

# Start with Docker Compose
docker-compose up -d --build

# Access the application
open http://localhost:3000
```

### Option 2: Local Development

```bash
# Install dependencies
npm install

# Set environment variables (optional)
cp .env.example .env

# Start the server
npm start

# Access the application
open http://localhost:3000
```

### Default Credentials

- Username: `admin`
- Password: `admin123`

⚠️ **Change the default password in production!**

## Development Status

### Phase 1: Project Setup ✅
- [x] Project structure initialized
- [x] Dependencies installed  
- [x] Testing framework (Jest + Supertest)
- [x] Health check endpoint

### Phase 2: Authentication ✅
- [x] JWT token management with bcrypt
- [x] User login API with validation
- [x] Rate limiting protection
- [x] Socket.IO authentication middleware

### Phase 3: Terminal Core ✅
- [x] PTY process management with node-pty
- [x] WebSocket terminal communication
- [x] Terminal I/O with backpressure handling
- [x] Session persistence and recovery

### Phase 4: Frontend ✅
- [x] Login interface with responsive design
- [x] Terminal UI with xterm.js integration
- [x] Real-time WebSocket communication
- [x] Multiple terminal themes

### Phase 5: Security & Deployment ✅
- [x] Security hardening (Helmet, CSP, validation)
- [x] Docker configuration with best practices
- [x] Production deployment ready

### Phase 6: Testing & Validation ✅
- [x] Unit tests (>90% coverage)
- [x] Integration tests
- [x] Security testing
- [x] Docker deployment validation

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server Configuration
NODE_ENV=production
PORT=3000

# Authentication
ADMIN_PASSWORD=your-secure-password
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# CORS Settings
CORS_ORIGINS=http://localhost:3000,https://yourdomain.com

# Terminal Limits
MAX_TERMINALS_PER_USER=5
MAX_CONCURRENT_USERS=50
TERMINAL_TIMEOUT=7200000

# Redis (Optional)
REDIS_URL=redis://localhost:6379
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm test -- --testPathPattern=unit
npm test -- --testPathPattern=integration
npm test -- --testPathPattern=security

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Test Results

All test suites are passing:
- ✅ Unit Tests (100% pass rate)
- ✅ Integration Tests (100% pass rate)  
- ✅ Security Tests (100% pass rate)
- ✅ Docker Configuration Tests (100% pass rate)

## API Documentation

### Authentication Endpoints

#### Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "admin123"
}
```

#### Verify Token
```http
POST /api/auth/verify
Authorization: Bearer <jwt-token>
```

### Terminal Management

#### List Terminals
```http
GET /api/terminals
Authorization: Bearer <jwt-token>
```

#### Restore Terminal Session
```http
POST /api/terminals/:id/restore
Authorization: Bearer <jwt-token>
```

### Health & Monitoring

#### Health Check
```http
GET /health
```

#### Statistics
```http
GET /api/stats
Authorization: Bearer <jwt-token>
```

## WebSocket Events

### Client → Server

- `terminal:create` - Create a new terminal
- `terminal:input` - Send input to terminal
- `terminal:resize` - Resize terminal
- `terminal:kill` - Terminate terminal
- `terminal:list` - List user terminals

### Server → Client

- `authenticated` - Authentication successful
- `terminal:created` - Terminal created successfully
- `terminal:data` - Terminal output data
- `terminal:exit` - Terminal process exited
- `terminal:error` - Error occurred
- `terminal:list` - Terminal list response

## Architecture

```
web-terminal/
├── src/
│   ├── auth.js          # Authentication manager
│   ├── terminal.js      # Terminal manager
│   ├── monitoring.js    # Health monitoring
│   └── index.js         # Main server
├── public/
│   ├── css/             # Stylesheets
│   ├── js/              # Client-side JavaScript
│   └── index.html       # Main HTML page
├── tests/
│   ├── unit/            # Unit tests
│   ├── integration/     # Integration tests
│   └── security/        # Security tests
├── tasks/               # Task and design documents
├── Dockerfile           # Docker configuration
├── docker-compose.yml   # Docker Compose configuration
└── package.json         # Node.js dependencies
```

## Deployment

### Production Deployment with Docker

1. **Configure environment variables**
   ```bash
   # Copy and edit environment file
   cp .env.example .env
   # Edit .env with your production values
   ```

2. **Deploy with Docker Compose**
   ```bash
   docker-compose up -d --build
   ```

3. **Verify deployment**
   ```bash
   # Check container status
   docker-compose ps
   
   # Check logs
   docker-compose logs -f web-terminal
   
   # Test health endpoint
   curl http://localhost:3000/health
   ```

## Security

### Security Features

- ✅ JWT authentication with secure tokens
- ✅ Password hashing with bcrypt
- ✅ Rate limiting on sensitive endpoints
- ✅ CORS protection
- ✅ Helmet security headers
- ✅ Input validation and sanitization
- ✅ Path traversal protection
- ✅ XSS prevention
- ✅ CSRF protection
- ✅ Non-root Docker container

### Security Best Practices

1. **Change default credentials** before deployment
2. **Use strong JWT secrets** (32+ characters)
3. **Enable HTTPS** in production
4. **Configure firewall** rules
5. **Regular security updates**
6. **Monitor access logs**
7. **Use environment variables** for secrets

## Troubleshooting

### Common Issues

#### Connection Issues
- **WebSocket connection fails**: Check CORS configuration and firewall settings
- **Authentication errors**: Verify JWT secret and token expiry
- **Terminal not responding**: Check if node-pty is properly installed

#### Performance Issues
- **High memory usage**: Limit terminal sessions and implement cleanup
- **Slow response times**: Check system resources and network latency
- **Rate limiting triggered**: Reduce request frequency

#### Docker Issues
- **Build fails**: Ensure Docker has enough memory allocated
- **Container exits**: Check logs with `docker-compose logs`
- **Port conflicts**: Change port mapping in docker-compose.yml

### Debug Mode

Enable debug logging:
```bash
export DEBUG=web-terminal:*
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a pull request

### Development Guidelines

- Follow existing code style
- Add tests for new features
- Update documentation
- Ensure all tests pass
- Follow security best practices

## License

This project is licensed under the MIT License.

## Changelog

### v0.1.0
- ✨ Initial release
- 🔐 JWT authentication system
- 💻 WebSocket terminal communication
- 🎨 Multiple terminal themes
- 🐳 Docker deployment support
- 📊 Health monitoring
- 🔒 Comprehensive security features

---

Made with ❤️ by the Web Terminal Team