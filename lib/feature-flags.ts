/**
 * Feature Flag System
 *
 * Simple environment-based feature flags for gradual rollout.
 * Can be extended to use LaunchDarkly, Statsig, etc. later.
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

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === "") return defaultValue;
  return value.toLowerCase() === "true" || value === "1";
}

function parseTrackingMode(value: string | undefined): TrackingMode {
  if (value === "blocking" || value === "async" || value === "shadow") {
    return value;
  }
  return "shadow"; // Default to safest mode
}

/**
 * Get current feature flags from environment.
 * All flags default to OFF for safety.
 */
export function getFeatureFlags(): FeatureFlags {
  return {
    // Master switch - default OFF
    enableOperationTracking: parseBoolean(
      process.env.FEATURE_ENABLE_OPERATION_TRACKING,
      false
    ),

    // Per-source controls - default OFF
    enableOperationTrackingForAgents: parseBoolean(
      process.env.FEATURE_ENABLE_OPERATION_TRACKING_AGENTS,
      false
    ),
    enableOperationTrackingForUsers: parseBoolean(
      process.env.FEATURE_ENABLE_OPERATION_TRACKING_USERS,
      false
    ),
    enableOperationTrackingForBackend: parseBoolean(
      process.env.FEATURE_ENABLE_OPERATION_TRACKING_BACKEND,
      false
    ),

    // Tracking mode - default to shadow (safest)
    trackingMode: parseTrackingMode(process.env.FEATURE_TRACKING_MODE),

    // UI features - default OFF
    enableHistoryPanel: parseBoolean(
      process.env.FEATURE_ENABLE_HISTORY_PANEL,
      false
    ),

    // API features - default OFF
    enableRollbackApi: parseBoolean(
      process.env.FEATURE_ENABLE_ROLLBACK_API,
      false
    ),
    enableActivityApi: parseBoolean(
      process.env.FEATURE_ENABLE_ACTIVITY_API,
      false
    ),
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
 * Singleton for caching flags (refreshed on each call in dev, cached in prod).
 * In production, consider caching with a TTL or using a proper flag service.
 */
let cachedFlags: FeatureFlags | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 1 minute cache in production

export function getFlags(): FeatureFlags {
  const now = Date.now();
  const isDev = process.env.NODE_ENV === "development";

  // In dev, always refresh. In prod, cache for TTL.
  if (isDev || cachedFlags === null || now - cacheTimestamp > CACHE_TTL_MS) {
    cachedFlags = getFeatureFlags();
    cacheTimestamp = now;
  }

  return cachedFlags;
}

/**
 * Clear the flag cache (useful for testing).
 */
export function clearFlagCache(): void {
  cachedFlags = null;
  cacheTimestamp = 0;
}
