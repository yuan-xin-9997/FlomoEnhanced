//
//  InsightCharts.swift
//  浮墨增强版 iOS
//
//  洞察模块可复用图表组件（Swift Charts）：
//  时间线 / 分类柱状 / 横向排名 / 直方图 / 数值趋势 / 布尔环形 / 热力图。
//

import Foundation
import SwiftUI
import Charts

// MARK: - 度量与数据项

/// 时间线度量（条数 / 字数）
enum InsightTimelineMeasure: String, CaseIterable, Identifiable {
    case count
    case chars

    var id: String { rawValue }

    var label: String {
        switch self {
        case .count: return "条数"
        case .chars: return "字数"
        }
    }

    func value(of point: TimelinePoint) -> Int {
        self == .count ? point.count : point.chars
    }
}

/// 数值趋势度量（均值 / 合计）
enum InsightNumericMeasure: String, CaseIterable, Identifiable {
    case mean
    case sum

    var id: String { rawValue }

    var label: String {
        switch self {
        case .mean: return "均值"
        case .sum: return "合计"
        }
    }

    func value(of point: NumericTrendPoint) -> Double {
        self == .mean ? point.mean : point.sum
    }
}

/// 横向排名条目（标签 / 域名 / 分布共用）
struct InsightRankedItem: Identifiable, Equatable {
    let id: String
    let name: String
    let value: Int
    var note: String? = nil
}

// MARK: - 时间线

/// 条数/字数时间线：数据点 ≤ 62 用柱状，更多用折线（避免柱子过密）
struct InsightTimelineChart: View {
    let points: [TimelinePoint]
    var measure: InsightTimelineMeasure = .count
    var height: CGFloat = 200
    var desiredXTicks: Int = 6

    var body: some View {
        Group {
            if points.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                let useBars = points.count <= 62
                Chart(points) { point in
                    if useBars {
                        BarMark(
                            x: .value("时间", point.label),
                            y: .value(measure.label, measure.value(of: point))
                        )
                        .foregroundStyle(Theme.chartPalette[0].opacity(0.85))
                        .cornerRadius(3)
                    } else {
                        LineMark(
                            x: .value("时间", point.label),
                            y: .value(measure.label, measure.value(of: point))
                        )
                        .foregroundStyle(Theme.chartPalette[0])
                        .interpolationMethod(.linear)
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: desiredXTicks)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .chartYAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .frame(height: height)
            }
        }
    }
}

// MARK: - 分类柱状（星期 / 小时 / 日期分桶共用）

/// 分类柱状图：labels 与 values 一一对应
struct InsightCategoryBarChart: View {
    let labels: [String]
    let values: [Int]
    var color: Color = Theme.chartPalette[0]
    var height: CGFloat = 180
    var desiredXTicks: Int = 7

    var body: some View {
        Group {
            if labels.isEmpty || labels.count != values.count {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                Chart {
                    ForEach(Array(labels.indices), id: \.self) { index in
                        BarMark(
                            x: .value("类别", labels[index]),
                            y: .value("数量", values[index])
                        )
                        .foregroundStyle(color)
                        .cornerRadius(3)
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: desiredXTicks)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .chartYAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .frame(height: height)
            }
        }
    }
}

// MARK: - 横向排名（标签 Top / 域名 / 分布 / 汇总排行）

/// 横向条形排名：数值大者在顶部；可选尾注（如 "42 · 30.7%"）
struct InsightRankedBarChart: View {
    let items: [InsightRankedItem]
    var color: Color = Theme.chartPalette[0]
    var multicolor: Bool = false
    var maxRows: Int = 20
    var maxHeight: CGFloat = 420
    var showXAxis: Bool = true

    private var rows: [InsightRankedItem] {
        // 算法保证：条数降序（并列按名称）；条数全为 0 时按名称排序
        let sorted = items.sorted { lhs, rhs in
            if lhs.value != rhs.value { return lhs.value > rhs.value }
            return lhs.name.localizedCompare(rhs.name) == .orderedAscending
        }
        return Array(sorted.prefix(maxRows)).reversed().map { $0 }
    }

