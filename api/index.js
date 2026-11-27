import { createClient } from '@libsql/client/web';
import { createApp } from '../server/app.js';
import { schema } from '../server/schema.js';

let application;

async function initialize() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) throw new Error('Turso database credentials are missing');
  const client = createClient({ url, authToken });
  await client.executeMultiple(schema);
  return createApp(client, { production: true, origin: process.env.APP_ORIGIN || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` });
}

export default async function handler(req, res) {
  try {
    application ??= initialize().catch(error => { application = undefined; throw error; });
    const app = await application;
    return app(req, res);
  } catch {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Database unavailable' }));
  }
}
