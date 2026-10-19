//
//  AnalyticsModels.swift
//  浮墨增强版 iOS
//
//  洞察分析响应结构（docs/ANALYTICS.md / apps/web/src/lib/analyticsTypes.ts）的 Swift 转写。
//

import Foundation

enum Granularity: String, Codable, Sendable {
    case day
    case week
    case month

    var label: String {
        switch self {
        case .day: return "按日"
        case .week: return "按周"
        case .month: return "按月"
        }
    }
}

/// §2 通用区间结构
struct AnalyticsRange: Codable, Sendable {
    let from: String
    let to: String
    let timezone: String
    let days: Int
    let granularity: Granularity
    let label: String
}

// MARK: - 时间线 / 热力图 / 分布

struct TimelinePoint: Codable, Sendable, Identifiable {
    var id: String { bucket }
    let bucket: String
    let label: String
    let count: Int
    let chars: Int
}

struct Timeline: Codable, Sendable {
    let granularity: Granularity
    let points: [TimelinePoint]
}

struct HeatmapDay: Codable, Sendable, Identifiable {
    var id: String { date }
    let date: String
    let count: Int
}

struct Heatmap: Codable, Sendable {
    let max: Int
    let days: [HeatmapDay]
}

struct WeekdayBucket: Codable, Sendable, Identifiable {
    var id: Int { weekday }
    let weekday: Int
    let label: String
    let count: Int
}

struct Weekday: Codable, Sendable {
    let buckets: [WeekdayBucket]
}

struct HourBucket: Codable, Sendable, Identifiable {
    var id: Int { hour }
    let hour: Int
    let count: Int

    var label: String { String(format: "%02d:00", hour) }
}

struct HourOfDay: Codable, Sendable {
    let buckets: [HourBucket]
}

struct TagStat: Codable, Sendable, Identifiable {
    var id: String { tag }
    let tag: String
    let count: Int
    let share: Double
}

// MARK: - 数值统计（§4.1）

struct HistogramBin: Codable, Sendable, Identifiable {
    var id: Double { from }
    let from: Double
    let to: Double
    let count: Int
    /// 数值直方图（numeric/currency/percent/rating）带占比；
    /// 文本直方图（text/longtext）服务端只返回 from/to/count，故为可选。
    let ratio: Double?
    let cumulativeRatio: Double?
}

struct Histogram: Codable, Sendable {
    let binCount: Int
    let binWidth: Double
    let bins: [HistogramBin]
}

struct Outliers: Codable, Sendable {
    let method: String
    let lower: Double
    let upper: Double
    let count: Int
}

struct NumericStats: Codable, Sendable {
    let count: Int
    let sum: Double
    let mean: Double
    let median: Double
    let min: Double
    let max: Double
    let p25: Double
    let p75: Double
    let p90: Double
    let p95: Double
    let stddev: Double
    let range: Double
    let histogram: Histogram
    let outliers: Outliers
}

struct NumericTrendPoint: Codable, Sendable, Identifiable {
    var id: String { bucket }
    let bucket: String
    let label: String
    let count: Int
    let sum: Double
    let mean: Double
    let min: Double
    let max: Double
}

struct NumericTrend: Codable, Sendable {
    let granularity: Granularity
    let points: [NumericTrendPoint]
}

/// 分布单项（rating 的 value 为数字、label 缺省）
struct DistributionEntry: Codable, Sendable, Identifiable {
    var id: String { "\(label ?? value.displayText)-\(count)" }
    let value: FieldValue
    let label: String?
    let count: Int
    let share: Double

    var displayLabel: String { label ?? value.displayText }
}

// MARK: - 各类型统计块（§4.3 - §4.6）

struct BooleanStats: Codable, Sendable {
    let trueCount: Int
    let falseCount: Int
    let trueRatio: Double
}

struct DateStats: Codable, Sendable {
    let min: String
    let max: String
    let spanDays: Int
    let byMonth: [MonthCount]
    let byWeekday: [WeekdayCount]
    let byHour: [HourCount]?

    struct MonthCount: Codable, Sendable, Identifiable {
        var id: String { bucket }
        let bucket: String
        let count: Int
    }

