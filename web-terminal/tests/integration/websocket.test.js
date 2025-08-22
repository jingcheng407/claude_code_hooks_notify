const request = require('supertest');
const { app, server, io } = require('../../src/index');
const Client = require('socket.io-client');

describe.skip('WebSocket Authentication Integration', () => {
  let validToken;
  
  beforeAll(async () => {
    // Get a valid token for testing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({
        username: 'admin',
        password: 'admin123'
      });
    
    validToken = loginResponse.body.token;
  });

  afterAll(() => {
    io.close();
  });

  describe('Socket.IO Authentication', () => {
    test('should authenticate with valid token', (done) => {
      const client = new Client(`http://localhost:3000`, {
        auth: {
          token: validToken
        }
      });

      client.on('connect', () => {
        expect(client.connected).toBe(true);
        client.disconnect();
        done();
      });

      client.on('connect_error', (error) => {
        done(error);
      });
    });

    test('should receive authenticated event after connection', (done) => {
      const client = new Client(`http://localhost:3000`, {
        auth: {
          token: validToken
        }
      });

      client.on('authenticated', (data) => {
        expect(data.message).toBe('Successfully connected to Web Terminal');
        expect(data.user.username).toBe('admin');
        client.disconnect();
        done();
      });

      client.on('connect_error', (error) => {
        done(error);
      });
    });

    test('should reject connection without token', (done) => {
      const client = new Client(`http://localhost:3000`);

      client.on('connect', () => {
        done(new Error('Should not connect without token'));
      });

      client.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication token required');
        done();
      });
    });

    test('should reject connection with invalid token', (done) => {
      const client = new Client(`http://localhost:3000`, {
        auth: {
          token: 'invalid-token'
        }
      });

      client.on('connect', () => {
        done(new Error('Should not connect with invalid token'));
      });

      client.on('connect_error', (error) => {
        expect(error.message).toBe('Invalid token');
        done();
      });
    });

    test('should handle terminal events with placeholder responses', (done) => {
      const client = new Client(`http://localhost:3000`, {
        auth: {
          token: validToken
        }
      });

      client.on('connect', () => {
        client.emit('terminal:create', { cols: 80, rows: 24 });
      });

      client.on('terminal:error', (data) => {
        expect(data.message).toBe('Terminal functionality not yet implemented');
        client.disconnect();
        done();
      });

      client.on('connect_error', (error) => {
        done(error);
      });
    });

    test('should handle multiple concurrent connections', (done) => {
      const clients = [];
      let connectedCount = 0;
      const totalClients = 3;

      const checkAllConnected = () => {
        connectedCount++;
        if (connectedCount === totalClients) {
          // All clients connected successfully
          clients.forEach(client => client.disconnect());
          done();
        }
      };

      for (let i = 0; i < totalClients; i++) {
        const client = new Client(`http://localhost:3000`, {
          auth: {
            token: validToken
          }
        });

        clients.push(client);

        client.on('connect', checkAllConnected);
        
        client.on('connect_error', (error) => {
          done(error);
        });
      }
    });

    test('should handle disconnection gracefully', (done) => {
      const client = new Client(`http://localhost:3000`, {
        auth: {
          token: validToken
        }
      });

      client.on('connect', () => {
        // Disconnect after successful connection
        client.disconnect();
      });

      client.on('disconnect', (reason) => {
        expect(reason).toBe('io client disconnect');
        done();
      });

      client.on('connect_error', (error) => {
        done(error);
      });
    });
  });
});