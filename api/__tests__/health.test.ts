/// <reference types="jest" />
import request from 'supertest';

const baseURL = process.env.API_URL || 'http://localhost:4000';

describe('Health', () => {
  it('GET /health returns ok', async () => {
    const res = await request(baseURL).get('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');
  });
});
