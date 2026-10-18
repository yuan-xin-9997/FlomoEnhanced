import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { closeDatabase, getSchemaVersion, migrate, openDatabase } from '../src/db/index.js';
import { MIGRATIONS, SCHEMA_VERSION } from '../src/db/migrations.js';
import { newId } from '../src/lib/ids.js';

function tempDbPath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'flomo-db-test-'));
  return { dir, file: join(dir, 'test.db') };
}

describe('数据库与迁移', () => {
  it('openDatabase 自动建目录、开启 WAL 外键并完成迁移', () => {
    const { dir, file } = tempDbPath();
    const nested = join(dir, 'nested', 'deep', 'flomo.db');
    const db = openDatabase({ file: nested });
    try {
      assert.equal(getSchemaVersion(db), SCHEMA_VERSION);
      assert.equal(SCHEMA_VERSION, 1);
      assert.equal(MIGRATIONS.length, 1);
      const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      assert.equal(String(journal.journal_mode).toLowerCase(), 'wal');
      const fk = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      assert.equal(Number(fk.foreign_keys), 1);
      const busy = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
      assert.equal(Number(busy.timeout), 5000);
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
      void file;
    }
  });

  it('迁移幂等：重复 open 不会重复建表', () => {
    const { dir, file } = tempDbPath();
    const first = openDatabase({ file });
    const before = first.prepare('SELECT COUNT(*) AS c FROM sqlite_master').get() as { c: number };
    closeDatabase(first);

    const second = openDatabase({ file });
    try {
      const after = second.prepare('SELECT COUNT(*) AS c FROM sqlite_master').get() as { c: number };
      assert.equal(Number(after.c), Number(before.c));
      assert.equal(getSchemaVersion(second), SCHEMA_VERSION);
      assert.equal(migrate(second), SCHEMA_VERSION);
    } finally {
      closeDatabase(second);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('数据库版本高于代码版本时拒绝启动', () => {
    const { dir, file } = tempDbPath();
    const db = openDatabase({ file });
    try {
      db.exec('PRAGMA user_version = 99');
      assert.throws(() => migrate(db), /高于当前程序支持的版本/);
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('外键级联与唯一约束生效', () => {
    const { dir, file } = tempDbPath();
    const db = openDatabase({ file });
    try {
      const nowIso = new Date().toISOString();
      const userId = newId();
      db.prepare(
        'INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      ).run(userId, 'alice', 'h', 's', nowIso, nowIso);

      // 用户名大小写不敏感唯一
      assert.throws(() =>
        db
          .prepare(
            'INSERT INTO users (id, username, password_hash, password_salt, created_at, updated_at) VALUES (?,?,?,?,?,?)',
          )
          .run(newId(), 'ALICE', 'h', 's', nowIso, nowIso),
      );

      db.prepare(
        'INSERT INTO memos (id, user_id, template_id, content, values_json, tags_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
      ).run(newId(), userId, null, '无模板记录', '{}', '[]', nowIso, nowIso);

      const count = db.prepare('SELECT COUNT(*) AS c FROM memos WHERE user_id = ?').get(userId) as { c: number };
      assert.equal(Number(count.c), 1);

      // 删除用户级联删除 memo
      db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      const remaining = db.prepare('SELECT COUNT(*) AS c FROM memos WHERE user_id = ?').get(userId) as { c: number };
      assert.equal(Number(remaining.c), 0);
    } finally {
      closeDatabase(db);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('newId 生成 UUID', () => {
    const id = newId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(newId(), newId());
  });
});
