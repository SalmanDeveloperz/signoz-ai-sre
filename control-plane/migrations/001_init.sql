CREATE TABLE IF NOT EXISTS control_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incidents (
  id                   SERIAL PRIMARY KEY,
  started_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at          TIMESTAMPTZ,
  detected_via         TEXT NOT NULL,
  diagnosis            TEXT NOT NULL,
  action_taken         TEXT NOT NULL,
  safety_check_result  TEXT NOT NULL,
  cost_before          NUMERIC,
  cost_after           NUMERIC
);
