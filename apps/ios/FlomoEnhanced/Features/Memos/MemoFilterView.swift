//
//  MemoFilterView.swift
//  浮墨增强版 iOS
//
//  记录筛选面板（sheet）：模板 / 标签 / 日期区间 / 关键词。
//  日期用本地日 key，提交时由 `MemoFilters.query` 换算为 `Dates.dayStartIso/dayEndIso`。
//

import Foundation
import SwiftUI

struct MemoFilterView: View {
    let templates: [Template]
    var onApply: (MemoFilters) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var template: MemoFilters.TemplateSelection
    @State private var tag: String
    @State private var keyword: String
    @State private var limitFrom: Bool
    @State private var limitTo: Bool
    @State private var fromDate: Date
    @State private var toDate: Date

    init(filters: MemoFilters, templates: [Template], onApply: @escaping (MemoFilters) -> Void) {
        self.templates = templates
        self.onApply = onApply
        _template = State(initialValue: filters.template)
        _tag = State(initialValue: filters.tag)
        _keyword = State(initialValue: filters.keyword)
        _limitFrom = State(initialValue: !filters.fromDay.isEmpty)
        _limitTo = State(initialValue: !filters.toDay.isEmpty)
        _fromDate = State(initialValue: MemoDay.date(fromKey: filters.fromDay) ?? MemoDay.todayDate())
        _toDate = State(initialValue: MemoDay.date(fromKey: filters.toDay) ?? MemoDay.todayDate())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("模板") {
                    Picker("模板", selection: $template) {
                        Text("全部笔记").tag(MemoFilters.TemplateSelection.all)
                        Text("无模板").tag(MemoFilters.TemplateSelection.none)
                        ForEach(templates) { item in
                            Text(item.name).tag(MemoFilters.TemplateSelection.id(item.id))
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("标签与关键词") {
                    TextField("标签（不用写 #）", text: $tag)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("关键词（匹配内容）", text: $keyword)
                }

                Section("日期区间") {
                    Toggle("限定开始日期", isOn: $limitFrom)
                    if limitFrom {
                        DatePicker("开始", selection: $fromDate, displayedComponents: .date)
                    }
                    Toggle("限定结束日期", isOn: $limitTo)
                    if limitTo {
                        DatePicker("结束", selection: $toDate, displayedComponents: .date)
                    }
                    Text("按设备本地日期筛选，含起止当天。")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                    if let warning = rangeWarning {
                        Text(warning)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                    }
                }

                Section {
                    Button("清除筛选") {
                        onApply(MemoFilters())
                        dismiss()
                    }
                    .foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("筛选")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("应用") { apply() }
                        .fontWeight(.semibold)
                        .disabled(rangeWarning != nil)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: - 行为

    private var rangeWarning: String? {
        guard limitFrom, limitTo, MemoDay.key(from: fromDate) > MemoDay.key(from: toDate) else { return nil }
        return "开始日期不能晚于结束日期"
    }

    private func apply() {
        var filters = MemoFilters()
        filters.template = template
        filters.tag = MemoTagInput.clean(tag)
        filters.keyword = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        filters.fromDay = limitFrom ? MemoDay.key(from: fromDate) : ""
        filters.toDay = limitTo ? MemoDay.key(from: toDate) : ""
        onApply(filters)
    }
}
