/**
 * ENVIRONMENT PRE-FLIGHT CHECK (Phase 8)
 *
 * Validates the current environment and exits non-zero when something is
 * wrong, with a human-readable list of problems. Intended as a pre-deploy
 * gate (e.g. `node scripts/check-env.js` in your release pipeline) and as a
 * quick local sanity check. Never prints secret values.
 *
 * Usage: node scripts/check-env.js
 */
import 'dotenv/config';
import { validateEnvironment, loadConfig } from '../config/env.js';

const config = loadConfig(process.env);
const errors = validateEnvironment(process.env);

console.log(`Environment:  ${config.nodeEnv}${config.isProduction ? ' (production)' : ''}`);
console.log(`Port:         ${config.port}`);
console.log(`APP_URL:      ${config.appUrl}`);
console.log(`CORS origins: ${config.corsOrigins.join(', ') || '(none configured)'}`);
console.log(`Groq key:     ${config.groqApiKey ? 'set' : 'NOT SET'}`);
console.log(`Paystack key: ${config.paystackSecretKey ? 'set' : 'NOT SET'}`);
console.log(`JWT secret:   ${config.jwtSecret ? 'set' : 'NOT SET'}`);

if (errors.length > 0) {
  console.error('\nEnvironment validation failed:');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log('\nEnvironment is valid.');
