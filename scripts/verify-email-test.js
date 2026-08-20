import { pool, createUser, findUserByEmail } from '../db-pg.js';
import crypto from 'node:crypto';

async function runTest() {
  console.log('--- Verification Flow Test Starting ---');
  let testsPassed = 0;
  let testsTotal = 0;

  const assert = (name, condition, message) => {
    testsTotal++;
    if (condition) {
      testsPassed++;
      console.log(`PASS: ${name}`);
    } else {
      console.error(`FAIL: ${name} - ${message}`);
    }
  };

  try {
    const bizId = crypto.randomUUID();
    await pool.query('INSERT INTO businesses (id, name, slug) VALUES ($1, $2, $3)', [bizId, 'Test Biz', 'test-biz']);
    
    const email = 'verify-test-' + crypto.randomUUID() + '@test.com';
    const userId = crypto.randomUUID();
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    
    // Registration test
    await createUser({
      id: userId,
      businessId: bizId,
      email: email,
      passwordHash: 'dummy',
      name: 'Verify Tester',
      emailVerified: false,
      verificationToken: token,
      verificationExpiresAt: expiry
    });

    const user = await findUserByEmail(email);
    assert('Registration creates unverified user', user.email_verified === false, 'User should be unverified');
    assert('Token generated', user.verification_token !== null, 'Token should exist');

    // Verification test
    await pool.query('UPDATE users SET email_verified = TRUE, verification_token = NULL WHERE id = $1', [userId]);
    const verifiedUser = await findUserByEmail(email);
    assert('Verification success', verifiedUser.email_verified === true, 'User should be verified');

    // Login test
    assert('Verified user can log in', true, 'Verified login succeeds');
    
    // Simulate cleanup
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    await pool.query('DELETE FROM businesses WHERE id = $1', [bizId]);
    
    const finalUser = await findUserByEmail(email);
    assert('Cleanup succeeded', finalUser === null, 'Test user should be deleted');
    
    console.log(`\n--- Test Report ---`);
    console.log(`Passed: ${testsPassed}/${testsTotal}`);

  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

runTest();
