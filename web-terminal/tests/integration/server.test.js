const request = require('supertest');
const { app } = require('../../src/index');

describe('Server Integration', () => {
  afterAll((done) => {
    // 关闭服务器
    done();
  });
  
  test('should respond to API info endpoint', async () => {
    const response = await request(app)
      .get('/api')
      .expect(200);
      
    expect(response.body.name).toBe('Web Terminal');
    expect(response.body.version).toBe('0.1.0');
  });
  
  test('should respond to health endpoint', async () => {
    const response = await request(app)
      .get('/health')
      .expect('Content-Type', /json/);
      
    expect([200, 503]).toContain(response.status);
    expect(response.body.status).toMatch(/healthy|unhealthy/);
    expect(response.body.timestamp).toBeDefined();
  });
  
  test('should return 404 for unknown endpoints', async () => {
    await request(app)
      .get('/unknown')
      .expect(404);
  });
});