    var body: some View {
        Group {
            if rows.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                Chart {
                    ForEach(Array(rows.indices), id: \.self) { index in
                        let item = rows[index]
                        BarMark(
                            x: .value("数量", item.value),
                            y: .value("项目", item.name)
                        )
                        .foregroundStyle(multicolor ? Theme.chartPalette[index % Theme.chartPalette.count] : color)
                        .cornerRadius(3)
                        .annotation(position: .trailing, alignment: .leading) {
                            if let note = item.note, !note.isEmpty {
                                Text(note)
                                    .font(.system(size: 9))
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                }
                .chartXAxis(showXAxis ? .visible : .hidden)
                .chartYAxis {
                    AxisMarks { _ in
                        AxisValueLabel().font(.system(size: 10))
                    }
                }
                .frame(height: max(120, min(maxHeight, CGFloat(rows.count) * 26 + 28)))
            }
        }
    }
}

// MARK: - 直方图（数值 / 文本字数共用）

/// 直方图：分箱区间为分类轴
struct InsightHistogramChart: View {
    let bins: [HistogramBin]
    var color: Color = Theme.chartPalette[0].opacity(0.85)
    var height: CGFloat = 190
    var desiredXTicks: Int = 5

    var body: some View {
        Group {
            if bins.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                Chart(bins) { bin in
                    BarMark(
                        x: .value("区间", "\(InsightFormat.compact(bin.from))–\(InsightFormat.compact(bin.to))"),
                        y: .value("条数", bin.count)
                    )
                    .foregroundStyle(color)
                    .cornerRadius(3)
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: desiredXTicks)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .chartYAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .frame(height: height)
            }
        }
    }
}

// MARK: - 数值趋势（折线 + 点）

/// 数值随时间的趋势：均值或合计折线
struct InsightNumericTrendChart: View {
    let trend: NumericTrend
    var measure: InsightNumericMeasure = .mean
    var height: CGFloat = 190
    var desiredXTicks: Int = 6

    var body: some View {
        Group {
            if trend.points.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                Chart(trend.points) { point in
                    LineMark(
                        x: .value("时间", point.label),
                        y: .value(measure.label, measure.value(of: point))
                    )
                    .foregroundStyle(Theme.chartPalette[0])
                    .interpolationMethod(.catmullRom)

                    PointMark(
                        x: .value("时间", point.label),
                        y: .value(measure.label, measure.value(of: point))
                    )
                    .foregroundStyle(Theme.chartPalette[0])
                    .symbolSize(16)
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: desiredXTicks)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .chartYAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel().font(.system(size: 9))
                    }
                }
                .frame(height: height)
            }
        }
    }
}

// MARK: - 布尔环形图

/// true/false 环形 + 图例（数量与比例）
struct InsightBooleanDonut: View {
    let trueCount: Int
    let falseCount: Int

    private var total: Int { trueCount + falseCount }

    var body: some View {
        Group {
            if total <= 0 {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                VStack(spacing: 10) {
                    Chart {
                        SectorMark(
                            angle: .value("数量", trueCount),
                            innerRadius: .ratio(0.62),
                            angularInset: 2
                        )
                        .foregroundStyle(Theme.chartPalette[0])

                        SectorMark(
                            angle: .value("数量", falseCount),
                            innerRadius: .ratio(0.62),
                            angularInset: 2
                        )
                        .foregroundStyle(Color(hex: 0xE5E7EB))
                    }
                    .frame(height: 150)

                    HStack(spacing: 14) {
                        legendRow(color: Theme.chartPalette[0], label: "是", count: trueCount)
                        legendRow(color: Color(hex: 0xE5E7EB), label: "否", count: falseCount)
                        Spacer(minLength: 0)
                    }
                }
            }
        }
    }

    private func legendRow(color: Color, label: String, count: Int) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(color)
                .frame(width: 9, height: 9)
            Text("\(label) \(InsightFormat.count(count))（\(InsightFormat.share(total > 0 ? Double(count) / Double(total) : 0))）")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
        }
    }
}

// MARK: - 热力图（自定义格子）

/// GitHub 风格热力图：按周列排布，绿系 5 档着色（用 `Heatmap.max` 归一）
struct InsightHeatmapView: View {
    let days: [HeatmapDay]
    var maxValue: Int

    private static let levelColors: [Color] = [
        Color(hex: 0xEDEDED),
        Color(hex: 0xC9F0DD),
        Color(hex: 0x8FE0B4),
        Color(hex: 0x4FCF8B),
        Color(hex: 0x30CF79),
    ]

    private static let cellSize: CGFloat = 11
    private static let cellSpacing: CGFloat = 3
    private static let monthLabelHeight: CGFloat = 10

    private struct HeatCell: Identifiable {
        let id: String
        let dateKey: String?
        let count: Int
        let inRange: Bool
    }

    private struct HeatColumn: Identifiable {
        let id: Int
        let monthLabel: String?
        let cells: [HeatCell]
    }

    private struct HeatModel {
        var columns: [HeatColumn] = []
        var activeDays: Int = 0
        var totalCount: Int = 0
    }

