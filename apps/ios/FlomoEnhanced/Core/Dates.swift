//
//  Dates.swift
//  浮墨增强版 iOS
//
//  日期与区间换算：与 apps/web/src/lib/dates.ts 逐行对齐（docs/IOS.md §3.6）。
//  所有「日」都按设备当前时区计算，与 Web 的「浏览器本地时区」语义一致；
//  输出格式与 JS `Date#toISOString()` 完全一致（毫秒 3 位 + `Z`），
//  例：`2026-10-12T16:00:00.000Z`。
//

import Foundation

/// 区间快捷按钮标识（对应 TS `RangePreset`）
enum RangePreset: String, CaseIterable, Identifiable {
    case d7 = "7d"
    case d30 = "30d"
    case m6 = "6m"
    case custom

    var id: String { rawValue }

    /// 中文文案（对应 TS `RANGE_PRESETS`）
    var label: String {
        switch self {
        case .d7: return "最近 7 天"
        case .d30: return "最近 30 天"
        case .m6: return "最近 6 个月"
        case .custom: return "自定义"
        }
    }
}

/// 日期区间（`YYYY-MM-DD`，闭区间，本地日；对应 TS `DayRange`）
struct DayRange: Equatable {
    var from: String
    var to: String
}

enum Dates {

    // MARK: - 日历 / 时区 / 正则

