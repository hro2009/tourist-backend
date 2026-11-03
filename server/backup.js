import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backupDir = path.join(root, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const filename = `hayq-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}.sqlite`;
await db.backup(path.join(backupDir, filename));
console.log(`Database backup created: backups/${filename}`);