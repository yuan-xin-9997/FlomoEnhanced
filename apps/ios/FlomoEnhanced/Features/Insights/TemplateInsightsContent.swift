//
//  TemplateInsightsContent.swift
//  浮墨增强版 iOS
//
//  模板洞察内容：摘要 + 趋势（条数/字数）+ 热力图 + 星期/时段 + 标签 + 字段填写率 + 字段卡片。
//

import Foundation
import SwiftUI

/// 模板洞察内容（`TemplateInsights`）
struct TemplateInsightsContent: View {
    let insights: TemplateInsights

    @State private var timelineMeasure: InsightTimelineMeasure = .count

    private var summary: TemplateSummary { insights.summary }
    private var template: TemplateInsights.InsightTemplate { insights.template }

    private var templateTitle: String {
        template.icon.isEmpty ? template.name : "\(template.icon) \(template.name)"
    }

    var body: some View {
        LazyVStack(spacing: 12) {
            if summary.memoCount == 0 {
                emptyCard
            } else {
                summaryCard
                timelineCard
                heatmapCard
                weekdayCard
                hourCard
                tagsCard
                fillRateCard

                if insights.fields.isEmpty {
                    InsightSection(title: "字段洞察") {
                        InsightEmptyBox(text: "该模板还没有定义字段", hint: "去「模板」页为它添加字段后再回来查看。")
                    }
                } else {
                    ForEach(insights.fields) { field in
                        FieldInsightCardView(
                            insight: field,
                            def: template.fields.first { $0.key == field.key }
                        )
                    }
                }
            }
        }
    }

    // MARK: - 空态

    private var emptyCard: some View {
        InsightSection(title: templateTitle, subtitle: insights.range.label) {
            InsightEmptyBox(
                text: "该区间没有数据",
                hint: "「\(template.name)」在这个区间内没有记录，换个区间或先去记录几条。"
            )
        }
    }

    // MARK: - 摘要

    private var summaryCard: some View {
        let busiest = summary.busiestDay
        let items: [InsightKpiItem] = [
            InsightKpiItem(
                label: "记录数",
                value: InsightFormat.count(summary.memoCount),
                sub: "占全部想法 \(InsightFormat.share(summary.shareOfAllMemos))"
            ),
            InsightKpiItem(
                label: "全部想法数",
                value: InsightFormat.count(summary.allMemoCount),
                sub: "\(InsightFormat.count(summary.memosWithContent)) 条有文字内容"
            ),
            InsightKpiItem(
                label: "总字数",
                value: InsightFormat.count(summary.totalChars),
                sub: "平均 \(InsightFormat.compact(summary.avgChars)) 字/条"
            ),
            InsightKpiItem(
                label: "活跃天数",
                value: InsightFormat.count(summary.activeDays),
                sub: "覆盖率 \(InsightFormat.share(summary.dayCoverage))"
            ),
            InsightKpiItem(
                label: "当前连续",
                value: "\(InsightFormat.count(summary.currentStreak)) 天",
                sub: "最长 \(InsightFormat.count(summary.longestStreak)) 天"
            ),
            InsightKpiItem(
                label: "最忙碌日",
                value: busiest?.date ?? "—",
                sub: busiest.map { "\(InsightFormat.count($0.count)) 条" } ?? "暂无记录"
            ),
        ]

        return InsightSection(title: templateTitle, subtitle: insights.range.label) {
            VStack(alignment: .leading, spacing: 10) {
                InsightKpiGrid(items: items)
                firstLastRow
            }
        }
    }

    @ViewBuilder
    private var firstLastRow: some View {
        if summary.firstMemoAt != nil || summary.lastMemoAt != nil {
            HStack(spacing: 10) {
                if let first = summary.firstMemoAt {
                    Text("首次记录 \(String(first.prefix(10)))")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 4)
                if let last = summary.lastMemoAt {
                    Text("最近记录 \(Dates.formatTimestamp(last))")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
        }
    }

    // MARK: - 趋势

    private var timelineCard: some View {
        InsightSection(
            title: "记录趋势",
            subtitle: insights.range.granularity.label,
            trailing: {
                Picker("趋势度量", selection: $timelineMeasure) {
                    ForEach(InsightTimelineMeasure.allCases) { measure in
                        Text(measure.label).tag(measure)
                    }
                }
                .pickerStyle(.segmented)
                .frame(width: 128)
            }
        ) {
            InsightTimelineChart(points: insights.timeline.points, measure: timelineMeasure)
        }
    }

    // MARK: - 热力图

    private var heatmapCard: some View {
        InsightSection(title: "记录热力图", subtitle: "单日最多 \(InsightFormat.count(insights.heatmap.max)) 条") {
            InsightHeatmapView(days: insights.heatmap.days, maxValue: insights.heatmap.max)
        }
    }

    // MARK: - 星期 / 时段

    private var weekdayCard: some View {
        InsightSection(title: "星期分布") {
            InsightCategoryBarChart(
                labels: insights.weekday.buckets.map { $0.label.isEmpty ? "周\($0.weekday)" : $0.label },
                values: insights.weekday.buckets.map { $0.count },
                color: Theme.chartPalette[0],
                height: 170
            )
        }
    }

    private var hourCard: some View {
        InsightSection(title: "时段分布（24 小时）") {
            InsightCategoryBarChart(
                labels: insights.hourOfDay.buckets.map { String(format: "%02d", $0.hour) },
                values: insights.hourOfDay.buckets.map { $0.count },
                color: Theme.chartPalette[3],
                height: 170,
                desiredXTicks: 8
            )
        }
    }

    // MARK: - 标签 Top

    private var tagsCard: some View {
        let items = insights.tags.map { tag in
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

    // MARK: - 字段填写率

    private var fillRateCard: some View {
        let rates = summary.fieldFillRate
        return InsightSection(title: "字段填写率", subtitle: "共 \(InsightFormat.count(rates.count)) 个字段") {
            if rates.isEmpty {
                InsightEmptyBox(text: "该模板还没有定义字段")
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(rates) { rate in
                        InsightFillRateRow(
                            label: rate.label,
                            key: rate.key,
                            filled: rate.filled,
                            missing: rate.missing,
                            ratio: rate.ratio
                        )
                    }
                }
            }
        }
    }
}
