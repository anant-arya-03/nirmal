import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '../server/db.js';
import { queryStore } from '../server/store.js';
import { schema } from '../server/schema.js';
import { emailInput, text, hashPassword, digest, secret } from '../server/security.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const [action, rawEmail, rawName] = process.argv.slice(2);
if (!['create','reset'].includes(action) || !rawEmail) throw new Error('Usage: npm run admin -- create email "Full name" OR npm run admin -- reset email');
const email = emailInput(rawEmail);
const remote = process.env.TURSO_DATABASE_URL;
if (remote && !process.env.TURSO_AUTH_TOKEN) throw new Error('Set TURSO_AUTH_TOKEN for hosted administration.');
const db = remote
  ? (await import('@libsql/client/web')).createClient({ url: remote, authToken: process.env.TURSO_AUTH_TOKEN })
  : openDatabase();
const { one, run, transaction } = queryStore(db);
try {
  if (remote) await db.executeMultiple(schema);
  if(action === 'create') {
    const name = text(rawName, 'Name', 2, 100), password = await hashPassword(process.env.NIRMAL_ADMIN_PASSWORD);
    await run("INSERT INTO accounts(id,name,email,password,role,created_at) VALUES (?,?,?,?,'admin',?)", randomUUID(),name,email,password,new Date().toISOString());
    console.log(`Administrator created: ${email}`);
  } else {
    const account = await one('SELECT id FROM accounts WHERE email=? AND active=1', email);
    if(!account)throw new Error('Active account not found.');
    const token=secret();
    await transaction(async () => {
      await run('DELETE FROM resets WHERE account_id=?', account.id);
      await run('INSERT INTO resets VALUES (?,?,?)', digest(token), account.id, Date.now()+1800000);
    });
    console.log('Deliver this one-time link privately after verifying the account owner. Expires in 30 minutes:');
    console.log(`${process.env.APP_ORIGIN||'http://localhost:4173'}/#reset/${token}`);
  }
} finally {db.close();}
