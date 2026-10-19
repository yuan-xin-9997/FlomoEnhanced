//
//  FieldInsightCardView.swift
//  浮墨增强版 iOS
//
//  单个字段的洞察卡片：填写率 + 按字段类型渲染的统计与图表（docs/IOS.md §4.4）。
//

import Foundation
import SwiftUI

/// 字段类型中文名（本模块自用，避免依赖其他 Feature）
private func insightTypeLabel(_ type: FieldType) -> String {
    switch type {
    case .text: return "文本"
    case .longtext: return "长文本"
    case .number: return "数字"
    case .currency: return "金额"
    case .percent: return "百分比"
    case .rating: return "评分"
    case .date: return "日期"
    case .datetime: return "日期时间"
    case .select: return "单选"
    case .multiselect: return "多选"
    case .boolean: return "是否"
    case .url: return "链接"
    }
}

/// 单字段洞察卡片
struct FieldInsightCardView: View {
    let insight: FieldInsight
    var def: FieldDefinition? = nil

    @State private var trendMeasure: InsightNumericMeasure = .mean

    var body: some View {
        InsightSection(title: insight.label, subtitle: "\(insightTypeLabel(insight.type)) · \(insight.key)") {
            VStack(alignment: .leading, spacing: 12) {
                fillHeader
                content
            }
        }
    }

    // MARK: - 填写率

