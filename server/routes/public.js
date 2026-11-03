import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { db, getSetting } from '../db.js';
import { ApiError } from '../errors.js';
import { sendBookingEmails, sendRequestAlert } from '../services/email.js';
import { createCheckoutSession } from '../services/payments.js';

export const publicRouter = Router();
const langSchema = z.enum(['en', 'ru', 'hy']).catch('en');
const email = z.string().trim().email().max(254);
const localize = (row, prefix, lang) => ({
  ...row,
  name: row[`${prefix}_${lang}`] || row[`${prefix}_en`],
  description: row[`description_${lang}`] || row.description_en,
  highlights: JSON.parse(row[`highlights_${lang}`] || row.highlights_en || '[]')
});
const tourQuery = `SELECT t.*,
  (SELECT json_group_array(json_object('id',p.id,'url','/uploads/' || p.filename,'alt',p.alt_en,'sort_order',p.sort_order)) FROM tour_photos p WHERE p.tour_id=t.id) photos,
  (SELECT json_group_array(json_object('id',d.id,'date',d.date,'seats_total',d.seats_total,'seats_remaining',d.seats_total-d.seats_taken)) FROM tour_departures d WHERE d.tour_id=t.id AND d.date >= date('now') AND d.seats_taken < d.seats_total ORDER BY d.date) departures
  FROM tours t`;

publicRouter.get('/tours', (req, res) => {
  const lang = langSchema.parse(req.query.lang);
  const tours = db.prepare(`${tourQuery} WHERE t.status='published' ORDER BY t.sort_order,t.id`).all().map(row => ({
    ...localize(row, 'name', lang), photos: JSON.parse(row.photos || '[]'), departures: JSON.parse(row.departures || '[]')
  }));
  res.json({ data: tours });
});

publicRouter.get('/tours/:slug', (req, res, next) => {
  const slug = z.string().min(1).max(120).safeParse(req.params.slug);
  if (!slug.success) return next(new ApiError(400, 'Invalid tour slug.'));
  const row = db.prepare(`${tourQuery} WHERE t.slug=? AND t.status='published'`).get(slug.data);
  if (!row) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  const lang = langSchema.parse(req.query.lang);
  res.json({ data: { ...localize(row, 'name', lang), photos: JSON.parse(row.photos || '[]'), departures: JSON.parse(row.departures || '[]') } });
});

publicRouter.get('/addons', (req, res) => {
  const lang = langSchema.parse(req.query.lang);
  const rows = db.prepare('SELECT * FROM addons WHERE active=1 ORDER BY rowid').all();
  res.json({ data: rows.map(row => ({ ...row, name: row[`name_${lang}`] || row.name_en, price_amd: Number(row.price_amd) })) });
});

publicRouter.get('/services', (req, res) => {
  const lang = langSchema.parse(req.query.lang);
  const rows = db.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort_order,id').all();
  res.json({ data: rows.map(row => ({ ...row, name: row[`name_${lang}`] || row.name_en, description: row[`description_${lang}`] || row.description_en })) });
});

publicRouter.get('/settings', (_req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  res.json({ data: Object.fromEntries(rows.map(row => [row.key, row.value])) });
});

const bookingSchema = z.object({
  customer: z.object({ name: z.string().trim().min(2).max(120), email, phone: z.string().trim().min(5).max(40) }),
  notes: z.string().trim().max(2000).optional().default(''),
  currency: z.enum(['AMD', 'USD']).default('AMD'),
  items: z.array(z.union([
    z.object({
      type: z.literal('tour').optional(),
      tour_id: z.coerce.number().int().positive(),
      departure_id: z.coerce.number().int().positive(),
      guests: z.coerce.number().int().min(2).max(20),
      addon_ids: z.array(z.string().trim().min(1).max(40)).max(20).default([])
    }),
    z.object({
      type: z.literal('transfer'),
      route_id: z.string().trim().min(2).max(80),
      travel_at: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).refine(value => Number.isFinite(Date.parse(value))),
      vehicle: z.enum(['sedan', 'minivan']),
      passengers: z.coerce.number().int().min(1).max(7),
      flight_number: z.string().trim().max(20).default(''),
      pickup_address: z.string().trim().max(160).default(''),
      extra_ids: z.array(z.string().trim().min(1).max(40)).max(10).default([])
    })
  ])).min(1).max(12)
});

