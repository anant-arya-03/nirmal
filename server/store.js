import { AsyncLocalStorage } from 'node:async_hooks';

export function queryStore(db) {
  const contexts = new AsyncLocalStorage();
  let queue = Promise.resolve();
  const remote = typeof db.execute === 'function';

  function exclusive(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }

  async function query(method, sql, args) {
    const context = contexts.getStore();
    if (!remote) {
      const execute = () => db.prepare(sql)[method](...args);
      return context ? execute() : exclusive(execute);
    }
    const result = await (context || db).execute({ sql, args });
    if (method === 'get') return result.rows[0];
    if (method === 'all') return result.rows;
    return { changes: result.rowsAffected };
  }

  async function transaction(work) {
    if (remote) {
      const tx = await db.transaction('write');
      try {
        const result = await contexts.run(tx, work);
        await tx.commit();
        return result;
      } finally {
        tx.close();
      }
    }
    return exclusive(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await contexts.run(db, work);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  return {
    one: (sql, ...args) => query('get', sql, args),
    all: (sql, ...args) => query('all', sql, args),
    run: (sql, ...args) => query('run', sql, args),
    transaction
  };
}
