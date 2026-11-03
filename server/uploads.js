import path from 'node:path';

export const uploadsDirectory = path.resolve(process.env.UPLOADS_DIR || './uploads');
