/**
 * Feature Flag System
 *
 * Runtime defaults for operation history behavior with a single master switch.
 * Audit visibility and persistence are gated by user plan/admin access checks.
 */

export type TrackingMode = "shadow" | "async" | "blocking";

export interface FeatureFlags {
  // Operation tracking master switch
  enableOperationTracking: boolean;

  // Per-source tracking controls
  enableOperationTrackingForAgents: boolean;
  enableOperationTrackingForUsers: boolean;
  enableOperationTrackingForBackend: boolean;

  // Tracking mode (shadow = log only, async = fire-and-forget, blocking = must succeed)
  trackingMode: TrackingMode;

  // UI features
  enableHistoryPanel: boolean;

  // API features
  enableRollbackApi: boolean;
  enableActivityApi: boolean;
}

const MASTER_SWITCH_ENV = "FEATURE_ENABLE_OPERATION_HISTORY";

const parseMasterSwitch = (value: string | undefined): boolean => {
  if (value === undefined || value.trim() === "") {
    return true;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
};

/**
 * Get current feature flags.
 * This is intentionally env-agnostic; entitlement checks enforce plan behavior.
 */
export function getFeatureFlags(): FeatureFlags {
  const enabled = parseMasterSwitch(process.env[MASTER_SWITCH_ENV]);
  return {
    enableOperationTracking: enabled,
    enableOperationTrackingForAgents: enabled,
    enableOperationTrackingForUsers: enabled,
    enableOperationTrackingForBackend: enabled,
    trackingMode: "async",
    enableHistoryPanel: enabled,
    enableRollbackApi: enabled,
    enableActivityApi: enabled,
  };
}

/**
 * Check if tracking is enabled for a specific source.
 */
export function isTrackingEnabledForSource(
  source: "agent" | "user" | "backend",
  flags?: FeatureFlags
): boolean {
  const f = flags ?? getFeatureFlags();

  if (!f.enableOperationTracking) {
    return false;
  }

  switch (source) {
    case "agent":
      return f.enableOperationTrackingForAgents;
    case "user":
      return f.enableOperationTrackingForUsers;
    case "backend":
      return f.enableOperationTrackingForBackend;
    default:
      return false;
  }
}

/**
 * Singleton for compatibility with existing call sites.
 */
let cachedFlags: FeatureFlags | null = null;

export function getFlags(): FeatureFlags {
  if (cachedFlags === null) {
    cachedFlags = getFeatureFlags();
  }

  return cachedFlags;
}

/**
 * Clear the flag cache (useful for testing).
 */
export function clearFlagCache(): void {
  cachedFlags = null;
}
