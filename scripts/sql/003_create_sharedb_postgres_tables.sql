CREATE TABLE IF NOT EXISTS ops (
  collection character varying(255) NOT NULL,
  doc_id character varying(255) NOT NULL,
  version integer NOT NULL,
  operation jsonb NOT NULL,
  PRIMARY KEY (collection, doc_id, version)
);

CREATE TABLE IF NOT EXISTS snapshots (
  collection character varying(255) NOT NULL,
  doc_id character varying(255) NOT NULL,
  doc_type character varying(255),
  version integer NOT NULL,
  data jsonb,
  metadata jsonb,
  PRIMARY KEY (collection, doc_id)
);

CREATE INDEX IF NOT EXISTS snapshots_version_idx
  ON snapshots (collection, doc_id);

ALTER TABLE ops
  ALTER COLUMN operation
  SET DATA TYPE jsonb
  USING operation::jsonb;

ALTER TABLE snapshots
  ALTER COLUMN data
  SET DATA TYPE jsonb
  USING data::jsonb;

ALTER TABLE snapshots
  ALTER COLUMN doc_type DROP NOT NULL;

ALTER TABLE snapshots
  ALTER COLUMN data DROP NOT NULL;

ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS metadata jsonb;
