// monitoring.js - Health checks and monitoring
class HealthChecker {
  constructor(redisClient = null, sessionManager = null) {
    this.redisClient = redisClient;
    this.sessionManager = sessionManager;
    this.diskPath = process.env.BASE_DIR || process.cwd();
  }
  
  async check() {
    const checks = {
      redis: await this.checkRedis(),
      memory: this.checkMemory(),
      disk: await this.checkDisk(),
      terminals: this.checkTerminals()
    };
    
    const healthy = Object.values(checks).every(c => 
      c.status === 'healthy' || c.status === 'unknown'
    );
    
    return {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      checks
    };
  }
  
  async checkRedis() {
    if (!this.redisClient) {
      return { status: 'unknown', message: 'Redis not configured' };
    }
    
    try {
      await this.redisClient.ping();
      return { status: 'healthy', message: 'Redis connected' };
    } catch (error) {
      return { status: 'unhealthy', message: error.message };
    }
  }
  
  checkMemory() {
    const usage = process.memoryUsage();
    const limit = 512 * 1024 * 1024; // 512MB
    
    if (usage.heapUsed > limit) {
      return { 
        status: 'unhealthy', 
        message: `Memory usage high: ${Math.round(usage.heapUsed / 1024 / 1024)}MB`
      };
    }
    
    return { 
      status: 'healthy', 
      usage: Math.round(usage.heapUsed / 1024 / 1024) + 'MB'
    };
  }
  
  async checkDisk() {
    try {
      const { execSync } = require('child_process');
      const df = execSync(`df -h ${this.diskPath}`).toString();
      const lines = df.split('\n');
      
      if (lines.length < 2) {
        return { status: 'unknown', message: 'Unable to parse disk usage' };
      }
      
      const parts = lines[1].split(/\s+/);
      const usageStr = parts[4];
      const usage = parseInt(usageStr);
      
      if (isNaN(usage)) {
        return { status: 'unknown', message: 'Unable to parse disk usage percentage' };
      }
      
      if (usage > 90) {
        return { status: 'unhealthy', message: `Disk usage: ${usage}%` };
      }
      
      return { status: 'healthy', usage: `${usage}%` };
    } catch (error) {
      return { status: 'unknown', message: `Disk check unavailable: ${error.message}` };
    }
  }
  
  checkTerminals() {
    if (!this.sessionManager) {
      return { status: 'unknown', message: 'Session manager not initialized' };
    }
    
    try {
      const count = this.sessionManager.getActiveTerminalCount();
      const maxUsers = parseInt(process.env.MAX_CONCURRENT_USERS) || 50;
      const maxTerminalsPerUser = parseInt(process.env.MAX_TERMINALS_PER_USER) || 5;
      const max = maxUsers * maxTerminalsPerUser;
      
      if (count > max * 0.9) {
        return { 
          status: 'unhealthy', 
          message: `Terminal count high: ${count}/${max}` 
        };
      }
      
      return { status: 'healthy', count };
    } catch (error) {
      return { status: 'unknown', message: error.message };
    }
  }
}

module.exports = { HealthChecker };