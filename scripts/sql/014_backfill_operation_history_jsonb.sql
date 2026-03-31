-- Migration: Backfill incorrectly stringified JSONB fields
-- Purpose: Convert operation_payload/metadata JSON strings into JSON objects
-- Safe to run multiple times

DO $$
DECLARE
  row_record RECORD;
BEGIN
  -- Backfill operation_payload values that are stored as JSON strings
  FOR row_record IN
    SELECT id, operation_payload #>> '{}' AS json_text
    FROM agent_operation_history
    WHERE jsonb_typeof(operation_payload) = 'string'
  LOOP
    BEGIN
      UPDATE agent_operation_history
      SET operation_payload = row_record.json_text::jsonb
      WHERE id = row_record.id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping operation_payload backfill for id=% (invalid JSON text)', row_record.id;
    END;
  END LOOP;

  -- Backfill metadata values that are stored as JSON strings
  FOR row_record IN
    SELECT id, metadata #>> '{}' AS json_text
    FROM agent_operation_history
    WHERE jsonb_typeof(metadata) = 'string'
  LOOP
    BEGIN
      UPDATE agent_operation_history
      SET metadata = row_record.json_text::jsonb
      WHERE id = row_record.id;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE NOTICE 'Skipping metadata backfill for id=% (invalid JSON text)', row_record.id;
    END;
  END LOOP;
END $$;
