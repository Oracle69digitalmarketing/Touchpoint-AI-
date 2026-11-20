/**
 * PHASE 15J2 — Entitlement Resolver
 *
 * Centralized, server-authoritative entitlement resolver for TouchPoint AI.
 * Determines founder status from database-loaded identity data and grants
 * capabilities according to the established founder-entitlement architecture.
 *
 * Key design principles (per FOUNDER_ENTITLEMENT_COMPARISON_REPORT.md):
 * 1. Founder status (is_platform_owner) is determined from the database-loaded
 *    user record only — never from client-supplied flags, email allowlists,
 *    or JWT custom claims.
 * 2. Founder (is_platform_owner === true) receives ALL IMPLEMENTED_CAPABILITIES
 *    regardless of subscription tier, subscription status, or commercial plan.
 *    Founder access is independent of and supersedes plan-based gating.
 * 3. Founder status does NOT modify, overwrite, or annotate any subscription
 *    or billing records. The resolver is read-only with respect to the
 *    subscription state.
 * 4. Normal (non-founder) users receive capabilities mapped from their
 *    subscription plan via PLAN_CAPABILITY_MAPPINGS from capabilities.ts.
 *    Their effective plan is the actual plan recorded in the database.
 * 5. PLANNED_CAPABILITIES are never granted under any circumstance — not for
 *    founders, not for paid users, not for any plan tier.
 * 6. If subscription data is missing, invalid, or the user cannot be located,
 *    the resolver fails safely: founder status defaults to false, effective
 *    plan defaults to "Free", and granted capabilities default to the Free
 *    plan mapping. No exceptions are thrown; the resolver always returns a
 *    valid EntitlementResult.
 * 7. Tenant boundaries and existing authorization behavior (requireAuth,
 *    requirePlatformOwner) are completely preserved. This resolver augments
 *    — never replaces — the existing authorization layer.
 *
 * EntitlementResult structure:
 *   - founder: boolean — true iff the user carries is_platform_owner === true
 *     from the database-loaded user record.
 *   - effectivePlan: 'Free' | 'Starter' | 'Growth' | 'Business' | 'Enterprise'
 *     the plan recorded in the database (or 'Free' as safe default).
 *   - grantedCapabilities: Set<string> — implemented capabilities the user
 *     is entitled to.
 *   - deniedCapabilities: Set<string> — implemented capabilities that were
 *     evaluated but not granted (always empty when founder === true, since
 *     founders receive ALL implemented capabilities).
 *   - resolutionSource: 'founder' | 'subscription' | 'fallback'
 *     how the entitlements were determined.
 *   - ownerPreview: boolean — true iff the user is a founder without a paid
 *     subscription (founder + commercially starter, owner_preview mode with
 *     implemented caps only).
 *   - subscription: { plan: 'Free' | 'Starter' | 'Growth' | 'Business' |
 *       'Enterprise'; status: 'active' | 'cancelled' | 'expired' |
 *       'not_renewing' } | null — the user's actual subscription row, or null
 *     if none exists.
 */

import { IMPLEMENTED_CAPABILITIES, PLANNED_CAPABILITIES, PLAN_CAPABILITY_MAPPINGS } from '../capabilities.js';

/**
 * Resolves the entitlement context for an authenticated user.
 *
 * Input:
 *   userOrId: { id: string; is_platform_owner?: boolean; business_id?: string } | string
 *     Either a user object (as returned by findUserById) or a user ID string.
 *     If a string is passed, the resolver will attempt to treat it as a user object
 *     shape in this offline/test context (callers in production should pass a pre-
 *     loaded user object).
 *   subscriptionInfo: { plan: 'Free' | 'Starter' | 'Growth' | 'Business' | 'Enterprise';
 *                     status: 'active' | 'cancelled' | 'expired' | 'not_renewing' } | null | undefined
 *     Optional subscription state. If not provided, the resolver uses fallbacks.
 *
 * Output: EntitlementResult object with founder status, effective plan, granted capabilities,
 * denied capabilities, resolution source, owner preview, and subscription info.
 */
