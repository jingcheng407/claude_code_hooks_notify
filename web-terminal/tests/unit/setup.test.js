const fs = require('fs');

describe('Project Setup', () => {
  test('should have all required directories', () => {
    expect(fs.existsSync('./src')).toBe(true);
    expect(fs.existsSync('./public')).toBe(true);
    expect(fs.existsSync('./tests')).toBe(true);
    expect(fs.existsSync('./config')).toBe(true);
  });
  
  test('should have all required files', () => {
    expect(fs.existsSync('./package.json')).toBe(true);
    expect(fs.existsSync('./.env.example')).toBe(true);
    expect(fs.existsSync('./config/default.json')).toBe(true);
  });
  
  test('should have all required dependencies', () => {
    const pkg = require('../../package.json');
    expect(pkg.dependencies['express']).toBeDefined();
    expect(pkg.dependencies['socket.io']).toBeDefined();
    expect(pkg.dependencies['node-pty']).toBeDefined();
    expect(pkg.dependencies['jsonwebtoken']).toBeDefined();
    expect(pkg.dependencies['bcrypt']).toBeDefined();
    expect(pkg.dependencies['helmet']).toBeDefined();
  });
  
  test('should load environment variables from example', () => {
    const envExample = fs.readFileSync('./.env.example', 'utf8');
    expect(envExample).toContain('NODE_ENV=');
    expect(envExample).toContain('PORT=');
    expect(envExample).toContain('JWT_SECRET=');
  });
  
  test('should have valid configuration', () => {
    const config = require('../../config/default.json');
    expect(config.server).toBeDefined();
    expect(config.terminal).toBeDefined();
    expect(config.security).toBeDefined();
    expect(config.performance).toBeDefined();
  });
});