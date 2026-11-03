import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db.js';
import { ApiError } from '../errors.js';
import { requireAdmin, requireOwner } from '../middleware/auth.js';
import { sendEmail } from '../services/email.js';
import { uploadsDirectory } from '../uploads.js';

const SERVICE_ICON_KEYS = [
  'map-pin', 'car', 'plane', 'bed-double', 'ticket', 'users', 'route', 'landmark', 'coffee', 'camera',
  'luggage', 'sparkles', 'briefcase-business', 'badge-check', 'croissant', 'truck', 'star'
];

export const adminRouter = Router();
adminRouter.use(requireAdmin);

const text = (min = 1, max = 4000) => z.string().trim().min(min).max(max);
const integer = (min = 0, max = 100000000) => z.coerce.number().int().min(min).max(max);
const serviceIconSchema = z.string().trim().max(40).refine(value => !value || SERVICE_ICON_KEYS.includes(value), {
  message: 'Service icon must be one of the supported Lucide keys.'
});
const imageStorage = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 10 }, fileFilter: (_req, file, callback) => {
  callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype));
} });
const tourSchema = z.object({
  slug: text(2, 120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), category: text(2, 80), duration: text(1, 80),
  price_amd: integer(), difficulty: text(1, 40), max_group: integer(1, 200), status: z.enum(['draft', 'published']), sort_order: integer(0, 10000),
  name_en: text(2, 180), description_en: text(2, 4000), highlights_en: z.array(text(1, 240)).max(20),
  name_ru: text(0, 180).default(''), description_ru: text(0, 4000).default(''), highlights_ru: z.array(text(1, 240)).max(20).default([]),
  name_hy: text(0, 180).default(''), description_hy: text(0, 4000).default(''), highlights_hy: z.array(text(1, 240)).max(20).default([])
});

adminRouter.get('/dashboard', (_req, res) => {
  const counts = db.prepare(`SELECT
    (SELECT COUNT(*) FROM bookings WHERE date(created_at)=date('now')) today,
    (SELECT COUNT(*) FROM bookings WHERE created_at >= datetime('now','-7 days')) week,
    (SELECT COUNT(*) FROM bookings WHERE created_at >= datetime('now','start of month')) month,
    (SELECT COALESCE(SUM(total_amd),0) FROM bookings WHERE status IN ('confirmed','paid','completed')) revenue,
    (SELECT COUNT(*) FROM bookings WHERE status='pending') pending`).get();
  const departures = db.prepare(`SELECT d.id,d.date,d.seats_total,d.seats_taken,t.name_en AS tour_name
    FROM tour_departures d JOIN tours t ON t.id=d.tour_id WHERE d.date>=date('now') AND d.seats_taken<d.seats_total ORDER BY d.date LIMIT 12`).all();
  const requests = db.prepare('SELECT * FROM custom_requests ORDER BY id DESC LIMIT 8').all();
  res.json({ data: { ...counts, upcoming_departures: departures, newest_requests: requests } });
});