    struct WeekdayCount: Codable, Sendable, Identifiable {
        var id: Int { weekday }
        let weekday: Int
        let count: Int
    }

    struct HourCount: Codable, Sendable, Identifiable {
        var id: Int { hour }
        let hour: Int
        let count: Int
    }
}

struct TextStats: Codable, Sendable {
    let totalChars: Int
    let avgChars: Double
    let minChars: Double
    let maxChars: Double
    let medianChars: Double
    let histogram: Histogram
    let topWords: [WordCount]
    let topWordsNote: String?

    struct WordCount: Codable, Sendable, Identifiable {
        var id: String { word }
        let word: String
        let count: Int
    }
}

struct UrlStats: Codable, Sendable {
    let distinctDomains: [DomainCount]
    let distinctCount: Int
    let httpsRatio: Double

    struct DomainCount: Codable, Sendable, Identifiable {
        var id: String { domain }
        let domain: String
        let count: Int
    }
}

// MARK: - 字段洞察

struct FieldFillRate: Codable, Sendable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let filled: Int
    let missing: Int
    let ratio: Double
}

struct FieldInsight: Codable, Sendable, Identifiable {
    var id: String { key }
    let key: String
    let label: String
    let type: FieldType
    let filled: Int
    let missing: Int
    let fillRatio: Double
    let valueUnion: [String]?

    let numeric: NumericStats?
    let trend: NumericTrend?
    let currency: String?
    let unit: String?
    let scale: Int?
    let distribution: [DistributionEntry]?
    let boolean: BooleanStats?
    let date: DateStats?
    let text: TextStats?
    let url: UrlStats?
}

// MARK: - 模板洞察（§3）

struct TemplateSummary: Codable, Sendable {
    let memoCount: Int
    let allMemoCount: Int
    let shareOfAllMemos: Double
    let totalChars: Int
    let avgChars: Double
    let memosWithContent: Int
    let activeDays: Int
    let dayCoverage: Double
    let longestStreak: Int
    let currentStreak: Int
    let busiestDay: BusiestDay?
    let firstMemoAt: String?
    let lastMemoAt: String?
    let fieldFillRate: [FieldFillRate]

    struct BusiestDay: Codable, Sendable {
        let date: String
        let count: Int
    }
}

struct TemplateInsights: Codable, Sendable {
    let template: InsightTemplate
    let range: AnalyticsRange
    let generatedAt: String
    let tookMs: Double
    let summary: TemplateSummary
    let timeline: Timeline
    let heatmap: Heatmap
    let weekday: Weekday
    let hourOfDay: HourOfDay
    let tags: [TagStat]
    let fields: [FieldInsight]

    struct InsightTemplate: Codable, Sendable {
        let id: String
        let name: String
        let icon: String
        let color: String
        let fields: [FieldDefinition]
    }
}

// MARK: - 全局概览（§5）

struct OverviewTemplateShare: Codable, Sendable, Identifiable {
    var id: String { templateId ?? "__none__" }
    let templateId: String?
    let templateName: String
    let icon: String
    let count: Int
    let share: Double
}

struct OverviewNumericField: Codable, Sendable, Identifiable {
    var id: String { "\(templateId)/\(key)" }
    let templateId: String
    let templateName: String
    let key: String
    let label: String
    let type: FieldType
    let currency: String?
    let count: Int
    let sum: Double
    let mean: Double
    let median: Double
    let max: Double
}

struct OverviewSummary: Codable, Sendable {
    let memoCount: Int
    let templateCount: Int
    let byTemplate: [OverviewTemplateShare]
    let totalChars: Int
    let avgChars: Double
    let activeDays: Int
    let dayCoverage: Double
    let longestStreak: Int
    let currentStreak: Int
}

struct AnalyticsOverview: Codable, Sendable {
    let range: AnalyticsRange
    let generatedAt: String
    let tookMs: Double
    let summary: OverviewSummary
    let timeline: Timeline
    let heatmap: Heatmap
    let weekday: Weekday
    let hourOfDay: HourOfDay
    let tags: [TagStat]
    let numericFields: [OverviewNumericField]
}
