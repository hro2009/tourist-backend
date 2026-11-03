import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import request from 'supertest';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hayq-tests-'));
process.env.DATABASE_PATH = path.join(temp, 'test.sqlite');
process.env.UPLOADS_DIR = path.join(temp, 'uploads');
process.env.ADMIN_EMAIL = 'owner@test.example';
process.env.ADMIN_PASSWORD = 'test-password-please-change';
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-sign-jwt-tokens';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_ORIGINS = 'https://frontend.test';
const [{ app }, { db }, { seedDatabase }] = await Promise.all([import('../index.js'), import('../db.js'), import('../seed.js')]);
const client = request.agent(app);
let csrf;
let tour;
let departure;

before(async () => {
  seedDatabase();
  const login = await client.post('/api/auth/login').send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  csrf = login.headers['set-cookie'].find(cookie => cookie.startsWith('hayq_csrf=')).split(';')[0].split('=')[1];
  client.set('x-csrf-token', csrf);
  tour = db.prepare("SELECT id,slug,price_amd FROM tours WHERE status='published' ORDER BY id LIMIT 1").get();
  departure = db.prepare('SELECT id,date FROM tour_departures WHERE tour_id=? ORDER BY date LIMIT 1').get(tour.id);
});

after(() => {
  db.close();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('configured frontend origin can use credentialed API and admin sessions', async () => {
  const preflight = await request(app).options('/api/auth/me')
    .set('Origin', 'https://frontend.test')
    .set('Access-Control-Request-Method', 'GET');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'https://frontend.test');
  assert.equal(preflight.headers['access-control-allow-credentials'], 'true');

  const session = request.agent(app);
  const login = await session.post('/api/auth/login')
    .set('Origin', 'https://frontend.test')
    .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  assert.equal(typeof login.body.data.csrf, 'string');
  const logout = await session.post('/api/auth/logout')
    .set('Origin', 'https://frontend.test')
    .set('X-CSRF-Token', login.body.data.csrf);
  assert.equal(logout.status, 200);
});

test('unconfigured frontend origins are rejected', async () => {
  const response = await request(app).options('/api/auth/me')
    .set('Origin', 'https://untrusted.test')
    .set('Access-Control-Request-Method', 'GET');
  assert.equal(response.status, 403);
});

test('public catalog endpoints return the seeded content', async () => {
  const [tours, addons, services, settings, reviews, health] = await Promise.all([
    request(app).get('/api/tours'), request(app).get('/api/addons'), request(app).get('/api/services'), request(app).get('/api/settings'), request(app).get('/api/reviews'), request(app).get('/api/health')
  ]);
  assert.equal(tours.status, 200); assert.equal(tours.body.data.length, 6);
  assert.equal(health.body.data.commit, process.env.RENDER_GIT_COMMIT || 'local');
  assert.equal(addons.body.data.length, 2); assert.equal(services.body.data.length, 6);
  assert.deepEqual(tours.body.data.map(item => item.name), [
    'Garni Temple and Geghard Monastery',
    'Khor Virap, Areni wine and Noravank',
    'Lake Sevan and Dilijan',
    'Yerevan city tour',
    'Echmiadzin and Zvartnots ruins',
    'Tatev Monastery and cable car'
  ]);
  assert.deepEqual(tours.body.data.map(item => item.price_amd), [9750, 17550, 15600, 7800, 7800, 21450]);
  assert.equal(settings.body.data.usd_rate, '390'); assert.equal(settings.body.data.tours_background_url, ''); assert.deepEqual(reviews.body.data, []);
  const englishCopy = JSON.parse(settings.body.data.landing_copy_en);
  const russianCopy = JSON.parse(settings.body.data.landing_copy_ru);
  const armenianCopy = JSON.parse(settings.body.data.landing_copy_hy);
  assert.equal(englishCopy.travelGuideTitle, 'Plan your Armenia trip with a local team');
  assert.ok(russianCopy.travelFaqTitle); assert.ok(armenianCopy.travelFaqTitle);
  assert.equal(health.body.data.status, 'ok');
  assert.equal((await request(app).get(`/api/tours/${tour.slug}`)).status, 200);
});

test('legacy tour migration updates the live catalog and preserves booked tour names', async () => {
  const current = db.prepare("SELECT id FROM tours WHERE slug='lake-sevan-dilijan'").get();
  db.prepare('DELETE FROM tour_departures WHERE tour_id=?').run(current.id);
  db.prepare('DELETE FROM tours WHERE id=?').run(current.id);
  const legacyId = Number(db.prepare(`INSERT INTO tours
    (slug,category,duration,price_amd,difficulty,max_group,status,sort_order,name_en,description_en,highlights_en)
    VALUES ('dilijan-lake-sevan','Culture','1 day',28000,'easy',8,'published',2,'Dilijan and Lake Sevan','Legacy description','[]')`).run().lastInsertRowid);
  const departureId = Number(db.prepare("INSERT INTO tour_departures (tour_id,date,seats_total) VALUES (?, '2099-01-01', 12)").run(legacyId).lastInsertRowid);
  const bookingId = Number(db.prepare(`INSERT INTO bookings (reference,customer_name,email,phone,total_amd)
    VALUES ('HQ-LEGACY01','History Guest','history@example.com','+37400000000',28000)`).run().lastInsertRowid);
  db.prepare(`INSERT INTO booking_items (booking_id,tour_id,departure_id,guests,unit_price_amd,addon_ids)
    VALUES (?,?,?,1,28000,'[]')`).run(bookingId, legacyId, departureId);

  seedDatabase();

  const migrated = db.prepare('SELECT name_en,duration FROM tours WHERE id=?').get(legacyId);
  const history = db.prepare('SELECT tour_name FROM booking_items WHERE booking_id=?').get(bookingId);
  assert.deepEqual(migrated, { name_en: 'Lake Sevan and Dilijan', duration: '9 hours' });
  assert.equal(history.tour_name, 'Dilijan and Lake Sevan');
  const response = await client.get('/api/admin/bookings');
  const booking = response.body.data.find(item => item.reference === 'HQ-LEGACY01');
  assert.equal(booking.items[0].tour_name, 'Dilijan and Lake Sevan');
});

test('booking total is calculated from database prices and seats are reserved', async () => {
  const response = await request(app).post('/api/bookings').send({
    customer: { name: 'Test Guest', email: 'guest@example.com', phone: '+37400000000' },
    currency: 'USD', items: [{ tour_id: tour.id, departure_id: departure.id, guests: 2, addon_ids: ['private-guide-car'] }]
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.total_amd, tour.price_amd * 2 + 15600);
  assert.equal(response.body.data.status, 'pending');
  const bookingId = db.prepare('SELECT id FROM bookings WHERE reference=?').get(response.body.data.reference).id;
  assert.equal(db.prepare('SELECT tour_name FROM booking_items WHERE booking_id=?').get(bookingId).tour_name,
    db.prepare('SELECT name_en FROM tours WHERE id=?').get(tour.id).name_en);
  assert.equal(db.prepare('SELECT seats_taken FROM tour_departures WHERE id=?').get(departure.id).seats_taken, 2);
});

test('per-person add-ons scale with group size', async () => {
  const addonId = 'test-per-person';
  db.prepare("INSERT INTO addons (id,name_en,price_amd,price_type) VALUES (?, 'Per-person test add-on', 1200, 'per_person')").run(addonId);
  const departureId = db.prepare('INSERT INTO tour_departures (tour_id,date,seats_total) VALUES (?,?,4)').run(tour.id, '2097-01-01').lastInsertRowid;
  const response = await request(app).post('/api/bookings').send({
    customer: { name: 'Group Guest', email: 'group@example.com', phone: '+37400000000' },
    items: [{ tour_id: tour.id, departure_id: departureId, guests: 3, addon_ids: [addonId] }]
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.total_amd, tour.price_amd * 3 + 3600);
});

test('priced transfer bookings use backend fares and appear in admin bookings', async () => {
  const routesSetting = db.prepare("SELECT value FROM settings WHERE key='transfer_routes'").get();
  const extrasSetting = db.prepare("SELECT value FROM settings WHERE key='transfer_extras'").get();
  const routes = JSON.parse(routesSetting.value);
  const extras = JSON.parse(extrasSetting.value);
  const route = routes.find(item => item.id === 'zvartnots-yerevan');
  const quote = await request(app).post('/api/bookings').send({
    customer: { name: 'Quote Guest', email: 'transfer-quote@example.com', phone: '+37400000000' },
    items: [{ type: 'transfer', route_id: route.id, travel_at: '2099-03-01T10:00', vehicle: 'sedan', passengers: 2, extra_ids: [] }]
  });
  assert.equal(quote.status, 201);
  assert.equal(quote.body.data.total_amd, 5850);
  route.sedan_amd = 25000;
  extras[0].price_amd = 2000;
  db.prepare("UPDATE settings SET value=? WHERE key='transfer_routes'").run(JSON.stringify(routes));
  db.prepare("UPDATE settings SET value=? WHERE key='transfer_extras'").run(JSON.stringify(extras));
  try {
    const response = await request(app).post('/api/bookings').send({
      customer: { name: 'Transfer Guest', email: 'transfer@example.com', phone: '+37400000000' },
      items: [{ type: 'transfer', route_id: route.id, travel_at: '2099-03-01T10:00', vehicle: 'sedan', passengers: 2, extra_ids: ['child-seat'] }]
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.equal(response.body.data.total_amd, 27000);
    const invalidDate = await request(app).post('/api/bookings').send({
      customer: { name: 'Invalid Date Guest', email: 'invalid-date@example.com', phone: '+37400000000' },
      items: [{ type: 'transfer', route_id: route.id, travel_at: 'tomorrow', vehicle: 'sedan', passengers: 2, extra_ids: [] }]
    });
    assert.equal(invalidDate.status, 400);
    const saved = db.prepare('SELECT route_name,vehicle,passengers,unit_price_amd,total_amd FROM booking_transfers WHERE booking_id=(SELECT id FROM bookings WHERE email=?)').get('transfer@example.com');
    assert.deepEqual(saved, { route_name: 'Zvartnots Airport to Yerevan', vehicle: 'sedan', passengers: 2, unit_price_amd: 25000, total_amd: 27000 });
    const bookings = await client.get('/api/admin/bookings?date=2099-03-01');
    assert.equal(bookings.status, 200, JSON.stringify(bookings.body));
    assert.ok(bookings.body.data.find(item => item.email === 'transfer@example.com').items.some(item => item.kind === 'transfer' && item.vehicle === 'sedan'));
  } finally {
    db.prepare("UPDATE settings SET value=? WHERE key='transfer_routes'").run(routesSetting.value);
    db.prepare("UPDATE settings SET value=? WHERE key='transfer_extras'").run(extrasSetting.value);
  }
});

test('Stripe webhook verifies its signature and marks the matching booking paid', async () => {
  const booking = db.prepare("SELECT reference FROM bookings WHERE email='guest@example.com'").get();
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { booking_reference: booking.reference } } } });
  process.env.STRIPE_WEBHOOK_SECRET = 'test-webhook-secret';
  const digest = createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest('hex');
  const response = await request(app).post('/api/webhooks/stripe').set('stripe-signature', `t=${timestamp},v1=${digest}`).set('Content-Type', 'application/json').send(payload);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const updated = db.prepare('SELECT status,payment_status FROM bookings WHERE reference=?').get(booking.reference);
  assert.deepEqual(updated, { status: 'paid', payment_status: 'paid' });
});

test('a full departure rejects a competing booking without partial writes', async () => {
  const departureId = db.prepare('INSERT INTO tour_departures (tour_id,date,seats_total,seats_taken) VALUES (?,?,2,0)').run(tour.id, '2099-01-01').lastInsertRowid;
  const payload = { customer: { name: 'Race Guest', email: 'race@example.com', phone: '+37400000000' }, items: [{ tour_id: tour.id, departure_id: departureId, guests: 2, addon_ids: [] }] };
  const results = await Promise.all([request(app).post('/api/bookings').send(payload), request(app).post('/api/bookings').send(payload)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  assert.equal(db.prepare('SELECT seats_taken FROM tour_departures WHERE id=?').get(departureId).seats_taken, 2);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM bookings WHERE email=?').get('race@example.com').count, 1);
});

test('public input validation and unavailable add-ons are rejected', async () => {
  const invalid = await request(app).post('/api/bookings').send({ customer: { name: 'x', email: 'bad', phone: '' }, items: [] });
  assert.equal(invalid.status, 400);
  const unknownAddon = await request(app).post('/api/bookings').send({ customer: { name: 'Test Guest', email: 'valid@example.com', phone: '+37400000000' }, items: [{ tour_id: tour.id, departure_id: departure.id, guests: 2, addon_ids: ['missing'] }] });
  assert.equal(unknownAddon.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM bookings WHERE email=?').get('valid@example.com').count, 0);
  const oneGuest = await request(app).post('/api/bookings').send({ customer: { name: 'Solo Guest', email: 'solo@example.com', phone: '+37400000000' }, items: [{ tour_id: tour.id, departure_id: departure.id, guests: 1, addon_ids: [] }] });
  assert.equal(oneGuest.status, 400);
});

test('authentication protects admin routes and rejects invalid CSRF tokens', async () => {
  assert.equal((await request(app).get('/api/admin/tours')).status, 401);
  const invalidCsrf = await client.put('/api/admin/settings').set('x-csrf-token', 'wrong').send({ usd_rate: '400' });
  assert.equal(invalidCsrf.status, 403);
  assert.equal((await client.get('/api/admin/dashboard')).status, 200);
});

test('owner can create tours, manage departures, and access admin collections', async () => {
  const base = {
    slug: 'test-admin-tour', category: 'Culture', duration: '1 day', price_amd: 10000, difficulty: 'easy', max_group: 8, status: 'draft', sort_order: 20,
    name_en: 'Admin-created test tour', description_en: 'A test description for an admin-created tour.', highlights_en: ['One stop'],
    name_ru: 'Тестовый тур', description_ru: 'Описание тестового тура.', highlights_ru: ['Остановка'],
    name_hy: 'Փորձնական շրջագայություն', description_hy: 'Փորձնական շրջագայության նկարագրություն։', highlights_hy: ['Կանգառ']
  };
  const created = await client.post('/api/admin/tours').send(base);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data.id;
  assert.equal((await client.get('/api/admin/tours')).status, 200);
  const updated = await client.put(`/api/admin/tours/${id}`).send({ ...base, status: 'published' });
  assert.equal(updated.status, 200);
  const duplicate = await client.post(`/api/admin/tours/${id}/duplicate`).send({});
  assert.equal(duplicate.status, 201);
  const departureCreate = await client.post(`/api/admin/tours/${id}/departures`).send({ date: '2099-02-01', seats_total: 10 });
  assert.equal(departureCreate.status, 201);
  const collectionRoutes = ['/dashboard','/bookings','/requests','/reviews','/addons','/services','/settings','/users'];
  for (const route of collectionRoutes) assert.equal((await client.get(`/api/admin${route}`)).status, 200, route);
  const settingsUpdate = await client.put('/api/admin/settings').send({ usd_rate: '400', hero_title: 'Test Armenia' });
  assert.equal(settingsUpdate.status, 200);
  assert.equal((await client.delete(`/api/admin/tours/${id}`)).status, 200);
});

test('service icons must use valid Lucide keys and a default fallback', async () => {
  const valid = await client.post('/api/admin/services').send({
    name_en: 'Lucide test service', description_en: 'Valid icon key should be accepted.',
    name_ru: 'Услуга', description_ru: 'Описание.', name_hy: 'Ծառայություն', description_hy: 'Նկարագրություն։',
    icon: 'plane', active: true, sort_order: 7
  });
  assert.equal(valid.status, 201, JSON.stringify(valid.body));

  const invalid = await client.post('/api/admin/services').send({
    name_en: 'Broken icon service', description_en: 'Invalid key should be rejected.',
    name_ru: 'Услуга', description_ru: 'Описание.', name_hy: 'Ծառայություն', description_hy: 'Նկարագրություն։',
    icon: 'not-a-real-icon', active: true, sort_order: 8
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /icon/i);
});

test('public requests and remaining admin CRUD endpoints work', async () => {
  const custom = await request(app).post('/api/requests').send({ name: 'Custom Guest', email: 'custom@example.com', message: 'We would like a private route through Armenia.' });
  assert.equal(custom.status, 201);
  const requestRows = await client.get('/api/admin/requests');
  assert.equal(requestRows.status, 200);
  const requestId = custom.body.data.id;
  assert.equal((await client.patch(`/api/admin/requests/${requestId}`).send({ status: 'contacted' })).status, 200);
  assert.equal(db.prepare('SELECT status FROM custom_requests WHERE id=?').get(requestId).status, 'contacted');
  const reply = await client.post(`/api/admin/requests/${requestId}/reply`).send({ subject: 'Your route', message: 'Thanks for getting in touch. We will send a route shortly.' });
  assert.equal(reply.status, 200);
  assert.ok(['sent', 'logged', 'not_sent'].includes(reply.body.data.delivery));
  assert.equal((await client.delete(`/api/admin/requests/${requestId}`)).status, 200);

  const addon = await client.post('/api/admin/addons').send({ id: 'test-extra', name_en: 'Test extra', name_ru: 'Дополнение', name_hy: 'Հավելում', price_amd: 1200, active: true });
  assert.equal(addon.status, 201);
  assert.equal((await client.put('/api/admin/addons/test-extra').send({ id: 'test-extra', name_en: 'Updated extra', name_ru: 'Дополнение', name_hy: 'Հավելում', price_amd: 1400, active: true })).status, 200);
  assert.equal((await client.delete('/api/admin/addons/test-extra')).status, 200);

  const service = await client.post('/api/admin/services').send({ name_en: 'Test service', description_en: 'Service test description.', name_ru: 'Услуга', description_ru: 'Описание услуги.', name_hy: 'Ծառայություն', description_hy: 'Ծառայության նկարագրություն։', icon: 'car', active: true, sort_order: 9 });
  assert.equal(service.status, 201);
  assert.equal((await client.put(`/api/admin/services/${service.body.data.id}`).send({ name_en: 'Updated service', description_en: 'Updated service description.', name_ru: 'Услуга', description_ru: 'Описание услуги.', name_hy: 'Ծառայություն', description_hy: 'Ծառայության նկարագրություն։', icon: 'car', active: true, sort_order: 9 })).status, 200);
  assert.equal((await client.delete(`/api/admin/services/${service.body.data.id}`)).status, 200);

  const departureId = db.prepare('INSERT INTO tour_departures (tour_id,date,seats_total) VALUES (?,?,?)').run(tour.id, '2098-01-01', 9).lastInsertRowid;
  assert.equal((await client.get(`/api/admin/tours/${tour.id}/departures`)).status, 200);
  assert.equal((await client.get(`/api/admin/tours/${tour.id}/photos`)).status, 200);
  const photoId = db.prepare('INSERT INTO tour_photos (tour_id,filename,alt_en,sort_order) VALUES (?,?,?,?)').run(tour.id, 'metadata-test.webp', 'Old alt', 0).lastInsertRowid;
  assert.equal((await client.patch(`/api/admin/photos/${photoId}`).send({ alt_en: 'Updated alternative text', sort_order: 3 })).status, 200);
  assert.equal(db.prepare('SELECT alt_en,sort_order FROM tour_photos WHERE id=?').get(photoId).sort_order, 3);
  assert.equal((await client.delete(`/api/admin/photos/${photoId}`)).status, 200);
  assert.equal((await client.put(`/api/admin/departures/${departureId}`).send({ date: '2098-01-02', seats_total: 11 })).status, 200);
  assert.equal((await client.delete(`/api/admin/departures/${departureId}`)).status, 200);

  const booking = db.prepare("SELECT id FROM bookings WHERE email='guest@example.com'").get();
  assert.equal((await client.get(`/api/admin/bookings?q=HQ&status=pending&tour=${tour.id}&date=${departure.date}`)).status, 200);
  const csv = await client.get('/api/admin/bookings/export.csv');
  assert.equal(csv.status, 200); assert.match(csv.text, /reference,customer_name/);
  const resend = await client.post(`/api/admin/bookings/${booking.id}/resend`).send({});
  assert.equal(resend.status, 200);
  assert.ok(['sent', 'logged', 'not_sent'].includes(resend.body.data.delivery));

  const staff = await client.post('/api/admin/users').send({ email: 'staff@test.example', password: 'staff-password-change-me', role: 'staff' });
  assert.equal(staff.status, 201);
  assert.ok((await client.get('/api/admin/users')).body.data.some(user => user.email === 'staff@test.example'));
  assert.equal((await client.delete(`/api/admin/users/${staff.body.data.id}`)).status, 200);
  assert.equal((await client.post('/api/admin/me/password').send({ current_password: process.env.ADMIN_PASSWORD, new_password: 'new-password-change-me-123' })).status, 200);

  const fakeImage = Buffer.from('not-an-image');
  assert.equal((await client.post(`/api/admin/tours/${tour.id}/photos`).attach('photos', fakeImage, { filename: 'bad.webp', contentType: 'image/webp' })).status, 400);
  assert.equal((await client.post('/api/admin/settings/logo').attach('photos', fakeImage, { filename: 'bad.webp', contentType: 'image/webp' })).status, 400);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZAAAAABJRU5ErkJggg==', 'base64');
  const uploadedPhoto = await client.post(`/api/admin/tours/${tour.id}/photos`).attach('photos', png, { filename: 'tiny.png', contentType: 'image/png' });
  assert.equal(uploadedPhoto.status, 201);
  const uploadedPhotoResponse = await request(app).get(uploadedPhoto.body.data[0].url).set('Origin', 'https://frontend.test');
  assert.equal(uploadedPhotoResponse.status, 200);
  assert.equal(uploadedPhotoResponse.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal((await client.delete(`/api/admin/photos/${uploadedPhoto.body.data[0].id}`)).status, 200);
  const uploadedTourCardImage = await client.post(`/api/admin/tours/${tour.id}/card-image`).attach('photos', png, { filename: 'tour-card.png', contentType: 'image/png' });
  assert.equal(uploadedTourCardImage.status, 201);
  assert.equal((await request(app).get(`/api/tours/${tour.slug}`)).body.data.card_image_url, uploadedTourCardImage.body.data.url);
  assert.equal((await client.delete(`/api/admin/tours/${tour.id}/card-image`)).status, 200);
  assert.equal((await request(app).get(`/api/tours/${tour.slug}`)).body.data.card_image_url, '');
  const uploadedLogo = await client.post('/api/admin/settings/logo').attach('photos', png, { filename: 'logo.png', contentType: 'image/png' });
  assert.equal(uploadedLogo.status, 201);
  const uploadedToursBackground = await client.post('/api/admin/settings/tours-background').attach('photos', png, { filename: 'tours.png', contentType: 'image/png' });
  assert.equal(uploadedToursBackground.status, 201);
  assert.match((await request(app).get('/api/settings')).body.data.tours_background_url, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.equal((await client.delete('/api/admin/settings/tours-background')).status, 200);
  assert.equal((await request(app).get('/api/settings')).body.data.tours_background_url, '');
  assert.equal((await request(app).post('/api/webhooks/stripe').set('stripe-signature', 'invalid').set('Content-Type', 'application/json').send('{}')).status, 400);
});

test('review moderation and booking cancellation update state safely', async () => {
  const review = await request(app).post('/api/reviews').send({ tour_id: tour.id, name: 'Reviewer', rating: 5, text: 'A thoughtful and wonderful tour experience.' });
  assert.equal(review.status, 201);
  assert.equal((await request(app).get('/api/reviews')).body.data.length, 0);
  assert.equal((await client.patch(`/api/admin/reviews/${review.body.data.id}`).send({ approved: true })).status, 200);
  assert.equal((await request(app).get('/api/reviews')).body.data.length, 1);
  const booking = db.prepare("SELECT id FROM bookings WHERE email='guest@example.com'").get();
  const cancelled = await client.patch(`/api/admin/bookings/${booking.id}`).send({ status: 'cancelled', internal_notes: 'Cancelled by test' });
  assert.equal(cancelled.status, 200);
  assert.equal(db.prepare('SELECT seats_taken FROM tour_departures WHERE id=?').get(departure.id).seats_taken, 0);
});

test('logout clears the session and invalid credentials are rejected', async () => {
  const invalid = await request(app).post('/api/auth/login').send({ email: process.env.ADMIN_EMAIL, password: 'wrong-password' });
  assert.equal(invalid.status, 401);
  const logout = await client.post('/api/auth/logout');
  assert.equal(logout.status, 200);
  assert.equal((await client.get('/api/auth/me')).status, 401);
  assert.equal((await request(app).get('/api/missing')).status, 404);
});