adminRouter.get('/tours', (_req, res) => res.json({ data: db.prepare('SELECT * FROM tours ORDER BY sort_order,id').all().map(row => ({ ...row, highlights_en: JSON.parse(row.highlights_en), highlights_ru: JSON.parse(row.highlights_ru), highlights_hy: JSON.parse(row.highlights_hy) })) }));
adminRouter.post('/tours/:id/card-image', imageStorage.single('photos'), (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  const tour = db.prepare('SELECT card_image_url FROM tours WHERE id=?').get(id.data);
  if (!tour) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  const file = req.file;
  if (!file) return next(new ApiError(400, 'Select a JPG, PNG, or WebP image up to 5 MB.'));
  const valid = (file.mimetype === 'image/jpeg' && file.buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (file.mimetype === 'image/png' && file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (file.mimetype === 'image/webp' && file.buffer.toString('ascii',0,4) === 'RIFF' && file.buffer.toString('ascii',8,12) === 'WEBP');
  if (!valid) return next(new ApiError(400, 'Tour card image is not a valid image.'));
  const uploadDir = uploadsDirectory;
  fs.mkdirSync(uploadDir, { recursive: true });
  const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
  const filename = `${randomBytes(16).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer, { flag: 'wx' });
  const url = `/uploads/${filename}`;
  db.prepare('UPDATE tours SET card_image_url=? WHERE id=?').run(url, id.data);
  if (tour.card_image_url?.startsWith('/uploads/')) fs.rmSync(path.resolve(uploadDir, path.basename(tour.card_image_url)), { force: true });
  res.status(201).json({ data: { url } });
});
adminRouter.delete('/tours/:id/card-image', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  const tour = db.prepare('SELECT card_image_url FROM tours WHERE id=?').get(id.data);
  if (!tour) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  db.prepare("UPDATE tours SET card_image_url='' WHERE id=?").run(id.data);
  if (tour.card_image_url?.startsWith('/uploads/')) fs.rmSync(path.resolve(uploadsDirectory, path.basename(tour.card_image_url)), { force: true });
  res.json({ data: { deleted: true } });
});
adminRouter.post('/tours', (req, res, next) => {
  const parsed = tourSchema.safeParse(req.body);
  if (!parsed.success) return next(new ApiError(400, 'Tour fields are invalid.', 'VALIDATION_ERROR'));
  const data = parsed.data;
  try {
    const result = db.prepare(`INSERT INTO tours (slug,category,duration,price_amd,difficulty,max_group,status,sort_order,name_en,description_en,highlights_en,name_ru,description_ru,highlights_ru,name_hy,description_hy,highlights_hy)
      VALUES (@slug,@category,@duration,@price_amd,@difficulty,@max_group,@status,@sort_order,@name_en,@description_en,@highlights_en,@name_ru,@description_ru,@highlights_ru,@name_hy,@description_hy,@highlights_hy)`)
      .run({ ...data, highlights_en: JSON.stringify(data.highlights_en), highlights_ru: JSON.stringify(data.highlights_ru), highlights_hy: JSON.stringify(data.highlights_hy) });
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch (error) { next(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? new ApiError(409, 'That tour slug already exists.') : error); }
});
adminRouter.put('/tours/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  const parsed = tourSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return next(new ApiError(400, 'Tour fields are invalid.', 'VALIDATION_ERROR'));
  const data = parsed.data;
  const result = db.prepare(`UPDATE tours SET slug=@slug,category=@category,duration=@duration,price_amd=@price_amd,difficulty=@difficulty,max_group=@max_group,status=@status,sort_order=@sort_order,name_en=@name_en,description_en=@description_en,highlights_en=@highlights_en,name_ru=@name_ru,description_ru=@description_ru,highlights_ru=@highlights_ru,name_hy=@name_hy,description_hy=@description_hy,highlights_hy=@highlights_hy WHERE id=@id`)
    .run({ ...data, id: id.data, highlights_en: JSON.stringify(data.highlights_en), highlights_ru: JSON.stringify(data.highlights_ru), highlights_hy: JSON.stringify(data.highlights_hy) });
  if (!result.changes) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  res.json({ data: { updated: true } });
});
adminRouter.post('/tours/:id/duplicate', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  const source = db.prepare('SELECT * FROM tours WHERE id=?').get(id.data);
  if (!source) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  const slug = `${source.slug}-copy-${randomBytes(2).toString('hex')}`;
  const result = db.prepare(`INSERT INTO tours (slug,category,duration,price_amd,difficulty,max_group,status,sort_order,name_en,description_en,highlights_en,name_ru,description_ru,highlights_ru,name_hy,description_hy,highlights_hy)
    VALUES (?,?,?,?,?,?, 'draft',?,?,?,?,?,?,?,?,?,?)`).run(slug,source.category,source.duration,source.price_amd,source.difficulty,source.max_group,source.sort_order,`${source.name_en} (copy)`,source.description_en,source.highlights_en,source.name_ru,source.description_ru,source.highlights_ru,source.name_hy,source.description_hy,source.highlights_hy);
  res.status(201).json({ data: { id: result.lastInsertRowid, slug } });
});
adminRouter.delete('/tours/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  try {
    const result = db.prepare('DELETE FROM tours WHERE id=?').run(id.data);
    if (!result.changes) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
    res.json({ data: { deleted: true } });
  } catch { next(new ApiError(409, 'Tours with bookings cannot be removed. Hide this tour instead.')); }
});

adminRouter.get('/tours/:id/departures', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  res.json({ data: db.prepare('SELECT * FROM tour_departures WHERE tour_id=? ORDER BY date').all(id.data) });
});
adminRouter.get('/tours/:id/photos', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid tour id.'));
  res.json({ data: db.prepare("SELECT id,filename,'/uploads/' || filename AS url,alt_en,sort_order FROM tour_photos WHERE tour_id=? ORDER BY sort_order,id").all(id.data) });
});
adminRouter.patch('/photos/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  const parsed = z.object({ alt_en: z.string().trim().max(180), sort_order: integer(0, 10000) }).safeParse(req.body);
  if (!id.success || !parsed.success) return next(new ApiError(400, 'Photo details are invalid.', 'VALIDATION_ERROR'));
  const result = db.prepare('UPDATE tour_photos SET alt_en=?,sort_order=? WHERE id=?').run(parsed.data.alt_en, parsed.data.sort_order, id.data);
  if (!result.changes) return next(new ApiError(404, 'Photo not found.', 'NOT_FOUND'));
  res.json({ data: { updated: true } });
});
const departureSchema = z.object({ date: z.string().date(), seats_total: integer(1, 200) });
adminRouter.post('/tours/:id/departures', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id), parsed = departureSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return next(new ApiError(400, 'Departure fields are invalid.', 'VALIDATION_ERROR'));
  if (!db.prepare('SELECT id FROM tours WHERE id=?').get(id.data)) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  try {
    const result = db.prepare('INSERT INTO tour_departures (tour_id,date,seats_total) VALUES (?,?,?)').run(id.data, parsed.data.date, parsed.data.seats_total);
    res.status(201).json({ data: { id: result.lastInsertRowid } });
  } catch { next(new ApiError(409, 'A departure already exists for that date.')); }
});
adminRouter.put('/departures/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id), parsed = departureSchema.safeParse(req.body);
  if (!id.success || !parsed.success) return next(new ApiError(400, 'Departure fields are invalid.', 'VALIDATION_ERROR'));
  const result = db.prepare('UPDATE tour_departures SET date=?,seats_total=? WHERE id=? AND seats_taken<=?').run(parsed.data.date, parsed.data.seats_total, id.data, parsed.data.seats_total);
  if (!result.changes) return next(new ApiError(409, 'Departure not found or seat total is below seats already reserved.'));
  res.json({ data: { updated: true } });
});
adminRouter.delete('/departures/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid departure id.'));
  const result = db.prepare('DELETE FROM tour_departures WHERE id=? AND seats_taken=0').run(id.data);
  if (!result.changes) return next(new ApiError(409, 'Departure is not empty or does not exist.'));
  res.json({ data: { deleted: true } });
});

adminRouter.post('/tours/:id/photos', imageStorage.array('photos', 10), (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success || !db.prepare('SELECT id FROM tours WHERE id=?').get(id.data)) return next(new ApiError(404, 'Tour not found.', 'NOT_FOUND'));
  if (!req.files?.length) return next(new ApiError(400, 'Select JPG, PNG, or WebP images up to 5 MB.'));
  const valid = req.files.filter(file => (file.mimetype === 'image/jpeg' && file.buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (file.mimetype === 'image/png' && file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (file.mimetype === 'image/webp' && file.buffer.toString('ascii',0,4) === 'RIFF' && file.buffer.toString('ascii',8,12) === 'WEBP'));
  if (valid.length !== req.files.length) return next(new ApiError(400, 'An uploaded file does not match its declared image type.'));
  const uploadDir = uploadsDirectory;
  fs.mkdirSync(uploadDir, { recursive: true });
  const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM tour_photos WHERE tour_id=?').get(id.data).next;
  const insert = db.prepare('INSERT INTO tour_photos (tour_id,filename,alt_en,sort_order) VALUES (?,?,?,?)');
  const photos = valid.map((file, index) => {
    const ext = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
    const filename = `${randomBytes(16).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(uploadDir, filename), file.buffer, { flag: 'wx' });
    return { id: Number(insert.run(id.data, filename, path.basename(file.originalname).slice(0, 160), nextSortOrder + index).lastInsertRowid), url: `/uploads/${filename}` };
  });
  res.status(201).json({ data: photos });
});
adminRouter.delete('/photos/:id', (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid photo id.'));
  const photo = db.prepare('SELECT filename FROM tour_photos WHERE id=?').get(id.data);
  if (!photo) return next(new ApiError(404, 'Photo not found.', 'NOT_FOUND'));
  db.prepare('DELETE FROM tour_photos WHERE id=?').run(id.data);
  fs.rmSync(path.resolve(uploadsDirectory, path.basename(photo.filename)), { force: true });
  res.json({ data: { deleted: true } });
});

