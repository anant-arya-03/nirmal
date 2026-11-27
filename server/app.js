import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { sanitizePhoto } from './images.js';
import nodemailer from 'nodemailer';
import { randomUUID, randomBytes } from 'node:crypto';
import { transaction } from './db.js';
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
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const setting = key => one('SELECT value FROM settings WHERE key=?', key).value;
  const cookie = { httpOnly: true, sameSite: 'strict', secure: production, path: '/' };
  const newSession = (res, accountId) => {
    run('DELETE FROM sessions WHERE expires < ?', Date.now());
    const token = secret();
    run('INSERT INTO sessions VALUES (?,?,?)', digest(token), accountId, Date.now() + 8 * 3600000);
    res.cookie('nirmal_session', token, { ...cookie, maxAge: 8 * 3600000 });
  };
  const notify = (accountId, title, body, target) => run('INSERT INTO notifications VALUES (?,?,?,?,?,0,?)', id(), accountId, title, body, target, now());
  const admins = (title, body, target) => all("SELECT id FROM accounts WHERE role='admin' AND active=1").forEach(a => notify(a.id, title, body, target));
  const worker = workerId => {
    if (!workerId || !one('SELECT id FROM workers WHERE id=? AND active=1', workerId)) throw fail('Choose an active worker.');
    return workerId;
  };
  const ownedBag = (account, bagId) => {
    const bag = one('SELECT b.*,a.name owner_name FROM bags b JOIN accounts a ON a.id=b.owner_id WHERE b.id=?', bagId || '');
    if (!bag || (account.role !== 'admin' && bag.owner_id !== account.id)) throw fail('Bag not found.', 404);
    return bag;
  };
  const complaint = (account, complaintId) => {
    const result = one(`SELECT c.*, b.label bag_label,a.name student_name,a.enrollment,a.email,a.phone,a.hostel,a.room,w.name worker_name
      FROM complaints c JOIN bags b ON b.id=c.bag_id JOIN accounts a ON a.id=c.student_id LEFT JOIN workers w ON w.id=c.worker_id WHERE c.id=?`, complaintId);
    if (!result || (account.role !== 'admin' && result.student_id !== account.id)) throw fail('Complaint not found.', 404);
    return result;
  };
  const safeComplaint = ({ photo, photo_mime, ...c }) => ({ ...c, has_photo: !!photo });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', async (req, res) => {
    const body = req.body || {}, p = profileInput(body), email = emailInput(body.email);
    const domain = process.env.UNIVERSITY_EMAIL_DOMAIN?.toLowerCase();
    if (domain && email.split('@')[1] !== domain) throw fail(`Use your @${domain} university email.`);
    const password = await hashPassword(body.password);
    const accountId = id();
    try { run("INSERT INTO accounts VALUES (?,?,?,?,'student',?,?,?,?,1,?)", accountId, p.name, email, password, p.enrollment, p.phone, p.hostel, p.room, now()); }
    catch (e) { if (e.code?.startsWith('ERR_SQLITE')) throw fail('An account with that email or enrollment already exists.', 409); throw e; }
    newSession(res, accountId);
    res.status(201).json(publicAccount(one('SELECT * FROM accounts WHERE id=?', accountId)));
  });
  const dummyPassword = hashPassword(secret());
  app.post('/api/auth/login', async (req, res) => {
    const email = emailInput(req.body?.email);
    const account = one('SELECT * FROM accounts WHERE email=?', email);
    const valid = await verifyPassword(req.body?.password, account?.password || await dummyPassword);
    if (!account?.active || !valid) throw fail('Email or password is incorrect.', 401);
    newSession(res, account.id);
    res.json(publicAccount(account));
  });
  app.post('/api/auth/forgot', async (req, res) => {
    const email = emailInput(req.body?.email);
    // A configured mail transport is required; never expose reset tokens in HTTP responses.
    if (!mailer && !process.env.SMTP_HOST) throw fail('Email delivery is not configured. Contact your campus administrator for a password reset link.', 503);
    const account = one('SELECT id FROM accounts WHERE email=? AND active=1', email);
    if (account) {
      const token = secret();
      transaction(db, () => { run('DELETE FROM resets WHERE account_id=? OR expires<?', account.id, Date.now()); run('INSERT INTO resets VALUES (?,?,?)', digest(token), account.id, Date.now() + 1800000); });
      const transport = mailer || nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_PORT === '465', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
      try { await transport.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Reset your Nirmal password', text: `Your one-time reset link expires in 30 minutes: ${origin}/#reset/${token}\nIf you did not request this, ignore this email.` }); }
      catch { run('DELETE FROM resets WHERE token=?', digest(token)); console.error('Password reset email delivery failed. Check SMTP configuration.'); }
    }
    res.json({ message: 'If an active account exists, a reset link will be sent to its email address.' });
  });
  app.post('/api/auth/reset', async (req, res) => {
    const token = text(req.body?.token, 'Reset token', 64, 64);
    const password = await hashPassword(req.body?.password);
    transaction(db, () => {
      const reset = one('SELECT * FROM resets WHERE token=? AND expires>?', digest(token), Date.now());
      if (!reset) throw fail('This reset link is invalid or expired.');
      run('UPDATE accounts SET password=? WHERE id=?', password, reset.account_id);
      run('DELETE FROM resets WHERE account_id=?', reset.account_id);
      run('DELETE FROM sessions WHERE account_id=?', reset.account_id);
    });
    res.clearCookie('nirmal_session', cookie).json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    const token = /(?:^|;\s*)nirmal_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const account = token && one('SELECT a.* FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token=? AND s.expires>? AND a.active=1', digest(token), Date.now());
    if (!account) return res.status(401).json({ error: 'Please sign in to continue.' });
    req.account = publicAccount(account); req.sessionToken = digest(token); next();
  });
  const admin = (req, res, next) => req.account.role === 'admin' ? next() : res.status(403).json({ error: 'Administrator access required.' });
  const student = (req, res, next) => req.account.role === 'student' ? next() : res.status(403).json({ error: 'Student access required.' });
  app.get('/api/me', (req, res) => res.json(req.account));
  app.post('/api/logout', (req, res) => { run('DELETE FROM sessions WHERE token=?', req.sessionToken); res.clearCookie('nirmal_session', cookie).json({ ok: true }); });
  app.patch('/api/profile', (req, res) => {
    const name = text(req.body.name, 'Name', 2, 100);
    const p = req.account.role === 'student' ? profileInput({ ...req.body, enrollment: req.account.enrollment }) : { phone: text(req.body.phone || '', 'Phone', 0, 20), hostel: '', room: '' };
    run('UPDATE accounts SET name=?,phone=?,hostel=?,room=? WHERE id=?', name, p.phone, p.hostel, p.room, req.account.id);
    res.json(publicAccount(one('SELECT * FROM accounts WHERE id=?', req.account.id)));
  });
  app.post('/api/password', async (req, res) => {
    const account = one('SELECT * FROM accounts WHERE id=?', req.account.id);
    if (!await verifyPassword(req.body.current, account.password)) throw fail('Current password is incorrect.', 403);
    const password = await hashPassword(req.body.password);
    transaction(db, () => {
      if (one('SELECT password FROM accounts WHERE id=?',account.id).password !== account.password) throw fail('Password changed during this request. Sign in again.',409);
      run('UPDATE accounts SET password=? WHERE id=?', password, account.id); run('DELETE FROM sessions WHERE account_id=?', account.id);
    });
    newSession(res, account.id); res.json({ ok: true });
  });
  app.get('/api/settings', (req, res) => res.json(Object.fromEntries(all('SELECT * FROM settings').map(s => [s.key, s.value]))));
  app.patch('/api/settings', admin, (req, res) => {
    const name = text(req.body.campus_name, 'Campus name', 2, 80);
    const hours = ['resolution_hours', 'delivery_hours'].map(k => { const n = Number(req.body[k]); if (!Number.isInteger(n) || n < 1 || n > 336) throw fail('Targets must be between 1 and 336 hours.'); return String(n); });
    transaction(db, () => { [['campus_name', name], ['resolution_hours', hours[0]], ['delivery_hours', hours[1]]].forEach(([k, v]) => run('UPDATE settings SET value=? WHERE key=?', v, k)); });
    res.json({ ok: true });
  });
  app.get('/api/bags', (req, res) => {
    const rows = all(`SELECT b.*,a.name owner_name,a.hostel,a.room FROM bags b JOIN accounts a ON a.id=b.owner_id ${req.account.role === 'student' ? 'WHERE b.owner_id=?' : ''} ORDER BY b.created_at DESC`, ...(req.account.role === 'student' ? [req.account.id] : []));
    res.json(rows.map(b => ({ ...b, cycles: all('SELECT c.*,w.name worker_name FROM cycles c LEFT JOIN workers w ON w.id=c.worker_id WHERE c.bag_id=? ORDER BY c.created_at DESC', b.id).map(c => ({ ...c, events: all('SELECT e.*,a.name actor_name,w.name worker_name FROM cycle_events e JOIN accounts a ON a.id=e.actor_id LEFT JOIN workers w ON w.id=e.worker_id WHERE cycle_id=? ORDER BY e.id', c.id) })) })));
  });
  app.post('/api/bags', admin, (req, res) => {
    const owner = one("SELECT id FROM accounts WHERE id=? AND role='student' AND active=1", req.body.owner_id || '');
    if (!owner) throw fail('Choose an active student.');
    const bagId = id(), label = `NM-${randomBytes(4).toString('hex').toUpperCase()}`;
    transaction(db, () => { run('INSERT INTO bags VALUES (?,?,?,?)', bagId, label, owner.id, now()); notify(owner.id, 'Your bag is assigned', `${label} is ready for your next collection.`, 'laundry'); });
    res.status(201).json({ id: bagId, label });
  });
  app.post('/api/cycles', student, (req, res) => {
    const bag = ownedBag(req.account, req.body.bag_id);
    const count = Number(req.body.garments);
    if (!Number.isInteger(count) || count < 1 || count > 50) throw fail('Enter between 1 and 50 garments.');
    const cycleId = id();
    transaction(db, () => {
      if (one("SELECT id FROM cycles WHERE bag_id=? AND status<>'Delivered'", bag.id)) throw fail('This bag already has an active collection.', 409);
      run("INSERT INTO cycles (id,bag_id,status,garments,created_at,due_at) VALUES (?,?,'Scheduled',?,?,?)", cycleId, bag.id, count, now(), after(Number(setting('delivery_hours'))));
      run('INSERT INTO cycle_events(cycle_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', cycleId, 'Scheduled', `${count} garments registered for collection.`, req.account.id, now());
      admins('Collection requested', `${bag.label} · ${count} garments`, 'laundry');
    });
    res.status(201).json({ id: cycleId });
  });
  app.patch('/api/cycles/:id', admin, (req, res) => {
    transaction(db, () => {
      const cycle = one('SELECT * FROM cycles WHERE id=?', req.params.id);
      if (!cycle) throw fail('Collection not found.', 404);
      requireVersion(req.body, cycle);
      const next = laundryStages[laundryStages.indexOf(cycle.status) + 1];
      if (!next || req.body.status !== next) throw fail('Collections must move one step at a time.', 409);
      const assigned = worker(req.body.worker_id), note = text(req.body.note, 'Handover note', 3, 1000);
      run('UPDATE cycles SET status=?,worker_id=?,version=version+1,delivered_at=? WHERE id=?', next, assigned, next === 'Delivered' ? now() : null, cycle.id);
      run('INSERT INTO cycle_events(cycle_id,status,note,actor_id,worker_id,created_at) VALUES (?,?,?,?,?,?)', cycle.id, next, note, req.account.id, assigned, now());
      const bag = ownedBag(req.account, cycle.bag_id);
      notify(bag.owner_id, `${bag.label} · ${next}`, note, 'tracking');
    });
    res.json({ ok: true });
  });
  app.get('/api/complaints', (req, res) => {
    const rows = all(`SELECT c.id,c.ref,c.student_id,c.bag_id,c.category,c.description,c.status,c.worker_id,c.created_at,c.due_at,c.resolved_at,c.rating,c.feedback,c.version,
      (c.photo IS NOT NULL) has_photo,b.label bag_label,a.name student_name,w.name worker_name
      FROM complaints c JOIN bags b ON b.id=c.bag_id JOIN accounts a ON a.id=c.student_id LEFT JOIN workers w ON w.id=c.worker_id
      ${req.account.role === 'student' ? 'WHERE c.student_id=?' : ''} ORDER BY c.created_at DESC`, ...(req.account.role === 'student' ? [req.account.id] : []));
    res.json(rows);
  });
  app.post('/api/complaints', student, async (req, res) => {
    const bag = ownedBag(req.account, req.body.bag_id), category = req.body.category;
    if (!categories.includes(category)) throw fail('Choose a laundry complaint category.');
    const description = text(req.body.description, 'Description', 15, 3000);
    const photo = req.body.photo ? sanitizePhoto(req.body.photo) : null;
    const complaintId = id(), ref = `NM-${randomBytes(5).toString('hex').toUpperCase()}`;
    transaction(db, () => {
      run("INSERT INTO complaints(id,ref,student_id,bag_id,category,description,status,photo,photo_mime,created_at,due_at) VALUES (?,?,?,?,?,?,'Submitted',?,?,?,?)", complaintId, ref, req.account.id, bag.id, category, description, photo, photo ? 'image/png' : null, now(), after(Number(setting('resolution_hours'))));
      run('INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', complaintId, 'Submitted', 'Your complaint is in the campus laundry queue.', req.account.id, now());
      notify(req.account.id, `${ref} received`, category, `complaints/${complaintId}`);
      admins(`${ref} · New complaint`, `${category} · ${bag.label}`, `complaints/${complaintId}`);
    });
    res.status(201).json({ id: complaintId, ref });
  });
  app.get('/api/complaints/:id/photo', (req, res) => {
    const c = complaint(req.account, req.params.id);
    if (!c.photo) throw fail('Photo not found.', 404);
    res.type(c.photo_mime).send(Buffer.from(c.photo));
  });
  app.get('/api/complaints/:id', (req, res) => {
    const c = complaint(req.account, req.params.id);
    res.json({ ...safeComplaint(c), events: all('SELECT e.*,a.name actor_name FROM complaint_events e JOIN accounts a ON a.id=e.actor_id WHERE complaint_id=? ORDER BY e.id', c.id) });
  });
  app.patch('/api/complaints/:id', admin, (req, res) => {
    transaction(db, () => {
      const c = complaint(req.account, req.params.id); requireVersion(req.body, c);
      const status = req.body.status, next = complaintStages[complaintStages.indexOf(c.status) + 1];
      if (!next || status !== next) throw fail('Choose the next step in the complaint timeline.', 409);
      const note = text(req.body.note, 'Progress note', 3, 1000);
      const assigned = ['Assigned', 'In Progress', 'Resolved', 'Closed'].includes(status) ? worker(req.body.worker_id || c.worker_id) : c.worker_id;
      run('UPDATE complaints SET status=?,worker_id=?,resolved_at=?,version=version+1 WHERE id=?', status, assigned, status === 'Resolved' ? now() : c.resolved_at, c.id);
      run('INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,?,?,?,?)', c.id, status, note, req.account.id, now());
      notify(c.student_id, `${c.ref} · ${status}`, note, `complaints/${c.id}`);
    });
    res.json({ ok: true });
  });
  app.post('/api/complaints/:id/feedback', student, (req, res) => {
    transaction(db, () => {
      const c = complaint(req.account, req.params.id); requireVersion(req.body, c);
      if (!['Resolved', 'Closed'].includes(c.status)) throw fail('Feedback is available after resolution.', 409);
      const rating = Number(req.body.rating), note = text(req.body.feedback || '', 'Feedback', 0, 1000);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail('Choose a rating from 1 to 5.');
      run('UPDATE complaints SET rating=?,feedback=?,version=version+1 WHERE id=?', rating, note, c.id);
    }); res.json({ ok: true });
  });
  app.post('/api/complaints/:id/reopen', student, (req, res) => {
    transaction(db, () => {
      const c = complaint(req.account, req.params.id); requireVersion(req.body, c);
      if (!['Resolved', 'Closed'].includes(c.status)) throw fail('Only resolved or closed complaints can be reopened.', 409);
      const note = text(req.body.note, 'Reason for reopening', 10, 1000);
      run("UPDATE complaints SET status='Under Review',resolved_at=NULL,rating=NULL,feedback=NULL,version=version+1 WHERE id=?", c.id);
      run("INSERT INTO complaint_events(complaint_id,status,note,actor_id,created_at) VALUES (?,'Under Review',?,?,?)", c.id, `Reopened: ${note}`, req.account.id, now());
      admins(`${c.ref} reopened`, note, `complaints/${c.id}`);
    }); res.json({ ok: true });
  });
  app.get('/api/notifications', (req, res) => res.json(all('SELECT * FROM notifications WHERE account_id=? ORDER BY created_at DESC LIMIT 100', req.account.id)));
  app.post('/api/notifications/read', (req, res) => { run('UPDATE notifications SET seen=1 WHERE account_id=?', req.account.id); res.json({ ok: true }); });
  app.get('/api/students', admin, (req, res) => res.json(all("SELECT id,name,email,enrollment,phone,hostel,room,active,created_at FROM accounts WHERE role='student' ORDER BY name")));
  app.patch('/api/students/:id', admin, (req, res) => {
    if (typeof req.body.active !== 'boolean') throw fail('Choose an active state.');
    const result = run("UPDATE accounts SET active=? WHERE id=? AND role='student'", Number(req.body.active), req.params.id);
    if (!result.changes) throw fail('Student not found.', 404);
    if (!req.body.active) run('DELETE FROM sessions WHERE account_id=?', req.params.id);
    res.json({ ok: true });
  });
  app.get('/api/workers', admin, (req, res) => res.json(all(`SELECT w.*,
    (SELECT count(*) FROM complaints c WHERE c.worker_id=w.id AND c.status NOT IN ('Resolved','Closed')) open_complaints,
    (SELECT count(*) FROM complaints c WHERE c.worker_id=w.id AND c.status IN ('Resolved','Closed')) resolved,
    (SELECT count(*) FROM cycle_events e WHERE e.worker_id=w.id) handovers,
    (SELECT avg(rating) FROM complaints c WHERE c.worker_id=w.id) satisfaction
    FROM workers w ORDER BY name`)));
  app.post('/api/workers', admin, (req, res) => { const workerId = id(); run('INSERT INTO workers VALUES (?,?,?,1)', workerId, text(req.body.name, 'Name', 2, 100), text(req.body.specialty, 'Specialty', 2, 100)); res.status(201).json({ id: workerId }); });
  app.patch('/api/workers/:id', admin, (req, res) => {
    if (typeof req.body.active !== 'boolean') throw fail('Choose an active state.');
    if (!req.body.active && (one("SELECT id FROM complaints WHERE worker_id=? AND status NOT IN ('Resolved','Closed')", req.params.id) || one("SELECT id FROM cycles WHERE worker_id=? AND status<>'Delivered'", req.params.id))) throw fail('Complete this worker’s active work before deactivating them.', 409);
    if (!run('UPDATE workers SET active=? WHERE id=?', Number(req.body.active), req.params.id).changes) throw fail('Worker not found.', 404);
    res.json({ ok: true });
  });
  app.get('/api/analytics', admin, (req, res) => {
    const metrics = one(`SELECT count(*) total, sum(status NOT IN ('Resolved','Closed')) pending,
      sum(status='In Progress') in_progress,sum(status IN ('Resolved','Closed')) resolved,
      sum(status NOT IN ('Resolved','Closed') AND due_at < ?) overdue,
      avg(CASE WHEN resolved_at IS NOT NULL THEN (julianday(resolved_at)-julianday(created_at))*24 END) average_hours,
      avg(rating) satisfaction FROM complaints`, now());
    res.json({ ...metrics, students: one("SELECT count(*) n FROM accounts WHERE role='student'").n,
      active_bags: one("SELECT count(*) n FROM cycles WHERE status<>'Delivered'").n,
      trends: all("SELECT substr(created_at,1,10) day,count(*) count FROM complaints WHERE created_at>=? GROUP BY day ORDER BY day", new Date(Date.now() - 29 * 86400000).toISOString().slice(0,10)),
      categories: all('SELECT category,count(*) count FROM complaints GROUP BY category ORDER BY count DESC'),
      stages: all('SELECT status,count(*) count FROM cycles GROUP BY status') });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use((error, req, res, next) => {
    const status = error.status || (error.type === 'entity.too.large' ? 413 : 500);
    if (status === 500) console.error(error);
    res.status(status).json({ error: status === 500 ? 'The request could not be completed. Please try again.' : error.message });
  });
  return app;
}
