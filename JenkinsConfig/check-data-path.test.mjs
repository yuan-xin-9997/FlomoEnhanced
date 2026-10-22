import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { assertProtectedDataPath } from './check-data-path.mjs';

const root = resolve('flomo-deploy-test');
test('默认数据目录和部署目录外的数据库允许同步', () => {
  assert.doesNotThrow(() => assertProtectedDataPath(root));
  assert.doesNotThrow(() => assertProtectedDataPath(root, { FLOMO_DATA_DIR: '.data/custom' }));
  assert.doesNotThrow(() => assertProtectedDataPath(root, { FLOMO_DATA_DIR: '../userdata' }));
  assert.doesNotThrow(() => assertProtectedDataPath(root, { FLOMO_DB_FILE: resolve(root, '../external/custom.sqlite') }));
});
test('自定义数据库在部署目录内但不受保护时拒绝同步', () => {
  for (const env of [
    { FLOMO_DATA_DIR: 'userdata' },
    { FLOMO_DB_FILE: resolve(root, 'custom.sqlite') },
    { FLOMO_DB_FILE: '../flomo.db' },
    { FLOMO_DATA_DIR: '.data-other' },
  ]) assert.throws(() => assertProtectedDataPath(root, env), /拒绝同步/);
});

for (const [name, linkPath, targetPath, dataDir, rejected] of [
  ['.data 指向内部未保护目录', 'deploy/.data', 'deploy/userdata', '.data', true],
  ['外部目录指回部署目录内部', 'external-link', 'deploy/userdata', 'external-link', true],
  ['.data 指向外部目录', 'deploy/.data', 'external-data', '.data', false],
  ['内部未保护路径指向外部仍拒绝', 'deploy/userdata', 'external-data', 'userdata', true],
]) {
  test(name, (t) => {
    const scratch = mkdtempSync(join(tmpdir(), 'flomo-deploy-path-'));
    assert.equal(dirname(scratch), resolve(tmpdir()));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const deploy = join(scratch, 'deploy');
    const target = join(scratch, targetPath);
    mkdirSync(deploy);
    mkdirSync(target, { recursive: true });
    try { symlinkSync(target, join(scratch, linkPath), process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('当前环境无创建符号链接权限'); return; }
      throw error;
    }
    const env = { FLOMO_DATA_DIR: dataDir === 'external-link' ? join(scratch, dataDir) : dataDir };
    for (const fileExists of [false, true]) {
      if (fileExists) writeFileSync(join(target, 'flomoenhanced.db'), 'fixture');
      if (rejected) assert.throws(() => assertProtectedDataPath(deploy, env), /拒绝同步/);
      else assert.doesNotThrow(() => assertProtectedDataPath(deploy, env));
    }
  });
}
