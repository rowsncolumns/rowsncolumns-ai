-- Migration: Create agent_operation_attributions table
-- Purpose: Custom key-value attribution tags for flexible filtering
-- Part of ShareDB Versioning Plan (Section 14.3)

CREATE TABLE IF NOT EXISTS agent_operation_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to parent operation
  operation_id UUID NOT NULL REFERENCES agent_operation_history(id) ON DELETE CASCADE,

  -- Key-value attribution pair
  k VARCHAR(255) NOT NULL,
  v VARCHAR(1024) NOT NULL,

  -- Timestamp (denormalized for query efficiency)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for filtering operations by custom attributions
CREATE INDEX IF NOT EXISTS idx_agent_operation_attributions_kv
  ON agent_operation_attributions (k, v);

-- Index for joining back to operations
CREATE INDEX IF NOT EXISTS idx_agent_operation_attributions_operation
  ON agent_operation_attributions (operation_id);

-- Composite index for common query pattern: find operations with specific attribution
CREATE INDEX IF NOT EXISTS idx_agent_operation_attributions_lookup
  ON agent_operation_attributions (k, v, operation_id);

COMMENT ON TABLE agent_operation_attributions IS 'Custom key-value attribution tags for flexible operation filtering';
COMMENT ON COLUMN agent_operation_attributions.k IS 'Attribution key, e.g., feature, experiment, requestId, toolCallId';
COMMENT ON COLUMN agent_operation_attributions.v IS 'Attribution value, e.g., dark-mode, exp_abc123, req_xyz';