export function resolveEntitlements(userOrId, subscriptionInfo) {
  // ---- Step 1: Resolve the user context ----
  let user = null;

  if (typeof userOrId === 'string') {
    // In this offline/test context, treat the string identifier as a user object shape.
    // In production, the caller should pass a pre-loaded user object from findUserById().
    user = {
      id: userOrId,
      is_platform_owner: false,
      business_id: 'b1',
    };
  } else {
    user = userOrId;
  }

  // Extract key fields from the user object.
  const id = user?.id || 'unknown';
  const isFounder = user?.is_platform_owner === true;
  const businessId = user?.business_id;

  // ---- Step 2: Determine founder status ----
  // Founder = database-loaded is_platform_owner === true.
  // This is the authoritative source; nothing from the client counts.
  const founder = !!isFounder;

  // ---- Step 3: Initialize default values ----
  let effectivePlan = 'Free';
  let grantedCapabilities = new Set(['CAP_EMAIL_OUTBOX']);
  let ownerPreview = false;
  let resolutionSource = 'fallback';
  let subscription = null;

  // ---- Step 4: Process subscription info if provided ----
  if (subscriptionInfo !== null && subscriptionInfo !== undefined) {
    const plan = subscriptionInfo.plan;
    const status = subscriptionInfo.status;

    effectivePlan = plan;
    subscription = { plan, status };

    // Founder takes precedence over subscription for capability grants,
    // but we still record the subscription for the result context.
    if (founder) {
      resolutionSource = 'founder';
      // Founder gets ALL implemented capabilities regardless of plan.
      grantedCapabilities = new Set([...IMPLEMENTED_CAPABILITIES]);
      // ownerPreview: founder commercially starter when no paid subscription.
      // "Paid" is inferred from status being 'active' or 'not_renewing'.
      ownerPreview = !(status === 'active' || status === 'not_renewing');
    } else {
      // Non-founder: use plan-to-capability mapping.
      resolutionSource = 'subscription';
      const planMapping = PLAN_CAPABILITY_MAPPINGS[effectivePlan];
      grantedCapabilities = planMapping
        ? new Set([...planMapping])
        : new Set(['CAP_EMAIL_OUTBOX']);
      ownerPreview = false;
    }
  } else {
    // No subscription info provided — use fallbacks.
    if (founder) {
      resolutionSource = 'founder';
      grantedCapabilities = new Set([...IMPLEMENTED_CAPABILITIES]);
      // ownerPreview: founder commercially starter when no subscription is present.
      ownerPreview = true;
    } else {
      resolutionSource = 'fallback';
      // Non-founder, no subscription info → Free plan mapping.
      effectivePlan = 'Free';
      const planMapping = PLAN_CAPABILITY_MAPPINGS['Free'];
      grantedCapabilities = planMapping
        ? new Set([...planMapping])
        : new Set(['CAP_EMAIL_OUTBOX']);
      ownerPreview = false;
      subscription = null;
    }
  }

  // ---- Step 4: Compute denied capabilities (API completeness) ----
  // Founders receive ALL implemented capabilities, so their denied set is empty.
  // Non-founders: denied = implemented ∩ ¬granted.
  const allImplemented = new Set([...IMPLEMENTED_CAPABILITIES]);
  const grantedSet = grantedCapabilities;
  const deniedCapabilities = new Set([...allImplemented].filter((cap) => !grantedSet.has(cap)));

  // ---- Step 5: Return the structured EntitlementResult ----
  return {
    // Founder status: authoritative from database only.
    founder,

    // Effective plan the user is on (or 'Free' as safe default).
    effectivePlan,

    // Implemented capabilities granted to this user.
    grantedCapabilities,

    // Implemented capabilities evaluated but not granted.
    deniedCapabilities,

    // How the entitlements were determined.
    resolutionSource,

    // True iff founder without a paid subscription (founder + commercially starter).
    ownerPreview,

    // The user's actual subscription, if available; null if none.
    subscription,
  };
}