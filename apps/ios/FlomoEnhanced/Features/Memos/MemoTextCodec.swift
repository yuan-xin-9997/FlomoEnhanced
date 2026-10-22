//
//  MemoTextCodec.swift
//  浮墨增强版 iOS
//
//  模板字段的「文本模式」：逐行「字段名：值」的序列化与解析。
//  规则与 packages/shared/src/memoText.ts 对齐（docs/SPEC 同步维护）：
//  - 字段名接受 label 或 key；有歧义时序列化改用 key；
//  - 数值保留原始精度；选项必要时用原始值或 JSON 字符串 / 数组；
//  - 分隔符支持中英文冒号 / 等号；
//  - longtext 的后续行作为续行，空行保留；
//  - 未出现的字段取模板默认值；
//  - 解析尽力填充，未识别行 / 非法值逐条报错。
//

import Foundation

// MARK: - 展示模式

/// 模板字段的展示 / 编辑方式（每条记录独立）
enum MemoFieldMode: String, CaseIterable, Identifiable {
    case template
    case text

    var id: String { rawValue }

    var label: String {
        switch self {
        case .template: return "模板模式"
        case .text: return "文本模式"
        }
    }
}

// MARK: - 解析结果

/// 文本行错误（`line` 从 1 开始，`message` 不含行号前缀）
struct MemoTextLineError: Identifiable, Equatable {
    let line: Int
    let message: String

    var id: String { "\(line)-\(message)" }
}

/// 纯文本解析结果（对应 TS `MemoTextParseResult`）
struct MemoTextParseResult {
    /// 表单草稿：包含所有字段；未出现的字段取默认值
    var draft: [String: FieldValue]
    /// 字段级错误（key → 中文消息）
    var errors: [String: String]
    /// 无法归属到字段的行、重复字段行等
    var lineErrors: [MemoTextLineError]
    /// 成功识别的字段数量
    var matchedCount: Int

    /// 没有解析错误（必填等业务校验由调用方继续完成）
    var ok: Bool { lineErrors.isEmpty && errors.isEmpty }
}

/// 解析 + 归一化后的结果（对应 Web `parseMemoTextDraft`）
struct MemoTextDraftResult {
    var draft: [String: FieldValue]
    var values: [String: FieldValue]
    var errors: [String: String]
    var lineErrors: [MemoTextLineError]
    var matchedCount: Int

    /// 是否既无解析错误，也通过必填 / 归一化校验
    var ok: Bool { lineErrors.isEmpty && errors.isEmpty }
}

enum MemoTextDraft {
    /// 解析文本 → 草稿 / 归一化值 / 合并错误。
    /// 「未出现的字段」按模板默认值处理（即清空）。
    static func parse(fields: [FieldDefinition], text: String) -> MemoTextDraftResult {
        let parsed = MemoTextCodec.parse(fields: fields, text: text)
        let normalized = MemoFieldDraft.normalize(fields: fields, draft: parsed.draft)
        // 解析错误优先，与 Web `{ ...normalized.errors, ...parsed.errors }` 一致
        var errors = normalized.errors
        for (key, message) in parsed.errors {
            errors[key] = message
        }
        return MemoTextDraftResult(
            draft: parsed.draft,
            values: normalized.values,
            errors: errors,
            lineErrors: parsed.lineErrors,
            matchedCount: parsed.matchedCount
        )
    }
}

// MARK: - 编解码

enum MemoTextCodec {

    private static let separators: Set<Character> = ["：", ":", "＝", "="]
    private static let multiselectSeparators = CharacterSet(charactersIn: "、,，;；|")

    /// 常见币种符号（与 Web 解析器一致，容错剥离）
    private static let currencySymbols = [
        // Intl 在 zh-CN 下会给部分币种加前缀（如 US$、AU$、CA$、JP¥），需先于裸符号剥离
        "US$", "AU$", "CA$", "JP¥", "HK$", "NT$", "S$", "A$", "C$", "CHF",
        "¥", "$", "€", "£", "₩", "₹", "₽", "฿",
    ]

