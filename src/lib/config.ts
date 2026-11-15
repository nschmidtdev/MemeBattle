import path from 'path'
import fs from 'fs'

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './data/uploads'),
  corsOrigin: process.env.CORS_ORIGIN || '*',
}

// Make sure the upload dir exists (server + route handlers both use it).
fs.mkdirSync(config.uploadDir, { recursive: true })
