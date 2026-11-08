/** Canonical DDL. Mirrors docs/03-data-model.md; change both together. */

export const SCHEMA_VERSION = 1

export const DDL = `
CREATE TABLE facts (
  id             TEXT PRIMARY KEY,
  subject        TEXT NOT NULL,
  predicate      TEXT NOT NULL,
  object         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('active','superseded','decayed')),
  weight         REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0.0 AND weight <= 1.0),
  valid_from     INTEGER NOT NULL,
  valid_until    INTEGER,
  superseded_by  TEXT REFERENCES facts(id) DEFERRABLE INITIALLY DEFERRED,
  created_at     INTEGER NOT NULL,
  source_session TEXT,
  metadata       TEXT,
  CHECK (valid_until IS NULL OR valid_until > valid_from)
) STRICT;

CREATE UNIQUE INDEX ux_facts_one_active
  ON facts(subject, predicate)
  WHERE status = 'active' AND valid_until IS NULL;

CREATE INDEX ix_facts_pair ON facts(subject, predicate);
CREATE INDEX ix_facts_current ON facts(status, valid_until);
CREATE INDEX ix_facts_valid_from ON facts(valid_from);

CREATE TABLE fact_relations (
  from_fact_id  TEXT NOT NULL REFERENCES facts(id),
  to_fact_id    TEXT NOT NULL REFERENCES facts(id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('SUPERSEDES','TRANSFERS_TO','DECAYS_FROM')),
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (from_fact_id, to_fact_id, relation_type)
) STRICT;

CREATE INDEX ix_rel_to ON fact_relations(to_fact_id);

CREATE TABLE adjudication_log (
  id                TEXT PRIMARY KEY,
  subject           TEXT NOT NULL,
  predicate         TEXT NOT NULL,
  conflict_fact_ids TEXT NOT NULL,
  chosen_strategy   TEXT NOT NULL CHECK (chosen_strategy IN ('supersede','versioned_transfer','weighted_decay')),
  result_fact_id    TEXT NOT NULL REFERENCES facts(id),
  reason            TEXT NOT NULL,
  created_at        INTEGER NOT NULL
) STRICT;

CREATE INDEX ix_log_pair ON adjudication_log(subject, predicate, created_at);

CREATE TABLE schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
`
