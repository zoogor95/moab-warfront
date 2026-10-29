-- Phase 2 schema from the design doc's Data model section.
-- Seats are 0-based here, as in the engine; the UI shows them as 1-6.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 32),
  notify_prefs  jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A guest is a user with no login rows yet.
CREATE TABLE user_logins (
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN ('email', 'google', 'apple', 'discord')),
  provider_id  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_id)
);
CREATE INDEX user_logins_user_id ON user_logins (user_id);

CREATE TABLE push_tokens (
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform    text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user_id ON push_tokens (user_id);

CREATE TABLE matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9]{6}$'),
  host_id             uuid NOT NULL REFERENCES users (id),
  status              text NOT NULL DEFAULT 'lobby'
                      CHECK (status IN ('lobby', 'picking', 'playing', 'finished')),
  settings            jsonb NOT NULL,
  -- Bumped by exactly one per accepted action: UPDATE ... SET rev = rev + 1 WHERE id = $1 AND rev = $2.
  rev                 integer NOT NULL DEFAULT 0 CHECK (rev >= 0),
  round               integer NOT NULL DEFAULT 0,
  active_seat         integer NOT NULL DEFAULT 0 CHECK (active_seat BETWEEN 0 AND 5),
  turn_deadline       timestamptz,
  discord_channel_id  text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
-- Finds overdue turns.
CREATE INDEX matches_status_deadline ON matches (status, turn_deadline);
CREATE INDEX matches_host_id ON matches (host_id);

CREATE TABLE seats (
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  seat        integer NOT NULL CHECK (seat BETWEEN 0 AND 5),
  user_id     uuid REFERENCES users (id),  -- null for a bot
  colour      text NOT NULL CHECK (colour ~ '^#[0-9A-F]{6}$'),
  emblem      text NOT NULL
              CHECK (emblem IN ('circle', 'triangle', 'square', 'diamond', 'hexagon', 'star')),
  ready       boolean NOT NULL DEFAULT false,
  alive       boolean NOT NULL DEFAULT true,
  start_pick  text,  -- city id; never sent to other seats before turn 1
  PRIMARY KEY (match_id, seat),
  UNIQUE (match_id, colour),
  UNIQUE (match_id, emblem)
);
-- One seat per person per match.
CREATE UNIQUE INDEX seats_match_user ON seats (match_id, user_id) WHERE user_id IS NOT NULL;
-- The home screen's match list.
CREATE INDEX seats_user_id ON seats (user_id);

CREATE TABLE match_actions (
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  rev         integer NOT NULL CHECK (rev > 0),
  seat        integer NOT NULL CHECK (seat BETWEEN 0 AND 5),
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, rev)
);

-- Full GameState at each turn start; recovery replays match_actions after the latest one.
CREATE TABLE match_snapshots (
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  rev         integer NOT NULL CHECK (rev >= 0),
  round       integer NOT NULL,
  state       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, rev)
);

-- Turn deadlines and outgoing notifications, claimed with FOR UPDATE SKIP LOCKED.
CREATE TABLE jobs (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind          text NOT NULL,
  run_at        timestamptz NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  locked_until  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_run_at ON jobs (run_at);
