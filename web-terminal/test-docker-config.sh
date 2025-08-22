#!/bin/bash

# Docker Configuration Test Script
# Tests Docker files without running containers

set -e

echo "🐳 Docker Configuration Test"
echo "============================"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi

echo "✅ Docker is installed"

# Check if docker-compose is available
if command -v docker-compose &> /dev/null; then
    echo "✅ docker-compose is available"
    COMPOSE_CMD="docker-compose"
elif command -v docker &> /dev/null && docker compose version &> /dev/null; then
    echo "✅ docker compose (plugin) is available"
    COMPOSE_CMD="docker compose"
else
    echo "❌ docker-compose is not available"
    exit 1
fi

# Validate Dockerfile
echo
echo "📝 Validating Dockerfile..."
if [ -f "Dockerfile" ]; then
    echo "✅ Dockerfile exists"
    
    # Check for security best practices
    if grep -q "USER " Dockerfile; then
        echo "✅ Non-root user is configured"
    else
        echo "⚠️  Warning: Container runs as root"
    fi
    
    if grep -q "HEALTHCHECK" Dockerfile; then
        echo "✅ Health check is configured"
    else
        echo "⚠️  Warning: No health check configured"
    fi
    
    if grep -q "EXPOSE" Dockerfile; then
        echo "✅ Port is exposed"
    else
        echo "⚠️  Warning: No port exposed"
    fi
else
    echo "❌ Dockerfile not found"
    exit 1
fi

# Validate docker-compose.yml
echo
echo "📝 Validating docker-compose.yml..."
if [ -f "docker-compose.yml" ]; then
    echo "✅ docker-compose.yml exists"
    
    # Validate syntax
    if $COMPOSE_CMD config > /dev/null 2>&1; then
        echo "✅ docker-compose.yml syntax is valid"
    else
        echo "❌ docker-compose.yml has syntax errors"
        $COMPOSE_CMD config
        exit 1
    fi
else
    echo "❌ docker-compose.yml not found"
    exit 1
fi

# Validate .dockerignore
echo
echo "📝 Validating .dockerignore..."
if [ -f ".dockerignore" ]; then
    echo "✅ .dockerignore exists"
    
    # Check for common exclusions
    if grep -q "node_modules" .dockerignore; then
        echo "✅ node_modules is excluded"
    else
        echo "⚠️  Warning: node_modules not excluded"
    fi
    
    if grep -q "tests" .dockerignore; then
        echo "✅ tests are excluded"
    else
        echo "⚠️  Warning: tests not excluded"
    fi
else
    echo "❌ .dockerignore not found"
fi

# Check package.json for Docker scripts
echo
echo "📝 Checking package.json for Docker scripts..."
if [ -f "package.json" ]; then
    if grep -q "docker:" package.json; then
        echo "✅ Docker scripts are configured"
    else
        echo "⚠️  Warning: No Docker scripts found"
    fi
else
    echo "❌ package.json not found"
    exit 1
fi

# Check if Docker daemon is running (without failing the test)
echo
echo "📝 Checking Docker daemon..."
if docker info > /dev/null 2>&1; then
    echo "✅ Docker daemon is running"
    
    # If Docker is running, try to validate build context
    echo
    echo "🔧 Testing Docker build context..."
    if docker build --dry-run . > /dev/null 2>&1; then
        echo "✅ Docker build context is valid"
    else
        echo "⚠️  Warning: Docker build context validation failed"
    fi
else
    echo "⚠️  Docker daemon is not running (this is OK for config validation)"
fi

echo
echo "🎉 Docker configuration test completed!"
echo
echo "To test the actual deployment:"
echo "1. Start Docker daemon"
echo "2. Run: $COMPOSE_CMD up --build"
echo "3. Test the application at http://localhost:3000"
echo "4. Run the tests in DOCKER_TEST.md"