publicRouter.post('/bookings', async (req, res, next) => {
  const parsed = bookingSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Please check the booking details.', 'VALIDATION_ERROR'));
  const data = parsed.data;
  const reference = `HQ-${randomBytes(4).toString('hex').toUpperCase()}`;
  const details = [];
  let total = 0;
  try {
    const create = db.transaction(() => {
      const booking = db.prepare(`INSERT INTO bookings (reference,customer_name,email,phone,notes,total_amd,currency)
        VALUES (?,?,?,?,?,?,?)`).run(reference, data.customer.name, data.customer.email.toLowerCase(), data.customer.phone, data.notes, 0, data.currency);
      const insertItem = db.prepare('INSERT INTO booking_items (booking_id,tour_id,departure_id,guests,unit_price_amd,addon_ids,tour_name) VALUES (?,?,?,?,?,?,?)');
      for (const item of data.items) {
        if (item.type === 'transfer') {
          if ((item.vehicle === 'sedan' && item.passengers > 3)) throw new ApiError(400, 'A sedan can carry at most 3 passengers.', 'VEHICLE_LIMIT');
          const routes = JSON.parse(getSetting('transfer_routes', '[]'));
          const route = routes.find(value => value.id === item.route_id);
          if (!route) throw new ApiError(404, 'Transfer route not found.', 'TRANSFER_NOT_FOUND');
          const unitPrice = Number(item.vehicle === 'sedan' ? route.sedan_amd : route.minivan_amd);
          if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) throw new ApiError(409, 'This transfer route is not available for online booking yet. Request a quote instead.', 'TRANSFER_QUOTE_REQUIRED');
          const extraIds = [...new Set(item.extra_ids)];
          const extras = JSON.parse(getSetting('transfer_extras', '[]'));
          const selectedExtras = extras.filter(extra => extraIds.includes(extra.id));
          if (selectedExtras.length !== extraIds.length) throw new ApiError(400, 'A selected transfer extra is unavailable.', 'INVALID_ADDON');
          const extrasTotal = selectedExtras.reduce((sum, extra) => sum + Number(extra.price_amd || 0), 0);
          const itemTotal = unitPrice + extrasTotal;
          const routeName = `${route.from} to ${route.to}`;
          const bookingId = Number(booking.lastInsertRowid);
          db.prepare(`INSERT INTO booking_transfers
            (booking_id,route_id,route_name,travel_at,vehicle,passengers,flight_number,pickup_address,extras,unit_price_amd,total_amd)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
            .run(bookingId, route.id, routeName, item.travel_at, item.vehicle, item.passengers, item.flight_number, item.pickup_address, JSON.stringify(extraIds), unitPrice, itemTotal);
          total += itemTotal;
          details.push({ name: routeName, date: item.travel_at, guests: item.passengers, total_amd: itemTotal });
          continue;
        }
        const tour = db.prepare("SELECT id,slug,name_en,price_amd,max_group FROM tours WHERE id=? AND status='published'").get(item.tour_id);
        const departure = db.prepare('SELECT id,date,seats_total,seats_taken FROM tour_departures WHERE id=? AND tour_id=?').get(item.departure_id, item.tour_id);
        if (!tour || !departure || departure.date < new Date().toISOString().slice(0, 10)) throw new ApiError(409, 'One selected departure is no longer available.', 'DEPARTURE_UNAVAILABLE');
        if (item.guests > tour.max_group) throw new ApiError(409, 'The guest count exceeds the maximum group size.', 'GROUP_LIMIT');
        const reserve = db.prepare('UPDATE tour_departures SET seats_taken=seats_taken+? WHERE id=? AND seats_taken+? <= seats_total').run(item.guests, departure.id, item.guests);
        if (!reserve.changes) throw new ApiError(409, 'There are not enough seats left for one selected departure.', 'SEATS_UNAVAILABLE');
        const ids = [...new Set(item.addon_ids)];
        const addons = ids.length ? db.prepare(`SELECT id,name_en,price_amd,price_type FROM addons WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
        if (addons.length !== ids.length) throw new ApiError(400, 'A selected add-on is unavailable.', 'INVALID_ADDON');
        const itemTotal = tour.price_amd * item.guests + addons.reduce((sum, addon) => sum + addon.price_amd * (addon.price_type === 'per_person' ? item.guests : 1), 0);
        total += itemTotal;
        insertItem.run(booking.lastInsertRowid, tour.id, departure.id, item.guests, tour.price_amd, JSON.stringify(ids), tour.name_en);
        details.push({ name: tour.name_en, date: departure.date, guests: item.guests, total_amd: itemTotal });
      }
      db.prepare('UPDATE bookings SET total_amd=? WHERE id=?').run(total, booking.lastInsertRowid);
    });
    create();
  } catch (error) {
    return next(error);
  }
  const booking = { reference, customer_name: data.customer.name, email: data.customer.email, total_amd: total };
  await sendBookingEmails(booking, details).catch(error => console.error('Booking email failed:', error));
  let checkout_url = null;
  try { checkout_url = await createCheckoutSession(booking, details, getSetting('usd_rate', '390')); }
  catch (error) { console.error('Payment session creation failed:', error); }
  res.status(201).json({ data: { reference, total_amd: total, currency: data.currency, status: 'pending', checkout_url } });
});

const requestSchema = z.object({ name: z.string().trim().min(2).max(120), email, message: z.string().trim().min(10).max(4000) });
publicRouter.post('/requests', async (req, res, next) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Please complete all request fields.', 'VALIDATION_ERROR'));
  try {
    const result = db.prepare('INSERT INTO custom_requests (name,email,message) VALUES (?,?,?)').run(parsed.data.name, parsed.data.email.toLowerCase(), parsed.data.message);
    await sendRequestAlert(parsed.data);
    res.status(201).json({ data: { id: result.lastInsertRowid, status: 'new' } });
  } catch (error) {
    next(error);
  }
});