    private var model: HeatModel {
        var result = HeatModel()
        let calendar = Calendar.current

        var counts: [String: Int] = [:]
        for day in days {
            counts[day.date] = (counts[day.date] ?? 0) + day.count
            result.totalCount += day.count
            if day.count > 0 { result.activeDays += 1 }
        }

        let parsed = days.compactMap { day -> (key: String, date: Date)? in
            guard let date = InsightDayKey.date(from: day.date) else { return nil }
            return (day.date, date)
        }.sorted { $0.date < $1.date }

        guard let first = parsed.first, let last = parsed.last else { return result }
        let firstKey = first.key
        let lastKey = last.key

        // 与 GitHub 热力图一致：周一为一周首日
        let startOfFirst = calendar.startOfDay(for: first.date)
        let startOfLast = calendar.startOfDay(for: last.date)
        let mondayOffsetFirst = (calendar.component(.weekday, from: startOfFirst) + 5) % 7
        guard let gridStart = calendar.date(byAdding: .day, value: -mondayOffsetFirst, to: startOfFirst) else {
            return result
        }
        let distanceToLast = calendar.dateComponents([.day], from: gridStart, to: startOfLast).day ?? 0

        var previousMonth = -1
        var offset = 0
        var columnIndex = 0
        while offset <= distanceToLast {
            guard let columnStart = calendar.date(byAdding: .day, value: offset, to: gridStart) else { break }
            let month = calendar.component(.month, from: columnStart)
            var label: String? = nil
            if month != previousMonth {
                label = InsightDayKey.monthLabel(from: columnStart)
                previousMonth = month
            }

            var cells: [HeatCell] = []
            for row in 0..<7 {
                guard let date = calendar.date(byAdding: .day, value: row, to: columnStart) else { continue }
                let key = InsightDayKey.key(from: date)
                let inRange = key >= firstKey && key <= lastKey
                cells.append(HeatCell(
                    id: inRange ? key : "placeholder-\(columnIndex)-\(row)",
                    dateKey: inRange ? key : nil,
                    count: counts[key] ?? 0,
                    inRange: inRange
                ))
            }
            result.columns.append(HeatColumn(id: columnIndex, monthLabel: label, cells: cells))
            columnIndex += 1
            offset += 7
        }
        return result
    }

    private func levelColor(count: Int) -> Color {
        if count <= 0 { return Self.levelColors[0] }
        let peak = max(1, maxValue)
        let ratio = min(Double(count), Double(peak)) / Double(peak)
        let level = max(1, min(4, Int(ceil(ratio * 4))))
        return Self.levelColors[level]
    }

    private func weekdayLabel(_ row: Int) -> String {
        let labels = ["一", "", "三", "", "五", "", "日"]
        guard row >= 0 && row < labels.count else { return "" }
        return labels[row]
    }

    var body: some View {
        let grid = model
        Group {
            if grid.columns.isEmpty {
                InsightEmptyBox(text: "该区间没有数据")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: Self.cellSpacing) {
                            VStack(spacing: Self.cellSpacing) {
                                Color.clear.frame(width: 10, height: Self.monthLabelHeight)
                                ForEach(0..<7, id: \.self) { row in
                                    Text(weekdayLabel(row))
                                        .font(.system(size: 8))
                                        .foregroundStyle(Theme.textSecondary)
                                        .frame(width: 10, height: Self.cellSize)
                                }
                            }
                            ForEach(grid.columns) { column in
                                VStack(spacing: Self.cellSpacing) {
                                    Text(column.monthLabel ?? " ")
                                        .font(.system(size: 8))
                                        .foregroundStyle(Theme.textSecondary)
                                        .frame(height: Self.monthLabelHeight, alignment: .topLeading)
                                    ForEach(column.cells) { cell in
                                        RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                                            .fill(cell.inRange ? levelColor(count: cell.count) : Color.clear)
                                            .frame(width: Self.cellSize, height: Self.cellSize)
                                            .accessibilityLabel("\(cell.dateKey ?? "") \(cell.count) 条")
                                    }
                                }
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .frame(height: Self.monthLabelHeight + 7 * Self.cellSize + 6 * Self.cellSpacing + 8)
                    .defaultScrollAnchor(.trailing)

                    HStack(spacing: 4) {
                        Text("少")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                        ForEach(Array(Self.levelColors.indices), id: \.self) { index in
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(Self.levelColors[index])
                                .frame(width: 10, height: 10)
                        }
                        Text("多")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                        Spacer(minLength: 6)
                        Text("\(InsightFormat.count(grid.activeDays)) 天有记录 · \(InsightFormat.count(grid.totalCount)) 条")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
    }
}
