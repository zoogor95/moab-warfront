-- Refresh tokens for guest and linked accounts. Only a SHA-256 hash is stored, so a leaked
-- table cannot be used to sign in. Each refresh deletes the old row and inserts a new one.
CREATE TABLE refresh_tokens (
  token_hash  bytea PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id ON refresh_tokens (user_id);

-- The clock worker finds a match's pending timer by kind and match.
CREATE INDEX jobs_match ON jobs ((payload ->> 'matchId'));
