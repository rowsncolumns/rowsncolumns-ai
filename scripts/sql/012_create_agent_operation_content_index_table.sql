-- Migration: Create agent_operation_content_index table
-- Purpose: Fine-grained content attribution for selective rollback by affected content
-- Part of ShareDB Versioning Plan (Section 8)

CREATE TABLE IF NOT EXISTS agent_operation_content_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to parent operation
  operation_id UUID NOT NULL REFERENCES agent_operation_history(id) ON DELETE CASCADE,

  -- Document context
  doc_id VARCHAR(255) NOT NULL,
  sheet_id VARCHAR(255),  -- Nullable for document-level changes

  -- Content selector (canonical path/range)
  -- Examples: "sheet:1!A1:C4", "sheet:0!B2", "properties.title"
  content_selector VARCHAR(512) NOT NULL,

  -- Type of change
  change_kind VARCHAR(50) NOT NULL CHECK (change_kind IN ('insert', 'update', 'delete', 'format', 'structure')),

  -- Timestamp (denormalized for query efficiency)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying what changed in a document
CREATE INDEX IF NOT EXISTS idx_agent_operation_content_index_doc
  ON agent_operation_content_index (doc_id, created_at DESC);

-- Index for querying changes to specific content
CREATE INDEX IF NOT EXISTS idx_agent_operation_content_index_selector
  ON agent_operation_content_index (doc_id, content_selector, created_at DESC);

-- Index for joining back to operations
CREATE INDEX IF NOT EXISTS idx_agent_operation_content_index_operation
  ON agent_operation_content_index (operation_id);

-- Index for sheet-specific queries
CREATE INDEX IF NOT EXISTS idx_agent_operation_content_index_sheet
  ON agent_operation_content_index (doc_id, sheet_id, created_at DESC)
  WHERE sheet_id IS NOT NULL;

COMMENT ON TABLE agent_operation_content_index IS 'Content-level attribution index for fine-grained rollback by affected cells/ranges';
COMMENT ON COLUMN agent_operation_content_index.content_selector IS 'Canonical path like sheet:1!A1:C4 or properties.title';
COMMENT ON COLUMN agent_operation_content_index.change_kind IS 'Type of change: insert, update, delete, format, or structure';
