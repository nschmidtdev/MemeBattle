import './src/lib/env'
import { defineConfig } from 'prisma/config'

// Prisma 7 removes the `package.json#prisma` section; keep the seed command in
// the modern config file. The datasource URL stays in prisma/schema.prisma, so
// `prisma generate` also works during Docker builds without a database.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
})