const addonSchema = z.object({ id: text(2, 40).regex(/^[a-z0-9_-]+$/), name_en: text(2, 180), name_ru: text(0, 180).default(''), name_hy: text(0, 180).default(''), price_amd: integer(), price_type: z.enum(['per_person','per_booking']).default('per_booking'), active: z.coerce.boolean().default(true) });
adminRouter.get('/addons', (_req,res) => res.json({data:db.prepare('SELECT * FROM addons ORDER BY id').all()}));
adminRouter.post('/addons', (req,res,next) => { const p=addonSchema.safeParse(req.body); if(!p.success)return next(new ApiError(400,'Add-on fields are invalid.')); const d=p.data; try{db.prepare('INSERT INTO addons (id,name_en,name_ru,name_hy,price_amd,price_type,active) VALUES (?,?,?,?,?,?,?)').run(d.id,d.name_en,d.name_ru,d.name_hy,d.price_amd,d.price_type,Number(d.active));res.status(201).json({data:{id:d.id}})}catch{next(new ApiError(409,'Add-on id already exists.'))} });
adminRouter.put('/addons/:id', (req,res,next) => { const p=addonSchema.safeParse({...req.body,id:req.params.id}); if(!p.success)return next(new ApiError(400,'Add-on fields are invalid.')); const d=p.data; const r=db.prepare('UPDATE addons SET name_en=?,name_ru=?,name_hy=?,price_amd=?,price_type=?,active=? WHERE id=?').run(d.name_en,d.name_ru,d.name_hy,d.price_amd,d.price_type,Number(d.active),d.id); if(!r.changes)return next(new ApiError(404,'Add-on not found.'));res.json({data:{updated:true}}) });
adminRouter.delete('/addons/:id', (req,res,next) => { const id=z.string().trim().min(2).max(40).regex(/^[a-z0-9_-]+$/).safeParse(req.params.id);if(!id.success)return next(new ApiError(400,'Invalid add-on id.'));const r=db.prepare('DELETE FROM addons WHERE id=?').run(id.data);if(!r.changes)return next(new ApiError(404,'Add-on not found.'));res.json({data:{deleted:true}}) });

