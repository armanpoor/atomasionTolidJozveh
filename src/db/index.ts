import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const isSqlConfigured = (): boolean =>
  Boolean(
    process.env.SQL_HOST &&
      process.env.SQL_USER &&
      process.env.SQL_PASSWORD &&
      process.env.SQL_DB_NAME
  );

export const isBenignIdlePoolDisconnect = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code = (err as { code?: string } | null)?.code || '';
  return (
    /Connection terminated unexpectedly/i.test(msg) ||
    /terminating connection due to administrator command/i.test(msg) ||
    /Client has encountered a connection error and is not queryable/i.test(msg) ||
    /ECONNRESET|EPIPE|ETIMEDOUT/i.test(msg) ||
    code === '57P01' ||
    code === '57P02' ||
    code === '57P03' ||
    code === 'ECONNRESET'
  );
};

export const createPool = (): Pool | null => {
  if (!isSqlConfigured()) {
    return null;
  }
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      allowExitOnIdle: true,
    });

    global._postgresPool.on('error', (err) => {
      if (isBenignIdlePoolDisconnect(err)) {
        // Cloud SQL Developer edition scales to zero or recycles idle TCP sockets;
        // pg.Pool automatically evicts the closed idle client and reconnects on next query.
        return;
      }
      console.warn('[SQL Pool] Non-fatal idle client warning:', err instanceof Error ? err.message : String(err));
    });
  }
  return global._postgresPool;
};

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

function createMockDbProxy(): DrizzleDb {
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: { data?: unknown }) => d?.data ?? {},
    update: async (d: { data?: unknown }) => d?.data ?? {},
    delete: async () => ({}),
  };
  return new Proxy(
    {},
    {
      get: (_, prop) =>
        prop === 'query' ? new Proxy({}, { get: () => noOp }) : async () => [],
    }
  ) as unknown as DrizzleDb;
}

let db: DrizzleDb;
try {
  const pool = createPool();
  if (pool) {
    db = drizzle(pool, { schema });
  } else {
    console.warn('[AI Studio] SQL database not configured — using in-memory repository store');
    db = createMockDbProxy();
  }
} catch {
  console.warn('[AI Studio] Database not connected — using mock');
  db = createMockDbProxy();
}

export { db };
