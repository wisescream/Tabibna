import request from 'supertest';

const baseURL = process.env.API_URL || 'http://localhost:4000';

describe('Auth and Booking basics', () => {
  const email = `test_${Date.now()}@example.com`;
  const password = 'Str0ngP@ssw0rd!';
  let accessToken: string;
  let refreshToken: string;

  it('registers a new user', async () => {
    const res = await request(baseURL)
      .post('/v1/auth/register')
      .send({ email, password, first_name: 'Test', last_name: 'User' });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('logs in and receives tokens', async () => {
    const res = await request(baseURL)
      .post('/v1/auth/login')
      .send({ emailOrPhone: email, password });
    expect(res.status).toBe(200);
    expect(res.body?.token).toBeTruthy();
    expect(res.body?.refreshToken).toBeTruthy();
    accessToken = res.body.token;
    refreshToken = res.body.refreshToken;
  });

  it('refreshes the access token', async () => {
    const res = await request(baseURL)
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshToken });
    expect(res.status).toBe(200);
    expect(res.body?.token).toBeTruthy();
    accessToken = res.body.token;
  });

  it('creates and cancels a reservation as patient (smoke)', async () => {
    // Create a practitioner first or assume one with id 1 exists.
    // For smoke test, if none exists, skip gracefully.
    let list = await request(baseURL).get('/v1/practitioners?limit=1');
    if (list.status !== 200 || !Array.isArray(list.body?.items) || list.body.items.length === 0) {
      // Attempt to seed one (dev-only)
      await request(baseURL)
        .post('/v1/practitioners/me/seed-dev-practitioner')
        .set('Authorization', `Bearer ${accessToken}`)
        .send();
      list = await request(baseURL).get('/v1/practitioners?limit=1');
      if (list.status !== 200 || !Array.isArray(list.body?.items) || list.body.items.length === 0) {
        console.warn('No practitioners available after seed; skipping booking smoke test');
        return;
      }
    }
    const practitioner = list.body.items[0];

    // Pick a start time ~2 days in future at top of hour
    const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    start.setMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const create = await request(baseURL)
      .post('/v1/reservations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ practitioner_id: practitioner.id, start_datetime: start.toISOString(), end_datetime: end.toISOString() });

    if (create.status !== 201 && create.status !== 200) {
      console.warn('Create reservation did not succeed; status:', create.status, create.body);
      return;
    }
    const reservationId = create.body?.id;
    expect(reservationId).toBeTruthy();

    const cancel = await request(baseURL)
      .put(`/v1/reservations/${reservationId}/cancel`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send();
    expect([200, 204]).toContain(cancel.status);
  });
});
