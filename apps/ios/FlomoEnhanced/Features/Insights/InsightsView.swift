//
//  InsightsView.swift
//  浮墨增强版 iOS
//
//  洞察页：模板/区间选择 + 全局概览 / 模板洞察（Swift Charts）+ CSV 导出（docs/IOS.md §4.4）。
//

import Foundation
import SwiftUI

/// 洞察页
struct InsightsView: View {
    /// 全局概览的伪模板 id（与 Web 端约定一致）
    static let overviewKey = "__overview__"

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var templates: [Template] = []
    @State private var selectedTemplateId = InsightsView.overviewKey
    @State private var preset: RangePreset = .d30
    @State private var customRange: DayRange = Dates.rangeForPreset(.d30, today: Dates.todayKey())

    @State private var overview: AnalyticsOverview?
    @State private var insights: TemplateInsights?

    @State private var loading = true
    @State private var errorText: String?
    @State private var exporting = false
    @State private var exported: InsightExportedFile?
    @State private var reloadToken = 0

    // MARK: - 区间

    private var range: DayRange {
        preset == .custom ? customRange : Dates.rangeForPreset(preset, today: Dates.todayKey())
    }

    private var rangeErrorText: String? {
        Dates.validateRange(range)
    }

    private struct LoadKey: Equatable {
        let templateId: String
        let from: String
        let to: String
        let reload: Int
    }

    private var loadKey: LoadKey {
        let current = range
        return LoadKey(templateId: selectedTemplateId, from: current.from, to: current.to, reload: reloadToken)
    }

