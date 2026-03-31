-- Migration: Create agent_operation_history table
-- Purpose: Track all ShareDB document mutations for attribution and undo capability
-- Part of ShareDB Versioning Plan

-- Main operation history table
CREATE TABLE IF NOT EXISTS agent_operation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document identification
  collection VARCHAR(255) NOT NULL,
  doc_id VARCHAR(255) NOT NULL,

  -- Attribution: who did this
  source VARCHAR(50) NOT NULL CHECK (source IN ('agent', 'user', 'backend')),
  actor_type VARCHAR(50) NOT NULL,
  actor_id VARCHAR(255) NOT NULL,

  -- Activity classification
  activity_type VARCHAR(50) NOT NULL DEFAULT 'write' CHECK (activity_type IN ('write', 'rollback', 'restore')),

  -- Version tracking (from ShareDB)
  sharedb_version_from INTEGER NOT NULL,
  sharedb_version_to INTEGER NOT NULL,

  -- Operation data
  operation_kind VARCHAR(50) NOT NULL CHECK (operation_kind IN ('patch_tuples', 'raw_op')),
  operation_payload JSONB NOT NULL,  -- Contains forward + inverse data

  -- Extended metadata (threadId, runId, toolName, userId, sessionId, etc.)
  metadata JSONB DEFAULT '{}',

  -- For rollback/restore: which operations were affected
  target_operation_ids UUID[] DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Revert tracking
  reverted_at TIMESTAMPTZ,
  reverted_by_operation_id UUID REFERENCES agent_operation_history(id),
  revert_sharedb_version_from INTEGER,
  revert_sharedb_version_to INTEGER,

  -- Payload storage strategy (for large payloads)
  payload_storage VARCHAR(20) NOT NULL DEFAULT 'inline' CHECK (payload_storage IN ('inline', 's3')),
  payload_s3_key VARCHAR(512),
  payload_bytes INTEGER
);

-- Primary query index: fetch history for a document
CREATE INDEX IF NOT EXISTS idx_agent_operation_history_doc_created
  ON agent_operation_history (doc_id, created_at DESC);

-- Partial index for pending (unreversed) operations
CREATE INDEX IF NOT EXISTS idx_agent_operation_history_pending
  ON agent_operation_history (doc_id, created_at DESC)
  WHERE reverted_at IS NULL;

-- Index for activity type filtering
CREATE INDEX IF NOT EXISTS idx_agent_operation_history_activity_type
  ON agent_operation_history (doc_id, activity_type, created_at DESC);

-- Index for actor-based queries
CREATE INDEX IF NOT EXISTS idx_agent_operation_history_actor
  ON agent_operation_history (doc_id, actor_id, created_at DESC);

-- Add comment for documentation
COMMENT ON TABLE agent_operation_history IS 'Tracks all ShareDB document mutations for attribution, audit, and undo capability';
COMMENT ON COLUMN agent_operation_history.source IS 'Origin of the operation: agent (AI), user (human), or backend (system)';
COMMENT ON COLUMN agent_operation_history.operation_payload IS 'JSON containing forward operation and inverse operation for undo';
COMMENT ON COLUMN agent_operation_history.target_operation_ids IS 'For rollback/restore: IDs of operations being reverted or restored';
