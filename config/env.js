
/**
 * ENVIRONMENT VALIDATION & CONFIGURATION (Phase 8)
 *
 * Single source of truth for how the Express server reads its environment.
 * The server fails fast in production with one clear list of every missing or
 * misconfigured variable instead of surfacing confusing errors later (a
 * missing GROQ_API_KEY already crashes the Groq client constructor, a missing
 * PAYSTACK_SECRET_KEY silently sends `Bearer undefined` to Paystack, and a
 * placeholder JWT_SECRET would let anyone forge sessions).
 *
 * Rules by mode:
 *   - every mode: JWT_SECRET is mandatory;
 *   - production: GROQ_API_KEY, PAYSTACK_SECRET_KEY, APP_URL and CORS_ORIGIN
 *     are mandatory, and several values are additionally sanity-checked
 *     (placeholder/length checks for JWT_SECRET, http(s) APP_URL, no
 *     localhost CORS origins);
 *   - development/test: optional keys are tolerated so a local or CI run does
 *     not need real credentials.
 *
 * The module is side-effect free at import time: `config` is computed from the
 * current process.env, `validateEnvironment` is a pure function, and the
 * server decides when to call `assertValidEnvironment` (fail fast) vs merely
 * warn (non-production).
 */

const NORMALIZED_ENV_KEYS = [
  'NODE_ENV',
  'PORT',
  'JWT_SECRET',
  'SESSION_TTL_DAYS',
  'GROQ_API_KEY',
  'PAYSTACK_SECRET_KEY',
  'PAYSTACK_PLAN_CODE_STARTER',
  'PAYSTACK_PLAN_CODE_GROWTH',
  'PAYSTACK_PLAN_CODE_BUSINESS',
  'APP_URL',
  'CORS_ORIGIN',
  'DATA_DIR',
  'TRUST_PROXY',
];

const normalizeEnv = (env = process.env) => {
  const normalized = {};
  for (const key of NORMALIZED_ENV_KEYS) {
    const value = env[key];
    normalized[key] = typeof value === 'string' ? value.trim() : value;
  }
  return normalized;
};

/**
 * Pure validation. Returns an array of human-readable problems (empty when the
 * environment is valid for the requested mode).
 */
export function validateEnvironment(rawEnv = process.env) {
  const env = normalizeEnv(rawEnv);
  const errors = [];

  const nodeEnv = (env.NODE_ENV || 'development').toLowerCase();
  const isProduction = nodeEnv === 'production';

  if (!env.JWT_SECRET) {
    errors.push('JWT_SECRET is required in every mode. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  } else if (isProduction) {
    if (env.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET must be at least 32 characters in production');
    }
    if (/replace-with|your-secret|changeme|placeholder/i.test(env.JWT_SECRET)) {
      errors.push('JWT_SECRET looks like a placeholder; generate a fresh random value');
    }
  }

  if (env.PORT !== undefined && env.PORT !== '') {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('PORT must be an integer between 1 and 65535');
    }
  }

  if (env.SESSION_TTL_DAYS !== undefined && env.SESSION_TTL_DAYS !== '') {
    const days = Number(env.SESSION_TTL_DAYS);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      errors.push('SESSION_TTL_DAYS must be an integer between 1 and 365');
    }
  }

  if (isProduction) {
    if (!env.GROQ_API_KEY) {
      errors.push('GROQ_API_KEY is required in production (the Groq SDK refuses to start without it)');
    }
    if (!env.PAYSTACK_SECRET_KEY) {
      errors.push('PAYSTACK_SECRET_KEY is required in production (billing, webhooks and identity resolution all depend on it)');
    }
    if (!env.APP_URL) {
      errors.push('APP_URL is required in production (used to build touchpoint links and the Paystack callback URL)');
    } else if (!/^https?:\/\/[^\s]+$/i.test(env.APP_URL)) {
      errors.push('APP_URL must be a valid http(s) URL');
    }
    if (!env.CORS_ORIGIN) {
      errors.push('CORS_ORIGIN is required in production (the browser origin(s) allowed to call the API)');
    } else if (env.CORS_ORIGIN.split(',').some((origin) => /^https?:\/\/localhost(:\d+)?$/.test(origin.trim()))) {
      errors.push('CORS_ORIGIN must not allow localhost origins in production');
    }
  }

  return errors;
}

/**
 * Throws with every validation problem when the environment is invalid.
 */
export function assertValidEnvironment(rawEnv = process.env) {
  const errors = validateEnvironment(rawEnv);
  if (errors.length > 0) {
    throw new Error(`Environment validation failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`);
  }
}

/**
 * Normalized, typed configuration derived from the current environment.
 */
export function loadConfig(rawEnv = process.env) {
  const env = normalizeEnv(rawEnv);
  const nodeEnv = (env.NODE_ENV || 'development').toLowerCase();
  const port = Number(env.PORT || 3001);
  const appUrl = (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, '');

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port,
    jwtSecret: env.JWT_SECRET,
    sessionTtlDays: Number(env.SESSION_TTL_DAYS || 7),
    groqApiKey: env.GROQ_API_KEY,
    paystackSecretKey: env.PAYSTACK_SECRET_KEY,
    appUrl,
    corsOrigins: (env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    trustProxy: env.TRUST_PROXY,
  };
}

/**
 * The live config for this process. Computed at import time — tests set
 * process.env before importing the server, so this reflects their values.
 */
export const config = loadConfig(process.env);
