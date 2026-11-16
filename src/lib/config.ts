import path from 'path'
import fs from 'fs'

// Unset = same-origin only. The app and its socket endpoint always share one
// origin (custom server.ts), so cross-origin access is never needed by default.
const corsEnv = process.env.CORS_ORIGIN?.trim() ?? ''

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  uploadDir: path.resolve(process.env.UPLOAD_DIR || './data/uploads'),
  corsOrigin: corsEnv === '' ? false : corsEnv,
}

// Make sure the upload dir exists (server + route handlers both use it).
fs.mkdirSync(config.uploadDir, { recursive: true })
