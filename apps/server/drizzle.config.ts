import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/database/auth-schema.ts', './src/database/schema.ts'],
  out: './migrations',
  strict: true,
  verbose: false,
});