    private var fillHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("填写率 \(InsightFormat.share(insight.fillRatio))")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 4)
                Text("\(InsightFormat.count(insight.filled)) 有值 · \(InsightFormat.count(insight.missing)) 缺失")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
            ProgressView(value: InsightFormat.clamp01(insight.fillRatio))
                .tint(Theme.brand)
        }
    }

    // MARK: - 按类型分支

    @ViewBuilder
    private var content: some View {
        switch insight.type {
        case .number, .currency, .percent, .rating:
            numericContent
        case .select, .multiselect:
            distributionContent
        case .boolean:
            booleanContent
        case .date, .datetime:
            dateContent
        case .text, .longtext:
            textContent
        case .url:
            urlContent
        }
    }

    // MARK: - 数值型

    @ViewBuilder
    private var numericContent: some View {
        if let stats = insight.numeric, stats.count > 0 {
            InsightKpiGrid(items: numericKpiItems(stats))

            if !stats.histogram.bins.isEmpty {
                block("数值分布（直方图）") {
                    InsightHistogramChart(bins: stats.histogram.bins)
                }
            }

            if let trend = insight.trend, !trend.points.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("数值趋势")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Theme.textSecondary)
                        Spacer(minLength: 0)
                        Picker("趋势度量", selection: $trendMeasure) {
                            ForEach(InsightNumericMeasure.allCases) { measure in
                                Text(measure.label).tag(measure)
                            }
                        }
                        .pickerStyle(.segmented)
                        .frame(width: 128)
                    }
                    InsightNumericTrendChart(trend: trend, measure: trendMeasure)
                }
            }

            if insight.type == .rating, !ratingDistribution.isEmpty, ratingDistributionTotal > 0 {
                block("评分分布") {
                    InsightCategoryBarChart(
                        labels: ratingDistribution.map { $0.label },
                        values: ratingDistribution.map { $0.count },
                        color: Theme.chartPalette[2],
                        height: 150
                    )
                }
            }

            if stats.outliers.count > 0 {
                footnote("离群值提示（1.5×IQR）：\(InsightFormat.count(stats.outliers.count)) 个 · 参考区间 [\(formatNumeric(stats.outliers.lower)), \(formatNumeric(stats.outliers.upper))]")
            }
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    private func numericKpiItems(_ stats: NumericStats) -> [InsightKpiItem] {
        [
            InsightKpiItem(label: "有值条数", value: InsightFormat.count(stats.count)),
            InsightKpiItem(label: "合计", value: formatNumeric(stats.sum)),
            InsightKpiItem(label: "平均", value: formatNumeric(stats.mean)),
            InsightKpiItem(label: "中位数", value: formatNumeric(stats.median)),
            InsightKpiItem(label: "最小", value: formatNumeric(stats.min)),
            InsightKpiItem(label: "最大", value: formatNumeric(stats.max)),
            InsightKpiItem(label: "P25", value: formatNumeric(stats.p25)),
            InsightKpiItem(label: "P75", value: formatNumeric(stats.p75)),
            InsightKpiItem(label: "P90", value: formatNumeric(stats.p90)),
            InsightKpiItem(label: "P95", value: formatNumeric(stats.p95)),
            InsightKpiItem(label: "标准差", value: formatNumeric(stats.stddev)),
            InsightKpiItem(label: "极差", value: formatNumeric(stats.range)),
        ]
    }

    /// 数值展示：number 简化；currency 加币种符号；percent 加 %；rating 显示 x / scale
    private func formatNumeric(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        switch insight.type {
        case .currency:
            return InsightFormat.currency(value, code: insight.currency ?? def?.currency)
        case .percent:
            return InsightFormat.compact(value) + (insight.unit ?? "%")
        case .rating:
            let scale = insight.scale ?? def?.scale ?? 5
            return "\(InsightFormat.compact(value)) / \(scale)"
        default:
            return InsightFormat.compact(value)
        }
    }

    private var ratingScale: Int {
        insight.scale ?? def?.scale ?? 5
    }

    private struct RatingBucket {
        let label: String
        let count: Int
    }

    private var ratingDistribution: [RatingBucket] {
        let scale = ratingScale
        var counts: [Int: Int] = [:]
        for entry in insight.distribution ?? [] {
            guard let raw = entry.value.numberValue, raw.isFinite else { continue }
            counts[Int(raw.rounded())] = entry.count
        }
        return (0...max(0, scale)).map { value in
            RatingBucket(
                label: value == 0 ? "未评分" : "\(value) 分",
                count: counts[value] ?? 0
            )
        }
    }

    private var ratingDistributionTotal: Int {
        ratingDistribution.reduce(0) { $0 + $1.count }
    }

    // MARK: - 单选 / 多选

    @ViewBuilder
    private var distributionContent: some View {
        let rows = distributionRows
        if rows.contains(where: { $0.value > 0 }) {
            block(insight.type == .select ? "选项分布" : "选项分布（一条可多选）") {
                InsightRankedBarChart(items: rows, multicolor: true)
            }
            if insight.type == .multiselect {
                footnote("占比分母为该字段被引用的总次数")
            }
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    /// 分布（补齐模板定义但未出现的选项，按条数降序由图表组件排序）
    private var distributionRows: [InsightRankedItem] {
        var labels: [String: String] = [:]
        var counts: [String: Int] = [:]
        var shares: [String: Double] = [:]
        var order: [String] = []

        func register(_ value: String) {
            if !order.contains(value) { order.append(value) }
        }

        for option in def?.options ?? [] {
            labels[option.value] = option.label
            if counts[option.value] == nil { counts[option.value] = 0 }
            register(option.value)
        }
        for entry in insight.distribution ?? [] {
            let value = entry.value.displayText
            if let label = entry.label, !label.isEmpty { labels[value] = label }
            counts[value] = entry.count
            shares[value] = entry.share
            register(value)
        }
        for value in insight.valueUnion ?? [] {
            if counts[value] == nil { counts[value] = 0 }
            register(value)
        }

        return order.compactMap { value in
            guard let count = counts[value] else { return nil }
            return InsightRankedItem(
                id: value,
                name: labels[value] ?? value,
                value: count,
                note: "\(InsightFormat.count(count)) · \(InsightFormat.share(shares[value] ?? 0))"
            )
        }
    }

    // MARK: - 布尔

    @ViewBuilder
    private var booleanContent: some View {
        if let stats = insight.boolean, stats.trueCount + stats.falseCount > 0 {
            InsightBooleanDonut(trueCount: stats.trueCount, falseCount: stats.falseCount)
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    // MARK: - 日期 / 日期时间

    @ViewBuilder
    private var dateContent: some View {
        let stats = insight.date
        let hasBuckets = stats.map { !$0.byMonth.isEmpty || !$0.byWeekday.isEmpty || !($0.byHour ?? []).isEmpty } ?? false
        if let stats, hasBuckets {
            HStack(spacing: 10) {
                InsightKpiItemView(label: "最早", value: stats.min.isEmpty ? "—" : stats.min)
                InsightKpiItemView(label: "最晚", value: stats.max.isEmpty ? "—" : stats.max)
                InsightKpiItemView(label: "跨度", value: "\(InsightFormat.count(stats.spanDays)) 天")
            }

            if !stats.byMonth.isEmpty {
                block("按时间分布") {
                    InsightCategoryBarChart(
                        labels: stats.byMonth.map { $0.bucket },
                        values: stats.byMonth.map { $0.count },
                        color: Theme.chartPalette[0].opacity(0.85),
                        desiredXTicks: 5
                    )
                }
            }
            if !stats.byWeekday.isEmpty {
                block("按星期分布") {
                    InsightCategoryBarChart(
                        labels: stats.byWeekday.map { insightWeekdayLabel($0.weekday) },
                        values: stats.byWeekday.map { $0.count },
                        color: Theme.chartPalette[5],
                        height: 160
                    )
                }
            }
            if insight.type == .datetime, let byHour = stats.byHour, !byHour.isEmpty {
                block("按小时分布") {
                    InsightCategoryBarChart(
                        labels: byHour.map { String(format: "%02d", $0.hour) },
                        values: byHour.map { $0.count },
                        color: Theme.chartPalette[3],
                        height: 160,
                        desiredXTicks: 8
                    )
                }
            }
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    // MARK: - 文本

    @ViewBuilder
    private var textContent: some View {
        if let stats = insight.text, stats.totalChars > 0 || !stats.topWords.isEmpty || !stats.histogram.bins.isEmpty {
            InsightKpiGrid(items: [
                InsightKpiItem(label: "总字数", value: InsightFormat.count(stats.totalChars)),
                InsightKpiItem(label: "平均", value: InsightFormat.compact(stats.avgChars)),
                InsightKpiItem(label: "最短", value: InsightFormat.compact(stats.minChars)),
                InsightKpiItem(label: "最长", value: InsightFormat.compact(stats.maxChars)),
                InsightKpiItem(label: "中位", value: InsightFormat.compact(stats.medianChars)),
            ])

            if !stats.histogram.bins.isEmpty {
                block("字数分布") {
                    InsightHistogramChart(bins: stats.histogram.bins)
                }
            }

            if !stats.topWords.isEmpty {
                block("高频词") {
                    InsightRankedBarChart(
                        items: stats.topWords.map {
                            InsightRankedItem(id: $0.word, name: $0.word, value: $0.count, note: InsightFormat.count($0.count))
                        },
                        color: Theme.chartPalette[3],
                        maxRows: 15
                    )
                }
            }
            if let note = stats.topWordsNote, !note.isEmpty {
                footnote(note)
            }
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    // MARK: - 链接

    @ViewBuilder
    private var urlContent: some View {
        if let stats = insight.url, !stats.distinctDomains.isEmpty || insight.filled > 0 {
            InsightKpiGrid(items: [
                InsightKpiItem(label: "不同链接", value: InsightFormat.count(stats.distinctCount)),
                InsightKpiItem(label: "域名数", value: InsightFormat.count(stats.distinctDomains.count)),
                InsightKpiItem(label: "HTTPS 占比", value: InsightFormat.share(stats.httpsRatio)),
                InsightKpiItem(label: "链接条数", value: InsightFormat.count(insight.filled)),
            ])

            if !stats.distinctDomains.isEmpty {
                block("域名 Top") {
                    InsightRankedBarChart(
                        items: stats.distinctDomains.map {
                            InsightRankedItem(id: $0.domain, name: $0.domain, value: $0.count, note: InsightFormat.count($0.count))
                        },
                        color: Theme.chartPalette[2],
                        maxRows: 15
                    )
                }
            }
        } else {
            InsightEmptyBox(text: "该区间内暂无该字段的数据")
        }
    }

    // MARK: - 小工具

    @ViewBuilder
    private func block<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
            content()
        }
    }

    private func footnote(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(Theme.textSecondary)
    }
}

/// 单个小指标（无底色，日期卡片内联用）
struct InsightKpiItemView: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
            Text(value)
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

/// 星期中文名（1 = 周一 … 7 = 周日）
private func insightWeekdayLabel(_ weekday: Int) -> String {
    let names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    guard weekday >= 1 && weekday <= names.count else { return "周\(weekday)" }
    return names[weekday - 1]
}