const serviceSchema = z.object({
  name_en: text(2, 180), description_en: text(2, 1500), name_ru: text(0, 180).default(''), description_ru: text(0, 1500).default(''),
  name_hy: text(0, 180).default(''), description_hy: text(0, 1500).default(''), icon: serviceIconSchema.default('map-pin'),
  active: z.coerce.boolean().default(true), sort_order: integer(0, 10000).default(0)
});
adminRouter.get('/services', (_req,res)=>res.json({data:db.prepare('SELECT * FROM services ORDER BY sort_order,id').all()}));
adminRouter.post('/services',(req,res,next)=>{const p=serviceSchema.safeParse(req.body);if(!p.success)return next(new ApiError(400,p.error.issues[0]?.message || 'Service fields are invalid.','VALIDATION_ERROR'));const d=p.data;const r=db.prepare('INSERT INTO services (name_en,description_en,name_ru,description_ru,name_hy,description_hy,icon,active,sort_order) VALUES (@name_en,@description_en,@name_ru,@description_ru,@name_hy,@description_hy,@icon,@active,@sort_order)').run({...d,active:Number(d.active)});res.status(201).json({data:{id:r.lastInsertRowid}})});
adminRouter.put('/services/:id',(req,res,next)=>{const p=serviceSchema.safeParse(req.body),id=integer(1).safeParse(req.params.id);if(!p.success||!id.success)return next(new ApiError(400,p.success ? 'Invalid service id.' : p.error.issues[0]?.message || 'Service fields are invalid.','VALIDATION_ERROR'));const d=p.data;const r=db.prepare('UPDATE services SET name_en=@name_en,description_en=@description_en,name_ru=@name_ru,description_ru=@description_ru,name_hy=@name_hy,description_hy=@description_hy,icon=@icon,active=@active,sort_order=@sort_order WHERE id=@id').run({...d,id:id.data,active:Number(d.active)});if(!r.changes)return next(new ApiError(404,'Service not found.'));res.json({data:{updated:true}})});
adminRouter.delete('/services/:id',(req,res,next)=>{const id=integer(1).safeParse(req.params.id);if(!id.success)return next(new ApiError(400,'Invalid service id.'));const r=db.prepare('DELETE FROM services WHERE id=?').run(id.data);if(!r.changes)return next(new ApiError(404,'Service not found.'));res.json({data:{deleted:true}})});

