/**
 * 标签提取（SPEC §8.3）—— 前后端一致。
 */

/** `#标签` 提取正则（SPEC §8.3 原文） */
export const TAG_PATTERN = /#([^\s#,，。；;：:!！?？()（）[\]【】{}<>《》"'’“”]+)/g;

/** 单标签最大字符数 */
export const MAX_TAG_LENGTH = 50;

/** 单条 memo 最多标签数 */
export const MAX_TAGS_PER_MEMO = 50;

/** 规范化单个标签：去掉前缀 `#`、trim、按 code point 截断到 50 字符 */
export function normalizeTag(raw: string): string {
  let tag = raw.trim();
  while (tag.startsWith('#')) tag = tag.slice(1).trim();
  const chars = Array.from(tag);
  return chars.length > MAX_TAG_LENGTH ? chars.slice(0, MAX_TAG_LENGTH).join('') : tag;
}

/**
 * 从 content 中提取 `#标签`，合并显式传入的 extraTags，去重并限制数量。
 * 保持首次出现顺序；`#` 前缀不入库。
 */
export function extractTags(content: string | null | undefined, extraTags?: readonly string[] | null): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string): void => {
    const tag = normalizeTag(raw);
    if (tag === '' || seen.has(tag)) return;
    if (result.length >= MAX_TAGS_PER_MEMO) return;
    seen.add(tag);
    result.push(tag);
  };

  if (typeof content === 'string' && content !== '') {
    TAG_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null = TAG_PATTERN.exec(content);
    while (match !== null) {
      const captured = match[1];
      if (captured !== undefined) push(captured);
      match = TAG_PATTERN.exec(content);
    }
  }

  if (Array.isArray(extraTags)) {
    for (const tag of extraTags) {
      if (typeof tag === 'string') push(tag);
    }
  }

  return result;
}
