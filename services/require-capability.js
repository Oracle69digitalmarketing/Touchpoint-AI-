/**
 * PHASE 15J2 — requireCapability() middleware
 *
 * Server-side middleware that authorizes route access based on
 * server-authoritative capability entitlements.
 *
 * Design principles (per FOUNDER_ENTITLEMENT_COMPARISON_REPORT.md):
 * 1. Founder status (is_platform_owner) is determined from the
 *    database-loaded user record only — never from client-supplied
 *    flags, email allowlists, or JWT custom claims.
 * 2. Founder (is_platform_owner === true) receives ALL
 *    IMPLEMENTED_CAPABILITIES regardless of subscription tier,
 *    subscription status, or commercial plan. Founder access is
 *    independent of and supersedes plan-based gating.
 * 3. Normal (non-founder) users receive capabilities mapped from
 *    their subscription plan via PLAN_CAPABILITY_MAPPINGS.
 * 4. PLANNED_CAPABILITIES are never granted under any circumstance.
 * 5. No client-supplied flag can elevate privileges.
 * 6. The middleware preserves existing authentication requirements
 *    and tenant/business scoping. It runs AFTER requireAuth.
 */

import { IMPLEMENTED_CAPABILITIES } from '../capabilities.js';
import { resolveEntitlements } from './entitlements.js';

/**
 * requireCapability() middleware.
 *
 * Usage in Express routes:
 *   app.get('/v1/featured', requireCapability('CAP_EMAIL_OUTBOX'), asyncHandler(async (req, res) => { ... }));
 *
 * The middleware:
 * 1. Resolves entitlements from the authenticated user record.
 * 2. Allows access if the requested capability is in the user's granted set.
 * 3. Returns 403 with a descriptive message if the capability is denied.
 * 4. Handles missing/invalid entitlement data safely (fails closed).
 * 5. Preserves existing requireAuth and tenant scoping.
 *
 * @param {string} capability - The capability name to check (e.g. 'CAP_EMAIL_OUTBOX').
 * @returns {function} Express handler function.
 */
export function requireCapability(capability) {
  // Validate that the requested capability is a known implemented capability.
  // This prevents arbitrary capability strings from being passed.
  if (!IMPLEMENTED_CAPABILITIES.has(capability)) {
    return (req, res, next) => {
      return res.status(400).json({
        error: 'Invalid capability',
        message: ` '${capability}' is not a recognized implemented capability.`,
      });
    };
  }

  return async function innerMiddleware(req, res, next) {
    try {
      // Resolve entitlements from the authenticated user.
      // In production, req.user is populated by requireAuth via findUserById().
      // We pass the user object and subscription info if available.
      const subscriptionInfo = req.subscriptionInfo; // optional, set by route if known

      const entitlements = await resolveEntitlements(req.user, subscriptionInfo);

      // Check if the requested capability is in the granted set.
      // Founders (founder === true) have ALL implemented capabilities,
      // so the check will pass for any implemented capability.
      // Non-founders are checked against their plan mapping.
      const grantedCapabilities = entitlements.grantedCapabilities;
      const founder = entitlements.founder;

      if (grantedCapabilities.has(capability)) {
        // Capability granted — proceed to the next handler.
        return next();
      }

      // Capability denied — return 403 with a consistent error format.
      // We include information about the effective plan and founder status
      // to help with debugging, but never leak internal details.
      const statusCode = 403;
      const errorMessage =
        founder
          ? 'Founder access verified, but this capability is not yet implemented for this use case.'
          : 'Insufficient permissions. Your subscription plan does not include this capability.';

      return res.status(statusCode).json({
        error: 'Forbidden',
        message: errorMessage,
        // Include minimal debug info (optional, can be removed in production).
        // founder: entitlements.founder,
        // effectivePlan: entitlements.effectivePlan,
      });
    } catch (error) {
        return res.status(500).json({
          error: "Internal Server Error",
          message: "Failed to resolve capabilities."
        });
      }
  }
}

export default requireCapability;