    // MARK: - 页面

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 12) {
                    headerCard

                    if let exported {
                        exportedCard(exported)
                    }

                    if let errorText {
                        InsightErrorBox(message: errorText) {
                            reloadToken += 1
                        }
                    }

                    contentArea
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("洞察")
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        reloadToken += 1
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("刷新")

                    if selectedTemplateId != Self.overviewKey {
                        Button {
                            Task { await exportCsv() }
                        } label: {
                            if exporting {
                                ProgressView()
                            } else {
                                Label("导出 CSV", systemImage: "square.and.arrow.up")
                            }
                        }
                        .disabled(exporting || loading || insights == nil)
                        .accessibilityLabel("导出 CSV")
                    }
                }
            }
            .task { await loadTemplates() }
            .task(id: loadKey) { await load() }
            .onChange(of: preset) { oldValue, newValue in
                if newValue == .custom {
                    customRange = Dates.rangeForPreset(oldValue, today: Dates.todayKey())
                }
            }
        }
    }

    // MARK: - 选择区

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("模板")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Picker("选择模板", selection: $selectedTemplateId) {
                    Text("全部模板（概览）").tag(Self.overviewKey)
                    ForEach(templates) { template in
                        Text(templateLabel(template)).tag(template.id)
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.textPrimary)
                .accessibilityIdentifier("insightsTemplatePicker")
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Picker("选择区间", selection: $preset) {
                ForEach(RangePreset.allCases) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)

            if preset == .custom {
                VStack(spacing: 6) {
                    DatePicker("开始日期", selection: customFromBinding, displayedComponents: .date)
                    DatePicker("结束日期", selection: customToBinding, displayedComponents: .date)
                    if let rangeErrorText {
                        Text(rangeErrorText)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .font(.footnote)
            }

            rangeInfoRow
        }
        .card()
    }

    private func templateLabel(_ template: Template) -> String {
        let base = template.icon.isEmpty ? template.name : "\(template.icon) \(template.name)"
        return template.isArchived ? base + "（已归档）" : base
    }

    private var customFromBinding: Binding<Date> {
        Binding(
            get: { InsightDayKey.date(from: customRange.from) ?? Date() },
            set: { customRange.from = InsightDayKey.key(from: $0) }
        )
    }

    private var customToBinding: Binding<Date> {
        Binding(
            get: { InsightDayKey.date(from: customRange.to) ?? Date() },
            set: { customRange.to = InsightDayKey.key(from: $0) }
        )
    }

    private var rangeInfoRow: some View {
        let current = range
        let isValid = Dates.validateRange(current) == nil
        let daysText = isValid ? "（\(InsightFormat.count(Dates.inclusiveDays(current.from, current.to))) 天）" : ""
        let loadedLabel = insights?.range.label ?? overview?.range.label
        let granularity = insights?.range.granularity ?? overview?.range.granularity
        let tookMs = insights?.tookMs ?? overview?.tookMs
        return VStack(alignment: .leading, spacing: 2) {
            Text("实际查询区间：\(current.from) ~ \(current.to)\(daysText)")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
            if let loadedLabel, let granularity {
                Text("\(loadedLabel) · \(granularity.label)" + (tookMs.map { " · 统计耗时 \(InsightFormat.compact($0)) ms" } ?? ""))
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    // MARK: - 内容区

    @ViewBuilder
    private var contentArea: some View {
        if loading {
            InsightLoadingCard()
        } else if errorText == nil {
            if selectedTemplateId == Self.overviewKey {
                if let overview {
                    OverviewContent(overview: overview)
                } else {
                    InsightSection(title: "全局概览") {
                        InsightEmptyBox(text: "该区间没有数据", hint: "换个区间试试，或先去记录几条。")
                    }
                }
            } else {
                if let insights {
                    TemplateInsightsContent(insights: insights)
                } else {
                    InsightSection(title: "模板洞察") {
                        InsightEmptyBox(text: "该区间没有数据", hint: "换个区间或模板试试。")
                    }
                }
            }
        }
    }

    // MARK: - 导出

    private func exportedCard(_ file: InsightExportedFile) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "doc.text.fill")
                .foregroundStyle(Theme.brand)
            VStack(alignment: .leading, spacing: 2) {
                Text("CSV 已导出")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Text(file.name)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 6)
            ShareLinkButton(title: "分享", url: file.url)
        }
        .card(padding: 12)
    }

    private func exportCsv() async {
        guard selectedTemplateId != Self.overviewKey, let insights else { return }
        exporting = true
        defer { exporting = false }

        let current = range
        let fallbackName = FileAccess.sanitize(insights.template.name) + "-" + Dates.todayFilenameStamp() + ".csv"
        do {
            let file = try await session.client.exportCsv(
                templateId: insights.template.id,
                from: Dates.dayStartIso(current.from),
                to: Dates.dayEndIso(current.to),
                fallbackName: fallbackName
            )
            let url = try FileAccess.writeTemporary(file.data, filename: file.filename)
            exported = InsightExportedFile(url: url, name: url.lastPathComponent)
            toasts.show("CSV 已导出，点击分享")
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            toasts.error(error.userMessage)
        }
    }

    // MARK: - 数据加载

    private func loadTemplates() async {
        do {
            let result = try await session.client.listTemplates(includeArchived: true)
            try Task.checkCancellation()
            templates = result
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            guard !Task.isCancelled else { return }
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            toasts.error(error.userMessage)
        }
    }

    private func load() async {
        guard !Task.isCancelled else { return }
        let key = loadKey
        guard rangeErrorText == nil else {
            overview = nil
            insights = nil
            exported = nil
            errorText = rangeErrorText
            loading = false
            return
        }

        loading = true
        errorText = nil
        let current = range
        let from = Dates.dayStartIso(current.from)
        let to = Dates.dayEndIso(current.to)

        do {
            if key.templateId == Self.overviewKey {
                let result = try await session.client.analyticsOverview(from: from, to: to)
                try Task.checkCancellation()
                guard key == loadKey else { return }
                overview = result
                insights = nil
            } else {
                let result = try await session.client.templateInsights(
                    templateId: key.templateId,
                    from: from,
                    to: to
                )
                try Task.checkCancellation()
                guard key == loadKey else { return }
                insights = result
                overview = nil
            }
            exported = nil
            loading = false
        } catch is CancellationError {
            return
        } catch let urlError as URLError where urlError.code == .cancelled {
            return
        } catch {
            guard !Task.isCancelled, key == loadKey else { return }
            overview = nil
            insights = nil
            exported = nil
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            errorText = error.userMessage
            toasts.error(error.userMessage)
            loading = false
        }
    }
}

/// 已导出的 CSV 临时文件
private struct InsightExportedFile: Identifiable, Equatable {
    let url: URL
    let name: String

    var id: String { url.absoluteString }
}