    /// 公历 + 设备当前时区（时区语义等价于 `Calendar.current` / `TimeZone.current`）。
    /// 固定用 Gregorian：设备若设置成其他历法（如佛历），仍与 Web 的 JS 日期行为一致。
    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone.current
        return calendar
    }

    /// UTC 历法（只用于 `dayDiff` 的绝对天数差）
    private static var utcCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utcTimeZone
        return calendar
    }

    private static let utcTimeZone: TimeZone =
        TimeZone(secondsFromGMT: 0) ?? TimeZone(identifier: "UTC") ?? TimeZone.current

    /// `/^(\d{4})-(\d{2})-(\d{2})$/`（JS 的 `\d` 只匹配 ASCII 数字，这里显式写 [0-9]）
    private static let dayKeyRegex: NSRegularExpression = {
        // 字面量固定，不会抛错
        try! NSRegularExpression(pattern: "^([0-9]{4})-([0-9]{2})-([0-9]{2})$")
    }()

    // MARK: - 基本换算

    /// 今天（本地）的 day key
    static func todayKey() -> String {
        toDayKey(Date())
    }

    /// `Date` → 本地 `YYYY-MM-DD`
    static func toDayKey(_ date: Date) -> String {
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return dayKey(
            year: components.year ?? 1970,
            month: components.month ?? 1,
            day: components.day ?? 1
        )
    }

    /// 解析 `YYYY-MM-DD`；格式不对 / 真实日历不存在 → nil。
    /// 与 TS `parseDayKey` 一致：JS 的 `new Date(0..99, ...)` 会把 0..99 年补成 1900+，
    /// 回读不一致 → 判非法，所以这里也拒绝 999 年以前的值。
    static func parseDayKey(_ key: String) -> DateComponents? {
        let fullRange = NSRange(key.startIndex..<key.endIndex, in: key)
        guard let match = dayKeyRegex.firstMatch(in: key, options: [], range: fullRange),
              match.range == fullRange,   // ICU 的 `$` 会容忍结尾换行，JS 不会，故强制整串匹配
              match.numberOfRanges >= 4,
              let year = intValue(key, match.range(at: 1)),
              let month = intValue(key, match.range(at: 2)),
              let day = intValue(key, match.range(at: 3)),
              year >= 100,
              isValidCalendarDay(year: year, month: month, day: day) else { return nil }
        return DateComponents(year: year, month: month, day: day)
    }

    /// day key 平移 n 天
    static func addDays(_ key: String, _ days: Int) -> String {
        guard let components = parseDayKey(key), let base = calendar.date(from: components) else {
            return key
        }
        guard let shifted = calendar.date(byAdding: .day, value: days, to: base) else { return key }
        return toDayKey(shifted)
    }

    /// day key 平移 n 个自然月（日期溢出回落，如 3-31 → 2-28）
    static func addMonths(_ key: String, _ months: Int) -> String {
        guard let components = parseDayKey(key),
              let year = components.year,
              let month = components.month,
              let day = components.day else { return key }
        // 以「当月 1 号」为中转，避免 Calendar 提前把 31 号滚动到下个月
        guard let monthStart = calendar.date(from: DateComponents(year: year, month: month, day: 1)),
              let target = calendar.date(byAdding: .month, value: months, to: monthStart) else {
            return key
        }
        let targetComponents = calendar.dateComponents([.year, .month], from: target)
        guard let targetYear = targetComponents.year, let targetMonth = targetComponents.month else {
            return key
        }
        let lastDay = calendar.range(of: .day, in: .month, for: target)?.count ?? 28
        return dayKey(year: targetYear, month: targetMonth, day: min(day, lastDay))
    }

    /// `to - from` 的天数差（按 UTC 绝对天数，避免夏令时误差）
    static func dayDiff(_ from: String, _ to: String) -> Int {
        guard let a = parseDayKey(from), let b = parseDayKey(to),
              let start = utcCalendar.date(from: a),
              let end = utcCalendar.date(from: b) else { return 0 }
        return Int((end.timeIntervalSince(start) / 86_400).rounded())
    }

    /// 闭区间天数（含首尾）
    static func inclusiveDays(_ from: String, _ to: String) -> Int {
        max(0, dayDiff(from, to) + 1)
    }

    /// 本地日 `00:00:00.000` 对应的 UTC ISO（如 `2026-10-12T16:00:00.000Z`）
    static func dayStartIso(_ key: String) -> String {
        dayBoundaryIso(key, hour: 0, minute: 0, second: 0, millisecond: 0)
    }

    /// 本地日 `23:59:59.999` 对应的 UTC ISO
    static func dayEndIso(_ key: String) -> String {
        dayBoundaryIso(key, hour: 23, minute: 59, second: 59, millisecond: 999)
    }

    // MARK: - 区间

    /// 区间按快捷按钮换算（`custom` 原样返回 `current`，没有就用最近 30 天）
    static func rangeForPreset(_ preset: RangePreset, today: String, current: DayRange? = nil) -> DayRange {
        let safeToday = parseDayKey(today) == nil ? todayKey() : today
        switch preset {
        case .d7:
            return DayRange(from: addDays(safeToday, -6), to: safeToday)
        case .d30:
            return DayRange(from: addDays(safeToday, -29), to: safeToday)
        case .m6:
            return DayRange(from: addMonths(safeToday, -6), to: safeToday)
        case .custom:
            return current ?? DayRange(from: addDays(safeToday, -29), to: safeToday)
        }
    }

    /// 校验自定义区间（from ≤ to、跨度 ≤ 3660 天）；合法返回 nil，否则返回中文文案
    static func validateRange(_ range: DayRange) -> String? {
        guard parseDayKey(range.from) != nil, parseDayKey(range.to) != nil else {
            return "请选择合法的日期区间"
        }
        if dayDiff(range.from, range.to) < 0 { return "开始日期不能晚于结束日期" }
        if inclusiveDays(range.from, range.to) > 3660 { return "区间跨度不能超过约 10 年" }
        return nil
    }

    // MARK: - 时间戳展示

    /// ISO8601（含毫秒）→ 本地 `yyyy-MM-dd HH:mm`；解析失败返回原串
    static func formatTimestamp(_ iso: String) -> String {
        guard let date = parseIsoTimestamp(iso) else { return iso }
        // 用 Calendar + 手工补零（不依赖 DateFormatter 的 locale/历法设置，输出稳定）
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard let year = components.year,
              let month = components.month,
              let day = components.day,
              let hour = components.hour,
              let minute = components.minute else { return iso }
        return "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2)) \(pad(hour, 2)):\(pad(minute, 2))"
    }

    /// 本地 `yyyyMMdd`（导出文件名用）
    static func todayFilenameStamp() -> String {
        toDayKey(Date()).replacingOccurrences(of: "-", with: "")
    }

    // MARK: - 内部工具

    /// 本地日边界 → UTC ISO8601（与 JS `toISOString()` 逐字一致：3 位毫秒 + `Z`）。
    /// 毫秒位直接用调用方给的意图值（0 / 999），并先把时刻取整到整秒，
    /// 避免 `Date` 的亚毫秒浮点误差把 `...59.999Z` 写成 `...59.998Z`。
    private static func dayBoundaryIso(
        _ key: String,
        hour: Int,
        minute: Int,
        second: Int,
        millisecond: Int
    ) -> String {
        guard let parsed = parseDayKey(key) else { return "" }
        var components = parsed
        components.hour = hour
        components.minute = minute
        components.second = second
        components.nanosecond = millisecond * 1_000_000
        guard let date = calendar.date(from: components) else { return "" }
        // 起始边界（0ms）向最近整秒取整；结束边界（999ms）向下取整 —— 两者都能容忍亚毫秒误差
        let epoch = date.timeIntervalSince1970
        let snapped = Date(timeIntervalSince1970: millisecond >= 500 ? epoch.rounded(.down) : epoch.rounded())
        let utc = utcCalendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: snapped)
        return "\(pad(utc.year ?? 1970, 4))"
            + "-\(pad(utc.month ?? 1, 2))"
            + "-\(pad(utc.day ?? 1, 2))"
            + "T\(pad(utc.hour ?? 0, 2))"
            + ":\(pad(utc.minute ?? 0, 2))"
            + ":\(pad(utc.second ?? 0, 2))"
            + ".\(pad(millisecond, 3))Z"
    }

    /// 解析服务端时间戳（含毫秒优先，其次无毫秒）
    private static func parseIsoTimestamp(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// 真实日历校验（拒绝 2026-02-30 这类不存在的日期）
    private static func isValidCalendarDay(year: Int, month: Int, day: Int) -> Bool {
        guard month >= 1, month <= 12, day >= 1, day <= 31 else { return false }
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        guard let date = calendar.date(from: components) else { return false }
        let check = calendar.dateComponents([.year, .month, .day], from: date)
        return check.year == year && check.month == month && check.day == day
    }

    /// `YYYY-MM-DD`（月 / 日补零；年补到 4 位以保证与 `parseDayKey` 可来回转换）
    private static func dayKey(year: Int, month: Int, day: Int) -> String {
        "\(pad(year, 4))-\(pad(month, 2))-\(pad(day, 2))"
    }

    /// 左侧补零（不用 `String(format:)`，避免本地化数字带来的意外）
    private static func pad(_ value: Int, _ width: Int) -> String {
        var text = String(value)
        if text.count < width {
            text = String(repeating: "0", count: width - text.count) + text
        }
        return text
    }

    private static func intValue(_ source: String, _ range: NSRange) -> Int? {
        guard range.location != NSNotFound, let range = Range(range, in: source) else { return nil }
        return Int(source[range])
    }
}