const reviewSchema = z.object({ tour_id: z.coerce.number().int().positive().nullable().optional(), name: z.string().trim().min(2).max(120), rating: z.coerce.number().int().min(1).max(5), text: z.string().trim().min(10).max(2000) });
publicRouter.post('/reviews', (req, res, next) => {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Please check the review details.', 'VALIDATION_ERROR'));
  const { tour_id, name, rating, text } = parsed.data;
  if (tour_id && !db.prepare("SELECT id FROM tours WHERE id=? AND status='published'").get(tour_id)) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  const result = db.prepare('INSERT INTO reviews (tour_id,name,rating,text) VALUES (?,?,?,?)').run(tour_id || null, name, rating, text);
  res.status(201).json({ data: { id: result.lastInsertRowid, approved: false } });
});

publicRouter.get('/reviews', (req, res, next) => {
  const tourId = req.query.tour ? z.coerce.number().int().positive().safeParse(req.query.tour) : null;
  if (tourId && !tourId.success) return next(new ApiError(400, 'Invalid tour id.'));
  const rows = tourId?.data
    ? db.prepare('SELECT id,tour_id,name,rating,text,created_at FROM reviews WHERE approved=1 AND tour_id=? ORDER BY id DESC').all(tourId.data)
    : db.prepare('SELECT id,tour_id,name,rating,text,created_at FROM reviews WHERE approved=1 ORDER BY id DESC LIMIT 100').all();
  res.json({ data: rows });
});