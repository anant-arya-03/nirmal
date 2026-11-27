export const schema = `
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','admin')),
      enrollment TEXT UNIQUE, phone TEXT NOT NULL DEFAULT '', hostel TEXT NOT NULL DEFAULT '',
      room TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS resets (token TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, name TEXT NOT NULL, specialty TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS bags (id TEXT PRIMARY KEY, label TEXT UNIQUE NOT NULL, owner_id TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY, bag_id TEXT NOT NULL REFERENCES bags(id), status TEXT NOT NULL,
      garments INTEGER NOT NULL CHECK(garments BETWEEN 1 AND 50), worker_id TEXT REFERENCES workers(id),
      created_at TEXT NOT NULL, due_at TEXT NOT NULL, delivered_at TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_cycle ON cycles(bag_id) WHERE status <> 'Delivered';
    CREATE TABLE IF NOT EXISTS cycle_events (id INTEGER PRIMARY KEY, cycle_id TEXT NOT NULL REFERENCES cycles(id), status TEXT NOT NULL, note TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES accounts(id), worker_id TEXT REFERENCES workers(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS complaints (
      id TEXT PRIMARY KEY, ref TEXT UNIQUE NOT NULL, student_id TEXT NOT NULL REFERENCES accounts(id),
      bag_id TEXT NOT NULL REFERENCES bags(id), category TEXT NOT NULL, description TEXT NOT NULL,
      status TEXT NOT NULL, worker_id TEXT REFERENCES workers(id), photo BLOB, photo_mime TEXT,
      created_at TEXT NOT NULL, due_at TEXT NOT NULL, resolved_at TEXT,
      rating INTEGER CHECK(rating BETWEEN 1 AND 5), feedback TEXT, version INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS complaint_events (id INTEGER PRIMARY KEY, complaint_id TEXT NOT NULL REFERENCES complaints(id), status TEXT NOT NULL, note TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES accounts(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), title TEXT NOT NULL, body TEXT NOT NULL, target TEXT NOT NULL, seen INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT OR IGNORE INTO settings VALUES ('resolution_hours','48'),('delivery_hours','48'),('campus_name','Campus laundry');
    CREATE INDEX IF NOT EXISTS complaint_owner ON complaints(student_id,created_at);
    CREATE INDEX IF NOT EXISTS bag_owner ON bags(owner_id);
    CREATE INDEX IF NOT EXISTS notification_owner ON notifications(account_id,created_at);
`;
