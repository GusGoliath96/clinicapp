import path from 'node:path';
import { fileURLToPath } from 'node:url';

// backend/src/config/paths.js → uploads fica em backend/uploads
export const uploadsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'uploads');
