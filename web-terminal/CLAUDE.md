# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Web Terminal is a secure, production-ready web-based terminal application built with Node.js, Socket.IO, and xterm.js. It provides real-time terminal access through WebSocket connections with JWT authentication and comprehensive security features.

## Key Architecture Components

### Three-Tier Architecture

1. **Frontend (public/)**: Browser-based terminal UI using xterm.js
   - `public/js/terminal.js` - Client-side terminal manager with WebSocket communication
   - `public/js/auth.js` - Authentication handling and token management
   - `public/js/app.js` - Main application coordinator

2. **Backend Services (src/)**: Express.js server with Socket.IO
   - `src/index.js` - Main server with Express routes and Socket.IO event handlers
   - `src/auth.js` - JWT authentication manager with bcrypt password hashing
   - `src/terminal.js` - PTY process manager using node-pty
   - `src/monitoring.js` - Health check and monitoring system
   - `src/session.js` - Session management and cleanup

3. **Infrastructure**: Docker containerization with Redis support
   - Helmet security middleware with CSP policies
   - Rate limiting on authentication endpoints
   - Non-root container execution for security

### Communication Flow

```
Browser Client ↔ Socket.IO (WebSocket) ↔ Express Server ↔ node-pty (PTY processes)
                      ↓
                JWT Authentication ↔ AuthManager ↔ bcrypt
                      ↓
                Terminal Sessions ↔ TerminalManager ↔ Redis (optional)
```

## Common Development Commands

### Running the Application
```bash
npm start                    # Production mode
npm run dev                  # Development with nodemon
docker-compose up --build    # Docker deployment with Redis
```

### Testing
```bash
npm test                                    # Run all tests
npm test -- --testPathPattern=unit         # Unit tests only
npm test -- --testPathPattern=integration  # Integration tests only  
npm test -- --testPathPattern=security     # Security tests only
npm run test:watch                          # Watch mode for development
npm run test:coverage                       # Generate coverage report
```

### Linting and Quality
```bash
npm run lint                 # ESLint code analysis
./test-docker-config.sh      # Validate Docker configuration
```

### Docker Operations
```bash
npm run docker:build        # Build Docker image
npm run docker:run          # Run with docker-compose
docker-compose logs -f web-terminal  # View application logs
```

## Core Development Patterns

### Authentication Flow
All protected routes require JWT tokens. The AuthManager handles:
- Password hashing with bcrypt (10 rounds)
- JWT token generation and validation
- Express middleware for route protection
- Socket.IO authentication middleware

### Terminal Management
The TerminalManager coordinates:
- PTY process creation using node-pty
- User terminal limits (default: 5 per user)
- WebSocket event routing for terminal I/O
- Session persistence with Redis (optional)
- Cleanup of inactive terminals

### Security Implementation
- Rate limiting: 5 login attempts per 15 minutes per IP
- CSP headers allowing xterm.js and Socket.IO CDN resources
- Input validation on all terminal operations
- Path traversal protection for file operations
- Non-root Docker container execution

## Testing Architecture

### Test Structure
- `tests/unit/` - Component unit tests with mocking
- `tests/integration/` - API endpoint and WebSocket integration tests
- `tests/security/` - Security vulnerability and penetration tests

### Key Testing Patterns
- Use supertest for HTTP endpoint testing
- Socket.IO client for WebSocket testing
- Rate limiting tests expect either success or 429 responses
- Security tests validate XSS, SQL injection, and path traversal protection

## Environment Configuration

Critical environment variables:
- `JWT_SECRET` - Must be 32+ characters in production
- `ADMIN_PASSWORD` - Default admin credentials (change in production)
- `NODE_ENV` - Controls security features and logging
- `MAX_TERMINALS_PER_USER` - Terminal session limits
- `REDIS_URL` - Optional session persistence backend

## WebSocket Event System

### Client → Server Events
- `terminal:create` - Create new terminal with shell/cwd options
- `terminal:input` - Send user input to specific terminal
- `terminal:resize` - Resize terminal dimensions
- `terminal:kill` - Terminate terminal process

### Server → Client Events  
- `terminal:data` - Stream terminal output data
- `terminal:created` - Confirm terminal creation with ID
- `terminal:exit` - Notify terminal process termination
- `terminal:error` - Error handling and user feedback

## Docker Deployment Notes

The application uses multi-stage Docker builds with:
- Alpine Linux base for minimal attack surface  
- Non-root user execution (nodejs:1001)
- Health checks on both web-terminal and Redis services
- Volume mounting for persistent logs
- Redis integration for session persistence across container restarts