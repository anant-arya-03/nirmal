import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDatabase, transaction } from '../server/db.js';
import { emailInput, text, hashPassword, digest, secret } from '../server/security.js';
if (existsSync('.env')) process.loadEnvFile('.env');
const [action, rawEmail, rawName] = process.argv.slice(2);
if (!['create','reset'].includes(action) || !rawEmail) throw new Error('Usage: npm run admin -- create email "Full name" OR npm run admin -- reset email');
const email = emailInput(rawEmail), db = openDatabase();
try {
  if(action === 'create') {
    const name = text(rawName, 'Name', 2, 100), password = await hashPassword(process.env.NIRMAL_ADMIN_PASSWORD);
    db.prepare("INSERT INTO accounts(id,name,email,password,role,created_at) VALUES (?,?,?,?,'admin',?)").run(randomUUID(),name,email,password,new Date().toISOString());
    console.log(`Administrator created: ${email}`);
  } else {
    const account = db.prepare('SELECT id FROM accounts WHERE email=? AND active=1').get(email);
    if(!account)throw new Error('Active account not found.');
    const token=secret();
    transaction(db,()=>{db.prepare('DELETE FROM resets WHERE account_id=?').run(account.id);db.prepare('INSERT INTO resets VALUES (?,?,?)').run(digest(token),account.id,Date.now()+1800000);});
    console.log('Deliver this one-time link privately after verifying the account owner. Expires in 30 minutes:');
    console.log(`${process.env.APP_ORIGIN||'http://localhost:4173'}/#reset/${token}`);
  }
} finally {db.close();}
