/**
 * id 生成（SPEC §5）：统一使用 `crypto.randomUUID()`。
 */
import { randomUUID } from 'node:crypto';

/** 生成新的实体 id（UUID v4） */
export function newId(): string {
  return randomUUID();
}
