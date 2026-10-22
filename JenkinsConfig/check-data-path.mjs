// 部署只保护 .data/；其他位于部署目录内的数据路径必须在同步前拒绝。
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

function isUnprotected(root, dbPath) {
  const location = relative(root, dbPath);
  const inside = location === '' || (!isAbsolute(location) && location !== '..' && !location.startsWith(`..${sep}`));
  return inside && !location.startsWith(`.data${sep}`);
}

function canonicalPath(path) {
  try { return realpathSync(path); }
  catch (error) {
    if (error.code !== 'ENOENT' || lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(canonicalPath(parent), basename(path));
  }
}

export function assertProtectedDataPath(deployRoot, env = {}) {
  const root = resolve(deployRoot);
  const dataDir = resolve(root, env.FLOMO_DATA_DIR?.trim() || '.data');
  const dbPath = resolve(dataDir, env.FLOMO_DB_FILE?.trim() || 'flomoenhanced.db');
  if (isUnprotected(root, dbPath) || isUnprotected(canonicalPath(root), canonicalPath(dbPath))) {
    throw new Error('数据库位于部署目录内未受保护的位置，已拒绝同步。请将数据库移到 .data/ 或部署目录外，再更新 FLOMO_DATA_DIR/FLOMO_DB_FILE。');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) throw new Error('需要指定部署目录');
  let env = {};
  try { env = parseEnv(readFileSync(resolve(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assertProtectedDataPath(root, env);
}
