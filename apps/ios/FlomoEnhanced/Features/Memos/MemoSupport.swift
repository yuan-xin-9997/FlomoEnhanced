//
//  MemoSupport.swift
//  浮墨增强版 iOS
//
//  Features/Memos 内部共用的小工具（全部以 `Memo` 前缀命名，避免与 Core 冲突）：
//  模板颜色 hex 解析、本地日 / 日期时间换算、标签输入解析、金额符号、数值文本。
//

import Foundation
import SwiftUI

// MARK: - 模板颜色（`#RRGGBB`）

enum MemoPalette {
    /// 解析 `#RRGGBB` / `RRGGBB` / `#RRGGBBAA`；非法返回 nil
    static func color(from hex: String?) -> Color? {
        guard var text = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return nil }
        if text.hasPrefix("#") {
            text.removeFirst()
        }
        guard let value = UInt32(text, radix: 16) else { return nil }
        switch text.count {
        case 6:
            return Color(hex: value)
        case 8:
            return Color(hex: value >> 8).opacity(Double(value & 0xFF) / 255.0)
        default:
            return nil
        }
    }

    /// 解析失败时回退（模板已删除 / 颜色非法）
    static func color(from hex: String?, fallback: Color) -> Color {
        color(from: hex) ?? fallback
    }
}

// MARK: - 本地日（`yyyy-MM-dd`）

/// `Date` ↔ `yyyy-MM-dd`（设备本地时区）。
/// 只用于 `DatePicker` 与 day key 的互转；换算全部复用 `Dates`，保证与列表筛选同一口径。
enum MemoDay {
    static func key(from date: Date) -> String {
        Dates.toDayKey(date)
    }

    static func date(fromKey key: String) -> Date? {
        guard let components = Dates.parseDayKey(key) else { return nil }
        return calendar.date(from: components)
    }

    /// 今天是本地哪一天（`Dates.todayKey()` 的 `Date` 形态）
    static func todayDate() -> Date {
        date(fromKey: Dates.todayKey()) ?? Date()
    }

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }
}

// MARK: - 日期时间（UTC ISO-8601 带毫秒）

/// `datetime` 字段取值：`2026-10-19T02:30:00.000Z`（docs/IOS.md §6）
enum MemoDateTime {
    /// `Date` → UTC ISO-8601（3 位毫秒 + `Z`，与 JS `Date#toISOString()` 逐字一致）
    static func iso(from date: Date) -> String {
        // 先取整到毫秒再拆分，避免 `ISO8601DateFormatter` 的时区格式差异（`+00:00` / `Z`）
        let totalMilliseconds = Int64((date.timeIntervalSince1970 * 1000).rounded())
        let seconds = totalMilliseconds / 1000
        let milliseconds = Int(totalMilliseconds % 1000)
        let parts = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: Date(timeIntervalSince1970: Double(seconds))
        )
        return "\(pad(parts.year ?? 1970, 4))"
            + "-\(pad(parts.month ?? 1, 2))"
            + "-\(pad(parts.day ?? 1, 2))"
            + "T\(pad(parts.hour ?? 0, 2))"
            + ":\(pad(parts.minute ?? 0, 2))"
            + ":\(pad(parts.second ?? 0, 2))"
            + ".\(pad(milliseconds, 3))Z"
    }

    static func date(fromIso text: String) -> Date? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if let value = withMillis.date(from: trimmed) { return value }
        return plain.date(from: trimmed)
    }

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        return calendar
    }

    private static let withMillis: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return formatter
    }()

    /// 左侧补零（不用 `String(format:)`，避免本地化数字带来的意外）
    private static func pad(_ value: Int, _ width: Int) -> String {
        var text = String(value)
        if text.count < width {
            text = String(repeating: "0", count: width - text.count) + text
        }
        return text
    }
}

// MARK: - 标签输入

enum MemoTagInput {
    private static let separators = CharacterSet(charactersIn: ",，、;；").union(.whitespacesAndNewlines)

    /// 输入框文本 → 裸标签（逗号 / 空格 / 中文顿号分隔；去 `#`、去重、保持顺序）
    static func parse(_ text: String) -> [String] {
        dedupe(text.components(separatedBy: separators))
    }

    /// 内容里的 `#标签` + 输入框标签（输入框在前）
    static func merged(explicit: [String], content: String) -> [String] {
        dedupe(explicit + Tags.extract(from: content))
    }

    /// 编辑已有记录时，输入框只回填「不在内容里」的标签（内容里的由 `#标签` 自动提取）
    static func explicitTags(of memo: Memo?) -> [String] {
        guard let memo else { return [] }
        let inContent = Set(Tags.extract(from: memo.content))
        return memo.tags.filter { !inContent.contains($0) }
    }

    /// 去 `#`、去空白
    static func clean(_ raw: String) -> String {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasPrefix("#") {
            text.removeFirst()
        }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 去重（保持首次出现顺序）
    static func dedupe(_ tags: [String]) -> [String] {
        var seen = Set<String>()
        var result: [String] = []
        for tag in tags {
            let value = clean(tag)
            guard !value.isEmpty, !seen.contains(value) else { continue }
            seen.insert(value)
            result.append(value)
        }
        return result
    }
}

// MARK: - 金额符号（与 Web `fieldForm.ts` 一致）

enum MemoCurrency {
    static func code(of def: FieldDefinition) -> String {
        let raw = def.currency?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return raw.isEmpty ? "CNY" : raw.uppercased()
    }

    /// ISO-4217 → 展示符号（未知币种回退代码本身）
    static func symbol(of code: String?) -> String {
        let key = (code ?? "CNY").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return symbols[key] ?? (key.isEmpty ? "¥" : key)
    }

    private static let symbols: [String: String] = [
        "CNY": "¥",
        "USD": "$",
        "EUR": "€",
        "GBP": "£",
        "JPY": "¥",
        "HKD": "HK$",
        "KRW": "₩",
        "TWD": "NT$",
        "SGD": "S$",
        "AUD": "A$",
        "CAD": "C$",
        "INR": "₹",
        "RUB": "₽",
        "CHF": "CHF",
        "THB": "฿",
        "MYR": "RM",
    ]
}

// MARK: - 数值文本

enum MemoNumberText {
    /// `Double` → 输入框文本（整数不带 `.0`；小数用最短往返表示，可被 `Double(_:)` 原样解析）
    static func text(from value: Double) -> String {
        if value.rounded() == value, abs(value) < 9_000_000_000_000 {
            return String(Int64(value))
        }
        return String(value)
    }
}
