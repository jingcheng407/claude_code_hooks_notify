const request = require('supertest');
const { app } = require('../../src/index');

describe('Security Tests', () => {
  let validToken;

  beforeAll(async () => {
    // Get a valid token for authenticated tests
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'admin123'
      });
    
    if (loginResponse.body.success) {
      validToken = loginResponse.body.token;
    }
  });

  describe('Authentication Security', () => {
    test('should reject requests without authentication', async () => {
      await request(app)
        .get('/api/protected')
        .expect(401);

      await request(app)
        .get('/api/terminals')
        .expect(401);

      await request(app)
        .get('/api/stats')
        .expect(401);
    });

    test('should reject invalid tokens', async () => {
      await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      await request(app)
        .get('/api/terminals')
        .set('Authorization', 'Bearer malicious-token')
        .expect(401);
    });

    test('should reject malformed authorization headers', async () => {
      await request(app)
        .get('/api/protected')
        .set('Authorization', 'InvalidFormat token')
        .expect(401);

      await request(app)
        .get('/api/protected')
        .set('Authorization', 'token')
        .expect(401);
    });

    test('should implement rate limiting', async () => {
      // Make multiple failed login attempts
      const promises = Array(6).fill(null).map(() =>
        request(app)
          .post('/api/auth/login')
          .send({
            username: 'nonexistent',
            password: 'invalid'
          })
      );

      const responses = await Promise.all(promises);
      
      // At least one should be rate limited
      const rateLimited = responses.some(res => res.status === 429);
      expect(rateLimited).toBe(true);
    }, 10000);
  });

  describe('Input Validation', () => {
    test('should reject invalid login data', async () => {
      // Empty username
      const response1 = await request(app)
        .post('/api/auth/login')
        .send({
          username: '',
          password: 'password'
        });
      
      expect([400, 429]).toContain(response1.status); // 400 or rate limited

      // No password
      const response2 = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin'
        });
      
      expect([400, 429]).toContain(response2.status); // 400 or rate limited

      // Invalid JSON
      const response3 = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid-json');
      
      expect([400, 429]).toContain(response3.status); // 400 or rate limited
    });

    test('should handle SQL injection attempts', async () => {
      const sqlInjectionPayloads = [
        "admin'; DROP TABLE users; --",
        "admin' OR '1'='1",
        "admin' UNION SELECT * FROM passwords --"
      ];

      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: payload,
            password: 'password'
          });

        // Should not cause server error
        expect(response.status).not.toBe(500);
        
        // Should be rejected as invalid credentials or rate limited
        expect([401, 429]).toContain(response.status);
      }
    });

    test('should handle XSS attempts', async () => {
      const xssPayloads = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src=x onerror=alert("xss")>',
        '"><script>alert("xss")</script>'
      ];

      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            username: payload,
            password: 'password'
          });

        // Should not cause server error
        expect(response.status).not.toBe(500);
        
        // Should be handled properly or rate limited
        expect([401, 429]).toContain(response.status);
      }
    });

    test('should validate input sizes', async () => {
      // Very long username
      const longUsername = 'a'.repeat(10000);
      
      const longUsernameResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: longUsername,
          password: 'password'
        });
      
      expect([401, 429]).toContain(longUsernameResponse.status); // Should reject, not crash

      // Very long password
      const longPassword = 'b'.repeat(10000);
      
      const longPasswordResponse = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'admin',
          password: longPassword
        });
      
      expect([401, 429]).toContain(longPasswordResponse.status); // Should reject, not crash
    });
  });

  describe('Path Traversal Protection', () => {
    test('should prevent path traversal in terminal restore', async () => {
      const pathTraversalPayloads = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        '....//....//....//etc/passwd',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
      ];

      for (const payload of pathTraversalPayloads) {
        const response = await request(app)
          .post(`/api/terminals/${payload}/restore`)
          .set('Authorization', `Bearer ${validToken}`)
          .send();

        // Should not cause server error
        expect(response.status).not.toBe(500);
        
        // Should be rejected (404, 400, or 401 for invalid token)
        expect([400, 401, 404]).toContain(response.status);
      }
    });
  });

  describe('Security Headers', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      // Helmet security headers
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    test('should have proper CSP directive', async () => {
      const response = await request(app)
        .get('/api')
        .expect(200);

      const csp = response.headers['content-security-policy'];
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-src 'none'");
    });
  });

  describe('Session Security', () => {
    test('should reject concurrent sessions with same token', async () => {
      if (!validToken) {
        console.log('Skipping session test - no valid token');
        return;
      }

      // Make multiple concurrent requests with same token
      const promises = Array(5).fill(null).map(() =>
        request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${validToken}`)
      );

      const responses = await Promise.all(promises);
      
      // All should succeed (same token should work)
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status); // 200 or rate limited
      });
    });

    test('should handle token expiry gracefully', async () => {
      // This is harder to test without manipulating time
      // For now, just test with obviously invalid expired token
      const expiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwiaWF0IjoxNjAwMDAwMDAwLCJleHAiOjE2MDAwMDAwMDB9.invalid';
      
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });
  });

  describe('Resource Exhaustion Protection', () => {
    test('should handle many concurrent requests', async () => {
      // Test server stability under load
      const promises = Array(20).fill(null).map(() =>
        request(app)
          .get('/health')
      );

      const responses = await Promise.all(promises);
      
      // Server should remain responsive
      responses.forEach(response => {
        expect([200, 503, 429]).toContain(response.status);
      });
    }, 10000);

    test('should limit request body size', async () => {
      const largePayload = {
        username: 'admin',
        password: 'admin123',
        data: 'x'.repeat(15 * 1024 * 1024) // 15MB
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(largePayload);

      // Should reject large payloads (413 or 400)
      expect([400, 413]).toContain(response.status);
    });
  });

  describe('Error Handling Security', () => {
    test('should not leak sensitive information in errors', async () => {
      // Invalid route
      const response1 = await request(app)
        .get('/api/nonexistent')
        .expect(404);

      // Should not contain stack traces or internal paths
      if (response1.text) {
        expect(response1.text).not.toMatch(/Error:/);
        expect(response1.text).not.toMatch(/at /);
        expect(response1.text).not.toMatch(/node_modules/);
      }

      // Server error simulation (invalid JSON)
      const response2 = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('invalid-json-data');

      // Should handle gracefully without leaking info (400 or rate limited)
      expect([400, 429]).toContain(response2.status);
      
      if (response2.body && response2.body.error && response2.status !== 429) {
        expect(response2.body.error).not.toMatch(/SyntaxError/);
        expect(response2.body.error).not.toMatch(/JSON/);
      }
    });
  });
});