    private static let numberRegex: NSRegularExpression = {
        // 对应 TS /[-+]?(?:\d+(?:\.\d*)?|\.\d+)/
        try! NSRegularExpression(pattern: #"[-+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)"#)
    }()

    // MARK: 序列化

    /// 字段值 → 文本模式文本（只输出非空字段；有歧义时保留原始键值）。
    static func format(fields: [FieldDefinition], values: [String: FieldValue]) -> String {
        var labelCounts: [String: Int] = [:]
        for def in fields {
            let label = MemoFieldDraft.label(of: def)
            labelCounts[label, default: 0] += 1
        }
        let keys = Set(fields.map(\.key))
        let lookup = buildLookup(fields)

        var lines: [String] = []
        for def in fields {
            guard let value = values[def.key], !value.isEmpty else { continue }
            let text = editableValueText(def, value, lookup: lookup)
            if text.isEmpty { continue }
            let label = MemoFieldDraft.label(of: def)
            let token = (labelCounts[label] ?? 0) > 1
                || (label != def.key && keys.contains(label))
                || label.rangeOfCharacter(from: .newlines) != nil ? def.key : label
            lines.append("\(token)：\(text)")
        }
        return lines.joined(separator: "\n")
    }

    private static func optionText(_ def: FieldDefinition, value: String) -> String {
        let options = def.options ?? []
        guard let option = options.first(where: { $0.value == value }) else { return value }
        let label = option.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let ambiguous = options.contains { other in
            other.value != value && (other.label.trimmingCharacters(in: .whitespacesAndNewlines) == label || other.value == label)
        }
        if ambiguous || label.hasPrefix("\"") || label.rangeOfCharacter(from: .newlines) != nil
            || (def.type == .multiselect && label.rangeOfCharacter(from: multiselectSeparators) != nil) {
            return value
        }
        return label
    }

    private static func editableValueText(_ def: FieldDefinition, _ value: FieldValue, lookup: [LookupEntry]) -> String {
        switch def.type {
        case .number, .currency, .percent:
            return fallbackText(value)
        case .select:
            guard let raw = value.stringValue else { return fallbackText(value) }
            let token = optionText(def, value: raw)
            if token.hasPrefix("\"") || token.rangeOfCharacter(from: .newlines) != nil {
                return jsonText(.string(raw))
            }
            return token
        case .multiselect:
            let values = value.arrayValue ?? [fallbackText(value)]
            let tokens = values.map { optionText(def, value: $0) }
            if tokens.contains(where: {
                $0.rangeOfCharacter(from: multiselectSeparators) != nil
                    || $0.rangeOfCharacter(from: .newlines) != nil || $0.hasPrefix("\"")
            }) || tokens.first?.hasPrefix("[") == true {
                return jsonText(.strings(values))
            }
            return tokens.joined(separator: "、")
        case .text, .longtext:
            guard let raw = value.stringValue else { return fallbackText(value) }
            let ambiguousLines = raw.contains("\n") && (def.type == .text || raw
                .split(separator: "\n", omittingEmptySubsequences: false).dropFirst()
                .contains { matchFieldLine(String($0), lookup: lookup) != nil })
            if raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("\"") || raw.contains("\r") || ambiguousLines {
                return jsonText(.string(raw))
            }
            return raw
        default:
            let formatted = FieldFormat.value(def, value)
            return formatted.isEmpty ? fallbackText(value) : formatted
        }
    }

    private static func jsonText(_ value: FieldValue) -> String {
        // 这里只编码字符串或字符串数组，JSON 编码不会失败。
        String(decoding: try! JSONEncoder().encode(value), as: UTF8.self)
    }

    // MARK: 解析

    /// 文本 → 字段草稿（不做必填校验；调用方继续 `MemoFieldDraft.normalize`）。
    static func parse(fields: [FieldDefinition], text: String) -> MemoTextParseResult {
        var draft: [String: FieldValue] = [:]
        for def in fields {
            draft[def.key] = defaultDraftValue(def)
        }

        var errors: [String: String] = [:]
        var lineErrors: [MemoTextLineError] = []
        let lookup = buildLookup(fields)
        var rawValues: [String: String] = [:]
        var seen = Set<String>()
        var current: FieldDefinition?
        var matchedCount = 0

        let lines = text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
        for (index, rawLine) in lines.enumerated() {
            let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine

            if let match = matchFieldLine(line, lookup: lookup) {
                let key = match.def.key
                if seen.contains(key) {
                    lineErrors.append(
                        MemoTextLineError(
                            line: index + 1,
                            message: "字段「\(MemoFieldDraft.label(of: match.def))」重复出现（以最后一次为准）"
                        )
                    )
                }
                seen.insert(key)
                rawValues[key] = match.value
                current = match.def
                continue
            }

            // 多行文本的续行：当前字段是 longtext 时，未匹配字段名的行都归入该字段
            if let current, current.type == .longtext {
                let previous = rawValues[current.key] ?? ""
                rawValues[current.key] = previous + "\n" + line
                continue
            }

            if line.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }
            lineErrors.append(
                MemoTextLineError(line: index + 1, message: "无法识别「\(preview(line))」")
            )
        }

        for def in fields where seen.contains(def.key) {
            let raw = rawValues[def.key] ?? ""
            switch prepareValue(def, raw: raw) {
            case .fail(let message):
                errors[def.key] = message
            case .ok(let value):
                switch Normalize.value(def, value) {
                case .ok(let normalized):
                    draft[def.key] = draftValue(of: def, value: normalized ?? .null)
                    matchedCount += 1
                case .fail(let message):
                    errors[def.key] = message
                }
            }
        }

        return MemoTextParseResult(
            draft: draft,
            errors: errors,
            lineErrors: lineErrors,
            matchedCount: matchedCount
        )
    }

