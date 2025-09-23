/// <reference types="jest" />
import request from 'supertest';
import crypto from 'crypto';

const baseURL = process.env.API_URL || 'http://localhost:4000';

function sign(body: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
}

describe('Webhooks payment HMAC', () => {
  const secret = process.env.PAYMENT_WEBHOOK_SECRET || '';
  const payloadObj = { event: 'paid', amount: 123, currency: 'MAD' };
  const body = JSON.stringify(payloadObj);

  it('rejects when signature is missing or invalid', async () => {
    const noSig = await request(baseURL)
      .post('/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .send(body);
    expect([400, 401, 415]).toContain(noSig.status);

    const badSig = await request(baseURL)
      .post('/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-signature', 'deadbeef')
      .send(body);
    expect([401]).toContain(badSig.status);
  });

  it('accepts when signature is valid (if secret present)', async () => {
    if (!secret) {
      console.warn('PAYMENT_WEBHOOK_SECRET not set; skipping valid signature test');
      return;
    }
    const sig = sign(body, secret);
    const ok = await request(baseURL)
      .post('/v1/webhooks/payment')
      .set('Content-Type', 'application/json')
      .set('x-signature', sig)
      .send(body);
    expect(ok.status).toBe(200);
    expect(ok.body?.ok).toBe(true);
  });
});
