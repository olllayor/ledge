-- Ledge D1 initial schema
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_otps (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_otps_email ON auth_otps (email);
CREATE INDEX idx_auth_otps_email_code ON auth_otps (email, code_hash);
CREATE INDEX idx_auth_otps_email_created ON auth_otps (email, created_at DESC);
CREATE INDEX idx_auth_otps_expires ON auth_otps (expires_at);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL,
  last_refreshed_at INTEGER
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX idx_auth_sessions_expires ON auth_sessions (expires_at);
CREATE INDEX idx_auth_sessions_revoked ON auth_sessions (revoked_at);

CREATE TABLE devices (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device_id)
);
CREATE INDEX idx_devices_user ON devices (user_id);

CREATE TABLE shelves (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shelf_id TEXT NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL CHECK (color IN ('ember', 'wave', 'forest', 'sand')),
  origin TEXT NOT NULL CHECK (origin IN ('shake', 'tray', 'shortcut', 'manual', 'restore')),
  items_json TEXT NOT NULL DEFAULT '[]',
  local_created_at TEXT NOT NULL,
  local_updated_at TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  image_storage_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, shelf_id)
);
CREATE INDEX idx_shelves_user_updated ON shelves (user_id, updated_at DESC);

CREATE TABLE shelf_items (
  team_id TEXT NOT NULL DEFAULT '',
  shelf_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL DEFAULT '',
  preview_json TEXT NOT NULL,
  order_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  server_updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (team_id, shelf_id, item_id)
);
CREATE INDEX idx_shelf_items_team_shelf ON shelf_items (team_id, shelf_id, server_updated_at);
CREATE INDEX idx_shelf_items_deleted ON shelf_items (team_id, shelf_id, deleted_at);

CREATE TABLE preferences (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  values_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE entitlements (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive', 'pastDue', 'cancelled')),
  ls_customer_id TEXT,
  ls_subscription_id TEXT,
  ls_order_id TEXT,
  ls_license_key TEXT,
  renews_at INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE image_assets (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  shelf_id TEXT NOT NULL DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_image_assets_user ON image_assets (user_id);
CREATE INDEX idx_image_assets_r2 ON image_assets (r2_key);

CREATE TABLE image_upload_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_flight', 'resolved', 'abandoned')),
  r2_key TEXT,
  created_at INTEGER NOT NULL,
  resolved_asset_id TEXT
);
CREATE INDEX idx_upload_events_user_status ON image_upload_events (user_id, status);
CREATE INDEX idx_upload_events_created ON image_upload_events (created_at);

CREATE TABLE teams (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users (id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE team_members (
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX idx_team_members_user ON team_members (user_id);

CREATE TABLE team_invitations (
  id TEXT PRIMARY KEY NOT NULL,
  team_id TEXT NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX idx_invites_email_status ON team_invitations (email, status);
CREATE INDEX idx_invites_team ON team_invitations (team_id);

CREATE TABLE processed_webhook_events (
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (source, event_id)
);
CREATE INDEX idx_webhook_events_processed ON processed_webhook_events (processed_at);

CREATE TABLE sync_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id TEXT,
  type TEXT NOT NULL,
  message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sync_events_user ON sync_events (user_id, created_at DESC);
