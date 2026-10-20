//
//  MemoCardView.swift
//  浮墨增强版 iOS
//
//  单条记录卡片：时间、模板徽标（模板色）、内容（`#标签` 高亮）、字段值列表、标签胶囊。
//

import Foundation
import SwiftUI

struct MemoCardView: View {
    let memo: Memo
    /// 模板定义（已归档 / 未加载时为 nil → 字段值走 `displayText` 降级）
    var template: Template?
    var onTagTap: ((String) -> Void)?
    var onTemplateTap: ((String) -> Void)?

    /// 每条卡片独立的展示模式
    @State private var fieldMode: MemoFieldMode = .template

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            if !trimmedContent.isEmpty {
                contentText
            }
            if hasTemplateFields {
                fieldSection
            } else if !fieldRows.isEmpty {
                fieldTable
            }
            if !memo.tags.isEmpty {
                tagRow
            }
        }
        .card()
    }

    // MARK: - 头部（时间 + 模板徽标）

    private var header: some View {
        HStack(spacing: 8) {
            Text(Dates.formatTimestamp(memo.createdAt))
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            if let name = templateName {
                templateBadge(name)
            }
            Spacer(minLength: 0)
        }
    }

    private func templateBadge(_ name: String) -> some View {
        let hasTemplate = template != nil
        let tint = hasTemplate ? MemoPalette.color(from: template?.color, fallback: Theme.brand) : Theme.textSecondary
        let icon = template?.icon ?? "📄"
        return Button {
            if let id = memo.templateId {
                onTemplateTap?(id)
            }
        } label: {
            HStack(spacing: 3) {
                if !icon.isEmpty {
                    Text(icon).font(.caption2)
                }
                Text(name)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(tint)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.14), in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(memo.templateId == nil || onTemplateTap == nil)
    }

    /// 模板名（模板定义缺失时用记录自带的 `templateName`）
    private var templateName: String? {
        let name = template?.name ?? memo.templateName
        guard let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return name
    }

    // MARK: - 内容（`#标签` 蓝色高亮）

    private var trimmedContent: String {
        memo.content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var contentText: some View {
        highlightedContent
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// `#标签` 片段：蓝色文字 + 浅蓝底（对应视觉规范的标签高亮）
    private var highlightedContent: Text {
        var result = AttributedString("")
        for segment in Tags.segments(of: memo.content) {
            var piece = AttributedString(segment.text)
            if segment.isTag {
                piece.foregroundColor = Theme.tagBlue
                piece.backgroundColor = Theme.tagBlueBg
            } else {
                piece.foregroundColor = Theme.textPrimary
            }
            result.append(piece)
        }
        return Text(result)
    }

    // MARK: - 字段值列表

    private var templateFields: [FieldDefinition] {
        template?.fields ?? []
    }

    private var hasTemplateFields: Bool {
        !templateFields.isEmpty
    }

    private var formattedText: String {
        MemoTextCodec.format(fields: templateFields, values: memo.values)
    }

    private var fieldSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("模板字段")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 0)
                Picker("", selection: $fieldMode) {
                    ForEach(MemoFieldMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 168)
            }

            if fieldMode == .template {
                if fieldRows.isEmpty {
                    emptyFieldText
                } else {
                    fieldTable
                }
            } else if formattedText.isEmpty {
                emptyFieldText
            } else {
                Text(formattedText)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(
                        Theme.bg.opacity(0.55),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                    .textSelection(.enabled)
            }
        }
    }

    private var emptyFieldText: some View {
        Text("（无字段值）")
            .font(.caption)
            .foregroundStyle(Theme.textSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
            .background(
                Theme.bg.opacity(0.55),
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
    }

    private var fieldTable: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 12, verticalSpacing: 6) {
            ForEach(fieldRows) { row in
                GridRow {
                    Text(row.label)
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .gridColumnAlignment(.leading)
                    Text(row.text)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.bg.opacity(0.55), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private struct MemoFieldRow: Identifiable {
        let id: String
        let label: String
        let text: String
    }

    /// 按模板 `fields` 顺序展示；模板定义缺失的键用 `FieldValue.displayText` 兜底
    private var fieldRows: [MemoFieldRow] {
        var rows: [MemoFieldRow] = []
        var covered = Set<String>()
        for def in template?.fields ?? [] {
            covered.insert(def.key)
            guard let value = memo.values[def.key], !value.isEmpty else { continue }
            let text = FieldFormat.value(def, value)
            guard !text.isEmpty else { continue }
            rows.append(MemoFieldRow(id: def.key, label: MemoFieldDraft.label(of: def), text: text))
        }
        for key in memo.values.keys.sorted() where !covered.contains(key) {
            guard let value = memo.values[key], !value.isEmpty else { continue }
            let text = value.displayText
            guard !text.isEmpty else { continue }
            rows.append(MemoFieldRow(id: key, label: key, text: text))
        }
        return rows
    }

    // MARK: - 标签胶囊

    private var tagRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(memo.tags.indices, id: \.self) { index in
                    let tag = memo.tags[index]
                    Button {
                        onTagTap?(tag)
                    } label: {
                        TagPill(text: "#\(tag)", highlighted: true)
                    }
                    .buttonStyle(.plain)
                    .disabled(onTagTap == nil)
                }
            }
            .padding(.vertical, 1)
        }
    }
}
