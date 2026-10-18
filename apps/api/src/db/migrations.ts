/**
 * 数据库迁移（SPEC §5）。数组下标 + 1 即版本号，写入 `PRAGMA user_version`。
 * 已发布的迁移**永不修改**，只追加新元素。
 */

/** v1：用户、会话、模板、想法四张表 */
const V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'scrypt',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  fields_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (user_id, name)
);
CREATE INDEX idx_templates_user ON templates(user_id, archived_at);

CREATE TABLE memos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  values_json TEXT NOT NULL DEFAULT '{}',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_memos_user_created ON memos(user_id, deleted_at, created_at DESC);
CREATE INDEX idx_memos_user_template ON memos(user_id, template_id, created_at DESC);
`;

/** 全部迁移，索引 0 为 v1 */
export const MIGRATIONS: string[] = [V1];

/** 当前代码支持的架构版本 */
export const SCHEMA_VERSION = MIGRATIONS.length;
