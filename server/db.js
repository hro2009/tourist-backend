import 'dotenv/config';
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configuredPath = process.env.DATABASE_PATH || './data/hayq.sqlite';
const dbPath = path.resolve(root, configuredPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
  CREATE TABLE IF NOT EXISTS tours (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL,
    duration TEXT NOT NULL,
    price_amd INTEGER NOT NULL CHECK(price_amd >= 0),
    difficulty TEXT NOT NULL DEFAULT 'easy',
    max_group INTEGER NOT NULL DEFAULT 8 CHECK(max_group > 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    name_en TEXT NOT NULL, description_en TEXT NOT NULL, highlights_en TEXT NOT NULL DEFAULT '[]',
    name_ru TEXT NOT NULL DEFAULT '', description_ru TEXT NOT NULL DEFAULT '', highlights_ru TEXT NOT NULL DEFAULT '[]',
    name_hy TEXT NOT NULL DEFAULT '', description_hy TEXT NOT NULL DEFAULT '', highlights_hy TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS tour_photos (
    id INTEGER PRIMARY KEY, tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, alt_en TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tour_departures (
    id INTEGER PRIMARY KEY, tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    date TEXT NOT NULL, seats_total INTEGER NOT NULL CHECK(seats_total > 0), seats_taken INTEGER NOT NULL DEFAULT 0 CHECK(seats_taken >= 0),
    UNIQUE(tour_id, date), CHECK(seats_taken <= seats_total)
  );
  CREATE TABLE IF NOT EXISTS addons (
    id TEXT PRIMARY KEY, name_en TEXT NOT NULL, name_ru TEXT NOT NULL DEFAULT '', name_hy TEXT NOT NULL DEFAULT '',
    price_amd INTEGER NOT NULL CHECK(price_amd >= 0), price_type TEXT NOT NULL DEFAULT 'per_booking' CHECK(price_type IN ('per_person','per_booking')),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY, name_en TEXT NOT NULL, description_en TEXT NOT NULL,
    name_ru TEXT NOT NULL DEFAULT '', description_ru TEXT NOT NULL DEFAULT '', name_hy TEXT NOT NULL DEFAULT '', description_hy TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY, reference TEXT NOT NULL UNIQUE, customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '', total_amd INTEGER NOT NULL CHECK(total_amd >= 0), currency TEXT NOT NULL DEFAULT 'AMD',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','paid','cancelled','completed')),
    payment_status TEXT NOT NULL DEFAULT 'unpaid', internal_notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS booking_items (
    id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    tour_id INTEGER NOT NULL REFERENCES tours(id), departure_id INTEGER NOT NULL REFERENCES tour_departures(id),
    guests INTEGER NOT NULL CHECK(guests > 0), unit_price_amd INTEGER NOT NULL, addon_ids TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS booking_transfers (
    id INTEGER PRIMARY KEY,
    booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    route_id TEXT NOT NULL,
    route_name TEXT NOT NULL,
    travel_at TEXT NOT NULL,
    vehicle TEXT NOT NULL CHECK(vehicle IN ('sedan','minivan')),
    passengers INTEGER NOT NULL CHECK(passengers BETWEEN 1 AND 7),
    flight_number TEXT NOT NULL DEFAULT '',
    pickup_address TEXT NOT NULL DEFAULT '',
    extras TEXT NOT NULL DEFAULT '[]',
    unit_price_amd INTEGER NOT NULL CHECK(unit_price_amd >= 0),
    total_amd INTEGER NOT NULL CHECK(total_amd >= 0)
  );
  CREATE TABLE IF NOT EXISTS custom_requests (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY, tour_id INTEGER REFERENCES tours(id) ON DELETE SET NULL, name TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), text TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner','staff')), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const tourColumns = new Set(db.pragma('table_info(tours)').map(column => column.name));
if (!tourColumns.has('card_image_url')) {
  db.exec("ALTER TABLE tours ADD COLUMN card_image_url TEXT NOT NULL DEFAULT ''");
}

const addonColumns = new Set(db.pragma('table_info(addons)').map(column => column.name));
if (!addonColumns.has('price_type')) {
  db.exec("ALTER TABLE addons ADD COLUMN price_type TEXT NOT NULL DEFAULT 'per_booking' CHECK(price_type IN ('per_person','per_booking'))");
  db.prepare("UPDATE addons SET price_type='per_person' WHERE id='lun'").run();
}

const bookingItemColumns = new Set(db.pragma('table_info(booking_items)').map(column => column.name));
if (!bookingItemColumns.has('tour_name')) {
  db.exec("ALTER TABLE booking_items ADD COLUMN tour_name TEXT NOT NULL DEFAULT ''");
}

export function getSetting(key, fallback = '') {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}