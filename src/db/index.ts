import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const url = process.env.DATABASE_URL!;
const isLocalhost = url.includes('localhost') || url.includes('127.0.0.1');

const client = postgres(url, {
  idle_timeout: 20,
  max: 5,
  ssl: isLocalhost ? false : 'require',
});

export const db = drizzle(client, { schema });
