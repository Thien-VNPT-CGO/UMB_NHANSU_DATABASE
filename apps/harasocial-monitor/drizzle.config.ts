import type { Config } from 'drizzle-kit';

export default {
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/harasocial',
  },
  verbose: true,
  strict: true,
} satisfies Config;
