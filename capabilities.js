/**
 * TouchPoint AI Capability Definitions (Phase 15J2)
 *
 * Centralized capability entitlement layer following the established
 * founder-entitlement architecture. Capabilities are server-authoritative
 * and independent of subscription tier.
 *
 * Design principles (per FOUNDER_ENTITLEMENT_COMPARISON_REPORT.md):
 * 1. Role (founder status) is independent of subscription plan.
 * 2. Capability grants are server-authoritative; frontend must not decide.
 * 3. PLANNED_CAPABILITIES are never granted.
 * 4. Founder status grants IMPLEMENTED_CAPABILITIES regardless of subscription.
 * 5. No client-supplied flag can elevate privileges.
 */

/**
 * IMPLEMENTED_CAPABILITIES — capabilities that are server-authoritatively
 * enforced and may be granted to qualified users. These correspond to features
 * that are demonstrably implemented in the TouchPoint AI codebase.
 *
 * Source of truth: codebase feature presence (db-pg.js email functions,
 * services/admin.ts endpoints, is_platform_owner flag, etc.).
 */
export const IMPLEMENTED_CAPABILITIES = new Set([
  // Email infrastructure (Phase 15: migrations 012-015)
  'CAP_EMAIL_OUTBOX',           // recordEmailMessage, getEmailMessage, updateEmailMessage
  'CAP_EMAIL_EVENTS',           // recordEmailEvent, provider webhook ledger
  'CAP_EMAIL_SUPPRESSIONS',     // isEmailSuppression, deleteEmailSuppression
  'CAP_EMAIL_JOBS',             // scheduleEmailJob, claimDueEmailJobs,
                               // markEmailJobDone, markEmailJobFailed, listEmailJobs

  // Platform founder authorization
  'CAP_PLATFORM_OWNER',         // isPlatformOwner, requirePlatformOwner

  // Admin console and governance
  'CAP_ADMIN_CONSOLE',          // /v1/admin/* endpoints, PlatformAdminPage

  // Subscription management
  'CAP_SUBSCRIPTION_MANAGEMENT', // plan management, Paystack integration
]);

/**
 * PLANNED_CAPABILITIES — capabilities for features that are under
 * consideration or in development but are NOT yet implemented. Per the
 * design rules, these are NEVER granted, regardless of subscription tier,
 * founder status, or any other factor.
 *
 * This set is intentionally kept minimal. If a feature is not
 * in IMPLEMENTED_CAPABILITIES, it is effectively unavailable through the
 * entitlement layer. New capabilities should be added to IMPLEMENTED_CAPABILITIES
 * only when there is clear, tested server-side implementation.
 */
export const PLANNED_CAPABILITIES = new Set();

// Human-readable names for display purposes (not used for authorization).
// These are separate from the capability enforcement layer.
export const CAPABILITY_NAMES = Object.fromEntries([
  ['CAP_EMAIL_OUTBOX', 'Email outbox management'],
  ['CAP_EMAIL_EVENTS', 'Email event processing'],
  ['CAP_EMAIL_SUPPRESSIONS', 'Email suppression management'],
  ['CAP_EMAIL_JOBS', 'Email delivery job queue'],
  ['CAP_PLATFORM_OWNER', 'Platform founder authorization'],
  ['CAP_ADMIN_CONSOLE', 'Platform admin console access'],
  ['CAP_SUBSCRIPTION_MANAGEMENT', 'Subscription management'],
]);

/**
 * Returns true if the given capability string is an implemented capability.
 */
export function isImplementedCapability(cap) {
  return IMPLEMENTED_CAPABILITIES.has(cap);
}

/**
 * Returns true if the given capability string is a planned capability.
 */
export function isPlannedCapability(cap) {
  return PLANNED_CAPABILITIES.has(cap);
}

/**
 * Returns the intersection of two capability sets.
 */
function intersectCapabilities(a, b) {
  const result = new Set();
  for (const cap of a) {
    if (b.has(cap)) result.add(cap);
  }
  return new Set(result);
}

/**
 * Returns whether the first set is a subset of the second.
 */
function isSubsetOf(a, b) {
  if (a.size > b.size) return false;
  return [...a].every((cap) => b.has(cap));
}

/**
 * Returns whether two capability sets have any overlap.
 */
function hasOverlap(a, b) {
  return [...a].some((cap) => b.has(cap));
}

/**
 * Subscription-to-capability mappings.
 *
 * These mappings define which capabilities are associated with each
 * subscription plan. Note that actual access enforcement is founder-authoritative
 * (via CAP_PLATFORM_OWNER and requirePlatformOwner), not plan-gated. These
 * mappings are provided for informational purposes and potential future
 * plan-gated feature flags, but they MUST NOT be used to grant access
 * over and above the founder authorization model.
 *
 * The foundational design is: founder status (is_platform_owner) is
 * independent of and supersedes plan-based access.
 */
export const PLAN_CAPABILITY_MAPPINGS = Object.fromEntries([
  // Free plan: core capabilities only (no founder privileges)
  ['Free', new Set(['CAP_EMAIL_OUTBOX'])],

  // Starter plan: email outbox only
  ['Starter', new Set(['CAP_EMAIL_OUTBOX'])],

  // Growth plan: email outbox only
  ['Growth', new Set(['CAP_EMAIL_OUTBOX'])],

  // Business plan: email outbox + admin console
  ['Business', new Set(['CAP_EMAIL_OUTBOX', 'CAP_ADMIN_CONSOLE'])],

  // Enterprise plan: email outbox + all admin capabilities
  ['Enterprise', new Set(['CAP_EMAIL_OUTBOX', 'CAP_ADMIN_CONSOLE'])],
]);