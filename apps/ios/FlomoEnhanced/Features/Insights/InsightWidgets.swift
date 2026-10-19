//
//  InsightWidgets.swift
//  浮墨增强版 iOS
//
//  洞察模块共享 UI 组件与格式化工具（非图表部分）。
//  全部类型以 `Insight` 前缀避免与 Core / 其他 Feature 冲突。
//

import Foundation
import SwiftUI

// MARK: - 格式化

/// 洞察模块统一格式化（非有限值一律显示 "—"，避免 NaN/∞）
enum InsightFormat {
    /// 简化数值（大数原样，去多余小数）
    static func compact(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return FieldFormat.compact(value)
    }

    /// 计数字符串（本地化千分位）
    static func count(_ value: Int) -> String {
        value.formatted()
    }

    /// 0..1 的占比 → "30.7%"
    static func share(_ ratio: Double) -> String {
        guard ratio.isFinite else { return "—" }
        let percent = (ratio * 1000).rounded() / 10
        return FieldFormat.compact(percent) + "%"
    }

    /// 0..100 的百分比字段值 → "12.34%"
    static func percentValue(_ value: Double) -> String {
        guard value.isFinite else { return "—" }
        return FieldFormat.compact(value) + "%"
    }

    /// 币种符号（未知币种用代码前缀）
    static func currencySymbol(_ code: String?) -> String? {
        guard let code, !code.isEmpty else { return nil }
        let symbols: [String: String] = [
            "CNY": "¥", "RMB": "¥", "USD": "$", "EUR": "€", "JPY": "¥",
            "GBP": "£", "HKD": "HK$", "TWD": "NT$", "KRW": "₩",
            "SGD": "S$", "AUD": "A$", "CAD": "C$",
        ]
        return symbols[code.uppercased()] ?? (code.uppercased() + " ")
    }

    /// 金额：币种符号 + 简化数值
    static func currency(_ value: Double, code: String?) -> String {
        guard value.isFinite else { return "—" }
        let text = FieldFormat.compact(value)
        if let symbol = currencySymbol(code) { return symbol + text }
        return text
    }

    /// 带百分比的纵向进度（统计量数值原样，不做单位换算）
    static func clamp01(_ ratio: Double) -> Double {
        guard ratio.isFinite else { return 0 }
        return Swift.min(1, Swift.max(0, ratio))
    }
}

// MARK: - 日期键换算（本地日 "yyyy-MM-dd"）

/// 日期键（`yyyy-MM-dd`）与 `Date` 的互转；供热力图与自定义区间选择使用。
enum InsightDayKey {
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let monthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = .current
        formatter.dateFormat = "M月"
        return formatter
    }()

    static func date(from key: String) -> Date? {
        dayFormatter.date(from: key)
    }

    static func key(from date: Date) -> String {
        dayFormatter.string(from: date)
    }

    static func monthLabel(from date: Date) -> String {
        monthFormatter.string(from: date)
    }
}

// MARK: - KPI 网格

/// 摘要指标项
struct InsightKpiItem: Identifiable, Equatable {
    var id: String { label }
    let label: String
    let value: String
    var sub: String? = nil
}

/// 自适应 KPI 网格（浅底小块）
struct InsightKpiGrid: View {
    let items: [InsightKpiItem]
    var minimumWidth: CGFloat = 100

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: minimumWidth), spacing: 8, alignment: .leading)],
            alignment: .leading,
            spacing: 8
        ) {
            ForEach(items) { item in
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.label)
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                    Text(item.value)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if let sub = item.sub, !sub.isEmpty {
                        Text(sub)
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
    }
}

// MARK: - 卡片容器

/// 带标题的卡片块（可选右上角操作视图）
struct InsightSection<Content: View, Trailing: View>: View {
    private let title: String
    private let subtitle: String?
    private let content: Content
    private let trailing: Trailing

    init(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder trailing: () -> Trailing,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
        self.trailing = trailing()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.textPrimary)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                trailing
            }
            content
        }
        .card()
    }
}

extension InsightSection where Trailing == EmptyView {
    init(
        title: String,
        subtitle: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.init(title: title, subtitle: subtitle, trailing: { EmptyView() }, content: content)
    }
}

// MARK: - 空态 / 错误 / 加载

/// 友好空态
struct InsightEmptyBox: View {
    var text: String = "该区间没有数据"
    var hint: String? = nil
    var systemImage: String = "chart.bar.xaxis"

    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(Theme.textSecondary.opacity(0.55))
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
    }
}

/// 行内错误 + 重试
struct InsightErrorBox: View {
    let message: String
    let retry: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.danger)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(Theme.textPrimary)
                Button("重试") { retry() }
                    .font(.footnote.weight(.medium))
                    .tint(Theme.brand)
            }
            Spacer(minLength: 0)
        }
        .card(padding: 12)
    }
}

/// 加载中
struct InsightLoadingCard: View {
    var text: String = "正在统计…"

    var body: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 0)
        }
        .card(padding: 12)
    }
}

// MARK: - 字段填写率行

/// 字段填写率（进度条 + 有值/缺失）
struct InsightFillRateRow: View {
    let label: String
    let key: String?
    let filled: Int
    let missing: Int
    let ratio: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(label)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                if let key, !key.isEmpty {
                    Text(key)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 4)
                Text("\(InsightFormat.share(ratio))（\(InsightFormat.count(filled)) 有值 / \(InsightFormat.count(missing)) 缺失）")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            ProgressView(value: InsightFormat.clamp01(ratio))
                .tint(Theme.brand)
        }
    }
}
