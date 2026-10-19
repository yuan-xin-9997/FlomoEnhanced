//
//  FieldFormat.swift
//  浮墨增强版 iOS
//
//  字段取值的中文展示：移植 packages/shared/src/fieldTypes.ts 的 `formatFieldValue`
//  （docs/IOS.md §3.6），用于记录列表、详情卡片与图表 tooltip。
//

import Foundation

enum FieldFormat {

    /// 字段取值的中文展示（对应 TS `formatFieldValue`）。
    /// - currency：`NumberFormatter`（zh_CN + 币种）→ `¥1,234.50`
    /// - percent：`12.34%`；number：千分位 + 固定小数位
    /// - rating：`4 / 5`；boolean：是 / 否
    /// - date / datetime：原样返回（datetime 的本地化由 `Dates.formatTimestamp` 负责）
    /// - select / multiselect：option label（找不到回退 value；multiselect 用「、」连接）
    /// - text / longtext / url：原样
    static func value(_ def: FieldDefinition, _ value: FieldValue?) -> String {
        // TS `isFieldValueEmpty`：null / 空白字符串 / 空数组为空；`false`、`0` 视为有值
        if isFieldValueEmpty(value) { return "" }

        switch def.type {
        case .currency:
            guard let number = numericValue(value) else { return "" }
            return currencyString(number, code: def.currencyEffective, digits: def.precisionEffective)

        case .percent:
            guard let number = numericValue(value) else { return "" }
            return "\(decimalString(number, digits: def.precisionEffective, grouping: true))%"

        case .number:
            guard let number = numericValue(value) else { return "" }
            return decimalString(number, digits: def.precisionEffective, grouping: true)

        case .rating:
            guard let number = numericValue(value) else { return "" }
            return "\(numberText(number)) / \(numberText(Double(def.scaleEffective)))"

        case .boolean:
            // TS: `value === true ? '是' : '否'`
            return value == FieldValue.bool(true) ? "是" : "否"

        case .date, .datetime:
            // TS: `typeof value === 'string' ? value : ''`
            return value?.stringValue ?? ""

        case .select:
            if let raw = value?.stringValue,
               let option = (def.options ?? []).first(where: { $0.value == raw }) {
                return option.label
            }
            return stringFallback(value)

        case .multiselect:
            let options = def.options ?? []
            let list: [String]
            if let items = value?.arrayValue {
                list = items
            } else {
                list = [stringFallback(value)]
            }
            return list
                .map { item in options.first(where: { $0.value == item })?.label ?? item }
                .joined(separator: "、")

        case .text, .longtext, .url:
            return stringFallback(value)
        }
    }

    /// 图表轴 / 卡片用的紧凑数字文本：整数不带小数点，否则最多 2 位小数（不带千分位）。
    /// 例：`5 → "5"`、`3.14159 → "3.14"`、`1234.5 → "1234.5"`
    static func compact(_ value: Double) -> String {
        guard value.isFinite else { return String(value) }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = false
        formatter.minimumFractionDigits = 0
        formatter.maximumFractionDigits = 2
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    // MARK: - 内部工具（逐条对应 TS 里的私有函数）

    /// 对应 TS `isFieldValueEmpty`：`null` / trim 后为空串 / 空数组 / 非有限数字 为空
    private static func isFieldValueEmpty(_ value: FieldValue?) -> Bool {
        guard let value = value else { return true }
        switch value {
        case .null:
            return true
        case .string(let text):
            return text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .strings(let items):
            return items.isEmpty
        case .number(let number):
            return !number.isFinite
        case .bool:
            return false
        }
    }

    /// 对应 TS `typeof value === 'number' ? value : Number(value)`
    /// - `.number` → 原值（非有限视为不可用）
    /// - `.string` → trim 后解析（`Number(' 12 ') === 12`）
    /// - `.bool` → `Number(true) === 1` / `Number(false) === 0`
    /// - `.strings` / `.null` → nil（数组落到 `Number()` 的结果无意义，按不可用处理）
    private static func numericValue(_ value: FieldValue?) -> Double? {
        guard let value = value else { return nil }
        switch value {
        case .number(let number):
            return number.isFinite ? number : nil
        case .string(let text):
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let number = Double(trimmed), number.isFinite else { return nil }
            return number
        case .bool(let flag):
            return flag ? 1 : 0
        case .strings(_), .null:
            return nil
        }
    }

    /// 对应 TS 里对非字符串值兜底的 `String(value)`
    private static func stringFallback(_ value: FieldValue?) -> String {
        guard let value = value else { return "" }
        switch value {
        case .string(let text): return text
        case .number(let number): return numberText(number)
        case .bool(let flag): return flag ? "true" : "false"
        case .strings(let items): return items.joined(separator: ",")
        case .null: return ""
        }
    }

    /// 与 JS 模板字符串 `${number}` 等价的文本（整数不带 `.0`）
    private static func numberText(_ value: Double) -> String {
        if value.isFinite, value == value.rounded(), abs(value) < 1e15 {
            return String(Int64(value))
        }
        return String(value)
    }

    /// 对应 TS `Intl.NumberFormat('zh-CN', { minimumFractionDigits, maximumFractionDigits })`
    private static func decimalString(_ value: Double, digits: Int, grouping: Bool) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = grouping
        let clamped = clampDigits(digits)
        formatter.minimumFractionDigits = clamped
        formatter.maximumFractionDigits = clamped
        // Intl.NumberFormat 默认 halfExpand（四舍五入、远离零），与 .halfUp 语义一致
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// 对应 TS `Intl.NumberFormat('zh-CN', { style: 'currency', currency })`
    private static func currencyString(_ value: Double, code: String, digits: Int) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.numberStyle = .currency
        // 币种码非法时不设置，避免 NumberFormatter 出现未定义行为（TS 在这种情况下会抛 RangeError）
        if isCurrencyCode(code) { formatter.currencyCode = code }
        let clamped = clampDigits(digits)
        formatter.minimumFractionDigits = clamped
        formatter.maximumFractionDigits = clamped
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// TS `formatNumber` 里的 `Math.min(Math.max(precision, 0), 6)`
    private static func clampDigits(_ digits: Int) -> Int {
        min(max(digits, 0), 6)
    }

    private static func isCurrencyCode(_ code: String) -> Bool {
        let chars = Array(code)
        guard chars.count == 3 else { return false }
        return chars.allSatisfy { "ABCDEFGHIJKLMNOPQRSTUVWXYZ".contains($0) }
    }
}