adminRouter.get('/reviews', (_req,res)=>res.json({data:db.prepare('SELECT r.*,t.name_en AS tour_name FROM reviews r LEFT JOIN tours t ON t.id=r.tour_id ORDER BY r.approved,r.id DESC').all()}));
adminRouter.patch('/reviews/:id', (req,res,next)=>{const id=integer(1).safeParse(req.params.id),approved=z.coerce.boolean().safeParse(req.body.approved);if(!id.success||!approved.success)return next(new ApiError(400,'Review update is invalid.'));const r=db.prepare('UPDATE reviews SET approved=? WHERE id=?').run(Number(approved.data),id.data);if(!r.changes)return next(new ApiError(404,'Review not found.'));res.json({data:{updated:true}})});
adminRouter.delete('/reviews/:id',(req,res,next)=>{const id=integer(1).safeParse(req.params.id);if(!id.success)return next(new ApiError(400,'Invalid review id.'));const r=db.prepare('DELETE FROM reviews WHERE id=?').run(id.data);if(!r.changes)return next(new ApiError(404,'Review not found.'));res.json({data:{deleted:true}})});

adminRouter.get('/bookings', (req,res,next)=>{
  const query=z.object({q:z.string().max(120).optional(),status:z.enum(['pending','confirmed','paid','cancelled','completed']).optional(),tour:z.coerce.number().int().positive().optional(),date:z.string().date().optional()}).safeParse(req.query);
  if(!query.success)return next(new ApiError(400,'Invalid booking filters.'));
  const where=[],params=[];
  if(query.data.q){where.push('(b.reference LIKE ? OR b.customer_name LIKE ? OR b.email LIKE ?)');params.push(...Array(3).fill(`%${query.data.q}%`))}
  if(query.data.status){where.push('b.status=?');params.push(query.data.status)}
  if(query.data.tour){where.push('EXISTS (SELECT 1 FROM booking_items bi WHERE bi.booking_id=b.id AND bi.tour_id=?)');params.push(query.data.tour)}
  if(query.data.date){where.push('(EXISTS (SELECT 1 FROM booking_items bi JOIN tour_departures d ON d.id=bi.departure_id WHERE bi.booking_id=b.id AND d.date=?) OR EXISTS (SELECT 1 FROM booking_transfers bt WHERE bt.booking_id=b.id AND substr(bt.travel_at,1,10)=?))');params.push(query.data.date,query.data.date)}
  const sql=`SELECT b.*,
    (SELECT json_group_array(json_object('kind','tour','tour_id',t.id,'tour_name',COALESCE(NULLIF(i.tour_name,''),t.name_en),'date',d.date,'guests',i.guests,'addon_ids',i.addon_ids)) FROM booking_items i JOIN tours t ON t.id=i.tour_id JOIN tour_departures d ON d.id=i.departure_id WHERE i.booking_id=b.id) tour_items,
    (SELECT json_group_array(json_object('kind','transfer','route_name',bt.route_name,'date',bt.travel_at,'guests',bt.passengers,'vehicle',bt.vehicle,'flight_number',bt.flight_number,'pickup_address',bt.pickup_address)) FROM booking_transfers bt WHERE bt.booking_id=b.id) transfer_items
    FROM bookings b ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY b.id DESC LIMIT 500`;
  res.json({data:db.prepare(sql).all(...params).map(row=>({...row,items:[...JSON.parse(row.tour_items||'[]'),...JSON.parse(row.transfer_items||'[]')]}))});
});
adminRouter.get('/bookings/export.csv', (_req,res)=>{const rows=db.prepare('SELECT reference,customer_name,email,phone,total_amd,currency,status,payment_status,created_at FROM bookings ORDER BY id DESC').all();const escape=value=>`"${String(value??'').replaceAll('"','""')}"`;res.type('text/csv').attachment('hayq-bookings.csv').send(['reference,customer_name,email,phone,total_amd,currency,status,payment_status,created_at',...rows.map(row=>Object.values(row).map(escape).join(','))].join('\r\n'))});
const bookingUpdateSchema=z.object({status:z.enum(['pending','confirmed','paid','cancelled','completed']).optional(),internal_notes:z.string().max(4000).optional()}).refine(value=>value.status!==undefined||value.internal_notes!==undefined);
adminRouter.patch('/bookings/:id',(req,res,next)=>{const id=integer(1).safeParse(req.params.id),parsed=bookingUpdateSchema.safeParse(req.body);if(!id.success||!parsed.success)return next(new ApiError(400,'Booking update is invalid.'));try{const update=db.transaction(()=>{const booking=db.prepare('SELECT id,status FROM bookings WHERE id=?').get(id.data);if(!booking)throw new ApiError(404,'Booking not found.','NOT_FOUND');const nextStatus=parsed.data.status||booking.status;if(booking.status!=='cancelled'&&nextStatus==='cancelled'){db.prepare('UPDATE tour_departures SET seats_taken=MAX(0,seats_taken-(SELECT guests FROM booking_items WHERE booking_items.departure_id=tour_departures.id AND booking_items.booking_id=?)) WHERE id IN (SELECT departure_id FROM booking_items WHERE booking_id=?)').run(id.data,id.data)}else if(booking.status==='cancelled'&&nextStatus!=='cancelled'){const items=db.prepare('SELECT departure_id,guests FROM booking_items WHERE booking_id=?').all(id.data);for(const item of items){if(!db.prepare('UPDATE tour_departures SET seats_taken=seats_taken+? WHERE id=? AND seats_taken+?<=seats_total').run(item.guests,item.departure_id,item.guests).changes)throw new ApiError(409,'Cannot restore booking because its departure is full.')}}db.prepare("UPDATE bookings SET status=?,internal_notes=COALESCE(?,internal_notes),payment_status=CASE WHEN ?='paid' THEN 'paid' ELSE payment_status END WHERE id=?").run(nextStatus,parsed.data.internal_notes??null,nextStatus,id.data)});update();res.json({data:{updated:true}})}catch(error){next(error)}});
adminRouter.post('/settings/logo', imageStorage.single('photos'), (req, res, next) => {
  const file = req.file;
  if (!file) return next(new ApiError(400, 'Select a JPG, PNG, or WebP logo up to 5 MB.'));
  const valid = (file.mimetype === 'image/jpeg' && file.buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (file.mimetype === 'image/png' && file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (file.mimetype === 'image/webp' && file.buffer.toString('ascii',0,4) === 'RIFF' && file.buffer.toString('ascii',8,12) === 'WEBP');
  if (!valid) return next(new ApiError(400, 'Logo file is not a valid image.'));
  const uploadDir = uploadsDirectory;
  fs.mkdirSync(uploadDir, { recursive: true });
  const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
  const filename = `${randomBytes(16).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer, { flag: 'wx' });
  const oldUrl = db.prepare("SELECT value FROM settings WHERE key='logo_url'").get()?.value;
  db.prepare("INSERT INTO settings (key,value) VALUES ('logo_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`/uploads/${filename}`);
  if (oldUrl?.startsWith('/uploads/')) fs.rmSync(path.resolve(uploadDir, path.basename(oldUrl)), { force: true });
  res.status(201).json({ data: { url: `/uploads/${filename}` } });
});
adminRouter.post('/settings/tours-background', imageStorage.single('photos'), (req, res, next) => {
  const file = req.file;
  if (!file) return next(new ApiError(400, 'Select a JPG, PNG, or WebP image up to 5 MB.'));
  const valid = (file.mimetype === 'image/jpeg' && file.buffer.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff]))) || (file.mimetype === 'image/png' && file.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (file.mimetype === 'image/webp' && file.buffer.toString('ascii',0,4) === 'RIFF' && file.buffer.toString('ascii',8,12) === 'WEBP');
  if (!valid) return next(new ApiError(400, 'Tours background file is not a valid image.'));
  const uploadDir = uploadsDirectory;
  fs.mkdirSync(uploadDir, { recursive: true });
  const extension = file.mimetype === 'image/jpeg' ? '.jpg' : file.mimetype === 'image/png' ? '.png' : '.webp';
  const filename = `${randomBytes(16).toString('hex')}${extension}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer, { flag: 'wx' });
  const oldUrl = db.prepare("SELECT value FROM settings WHERE key='tours_background_url'").get()?.value;
  db.prepare("INSERT INTO settings (key,value) VALUES ('tours_background_url',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`/uploads/${filename}`);
  if (oldUrl?.startsWith('/uploads/')) fs.rmSync(path.resolve(uploadDir, path.basename(oldUrl)), { force: true });
  res.status(201).json({ data: { url: `/uploads/${filename}` } });
});
adminRouter.delete('/settings/tours-background', (_req, res) => {
  const uploadDir = uploadsDirectory;
  const oldUrl = db.prepare("SELECT value FROM settings WHERE key='tours_background_url'").get()?.value;
  db.prepare("INSERT INTO settings (key,value) VALUES ('tours_background_url','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  if (oldUrl?.startsWith('/uploads/')) fs.rmSync(path.resolve(uploadDir, path.basename(oldUrl)), { force: true });
  res.json({ data: { deleted: true } });
});
adminRouter.post('/bookings/:id/resend', async (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  if (!id.success) return next(new ApiError(400, 'Invalid booking id.'));
  const booking = db.prepare('SELECT * FROM bookings WHERE id=?').get(id.data);
  if (!booking) return next(new ApiError(404, 'Booking not found.'));
  try {
    const result = await sendEmail({
      to: booking.email,
      subject: `Hayq booking ${booking.reference}`,
      html: `<h1>Hayq Tours</h1><p>Your booking reference is ${booking.reference}.</p><p>Total: ${booking.total_amd.toLocaleString('en-US')} AMD</p>`,
      text: `Your booking reference is ${booking.reference}.`
    });
    res.json({ data: result });
  } catch (error) { next(error); }
});

adminRouter.get('/requests',(_req,res)=>res.json({data:db.prepare('SELECT * FROM custom_requests ORDER BY id DESC').all()}));
adminRouter.patch('/requests/:id',(req,res,next)=>{const id=integer(1).safeParse(req.params.id),status=text(2,40).safeParse(req.body.status);if(!id.success||!status.success)return next(new ApiError(400,'Request status is invalid.'));const r=db.prepare('UPDATE custom_requests SET status=? WHERE id=?').run(status.data,id.data);if(!r.changes)return next(new ApiError(404,'Request not found.'));res.json({data:{updated:true}})});
adminRouter.delete('/requests/:id',(req,res,next)=>{const id=integer(1).safeParse(req.params.id);if(!id.success)return next(new ApiError(400,'Invalid request id.'));const r=db.prepare('DELETE FROM custom_requests WHERE id=?').run(id.data);if(!r.changes)return next(new ApiError(404,'Request not found.'));res.json({data:{deleted:true}})});
adminRouter.post('/requests/:id/reply', async (req, res, next) => {
  const id = integer(1).safeParse(req.params.id);
  const parsed = z.object({ subject: text(2, 180), message: text(2, 4000) }).safeParse(req.body);
  if (!id.success || !parsed.success) return next(new ApiError(400, 'Reply fields are invalid.'));
  const request = db.prepare('SELECT * FROM custom_requests WHERE id=?').get(id.data);
  if (!request) return next(new ApiError(404, 'Request not found.'));
  const escapeHtml = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  try {
    const result = await sendEmail({
      to: request.email,
      subject: parsed.data.subject,
      html: `<main style="font-family:Arial,sans-serif"><h1>Hayq Tours</h1><p>${escapeHtml(parsed.data.message)}</p></main>`,
      text: parsed.data.message
    });
    res.json({ data: result });
  } catch (error) { next(error); }
});

adminRouter.get('/settings',(_req,res)=>res.json({data:Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(row=>[row.key,row.value]))}));
adminRouter.put('/settings',(req,res,next)=>{
  const parsed=z.record(z.string().min(1).max(80),z.string().max(12000)).safeParse(req.body);
  if(!parsed.success)return next(new ApiError(400,'Settings must be string values.'));
  const fields=parsed.data;
  const routeSchema=z.array(z.object({
    id:text(2,80),airport:text(2,120),airport_ru:text(0,120),airport_hy:text(0,120),
    from:text(2,120),from_ru:text(0,120),from_hy:text(0,120),to:text(2,120),to_ru:text(0,120),to_hy:text(0,120),
    distance:text(1,40),duration:text(1,40),sedan_amd:integer(),minivan_amd:integer()
  })).length(4);
  const extraSchema=z.array(z.object({id:text(2,40).regex(/^[a-z0-9_-]+$/),name_en:text(2,120),name_ru:text(0,120),name_hy:text(0,120),price_amd:integer()})).max(10);
  const landingSchema=z.record(z.string().min(1).max(80),z.string().min(1).max(1200));
  for (const [key,schema] of [
    ['transfer_routes',routeSchema],['transfer_extras',extraSchema],
    ['landing_copy_en',landingSchema],['landing_copy_ru',landingSchema],['landing_copy_hy',landingSchema]
  ]) {
    if (!(key in fields)) continue;
    let value;
    try { value=JSON.parse(fields[key]); }
    catch { return next(new ApiError(400,`${key} must contain valid JSON.`,'VALIDATION_ERROR')); }
    if (!schema.safeParse(value).success) return next(new ApiError(400,`${key} has invalid fields.`,'VALIDATION_ERROR'));
  }
  const put=db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const save=db.transaction(entries=>entries.forEach(([key,value])=>put.run(key,value)));
  save(Object.entries(fields));
  res.json({data:{updated:true}});
});

adminRouter.get('/users',requireOwner,(_req,res)=>res.json({data:db.prepare('SELECT id,email,role,created_at FROM admin_users ORDER BY id').all()}));
adminRouter.post('/me/password', (req,res,next)=>{
  const parsed=z.object({current_password:z.string().min(1).max(200),new_password:z.string().min(12).max(200)}).safeParse(req.body);
  if(!parsed.success)return next(new ApiError(400,'New password must contain at least 12 characters.','VALIDATION_ERROR'));
  const user=db.prepare('SELECT password_hash FROM admin_users WHERE id=?').get(req.admin.id);
  if(!user)return next(new ApiError(401,'Session expired. Sign in again.','AUTH_REQUIRED'));
  if(!bcrypt.compareSync(parsed.data.current_password,user.password_hash))return next(new ApiError(401,'Current password is incorrect.','INVALID_CREDENTIALS'));
  db.prepare('UPDATE admin_users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(parsed.data.new_password,12),req.admin.id);
  res.json({data:{updated:true}});
});
adminRouter.post('/users',requireOwner,(req,res,next)=>{const parsed=z.object({email:z.string().trim().email().max(254),password:z.string().min(12).max(200),role:z.enum(['owner','staff']).default('staff')}).safeParse(req.body);if(!parsed.success)return next(new ApiError(400,'Provide a valid email, a password of at least 12 characters, and a role.'));try{const result=db.prepare('INSERT INTO admin_users (email,password_hash,role) VALUES (?,?,?)').run(parsed.data.email.toLowerCase(),bcrypt.hashSync(parsed.data.password,12),parsed.data.role);res.status(201).json({data:{id:result.lastInsertRowid}})}catch{next(new ApiError(409,'An admin with that email already exists.'))}});
adminRouter.delete('/users/:id',requireOwner,(req,res,next)=>{const id=integer(1).safeParse(req.params.id);if(!id.success)return next(new ApiError(400,'Invalid user id.'));if(id.data===req.admin.id)return next(new ApiError(400,'You cannot remove your own account.'));const result=db.prepare('DELETE FROM admin_users WHERE id=?').run(id.data);if(!result.changes)return next(new ApiError(404,'User not found.'));res.json({data:{deleted:true}})});