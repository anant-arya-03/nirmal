import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const secret = () => randomBytes(32).toString('hex');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export function text(value, label, min = 1, max = 200) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw fail(`${label} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function passwordInput(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw fail('Use a password with 12–128 characters.');
  return value;
}
export async function hashPassword(value) {
  passwordInput(value);
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${Buffer.from(await derive(value, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(value, encoded) {
  if (typeof value !== 'string' || value.length > 128) return false;
  const [salt, expected] = encoded.split(':');
  const actual = Buffer.from(await derive(value, salt, 64));
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
export function emailInput(value) {
  const email = text(value, 'Email', 5, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail('Enter a valid university email.');
  return email;
}
export function profileInput(body) {
  const phone = text(body.phone, 'Phone', 7, 20);
  if (!/^[+\d ()-]+$/.test(phone)) throw fail('Enter a valid contact number.');
  return { name: text(body.name, 'Name', 2, 100), enrollment: text(body.enrollment, 'Enrollment', 2, 40), phone, hostel: text(body.hostel, 'Hostel', 1, 60), room: text(body.room, 'Room', 1, 20) };
}
export function requireVersion(body, record) {
  if (!Number.isInteger(body.version) || body.version !== record.version) throw fail('This record changed. Refresh it before saving.', 409);
}
export const publicAccount = ({ password, ...account }) => account;
