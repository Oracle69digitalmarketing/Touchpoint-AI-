
/**
 * SECRET LEAK VERIFICATION (Phase 8)
 *
 * Scans the production build output (dist/) for known secret material that
 * must never reach a client bundle. Run automatically after every production
 * build (`yarn build:prod`) so a leaked API key fails the build instead of
 * being deployed.
 *
 * The browser bundle legitimately contains only the Paystack PUBLIC key; the
 * server secrets (Groq, Paystack secret, JWT) and any key-shaped value must
 * never appear. Also exported so the test suite can exercise it directly.
 *
 * Usage: node scripts/verify-dist.js [distDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Patterns for secret material that must never be shipped to the browser.
export const SECRET_PATTERNS = [
  { name: 'Paystack secret key (test)', re: /sk_test_[A-Za-z0-9]+/ },
  { name: 'Paystack secret key (live)', re: /sk_live_[A-Za-z0-9]+/ },
  { name: 'Groq API key', re: /gsk_[A-Za-z0-9]+/ },
  { name: 'OpenAI-style secret key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: 'Slack bot token', re: /xox[baprs]-[A-Za-z0-9-]+/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Server-side env var reference', re: /PAYSTACK_SECRET_KEY|GROQ_API_KEY|JWT_SECRET/ },
];

/**
 * Walks a directory recursively and reports every file whose contents match a
 * known secret pattern. Returns an array of { file, pattern } (empty = clean).
 */
export function findSecretLeaks(distDir) {
  const leaks = [];
  if (!fs.existsSync(distDir)) return leaks;

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      let content;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch (err) {
        continue; // binary/odd files are skipped
      }
      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(content)) {
          leaks.push({ file: path.relative(process.cwd(), full), pattern: name });
        }
      }
    }
  };
  walk(distDir);
  return leaks;
}

function main() {
  const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));
  const leaks = findSecretLeaks(distDir);

  if (leaks.length > 0) {
    console.error('SECRET LEAK DETECTED in built output:');
    for (const leak of leaks) {
      console.error(`  - ${leak.file} contains ${leak.pattern}`);
    }
    process.exitCode = 1;
    return;
  }

  if (!fs.existsSync(distDir)) {
    console.error(`dist/ not found at ${distDir}; run the build first.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Secret verification passed: no secret material found in ${distDir}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
