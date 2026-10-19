//
//  OverviewContent.swift
//  浮墨增强版 iOS
//
//  全局概览（未选模板）内容：摘要 + 各模板占比 + 时间线 + 热力图 + 星期/时段 + 标签 + 数值字段汇总。
//

import Foundation
import SwiftUI

/// 全局概览内容（`AnalyticsOverview`）
struct OverviewContent: View {
    let overview: AnalyticsOverview

    private var summary: OverviewSummary { overview.summary }

    var body: some View {
        LazyVStack(spacing: 12) {
            if summary.memoCount == 0 {
                InsightSection(title: "全局概览") {
                    InsightEmptyBox(text: "该区间没有数据", hint: "换个区间试试，或先去记录几条。")
                }
            } else {
                summaryCard
                shareCard
                timelineCard
                heatmapCard
                weekdayCard
                hourCard
                tagsCard
                numericFieldsCard
            }
        }
    }

    // MARK: - 摘要

    private var summaryCard: some View {
        InsightSection(title: "全局概览", subtitle: overview.range.label) {
            InsightKpiGrid(items: [
                InsightKpiItem(label: "记录数", value: InsightFormat.count(summary.memoCount)),
                InsightKpiItem(label: "使用模板数", value: InsightFormat.count(summary.templateCount)),
                InsightKpiItem(label: "活跃天数", value: InsightFormat.count(summary.activeDays), sub: "覆盖率 \(InsightFormat.share(summary.dayCoverage))"),
                InsightKpiItem(label: "当前连续", value: "\(InsightFormat.count(summary.currentStreak)) 天", sub: "最长 \(InsightFormat.count(summary.longestStreak)) 天"),
                InsightKpiItem(label: "总字数", value: InsightFormat.count(summary.totalChars), sub: "平均 \(InsightFormat.compact(summary.avgChars)) 字/条"),
            ])
        }
    }

    // MARK: - 各模板占比

    private var shareCard: some View {
        let items = summary.byTemplate.map { share in
            InsightRankedItem(
                id: share.id,
                name: share.icon.isEmpty ? share.templateName : "\(share.icon) \(share.templateName)",
                value: share.count,
                note: "\(InsightFormat.count(share.count)) · \(InsightFormat.share(share.share))"
            )
        }
        return InsightSection(title: "各模板记录占比", subtitle: "共 \(InsightFormat.count(items.count)) 项") {
            if items.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                InsightRankedBarChart(items: items, multicolor: true, maxRows: 12)
            }
        }
    }

    // MARK: - 时间线

    private var timelineCard: some View {
        InsightSection(title: "记录趋势", subtitle: overview.range.granularity.label) {
            InsightTimelineChart(points: overview.timeline.points, measure: .count)
        }
    }

    // MARK: - 热力图

    private var heatmapCard: some View {
        InsightSection(title: "记录热力图", subtitle: "单日最多 \(InsightFormat.count(overview.heatmap.max)) 条") {
            InsightHeatmapView(days: overview.heatmap.days, maxValue: overview.heatmap.max)
        }
    }

    // MARK: - 星期 / 时段

    private var weekdayCard: some View {
        InsightSection(title: "星期分布") {
            InsightCategoryBarChart(
                labels: overview.weekday.buckets.map { $0.label.isEmpty ? "周\($0.weekday)" : $0.label },
                values: overview.weekday.buckets.map { $0.count },
                color: Theme.chartPalette[0],
                height: 170
            )
        }
    }

    private var hourCard: some View {
        InsightSection(title: "时段分布（24 小时）") {
            InsightCategoryBarChart(
                labels: overview.hourOfDay.buckets.map { String(format: "%02d", $0.hour) },
                values: overview.hourOfDay.buckets.map { $0.count },
                color: Theme.chartPalette[3],
                height: 170,
                desiredXTicks: 8
            )
        }
    }

    // MARK: - 标签 Top

    private var tagsCard: some View {
        let items = overview.tags.map { tag in
            InsightRankedItem(
                id: tag.tag,
                name: tag.tag,
                value: tag.count,
                note: "\(InsightFormat.count(tag.count)) · \(InsightFormat.share(tag.share))"
            )
        }
        return InsightSection(title: "标签 Top", subtitle: "共 \(InsightFormat.count(items.count)) 个") {
            if items.isEmpty {
                InsightEmptyBox(text: "该区间没有标签数据")
            } else {
                InsightRankedBarChart(items: items, color: Theme.chartPalette[0], maxRows: 20)
            }
        }
    }

    // MARK: - 跨模板数值字段汇总

    private var numericFieldsCard: some View {
        let fields = overview.numericFields.sorted { lhs, rhs in
            if lhs.sum != rhs.sum { return lhs.sum > rhs.sum }
            return lhs.templateName.localizedCompare(rhs.templateName) == .orderedAscending
        }
        return InsightSection(title: "数值字段汇总", subtitle: "跨模板 · \(InsightFormat.count(fields.count)) 项") {
            if fields.isEmpty {
                InsightEmptyBox(text: "该区间没有数值字段数据")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(fields) { field in
                        numericFieldRow(field)
                    }
                }
            }
        }
    }

    private func numericFieldRow(_ field: OverviewNumericField) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(field.templateName)
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                Text(field.label)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                Text(field.key)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            HStack(spacing: 6) {
                InsightKpiItemView(label: "数量", value: InsightFormat.count(field.count))
                InsightKpiItemView(label: "求和", value: numericText(field.sum, field: field))
                InsightKpiItemView(label: "均值", value: numericText(field.mean, field: field))
                InsightKpiItemView(label: "中位数", value: numericText(field.median, field: field))
                InsightKpiItemView(label: "最大值", value: numericText(field.max, field: field))
            }
        }
        .padding(8)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// 数值展示：currency 加币种符号；percent 加 %；其余简化数值
    private func numericText(_ value: Double, field: OverviewNumericField) -> String {
        guard value.isFinite else { return "—" }
        switch field.type {
        case .currency:
            return InsightFormat.currency(value, code: field.currency)
        case .percent:
            return InsightFormat.percentValue(value)
        default:
            return InsightFormat.compact(value)
        }
    }
}
