export interface ServerBindConfig {
  port: number;
  host: string;
  isProd: boolean;
  disableHmr: boolean;
}

function parsePortValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return null;
  }
  return parsed;
}

/**
 * Resolves the HTTP server bind configuration from CLI arguments and environment variables.
 *
 * Precedence for port:
 * 1. Explicit CLI flag (`--port 3000`, `--port=3000`, `-p 3000`)
 * 2. Production mode (`NODE_ENV=production`): `PORT` env var or 3000
 * 3. Development mode: `PORT` env var unless it is 8080 (which collides with the container
 *    reverse proxy in dev environments), falling back to 3000.
 */
export function resolveServerBindConfig(
  argv: readonly string[] = process.argv.slice(2),
  env: Record<string, string | undefined> = process.env
): ServerBindConfig {
  const isProd = env.NODE_ENV === 'production';
  const disableHmr = env.DISABLE_HMR === 'true';

  let cliPort: number | null = null;
  let cliHost: string | null = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') {
      cliPort = parsePortValue(argv[i + 1]);
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        i += 1;
      }
    } else if (arg.startsWith('--port=')) {
      cliPort = parsePortValue(arg.slice('--port='.length));
    } else if (arg === '--host') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-')) {
        cliHost = next;
        i += 1;
      } else {
        cliHost = '0.0.0.0';
      }
    } else if (arg.startsWith('--host=')) {
      cliHost = arg.slice('--host='.length) || '0.0.0.0';
    }
  }

  const envPort = parsePortValue(env.PORT);
  let port: number;
  if (cliPort !== null) {
    port = cliPort;
  } else if (isProd) {
    port = envPort ?? 3000;
  } else if (envPort !== null && envPort !== 8080) {
    port = envPort;
  } else {
    port = 3000;
  }

  const host = cliHost || env.HOST || '0.0.0.0';

  return {
    port,
    host,
    isProd,
    disableHmr,
  };
}