    /// 单个字段的默认草稿值（字段自身 `defaultValue` 优先）
    static func defaultDraftValue(_ def: FieldDefinition) -> FieldValue {
        if let value = def.defaultValue { return value }
        return def.type.meta.defaultValue ?? .null
    }

    // MARK: 字段名匹配

    private enum LookupKind {
        case key
        case label
    }

    private struct LookupEntry {
        let token: String
        let def: FieldDefinition
        let kind: LookupKind
    }

    /// 构建「字段名 → 字段」匹配表：key 优先；重复 label 不参与匹配，避免歧义
    private static func buildLookup(_ fields: [FieldDefinition]) -> [LookupEntry] {
        var labelCounts: [String: Int] = [:]
        for def in fields {
            let label = MemoFieldDraft.label(of: def)
            labelCounts[label, default: 0] += 1
        }
        let keys = Set(fields.map(\.key))
        var entries: [LookupEntry] = []
        for def in fields {
            entries.append(LookupEntry(token: def.key, def: def, kind: .key))
            let label = MemoFieldDraft.label(of: def)
            if (labelCounts[label] ?? 0) > 1 { continue }
            if label != def.key && keys.contains(label) { continue }
            entries.append(LookupEntry(token: label, def: def, kind: .label))
        }
        entries.sort { lhs, rhs in
            let leftLength = lhs.token.utf16.count
            let rightLength = rhs.token.utf16.count
            if leftLength != rightLength { return leftLength > rightLength }
            if lhs.kind != rhs.kind { return lhs.kind == .key }
            return false
        }
        return entries
    }

    /// 尝试把一行识别为「字段名：值」；失败返回 nil
    private static func matchFieldLine(
        _ line: String,
        lookup: [LookupEntry]
    ) -> (def: FieldDefinition, value: String)? {
        var trimmed = Substring(line)
        while let first = trimmed.first, first.isWhitespace {
            trimmed = trimmed.dropFirst()
        }

        for entry in lookup {
            guard trimmed.hasPrefix(entry.token) else { continue }
            var rest = trimmed.dropFirst(entry.token.count)
            while let first = rest.first, first.isWhitespace {
                rest = rest.dropFirst()
            }
            guard let separator = rest.first, separators.contains(separator) else { continue }
            var value = rest.dropFirst()
            while let first = value.first, first.isWhitespace {
                value = value.dropFirst()
            }
            return (entry.def, String(value))
        }
        return nil
    }

    // MARK: 值预处理

    private enum PreparedValue {
        case ok(FieldValue)
        case fail(String)
    }

