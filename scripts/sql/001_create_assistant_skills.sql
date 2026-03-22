CREATE TABLE IF NOT EXISTS assistant_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_skills_name_not_empty CHECK (char_length(trim(name)) > 0),
  CONSTRAINT assistant_skills_instructions_not_empty CHECK (char_length(trim(instructions)) > 0)
);

CREATE INDEX IF NOT EXISTS assistant_skills_user_workspace_updated_idx
  ON assistant_skills (user_id, workspace_id, updated_at DESC);
