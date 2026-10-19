//
//  Normalize.swift
//  浮墨增强版 iOS
//
//  字段取值归一化 + 字段定义校验：逐条移植 packages/shared/src/fieldTypes.ts 的
//  `normalizeFieldValue` / `validateFieldDefinition` / `validateTemplateFields`
//  （docs/IOS.md §3.6）。客户端只做预校验，服务端仍会再校验一次，因此
//  **错误文案与 TS 必须逐字一致**，避免同一份数据出现两套提示。
//

import Foundation

enum Normalize {

    /// 归一化结果（对应 TS `NormalizeResult`）
    enum Result {
        /// 归一化成功；`.ok(nil)` 表示空值（multiselect 的空值是 `.strings([])`）
        case ok(FieldValue?)
        /// 归一化失败；`message` 是可直接展示的中文文案
        case fail(String)

        /// 是否成功（表单层快速判断用）
        var isOK: Bool {
            if case .ok(_) = self { return true }
            return false
        }

        /// 失败文案（成功时为 nil）
        var errorMessage: String? {
            if case .fail(let message) = self { return message }
            return nil
        }
    }

    // MARK: - 归一化（TS: normalizeFieldValue）

    /// 按字段定义归一化取值（SPEC §6 归一化表）。
    /// 空值统一为 `.null`（multiselect 为 `.strings([])`）；失败返回中文文案。
    static func value(_ def: FieldDefinition, _ raw: FieldValue?) -> Result {
        // TS `const label = def.label || def.key;` —— 只对空串回退到 key，且**不 trim**
        let label = def.label.isEmpty ? def.key : def.label

        switch def.type {
        case .text, .longtext:
            if isBlank(raw) { return .ok(nil) }
            guard case .string(let text)? = raw else { return .fail("「\(label)」必须是文本") }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty { return .ok(nil) }
            if let max = def.maxLengthEffective, charLength(trimmed) > max {
                return .fail("「\(label)」长度不能超过 \(max) 个字符")
            }
            return .ok(.string(trimmed))

        case .url:
            if isBlank(raw) { return .ok(nil) }
            guard case .string(let text)? = raw else { return .fail("「\(label)」必须是链接文本") }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let max = def.maxLengthEffective, charLength(trimmed) > max {
                return .fail("「\(label)」长度不能超过 \(max) 个字符")
            }
            guard let parsed = URL(string: trimmed),
                  let scheme = parsed.scheme?.lowercased(),
                  let host = parsed.host, !host.isEmpty else {
                // 对应 TS `new URL(value)` 抛错：JS 要求绝对地址（带 scheme 与 host）
                return .fail("「\(label)」必须是合法的 http/https 链接")
            }
            if scheme != "http" && scheme != "https" {
                return .fail("「\(label)」只支持 http/https 链接")
            }
            return .ok(.string(trimmed))

        case .number, .currency, .percent:
            if isBlank(raw) { return .ok(nil) }
            guard let number = finiteNumber(raw) else { return .fail("「\(label)」必须是数字") }
            if def.type == .percent && (number < 0 || number > 100) {
                return .fail("「\(label)」必须在 0 到 100 之间")
            }
            if let min = def.min, number < min {
                return .fail("「\(label)」不能小于 \(numberText(min))")
            }
            if let max = def.max, number > max {
                return .fail("「\(label)」不能大于 \(numberText(max))")
            }
            return .ok(.number(number))

        case .rating:
            if isBlank(raw) { return .ok(nil) }
            guard let number = finiteNumber(raw) else { return .fail("「\(label)」必须是数字") }
            if number != number.rounded() { return .fail("「\(label)」必须是整数评分") }
            let scale = def.scaleEffective
            if number < 0 || number > Double(scale) {
                return .fail("「\(label)」必须在 0 到 \(scale) 之间")
            }
            return .ok(.number(number))

        case .date:
            if isBlank(raw) { return .ok(nil) }
            guard case .string(let text)? = raw else {
                return .fail("「\(label)」必须是 YYYY-MM-DD 格式的日期")
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard matchesDayKeyFormat(trimmed) else {
                return .fail("「\(label)」必须是 YYYY-MM-DD 格式的日期")
            }
            // Dates.parseDayKey 做真实日历校验（拒绝 2026-02-30、年 < 100），
            // 与 TS `isValidCalendarDate` 的 Date 回读比对等价
            guard Dates.parseDayKey(trimmed) != nil else {
                return .fail("「\(label)」不是合法的日期")
            }
            return .ok(.string(trimmed))

        case .datetime:
            if isBlank(raw) { return .ok(nil) }
            guard case .string(let text)? = raw else {
                return .fail("「\(label)」必须是带时区的 ISO-8601 时间")
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let parts = matchDateTime(trimmed) else {
                return .fail("「\(label)」必须是带时区的 ISO-8601 时间")
            }
            guard isRealDateTime(parts) else {
                return .fail("「\(label)」不是合法的时间")
            }
            return .ok(.string(trimmed))

        case .select:
            if isBlank(raw) { return .ok(nil) }
            guard case .string(let text)? = raw else { return .fail("「\(label)」必须是选项值") }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            let options = def.options ?? []
            if !options.contains(where: { $0.value == trimmed }) {
                return .fail("「\(label)」的取值不在候选项中")
            }
            return .ok(.string(trimmed))

        case .multiselect:
            let options = def.options ?? []
            guard let current = raw else { return .ok(.strings([])) }
            switch current {
            case .null:
                return .ok(.strings([]))
            case .string(let text):
                let single = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if single.isEmpty { return .ok(.strings([])) }
                if !options.contains(where: { $0.value == single }) {
                    return .fail("「\(label)」的取值不在候选项中")
                }
                return .ok(.strings([single]))
            case .strings(let items):
                var picked = Set<String>()
                for item in items {
                    let value = item.trimmingCharacters(in: .whitespacesAndNewlines)
                    if value.isEmpty { continue }
                    if !options.contains(where: { $0.value == value }) {
                        return .fail("「\(label)」的取值「\(value)」不在候选项中")
                    }
                    picked.insert(value)
                }
                // 排序稳定：按 options 定义的顺序输出
                let ordered = options.map(\.value).filter { picked.contains($0) }
                return .ok(.strings(ordered))
            case .number(_), .bool(_):
                return .fail("「\(label)」必须是选项值数组")
            }

        case .boolean:
            guard let current = raw else { return .ok(nil) }
            switch current {
            case .null:
                return .ok(nil)
            case .string(let text) where text.isEmpty:
                // TS 只把「恰好是空串」视为未填（`" "`、`"  "` 不算）
                return .ok(nil)
            case .bool(let flag):
                return .ok(.bool(flag))
            case .number(let number):
                if number == 1 { return .ok(.bool(true)) }
                if number == 0 { return .ok(.bool(false)) }
                return .fail("「\(label)」必须是布尔值")
            case .string(let text):
                let normalized = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if Self.booleanTrueTexts.contains(normalized) { return .ok(.bool(true)) }
                if Self.booleanFalseTexts.contains(normalized) { return .ok(.bool(false)) }
                return .fail("「\(label)」必须是「是」或「否」")
            case .strings(_):
                return .fail("「\(label)」必须是「是」或「否」")
            }
        }
    }

    // MARK: - 字段定义校验（TS: validateFieldDefinition / validateTemplateFields）

    /// 校验单个字段定义，返回中文错误信息数组（空数组表示通过）。
    /// TS 里对 key / label / type / required 的**类型**检查由 Swift 类型系统保证，
    /// 这里只保留取值规则（key 正则、长度上限、依赖 options 的规则等）。
    static func validateFieldDefinition(_ def: FieldDefinition) -> [String] {
        var errors: [String] = []
        let trimmedLabel = def.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let name = trimmedLabel.isEmpty ? "字段「\(def.key)」" : "「\(def.label)」"

        // TS: `/^[a-z][a-z0-9_]{0,39}$/`
        if !matchesKeyPattern(def.key) {
            errors.append("\(name)的 key 必须匹配 /^[a-z][a-z0-9_]{0,39}$/")
        }
        if trimmedLabel.isEmpty {
            errors.append("字段「\(def.key)」的显示名不能为空")
        } else if charLength(def.label) > 40 {
            errors.append("\(name)的显示名不能超过 40 个字符")
        }

        let meta = def.type.meta

        if let help = def.help, charLength(help) > 120 {
            errors.append("\(name)的帮助文字不能超过 120 个字符")
        }
        if let placeholder = def.placeholder, charLength(placeholder) > 60 {
            errors.append("\(name)的占位文字不能超过 60 个字符")
        }

        if meta.numeric {
            if let min = def.min, !min.isFinite {
                errors.append("\(name)的 min 必须是有限数字")
            }
            if let max = def.max, !max.isFinite {
                errors.append("\(name)的 max 必须是有限数字")
            }
            if let min = def.min, let max = def.max, min.isFinite, max.isFinite, min > max {
                errors.append("\(name)的 min 不能大于 max")
            }
            if let step = def.step, !step.isFinite || step <= 0 {
                errors.append("\(name)的 step 必须是正数")
            }
        }
        if let precision = def.precision, precision < 0 || precision > 6 {
            errors.append("\(name)的 precision 必须是 0..6 的整数")
        }
        if def.type == .currency, let currency = def.currency, !matchesCurrencyPattern(currency) {
            errors.append("\(name)的 currency 必须是 3 位大写字母的 ISO-4217 代码")
        }
        if def.type == .rating, let scale = def.scale, scale < 1 || scale > 10 {
            errors.append("\(name)的 scale 必须是 1..10 的整数")
        }
        if let maxLength = def.maxLength, maxLength < 1 {
            errors.append("\(name)的 maxLength 必须是正整数")
        }

        if meta.requiresOptions {
            let options = def.options ?? []
            if options.isEmpty {
                errors.append("\(name)是\(meta.label)字段，必须提供至少 1 个选项")
            } else {
                if def.type == .select && options.count > 50 {
                    errors.append("\(name)的选项不能超过 50 个")
                }
                if def.type == .multiselect && options.count > 100 {
                    errors.append("\(name)的选项不能超过 100 个")
                }
                var seen = Set<String>()
                for (index, option) in options.enumerated() {
                    let position = "\(name)的第 \(index + 1) 个选项"
                    let optionValue = option.value
                    if optionValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        || charLength(optionValue) > 40 {
                        errors.append("\(position)的 value 必须是 1..40 字符的非空字符串")
                        continue
                    }
                    if option.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        errors.append("\(position)的 label 不能为空")
                    }
                    if seen.contains(optionValue) {
                        errors.append("\(name)的选项 value「\(optionValue)」重复")
                    }
                    seen.insert(optionValue)
                }
            }
        }

        // TS: `def.defaultValue !== undefined && def.defaultValue !== null`
        if let defaultValue = def.defaultValue, defaultValue != FieldValue.null {
            switch value(def, defaultValue) {
            case .ok(_):
                break
            case .fail(let message):
                errors.append("\(name)的默认值非法：\(message)")
            }
        }

        return errors
    }

    /// 校验整个模板的字段定义（逐字段校验 + key 唯一），返回中文错误信息数组
    static func validateTemplateFields(_ fields: [FieldDefinition]) -> [String] {
        var errors: [String] = []
        var seenKeys = Set<String>()
        for (index, def) in fields.enumerated() {
            for message in validateFieldDefinition(def) {
                errors.append("字段 #\(index + 1)：\(message)")
            }
            if seenKeys.contains(def.key) {
                errors.append("字段 #\(index + 1)：key「\(def.key)」重复")
            }
            seenKeys.insert(def.key)
        }
        return errors
    }

    // MARK: - 共用小工具

    /// 按「字符」计长度（Swift `String.count`，与 TS `Array.from(value).length` 对齐）
    static func charLength(_ value: String) -> Int {
        value.count
    }

    /// 对应 TS `isBlank(raw)`：`undefined` / `null` / 只含空白字符的字符串
    private static func isBlank(_ raw: FieldValue?) -> Bool {
        guard let raw = raw else { return true }
        switch raw {
        case .null:
            return true
        case .string(let text):
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .number, .bool, .strings(_):
            return false
        }
    }

    /// 对应 TS `toFiniteNumber(raw)`：数字 / 数字字符串 → 有限数字，否则 nil
    private static func finiteNumber(_ raw: FieldValue?) -> Double? {
        guard let raw = raw else { return nil }
        switch raw {
        case .number(let value):
            return value.isFinite ? value : nil
        case .string(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let value = Double(trimmed), value.isFinite else { return nil }
            return value
        case .bool, .strings(_), .null:
            return nil
        }
    }

    /// 错误文案里的数字文本：与 JS 模板字符串 `${number}` 一致（整数不带 `.0`）
    private static func numberText(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// 对应 TS `/^[a-z][a-z0-9_]{0,39}$/`。
    /// 手写匹配而非 ICU 正则：ICU 的 `$` 会容忍结尾换行，JS 不会。
    private static func matchesKeyPattern(_ key: String) -> Bool {
        let chars = Array(key)
        guard let first = chars.first, chars.count <= 40 else { return false }
        guard Self.lowerASCIILetters.contains(first) else { return false }
        for char in chars.dropFirst() {
            guard Self.lowerASCIILetters.contains(char)
                    || Self.asciiDigits.contains(char)
                    || char == "_" else { return false }
        }
        return true
    }

    /// 对应 TS `/^[A-Z]{3}$/`
    private static func matchesCurrencyPattern(_ code: String) -> Bool {
        let chars = Array(code)
        guard chars.count == 3 else { return false }
        return chars.allSatisfy { Self.upperASCIILetters.contains($0) }
    }

    /// 对应 TS `/^\d{4}-\d{2}-\d{2}$/`（JS 的 `\d` 只匹配 ASCII 数字）
    private static func matchesDayKeyFormat(_ value: String) -> Bool {
        let chars = Array(value)
        guard chars.count == 10, chars[4] == "-", chars[7] == "-" else { return false }
        for (index, char) in chars.enumerated() where index != 4 && index != 7 {
            guard Self.asciiDigits.contains(char) else { return false }
        }
        return true
    }

    private static let lowerASCIILetters = Set("abcdefghijklmnopqrstuvwxyz")
    private static let upperASCIILetters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    private static let asciiDigits = Set("0123456789")
    private static let booleanTrueTexts: Set<String> = ["true", "1", "yes", "y", "是", "真"]
    private static let booleanFalseTexts: Set<String> = ["false", "0", "no", "n", "否", "假"]

    // MARK: - datetime 解析（TS: DATETIME_PATTERN + Date.parse 有限性）

    /// `/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|z|[+-]\d{2}:?\d{2})$/`
    /// （JS 的 `\d` 只匹配 ASCII 数字，这里显式写成 [0-9]；秒与毫秒可省略）
    private static let dateTimeRegex: NSRegularExpression = {
        // 字面量固定，不会抛错
        try! NSRegularExpression(
            pattern: #"^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,3}))?)?(Z|z|[+-]([0-9]{2}):?([0-9]{2}))$"#
        )
    }()

    private struct DateTimeParts {
        let year: Int
        let month: Int
        let day: Int
        let hour: Int
        let minute: Int
        let second: Int?
        let offsetHour: Int?
        let offsetMinute: Int?
    }

    /// 正则匹配 + 取出各字段；格式不对返回 nil
    private static func matchDateTime(_ value: String) -> DateTimeParts? {
        let fullRange = NSRange(value.startIndex..<value.endIndex, in: value)
        guard let match = dateTimeRegex.firstMatch(in: value, options: [], range: fullRange),
              match.range == fullRange,
              match.numberOfRanges >= 11,
              let year = intValue(value, match.range(at: 1)),
              let month = intValue(value, match.range(at: 2)),
              let day = intValue(value, match.range(at: 3)),
              let hour = intValue(value, match.range(at: 4)),
              let minute = intValue(value, match.range(at: 5)) else { return nil }
        return DateTimeParts(
            year: year,
            month: month,
            day: day,
            hour: hour,
            minute: minute,
            second: intValue(value, match.range(at: 6)),
            offsetHour: intValue(value, match.range(at: 9)),
            offsetMinute: intValue(value, match.range(at: 10))
        )
    }

    private static func intValue(_ source: String, _ range: NSRange) -> Int? {
        guard range.location != NSNotFound, let range = Range(range, in: source) else { return nil }
        return Int(source[range])
    }

    /// 对应 TS `Number.isFinite(Date.parse(value))`：日期真实存在、时间与偏移在范围内。
    /// 日期部分用公历闰年规则校验（与 JS 的 ISO 解析一致，拒绝 2026-02-30；
    /// 且 0000..9999 年都合法 —— 与 date 分支不同，TS 对 datetime 不做 0..99 年回退）。
    private static func isRealDateTime(_ parts: DateTimeParts) -> Bool {
        guard isRealCalendarDay(year: parts.year, month: parts.month, day: parts.day) else {
            return false
        }
        // JS 规范：HH 为 0..24，HH=24 时 MM/SS/毫秒必须为 0（等价于次日 00:00）
        guard parts.hour >= 0, parts.hour <= 24,
              parts.minute >= 0, parts.minute <= 59 else { return false }
        if let second = parts.second, second < 0 || second > 59 { return false }
        if parts.hour == 24 {
            if parts.minute != 0 { return false }
            if let second = parts.second, second != 0 { return false }
        }
        if let offsetHour = parts.offsetHour, offsetHour < 0 || offsetHour > 23 { return false }
        if let offsetMinute = parts.offsetMinute, offsetMinute < 0 || offsetMinute > 59 { return false }
        return true
    }

    /// 公历闰年规则的真实日历校验（2 月 30 日等一律拒绝）
    private static func isRealCalendarDay(year: Int, month: Int, day: Int) -> Bool {
        guard month >= 1, month <= 12, day >= 1 else { return false }
        let days: Int
        switch month {
        case 1, 3, 5, 7, 8, 10, 12: days = 31
        case 4, 6, 9, 11: days = 30
        default: days = isLeapYear(year) ? 29 : 28
        }
        return day <= days
    }

    private static func isLeapYear(_ year: Int) -> Bool {
        year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    }
}

// MARK: - 有效值计算（TS: effectiveMaxLength / effectivePrecision / effectiveCurrency / effectiveScale）

extension FieldDefinition {
    /// 有效最大长度：显式 `maxLength` 优先，否则取类型默认（text 200 / longtext 5000 / url 2048）
    var maxLengthEffective: Int? {
        if let maxLength = maxLength { return maxLength }
        return type.meta.maxLength
    }

    /// 有效小数位：显式 `precision` 优先，否则取类型默认（number/percent/currency 2、rating/其他 0）
    var precisionEffective: Int {
        if let precision = precision { return precision }
        return type.meta.precision
    }

    /// 有效币种：默认 `CNY`
    var currencyEffective: String {
        currency ?? "CNY"
    }

    /// 有效评分满分：默认 5
    var scaleEffective: Int {
        scale ?? 5
    }
}
