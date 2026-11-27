import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { sanitizePhoto } from './images.js';
import nodemailer from 'nodemailer';
import { randomUUID, randomBytes } from 'node:crypto';
import { queryStore } from './store.js';
import { secret, digest, fail, text, emailInput, profileInput, hashPassword, verifyPassword, requireVersion, publicAccount } from './security.js';

export const complaintStages = ['Submitted', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed'];
export const laundryStages = ['Scheduled', 'Collected', 'Washing', 'Drying', 'Quality Check', 'Ready', 'Delivered'];
export const categories = ['Missing clothes', 'Damaged clothes', 'Delayed delivery', 'Incorrect bag', 'Washing quality', 'Other laundry issue'];
const now = () => new Date().toISOString();
const after = hours => new Date(Date.now() + hours * 3600000).toISOString();
const id = () => randomUUID();

export function createApp(db, { origin = process.env.APP_ORIGIN || 'http://localhost:4173', production = process.env.NODE_ENV === 'production', mailer } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'], 'script-src': ["'self'"], 'upgrade-insecure-requests': production ? [] : null } }, strictTransportSecurity: production ? undefined : false }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Cookies are SameSite=Strict. Reject cross-origin and cross-site writes as a second CSRF boundary.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ error: 'Request origin is not allowed.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site writes are not allowed.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json.' });
    }
    next();
  });
  app.use('/api', express.json({ limit: '3mb' }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 240, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many requests. Try again shortly.' } }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60000, limit: 35, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' } }));
  const { one, all, run, transaction } = queryStore(db);
  const setting = async key => (await one('SELECT value FROM settings WHERE key=?', key)).value;
  const cookie = { httpOnly: true, sameSite: 'strict', secure: production, path: '/' };
  const newSession = async (res, accountId) => {
    await run('DELETE FROM sessions WHERE expires < ?', Date.now());
    const token = secret();
    await run('INSERT INTO sessions VALUES (?,?,?)', digest(token), accountId, Date.now() + 8 * 3600000);
    res.cookie('nirmal_session', token, { ...cookie, maxAge: 8 * 3600000 });
  };
  const notify = (accountId, title, body, target) => run('INSERT INTO notifications VALUES (?,?,?,?,?,0,?)', id(), accountId, title, body, target, now());
  const admins = async (title, body, target) => {
    const recipients = await all("SELECT id FROM accounts WHERE role='admin' AND active=1");
    for (const account of recipients) await notify(account.id, title, body, target);
  };
  const worker = async workerId => {
    if (!workerId || !await one('SELECT id FROM workers WHERE id=? AND active=1', workerId)) throw fail('Choose an active worker.');
    return workerId;
  };
  const ownedBag = async (account, bagId) => {
    const bag = await one('SELECT b.*,a.name owner_name FROM bags b JOIN accounts a ON a.id=b.owner_id WHERE b.id=?', bagId || '');
    if (!bag || (account.role !== 'admin' && bag.owner_id !== account.id)) throw fail('Bag not found.', 404);
    return bag;
  };
  const complaint = async (account, complaintId) => {
    const result = await one(`SELECT c.*, b.label bag_label,a.name student_name,a.enrollment,a.email,a.phone,a.hostel,a.room,w.name worker_name
      FROM complaints c JOIN bags b ON b.id=c.bag_id JOIN accounts a ON a.id=c.student_id LEFT JOIN workers w ON w.id=c.worker_id WHERE c.id=?`, complaintId);
    if (!result || (account.role !== 'admin' && result.student_id !== account.id)) throw fail('Complaint not found.', 404);
    return result;
  };
  const safeComplaint = ({ photo, photo_mime, ...c }) => ({ ...c, has_photo: !!photo });

  app.get('/api/health', async (req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', async (req, res) => {
    const body = req.body || {}, p = profileInput(body), email = emailInput(body.email);
    const domain = process.env.UNIVERSITY_EMAIL_DOMAIN?.trim().toLowerCase();
    if (domain && email.split('@')[1] !== domain) throw fail(`Use your @${domain} university email.`);
    const password = await hashPassword(body.password);
    const accountId = id();
    try { await run("INSERT INTO accounts VALUES (?,?,?,?,'student',?,?,?,?,1,?)", accountId, p.name, email, password, p.enrollment, p.phone, p.hostel, p.room, now()); }
    catch (e) { if (e.errcode === 2067 || e.code === 'SQLITE_CONSTRAINT_UNIQUE') throw fail('An account with that email or enrollment already exists.', 409); throw e; }
    await newSession(res, accountId);
    res.status(201).json(publicAccount(await one('SELECT * FROM accounts WHERE id=?', accountId)));
  });
  const dummyPassword = hashPassword(secret());
  app.post('/api/auth/login', async (req, res) => {
    const email = emailInput(req.body?.email);
    const account = await one('SELECT * FROM accounts WHERE email=?', email);
    const valid = await verifyPassword(req.body?.password, account?.password || await dummyPassword);
    if (!account?.active || !valid) throw fail('Email or password is incorrect.', 401);
    await newSession(res, account.id);
    res.json(publicAccount(account));
  });
  app.post('/api/auth/forgot', async (req, res) => {
    const email = emailInput(req.body?.email);
    // A configured mail transport is required; never expose reset tokens in HTTP responses.
    if (!mailer && !process.env.SMTP_HOST) throw fail('Email delivery is not configured. Contact your campus administrator for a password reset link.', 503);
    const account = await one('SELECT id FROM accounts WHERE email=? AND active=1', email);
    if (account) {
      const token = secret();
      await transaction(async () => { await run('DELETE FROM resets WHERE account_id=? OR expires<?', account.id, Date.now()); await run('INSERT INTO resets VALUES (?,?,?)', digest(token), account.id, Date.now() + 1800000); });
      const transport = mailer || nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      try { await transport.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Reset your Nirmal password', text: `Your one-time reset link expires in 30 minutes: ${origin}/#reset/${token}\nIf you did not request this, ignore this email.` }); }
      catch { await run('DELETE FROM resets WHERE token=?', digest(token)); console.error('Password reset email delivery failed. Check SMTP configuration.'); }
    }
    res.json({ message: 'If an active account exists, a reset link will be sent to its email address.' });
  });
  app.post('/api/auth/reset', async (req, res) => {
    const token = text(req.body?.token, 'Reset token', 64, 64);
    const password = await hashPassword(req.body?.password);
    await transaction(async () => {
      const reset = await one('SELECT * FROM resets WHERE token=? AND expires>?', digest(token), Date.now());
      if (!reset) throw fail('This reset link is invalid or expired.');
      await run('UPDATE accounts SET password=? WHERE id=?', password, reset.account_id);
      await run('DELETE FROM resets WHERE account_id=?', reset.account_id);
      await run('DELETE FROM sessions WHERE account_id=?', reset.account_id);
    });
    res.clearCookie('nirmal_session', cookie).json({ ok: true });
  });
  app.use('/api', async (req, res, next) => {
    const token = /(?:^|;\s*)nirmal_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const account = token && await one('SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token=? AND s.expires>? AND a.active=1', digest(token), Date.now());
    if (!account) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.account = publicAccount(account); req.sessionToken = digest(token); next();
  });
  const admin = (req, res, next) => req.account.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required.' });
  const student = (req, res, next) => req.account.role === 'student' ? next() : res.status(403).json({ error: 'Student access required.' });
  app.get('/api/me', async (req, res) => res.json(req.account));
  app.post('/api/logout', async (req, res) => { await run('DELETE FROM sessions WHERE token=?', req.sessionToken); res.clearCookie('nirmal_session', cookie).json({ ok: true }); });
  app.patch('/api/profile', async (req, res) => {
    const name = text(req.body.name, 'Name', 2, 100);
    const p = req.account.role === 'student' ? profileInput({ ...req.body, enrollment: req.account.enrollment }) : { phone: text(req.body.phone || '', 'Phone', 0, 20), hostel: '', room: '' };
    await run('UPDATE accounts SET name=?,phone=?,hostel=?,room=? WHERE id=?', name, p.phone, p.hostel, p.room, req.account.id);
    res.json(publicAccount(await one('SELECT * FROM accounts WHERE id=?', req.account.id)));
  });
  app.post('/api/password', async (req, res) => {
    const account = await one('SELECT * FROM accounts WHERE id=?', req.account.id);
    if (!await verifyPassword(req.body.current, account.password)) throw fail('Current password is incorrect.', 403);
    const password = await hashPassword(req.body.password);
    await transaction(async () => {
      if ((await one('SELECT password FROM accounts WHERE id=?',account.id)).password !== account.password) throw fail('Password changed during this request. Sign in again.',409);
      await run('UPDATE accounts SET password=? WHERE id=?', password, account.id); await run('DELETE FROM sessions WHERE account_id=?', account.id);
    });
    await newSession(res, account.id); res.json({ ok: true });
  });
  app.get('/api/settings', async (req, res) => res.json(Object.fromEntries((await all('SELECT * FROM settings')).map(s => [s.key, s.value]))));
  app.patch('/api/settings', admin, async (req, res) => {
    const name = text(req.body.campus_name, 'Campus name', 2, 80);
    const hours = ['resolution_hours', 'delivery_hours'].map(k => { const n = Number(req.body[k]); if (!Number.isInteger(n) || n < 1 || n > 336) throw fail('Targets must be between 1 and 336 hours.'); return String(n); });
    await transaction(async () => { for (const [key, value] of [['campus_name', name], ['resolution_hours', hours[0]], ['delivery_hours', hours[1]]]) {
      await run('UPDATE settings SET value=? WHERE key=?', value, key);
    } });
    res.json({ ok: true });
  });
  app.get('/api/bags', async (req, res) => {
    const rows = await all(`SELECT b.*,a.name owner_name,a.hostel,a.room FROM bags b JOIN accounts a ON a.id=b.owner_id ${req.account.role === 'student' ? 'WHERE b.owner_id=?' : ''} ORDER BY b.created_at DESC`, ...(req.account.role === 'student' ? [req.account.id] : []));
    const bags = await Promise.all(rows.map(async bag => {
      const cycles = await all('SELECT c.*,w.name worker_name FROM cycles c LEFT JOIN workers w ON w.id=c.worker_id WHERE c.bag_id=? ORDER BY c.created_at DESC', bag.id);
      return { ...bag, cycles: await Promise.all(cycles.map(async cycle => ({
        ...cycle,
        events: await all('SELECT e.*,a.name actor_name,w.name worker_name FROM cycle_events e JOIN accounts a ON a.id=e.actor_id LEFT JOIN workers w ON w.id=e.worker_id WHERE cycle_id=? ORDER BY e.id', cycle.id)
      }))) };
    }));
    res.json(bags);
  });
  app.post('/api/bags', admin, async (req, res) => {
    const owner = await one("SELECT id FROM accounts WHERE id=? AND role='student' AND active=1", req.body.owner_id || '');
    if (!owner) throw fail('Choose an active student.');
    const bagId = id(), label = `NM-${randomBytes(4).toString('hex').toUpperCase()}`;
    await transaction(async () => { await run('INSERT INTO bags VALUES (?,?,?,?)', bagId, label, owner.id, now()); await notify(owner.id, 'Your bag is assigned', `${label} is ready for your next collection.`, 'laundry'); });
    res.status(201).json({ id: bagId, label });
  });
  app.post('/api/cycles', student, async (req, res) => {
    const bag = await ownedBag(req.account, req.body.bag_id);
    const count = Number(req.body.garments);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw fail('Enter between 1 and 50 garments.');
    const cycleId = id();
    await transaction(async () => {
      if (await one("SELECT id FROM cycles WHERE bag_id=? AND status<>'Delivered'", bag.id)) throw fail('This bag already has an active collection.', 409);
      await run("INSERT INTO cycles (id,bag_id,status,garments,created_at,due_at) VALUES (?,?,'Scheduled',?,?,?)", cycleId, bag.id, count, now(), after(Number(await setting('delivery_hours'))));
      await run('INSERT INTO cycle_events(cycle_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', cycleId, 'Scheduled', `${count} garments registered for collection.`, req.account.id, now());
      await admins('Collection requested', `${bag.label} · ${count} garments`, 'laundry');
    });
    res.status(201).json({ id: cycleId });
  });
  app.patch('/api/cycles/:id', admin, async (req, res) => {
    await transaction(async () => {
      const cycle = await one('SELECT * FROM cycles WHERE id=?', req.params.id);
      if (!cycle) throw fail('Collection not found.', 404);
      requireVersion(req.body, cycle);
      const next = laundryStages[laundryStages.indexOf(cycle.status) + 1];
      if (!next || req.body.status !== next) throw fail('Collections must move one step at a time.', 409);
      const assigned = await worker(req.body.worker_id), note = text(req.body.note, 'Handover note', 3, 1000);
      await run('UPDATE cycles SET status=?,worker_id=?,version=version+1,delivered_at=? WHERE id=?', next, assigned, next === 'Delivered' ? now() : null, cycle.id);
      await run('INSERT INTO cycle_events(cycle_id,status,note,actor_id,worker_id,created_at) VALUES (?,?,?,?,?,?)', cycle.id, next, note, req.account.id, assigned, now());
      const bag = await ownedBag(req.account, cycle.bag_id);
      await notify(bag.owner_id, `${bag.label} · ${next}`, note, 'tracking');
    });
    res.json({ ok: true });
  });
  app.get('/api/complaints', async (req, res) => {
    const rows = await all(`SELECT c.id,c.ref,c.student_id,c.bag_id,c.category,c.description,c.status,c.worker_id,c.created_at,c.due_at,c.resolved_at,c.rating,c.feedback,c.version,
      (c.photo IS NOT NULL) has_photo,b.label bag_label,a.name student_name,w.name worker_name
      FROM complaints c JOIN bags b ON b.id=c.bag_id JOIN accounts a ON a.id=c.student_id LEFT JOIN workers w ON w.id=c.worker_id
      ${req.account.role === 'student' ? 'WHERE c.student_id=?' : ''} ORDER BY c.created_at DESC`, ...(req.account.role === 'student' ? [req.account.id] : []));
    res.json(rows);
  });
  app.post('/api/complaints', student, async (req, res) => {
    const bag = await ownedBag(req.account, req.body.bag_id), category = req.body.category;
    if (!categories.includes(category)) throw fail('Choose a laundry complaint category.');
    const description = text(req.body.description, 'Description', 15, 3000);
    const photo = req.body.photo ? sanitizePhoto(req.body.photo) : null;
    const complaintId = id(), ref = `NM-${randomBytes(5).toString('hex').toUpperCase()}`;
    await transaction(async () => {
      await run("INSERT INTO complaints(id,ref,student_id,bag_id,category,description,status,photo,photo_mime,created_at,due_at) VALUES (?,?,?,?,?,?,'Submitted',?,?,?,?)", complaintId, ref, req.account.id, bag.id, category, description, photo, photo ? 'image/png' : null, now(), after(Number(await setting('resolution_hours'))));
      await run('INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', complaintId, 'Submitted', 'Your complaint is in the campus laundry queue.', req.account.id, now());
      await notify(req.account.id, `${ref} received`, category, `complaints/${complaintId}`);
      await admins(`${ref} · New complaint`, `${category} · ${bag.label}`, `complaints/${complaintId}`);
    });
    res.status(201).json({ id: complaintId, ref });
  });
  app.get('/api/complaints/:id/photo', async (req, res) => {
    const c = await complaint(req.account, req.params.id);
    if (!c.photo) throw fail('Photo not found.', 404);
    res.type(c.photo_mime).send(Buffer.from(c.photo));
  });
  app.get('/api/complaints/:id', async (req, res) => {
    const c = await complaint(req.account, req.params.id);
    res.json({ ...safeComplaint(c), events: await all('SELECT e.*,a.name actor_name FROM complaint_events e JOIN accounts a ON a.id=e.actor_id WHERE complaint_id=? ORDER BY e.id', c.id) });
  });
  app.patch('/api/complaints/:id', admin, async (req, res) => {
    await transaction(async () => {
      const c = await complaint(req.account, req.params.id); requireVersion(req.body, c);
      const status = req.body.status, next = complaintStages[complaintStages.indexOf(c.status) + 1];
      if (!next || status !== next) throw fail('Choose the next step in the complaint timeline.', 409);
      const note = text(req.body.note, 'Progress note', 3, 1000);
      const assigned = ['Assigned', 'In Progress', 'Resolved', 'Closed'].includes(status) ? await worker(req.body.worker_id || c.worker_id) : c.worker_id;
      await run('UPDATE complaints SET status=?,worker_id=?,resolved_at=?,version=version+1 WHERE id=?', status, assigned, status === 'Resolved' ? now() : c.resolved_at, c.id);
      await run('INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', c.id, status, note, req.account.id, now());
      await notify(c.student_id, `${c.ref} · ${status}`, note, `complaints/${c.id}`);
    });
    res.json({ ok: true });
  });
  app.post('/api/complaints/:id/feedback', student, async (req, res) => {
    await transaction(async () => {
      const c = await complaint(req.account, req.params.id); requireVersion(req.body, c);
      if (!['Resolved', 'Closed'].includes(c.status)) throw fail('Feedback is available after resolution.', 409);
      const rating = Number(req.body.rating), note = text(req.body.feedback || '', 'Feedback', 0, 1000);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail('Choose a rating from 1 to 5.');
      await run('UPDATE complaints SET rating=?,feedback=?,version=version+1 WHERE id=?', rating, note, c.id);
    }); res.json({ ok: true });
  });
  app.post('/api/complaints/:id/reopen', student, async (req, res) => {
    await transaction(async () => {
      const c = await complaint(req.account, req.params.id); requireVersion(req.body, c);
      if (!['Resolved', 'Closed'].includes(c.status)) throw fail('Only resolved or closed complaints can be reopened.', 409);
      const note = text(req.body.note, 'Reason for reopening', 10, 1000);
      await run("UPDATE complaints SET status='Under Review',resolved_at=NULL,rating=NULL,feedback=NULL,version=version+1 WHERE id=?", c.id);
      await run("INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,'Under Review',?,?,?)", c.id, `Reopened: ${note}`, req.account.id, now());
      await admins(`${c.ref} reopened`, note, `complaints/${c.id}`);
    }); res.json({ ok: true });
  });
  app.get('/api/notifications', async (req, res) => res.json(await all('SELECT * FROM notifications WHERE account_id=? ORDER BY created_at DESC LIMIT 100', req.account.id)));
  app.post('/api/notifications/read', async (req, res) => { await run('UPDATE notifications SET seen=1 WHERE account_id=?', req.account.id); res.json({ ok: true }); });
  app.get('/api/students', admin, async (req, res) => res.json(await all("SELECT id,name,email,enrollment,phone,hostel,room,active,created_at FROM accounts WHERE role='student' ORDER BY name")));
  app.patch('/api/students/:id', admin, async (req, res) => {
    if (typeof req.body.active !== 'boolean') throw fail('Choose an active state.');
    const result = await run("UPDATE accounts SET active=? WHERE id=? AND role='student'", Number(req.body.active), req.params.id);
    if (!result.changes) throw fail('Student not found.', 404);
    if (!req.body.active) await run('DELETE FROM sessions WHERE account_id=?', req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/workers', admin, async (req, res) => res.json(await all(`SELECT w.*,
    (SELECT count(*) FROM complaints c WHERE c.worker_id=w.id AND c.status NOT IN ('Resolved','Closed')) open_complaints,
    (SELECT count(*) FROM complaints c WHERE c.worker_id=w.id AND c.status IN ('Resolved','Closed')) resolved,
    (SELECT count(*) FROM cycle_events e WHERE e.worker_id=w.id) handovers,
    (SELECT avg(rating) FROM complaints c WHERE c.worker_id=w.id) satisfaction
    FROM workers w ORDER BY name`)));
  app.post('/api/workers', admin, async (req, res) => { const workerId = id(); await run('INSERT INTO workers VALUES (?,?,?,1)', workerId, text(req.body.name, 'Name', 2, 100), text(req.body.specialty, 'Specialty', 2, 100)); res.status(201).json({ id: workerId }); });
  app.patch('/api/workers/:id', admin, async (req, res) => {
    if (typeof req.body.active !== 'boolean') throw fail('Choose an active state.');
    if (!req.body.active && (await one("SELECT id FROM complaints WHERE worker_id=? AND status NOT IN ('Resolved','Closed')", req.params.id) || await one("SELECT id FROM cycles WHERE worker_id=? AND status<>'Delivered'", req.params.id))) throw fail('Complete this worker’s active work before deactivating them.', 409);
    if (!(await run('UPDATE workers SET active=? WHERE id=?', Number(req.body.active), req.params.id)).changes) throw fail('Worker not found.', 404);
    res.json({ ok: true });
  });
  app.get('/api/analytics', admin, async (req, res) => {
    const metrics = await one(`SELECT count(*) total, sum(status NOT IN ('Resolved','Closed')) pending,
      sum(status='In Progress') in_progress,sum(status IN ('Resolved','Closed')) resolved,
      sum(status NOT IN ('Resolved','Closed') AND due_at < ?) overdue,
      avg(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at)-julianday(created_at))*24 END) average_hours,
      avg(rating) satisfaction FROM complaints`, now());
    res.json({ ...metrics, students: (await one("SELECT count(*) n FROM accounts WHERE role='student'")).n,
      active_bags: (await one("SELECT count(*) n FROM cycles WHERE status<>'Delivered'")).n,
      trends: await all("SELECT substr(created_at,1,10) day,count(*) count FROM complaints WHERE created_at>=? GROUP BY day ORDER BY day", new Date(Date.now() - 29 * 86400000).toISOString().slice(0,10)),
      categories: await all('SELECT category,count(*) count FROM complaints GROUP BY category ORDER BY count DESC'),
      stages: await all('SELECT status,count(*) count FROM cycles GROUP BY status') });
  });
  app.use('/api', async (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'The request could not be completed. Please try again.' : error.message });
  });
  return app;
}