    /// 按字段类型预处理文本值（选择类字段把 label 映射为 value）
    private static func prepareValue(_ def: FieldDefinition, raw: String) -> PreparedValue {
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .ok(.string(""))
        }
        switch def.type {
        case .number, .currency, .percent:
            return prepareNumber(def, raw: raw)
        case .rating:
            return prepareRating(def, raw: raw)
        case .select:
            return prepareSelect(def, raw: raw)
        case .multiselect:
            return prepareMultiselect(def, raw: raw)
        case .text, .longtext:
            if raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("\""),
               let value = try? JSONDecoder().decode(String.self, from: Data(raw.utf8)) {
                return .ok(.string(value))
            }
            return .ok(.string(raw))
        default:
            return .ok(.string(raw))
        }
    }

    private static func prepareNumber(_ def: FieldDefinition, raw: String) -> PreparedValue {
        let text = cleanNumberText(
            def,
            raw: raw,
            percent: def.type == .percent,
            currency: def.type == .currency
        )
        if text.isEmpty {
            return .fail("「\(MemoFieldDraft.label(of: def))」必须是数字")
        }
        return .ok(.string(text))
    }

    private static func prepareRating(_ def: FieldDefinition, raw: String) -> PreparedValue {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let slash = text.firstIndex(of: "/") {
            text = String(text[..<slash])
        }
        text = String(text.filter { !$0.isWhitespace })
        guard let number = firstNumber(in: text) else {
            return .fail("「\(MemoFieldDraft.label(of: def))」必须是数字")
        }
        return .ok(.string(number))
    }

    private static func prepareSelect(_ def: FieldDefinition, raw: String) -> PreparedValue {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("\""), let value = try? JSONDecoder().decode(String.self, from: Data(text.utf8)) {
            return .ok(.string(value))
        }
        let options = def.options ?? []
        if let option = options.first(where: { $0.value == text }) {
            return .ok(.string(option.value))
        }
        let byLabel = options.filter {
            $0.label.trimmingCharacters(in: .whitespacesAndNewlines) == text
        }
        if byLabel.count > 1 {
            return .fail("「\(MemoFieldDraft.label(of: def))」的选项名称有歧义，请使用选项值")
        }
        if let option = byLabel.first {
            return .ok(.string(option.value))
        }
        // 交给 Normalize.value 产生统一的「取值不在候选项中」错误
        return .ok(.string(text))
    }

    private static func prepareMultiselect(_ def: FieldDefinition, raw: String) -> PreparedValue {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return .ok(.strings([])) }
        if text.hasPrefix("["), let values = try? JSONDecoder().decode([String].self, from: Data(text.utf8)) {
            return .ok(.strings(values))
        }
        let items = text
            .components(separatedBy: multiselectSeparators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        var picked: [String] = []
        for item in items {
            switch prepareSelect(def, raw: item) {
            case .ok(let value): picked.append(value.stringValue ?? "")
            case .fail(let message): return .fail(message)
            }
        }
        return .ok(.strings(picked))
    }

    /// 去掉数值装饰（千分位、币种符号、百分号等），保留可交给 `Normalize.value` 的文本
    private static func cleanNumberText(
        _ def: FieldDefinition,
        raw: String,
        percent: Bool,
        currency: Bool
    ) -> String {
        var text = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .filter { !$0.isWhitespace }
        text = text.replacingOccurrences(of: ",", with: "")
        text = text.replacingOccurrences(of: "，", with: "")

        if currency {
            let code = (def.currency ?? "CNY").uppercased()
            text = text.replacingOccurrences(of: code, with: "", options: .caseInsensitive)
            for symbol in currencySymbols {
                text = text.replacingOccurrences(of: symbol, with: "")
            }
            text = text.replacingOccurrences(of: "人民币", with: "")
            text = text.replacingOccurrences(of: "元", with: "")
            text = text.replacingOccurrences(of: "RMB", with: "", options: .caseInsensitive)
        }
        if percent {
            text = text.replacingOccurrences(of: "%", with: "")
            text = text.replacingOccurrences(of: "％", with: "")
        }
        return text
    }

    // MARK: 小工具

    /// 归一化后的值 → 表单草稿形态（数值保留字符串，便于输入框编辑）
    private static func draftValue(of def: FieldDefinition, value: FieldValue) -> FieldValue {
        switch def.type {
        case .number, .currency, .percent, .rating:
            if case .number(let number) = value {
                return .string(MemoNumberText.text(from: number))
            }
            return value
        case .multiselect:
            if case .strings(let items) = value { return .strings(items) }
            return .strings([])
        default:
            return value
        }
    }

    private static func fallbackText(_ value: FieldValue) -> String {
        switch value {
        case .strings(let items): return items.joined(separator: "、")
        case .null: return ""
        case .bool(let flag): return flag ? "是" : "否"
        case .number(let number): return MemoNumberText.text(from: number)
        case .string(let text): return text
        }
    }

    private static func firstNumber(in text: String) -> String? {
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = numberRegex.firstMatch(in: text, options: [], range: range),
              let matchRange = Range(match.range, in: text) else { return nil }
        return String(text[matchRange])
    }

    private static func preview(_ line: String) -> String {
        let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.count <= 24 ? text : String(text.prefix(24)) + "…"
    }
}
