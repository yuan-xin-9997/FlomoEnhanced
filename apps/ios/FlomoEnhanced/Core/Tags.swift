//
//  Tags.swift
//  浮墨增强版 iOS
//
//  `#标签` 的提取与高亮分段：与 packages/shared/src/tags.ts 及 Web
//  `highlightTagSegments`（apps/web/src/lib/memoQuery.ts）语义一致（docs/IOS.md §3.6）。
//

import Foundation

enum Tags {

    /// `#([^\s#,，。；;：:!！?？()（）\[\]【】{}<>《》"'’“”]+)`
    /// —— 与 `packages/shared/src/tags.ts` 的 `TAG_PATTERN` 完全一致。
    /// 说明：`#` 后至少 1 个字符；单个标签不含空白、`#`、中英文标点与引号。
    static let pattern: NSRegularExpression = {
        // 字面量固定，不会抛错
        try! NSRegularExpression(
            pattern: #"#([^\s#,，。；;：:!！?？()（）\[\]【】{}<>《》"'’“”]+)"#
        )
    }()

    /// 单标签最大字符数（tags.ts `MAX_TAG_LENGTH`）
    static let maxTagLength = 50

    /// 单条想法最多标签数（tags.ts `MAX_TAGS_PER_MEMO`）
    static let maxTagsPerMemo = 50

    /// 从内容中提取 `#标签`：裸标签（不含 `#`）、按出现顺序、去重、每个 ≤50 字符、最多 50 个
    static func extract(from content: String) -> [String] {
        guard !content.isEmpty else { return [] }
        var result: [String] = []
        var seen = Set<String>()
        let fullRange = NSRange(content.startIndex..<content.endIndex, in: content)
        let matches = pattern.matches(in: content, options: [], range: fullRange)
        for match in matches {
            // 与 TS 的 push 一致：到达上限后继续扫描但不再收录
            guard result.count < maxTagsPerMemo else { break }
            guard match.numberOfRanges > 1,
                  let range = Range(match.range(at: 1), in: content) else { continue }
            let tag = normalizeTag(String(content[range]))
            guard !tag.isEmpty, !seen.contains(tag) else { continue }
            seen.insert(tag)
            result.append(tag)
        }
        return result
    }

    /// 规范化单个标签：去 `#` 前缀、trim、按字符截断到 50（对应 TS `normalizeTag`）
    static func normalizeTag(_ raw: String) -> String {
        var tag = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while tag.hasPrefix("#") {
            tag = String(tag.dropFirst()).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if tag.count > maxTagLength {
            return String(tag.prefix(maxTagLength))
        }
        return tag
    }

    /// 把内容切成普通片段与 `#标签` 片段（标签片段**包含** `#` 前缀，供高亮渲染）。
    /// 保证：所有片段的 `text` 依次拼接后与 `content` 完全相等（对应 Web `highlightTagSegments`）。
    static func segments(of content: String) -> [(text: String, isTag: Bool)] {
        guard !content.isEmpty else { return [] }
        var segments: [(text: String, isTag: Bool)] = []
        var cursor = content.startIndex
        let fullRange = NSRange(content.startIndex..<content.endIndex, in: content)
        let matches = pattern.matches(in: content, options: [], range: fullRange)
        for match in matches {
            guard let range = Range(match.range, in: content) else { continue }
            if range.lowerBound > cursor {
                segments.append((text: String(content[cursor..<range.lowerBound]), isTag: false))
            }
            // 正则的 `+` 保证不会出现空匹配；这里再兜一层，避免产生空标签片段
            if !range.isEmpty {
                segments.append((text: String(content[range]), isTag: true))
            }
            if range.upperBound > cursor {
                cursor = range.upperBound
            }
        }
        if cursor < content.endIndex {
            segments.append((text: String(content[cursor...]), isTag: false))
        }
        return segments
    }
}
