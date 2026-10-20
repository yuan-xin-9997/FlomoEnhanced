//
//  MemoEditorView.swift
//  浮墨增强版 iOS
//
//  新建 / 编辑记录 sheet：内容、标签、模板选择与字段表单、保存 / 删除。
//  契约（docs/IOS.md §4.2 / §5）：
//  - 内容与字段值至少一个非空；
//  - 切换模板时字段值重置（编辑态提示）；
//  - 数值类字段用字符串草稿，保存前走 `Normalize.value`；
//  - `templateId` 只在模板选择变化时提交（`MemoUpsertBody.update` 的模板切换契约）。
//

import Foundation
import SwiftUI

// MARK: - 模板选项

/// 模板选择项（`fields == nil` 表示模板定义不可用，例如模板已删除 / 归档）
struct MemoTemplateChoice: Identifiable, Hashable {
    let id: String
    let name: String
    let icon: String
    let color: String
    let fields: [FieldDefinition]?

    var label: String {
        let title = name.isEmpty ? "未命名模板" : name
        let prefix = icon.isEmpty ? "" : "\(icon) "
        if fields == nil {
            return "\(prefix)\(title)（字段定义不可用）"
        }
        return "\(prefix)\(title)"
    }
}

// MARK: - 编辑器

struct MemoEditorView: View {
    private let memo: Memo?
    private let onFinished: (() -> Void)?

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var content: String
    @State private var tagInput: String
    /// `""` = 不使用模板
    @State private var templateSelection: String
    @State private var fieldDraft: [String: FieldValue] = [:]
    /// 切换模板时缓存各模板的草稿，切回来不丢失输入
    @State private var draftCache: [String: [String: FieldValue]] = [:]
    @State private var fieldErrors: [String: String] = [:]
    /// 模板字段的展示 / 编辑方式（每条记录独立）
    @State private var fieldMode: MemoFieldMode = .template
    @State private var textDraft = ""
    @State private var textLineErrors: [MemoTextLineError] = []
    @State private var textNotice = ""
    @State private var textWarning = ""
    @State private var formError = ""
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var showDeleteConfirm = false
    @State private var templates: [Template] = []
    @State private var isLoadingTemplates = false
    @State private var templatesError: String?
    /// 字段草稿是否已构造（等模板列表就绪后再建，避免把原值覆盖成空草稿）
    @State private var draftPrepared = false

    init(memo: Memo?, onFinished: (() -> Void)? = nil) {
        self.memo = memo
        self.onFinished = onFinished
        _content = State(initialValue: memo?.content ?? "")
        _tagInput = State(initialValue: MemoTagInput.explicitTags(of: memo).joined(separator: "、"))
        _templateSelection = State(initialValue: memo.flatMap { $0.templateId } ?? "")
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.bg.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if !formError.isEmpty {
                            errorBanner
                        }
                        contentCard
                        templateCard
                        if memo != nil {
                            deleteCard
                        }
                    }
                    .padding(16)
                    .padding(.bottom, 32)
                }
            }
            .navigationTitle(memo == nil ? "新建记录" : "编辑记录")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isSaving || isDeleting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("保存").fontWeight(.semibold)
                        }
                    }
                    .disabled(isSaving || isDeleting || !canSave)
                }
            }
            .interactiveDismissDisabled(isSaving || isDeleting)
            .task { await prepare() }
            .alert("删除这条记录？", isPresented: $showDeleteConfirm) {
                Button("取消", role: .cancel) {}
                Button("删除", role: .destructive) {
                    Task { await deleteMemo() }
                }
            } message: {
                Text("删除后不可恢复。")
            }
        }
    }

    // MARK: - 错误横幅

    private var errorBanner: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(Theme.danger)
            Text(formError)
                .font(.subheadline)
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: - 内容 + 标签

    private var contentCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("内容")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)

            ZStack(alignment: .topLeading) {
                TextEditor(text: $content)
                    .font(.body)
                    .frame(minHeight: 120)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(
                        Theme.bg.opacity(0.6),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
                if content.isEmpty {
                    Text("现在的想法是… 可用 #标签")
                        .font(.body)
                        .foregroundStyle(Theme.textSecondary.opacity(0.7))
                        .padding(.top, 14)
                        .padding(.leading, 11)
                        .allowsHitTesting(false)
                }
            }

            HStack(spacing: 8) {
                Text("\(content.count)/\(MemoFieldDraft.contentMax)")
                    .font(.caption2)
                    .foregroundStyle(content.count > MemoFieldDraft.contentMax ? Theme.danger : Theme.textSecondary)
                Spacer(minLength: 0)
                if !canSave && !isSaving {
                    Text(saveHint)
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
            }

            Divider()

            Text("标签")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)
            TextField("如：工作、阅读（逗号 / 空格分隔）", text: $tagInput)
                .font(.subheadline)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Theme.bg.opacity(0.6), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            if tagPreview.isEmpty {
                Text("内容里的 #标签 会自动提取")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(tagPreview, id: \.self) { tag in
                            TagPill(text: "#\(tag)", highlighted: true)
                        }
                    }
                    .padding(.vertical, 1)
                }
            }
        }
        .card()
    }

    // MARK: - 模板 + 字段表单

    private var templateCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("模板")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)

            Picker("模板", selection: templateBinding) {
                Text("不使用模板").tag("")
                ForEach(templateChoices) { choice in
                    Text(choice.label).tag(choice.id)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .accessibilityIdentifier("memoTemplatePicker")
            .frame(maxWidth: .infinity, alignment: .leading)

            if isLoadingTemplates {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("模板加载中…")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
            } else if let templatesError {
                HStack(spacing: 8) {
                    Text(templatesError)
                        .font(.caption)
                        .foregroundStyle(Theme.danger)
                    Button("重试") {
                        Task {
                            await loadTemplates()
                            prepareDraftIfNeeded()
                        }
                    }
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.brand)
                }
            }

            if let choice = selectedChoice, choice.fields == nil {
                Text("该模板已归档或不可用，仅可编辑内容或取消模板关联。")
                    .font(.caption)
                    .foregroundStyle(Theme.warning)
            }

            if let fields = selectedFields, !fields.isEmpty {
                Divider()
                HStack(spacing: 8) {
                    Text("模板字段")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                    Spacer(minLength: 0)
                    Picker("", selection: fieldModeBinding) {
                        ForEach(MemoFieldMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .accessibilityIdentifier("memoFieldModePicker")
                    .frame(width: 168)
                }

                if effectiveFieldMode == .template {
                    MemoFieldFormView(fields: fields, draft: $fieldDraft, errors: fieldErrors)
                } else {
                    MemoTextEditorView(
                        text: textBinding,
                        lineErrors: textLineErrors,
                        fieldErrors: fieldErrors,
                        notice: textNotice,
                        onPaste: onTextPaste
                    )
                }
            }

            if !textWarning.isEmpty {
                Text(textWarning)
                    .font(.caption2)
                    .foregroundStyle(Theme.warning)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if isTemplateChanged, memo != nil {
                Text("切换模板后需要重新填写新模板的字段值。")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .card()
    }

    // MARK: - 删除

    private var deleteCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                showDeleteConfirm = true
            } label: {
                Text(isDeleting ? "删除中…" : "删除记录")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 11)
                    .background(
                        Theme.danger.opacity(0.1),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isDeleting || isSaving)
            .opacity(isDeleting || isSaving ? 0.5 : 1)

            Text("删除后不可恢复。")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    // MARK: - 派生状态

    private var templateChoices: [MemoTemplateChoice] {
        var choices: [MemoTemplateChoice] = templates.map { item in
            MemoTemplateChoice(
                id: item.id,
                name: item.name,
                icon: item.icon,
                color: item.color,
                fields: item.fields
            )
        }
        let currentId = memo.flatMap { $0.templateId } ?? ""
        if !currentId.isEmpty, !choices.contains(where: { $0.id == currentId }) {
            choices.append(
                MemoTemplateChoice(
                    id: currentId,
                    name: memo?.templateName ?? "已删除的模板",
                    icon: "🗑️",
                    color: "",
                    fields: nil
                )
            )
        }
        return choices
    }

    private var selectedChoice: MemoTemplateChoice? {
        templateChoices.first { $0.id == templateSelection }
    }

    /// 选中模板的字段定义（`nil` = 不使用模板或定义不可用）
    private var selectedFields: [FieldDefinition]? {
        selectedChoice?.fields
    }

    /// 当前模板是否有可编辑字段（文本模式只在有字段时提供）
    private var hasTemplateFields: Bool {
        if let fields = selectedFields { return !fields.isEmpty }
        return false
    }

    /// 没有字段 / 模板不可用时强制回模板模式
    private var effectiveFieldMode: MemoFieldMode {
        hasTemplateFields ? fieldMode : .template
    }

    private var fieldModeBinding: Binding<MemoFieldMode> {
        Binding(
            get: { effectiveFieldMode },
            set: { changeFieldMode($0) }
        )
    }

    private var textBinding: Binding<String> {
        Binding(
            get: { textDraft },
            set: { onTextChange($0) }
        )
    }

    private var isTemplateChanged: Bool {
        guard let memo else { return false }
        return templateSelection != (memo.templateId ?? "")
    }

    private var templateBinding: Binding<String> {
        Binding(
            get: { templateSelection },
            set: { applyTemplateChange($0) }
        )
    }

    private var trimmedContent: String {
        content.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var tagPreview: [String] {
        MemoTagInput.merged(explicit: MemoTagInput.parse(tagInput), content: content)
    }

    private var isDraftEmpty: Bool {
        fieldDraft.values.allSatisfy { $0.isEmpty }
    }

    private var hasExistingValues: Bool {
        guard let memo else { return false }
        return memo.values.values.contains { !$0.isEmpty }
    }

    private var canSave: Bool {
        if isSaving || isDeleting { return false }
        if !trimmedContent.isEmpty { return true }
        if effectiveFieldMode == .text {
            return !textDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        if !isDraftEmpty { return true }
        return hasExistingValues
    }

    /// 提交按钮禁用时的中文原因
    private var saveHint: String {
        if hasTemplateFields && effectiveFieldMode == .text {
            return "请输入内容或粘贴模板文本"
        }
        return "请输入内容或填写至少一个字段"
    }

    // MARK: - 加载与草稿准备

    private func prepare() async {
        await loadTemplates()
        prepareDraftIfNeeded()
    }

    private func loadTemplates() async {
        guard !isLoadingTemplates else { return }
        isLoadingTemplates = true
        templatesError = nil
        do {
            templates = try await session.client.listTemplates(includeArchived: false)
        } catch {
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            templatesError = error.userMessage
        }
        isLoadingTemplates = false
    }

    /// 模板列表就绪后构造字段草稿（只做一次；模板不可用时等重试成功后补做）
    private func prepareDraftIfNeeded() {
        guard !draftPrepared, let fields = selectedFields else { return }
        draftPrepared = true
        if let memo {
            fieldDraft = MemoFieldDraft.draft(fields: fields, values: memo.values)
        } else {
            fieldDraft = MemoFieldDraft.empty(fields: fields)
        }
        draftCache[templateSelection] = fieldDraft
        textDraft = MemoTextCodec.format(fields: fields, values: fieldDraft)
    }

    /// 切换模板：缓存当前草稿 → 恢复目标模板的草稿（无缓存则新建 / 用原记录值）
    private func applyTemplateChange(_ newValue: String) {
        guard newValue != templateSelection else { return }
        draftPrepared = true
        draftCache[templateSelection] = fieldDraft
        templateSelection = newValue
        fieldErrors = [:]
        fieldMode = .template
        textLineErrors = []
        textNotice = ""
        textWarning = ""
        formError = ""

        if let cached = draftCache[newValue] {
            fieldDraft = cached
        } else if let choice = templateChoices.first(where: { $0.id == newValue }), let fields = choice.fields {
            if let memo, newValue == memo.templateId {
                fieldDraft = MemoFieldDraft.draft(fields: fields, values: memo.values)
            } else {
                fieldDraft = MemoFieldDraft.empty(fields: fields)
            }
            draftCache[newValue] = fieldDraft
        } else {
            fieldDraft = [:]
        }

        if let fields = templateChoices.first(where: { $0.id == newValue })?.fields, !fields.isEmpty {
            textDraft = MemoTextCodec.format(fields: fields, values: fieldDraft)
        } else {
            textDraft = ""
        }
    }

    // MARK: - 文本模式

    /// 解析文本 → 草稿 / 错误 / 提示；返回结果供保存时判断
    @discardableResult
    private func applyText(_ text: String) -> MemoTextDraftResult? {
        guard let fields = selectedFields else { return nil }
        let result = MemoTextDraft.parse(fields: fields, text: text)
        fieldDraft = result.draft
        fieldErrors = result.errors
        textLineErrors = result.lineErrors
        textNotice = result.ok ? "已识别 \(result.matchedCount) 个字段" : ""
        textWarning = ""
        formError = ""
        return result
    }

    /// 手工输入不立即解析；清掉旧提示，等切换 / 保存时再处理
    private func onTextChange(_ text: String) {
        textDraft = text
        textLineErrors = []
        textNotice = ""
        textWarning = ""
        fieldErrors = [:]
        formError = ""
    }

    /// 粘贴后立即按「插入后的完整文本」解析
    private func onTextPaste(_ text: String) {
        textDraft = text
        applyText(text)
    }

    private func changeFieldMode(_ next: MemoFieldMode) {
        guard next != effectiveFieldMode else { return }
        if next == .text {
            if let fields = selectedFields {
                textDraft = MemoTextCodec.format(fields: fields, values: fieldDraft)
            }
            textLineErrors = []
            textNotice = ""
            textWarning = ""
            fieldErrors = [:]
            formError = ""
            fieldMode = .text
            return
        }

        // 文本 → 模板：重新解析当前文本，让手动修改也生效
        if let fields = selectedFields {
            let parsed = applyText(textDraft)
            if let parsed, !parsed.lineErrors.isEmpty {
                textWarning = "文本中有 \(parsed.lineErrors.count) 行无法识别，已忽略；当前以模板字段为准。"
            }
        }
        fieldMode = .template
    }

    // MARK: - 保存 / 删除

    private func save() async {
        guard !isSaving, !isDeleting else { return }

        let trimmed = trimmedContent
        var errors: [String: String] = [:]
        var values: [String: FieldValue] = [:]

        if let fields = selectedFields {
            if effectiveFieldMode == .text {
                let parsed = applyText(textDraft)
                guard let parsed, parsed.ok else {
                    formError = "文本识别未通过，请根据提示修正后再保存"
                    return
                }
                errors = parsed.errors
                values = parsed.values
            } else {
                let result = MemoFieldDraft.normalize(fields: fields, draft: fieldDraft)
                errors = result.errors
                values = result.values
            }
        } else if templateSelection.isEmpty {
            values = [:]
        } else if let memo {
            // 模板定义不可用：保留原字段值（不提交 values）
            values = memo.values
        }

        fieldErrors = errors
        guard errors.isEmpty else {
            formError = memo == nil ? "字段校验未通过，请检查后重试" : "请检查字段填写"
            return
        }
        if trimmed.isEmpty, values.values.allSatisfy({ $0.isEmpty }) {
            formError = memo == nil ? "内容与模板字段不能同时为空" : "内容与字段值不能同时为空"
            return
        }

        let tags = MemoTagInput.merged(explicit: MemoTagInput.parse(tagInput), content: trimmed)
        let nextTemplateId: String? = templateSelection.isEmpty ? nil : templateSelection

        isSaving = true
        formError = ""
        do {
            if let memo {
                var body = MemoUpsertBody.update(content: trimmed, tags: tags)
                if isTemplateChanged {
                    // 服务端契约：切换模板时必须同时提交 values（按新模板校验）
                    body.values = selectedFields != nil ? values : [:]
                    body.templateId = .some(nextTemplateId)
                } else if selectedFields != nil {
                    // 模板未变化：整体替换字段值（服务端按行内模板重新校验）
                    body.values = values
                }
                // 无模板 / 模板定义不可用且未切换模板：不提交 values，保留服务端已有字段值
                _ = try await session.client.updateMemo(id: memo.id, body)
                toasts.show("已保存修改")
            } else {
                let body = MemoUpsertBody.create(
                    content: trimmed,
                    templateId: nextTemplateId,
                    values: values,
                    tags: tags
                )
                _ = try await session.client.createMemo(body)
                toasts.show("已记录")
            }
            onFinished?()
            dismiss()
        } catch {
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            formError = error.userMessage
            toasts.error(error.userMessage)
            isSaving = false
        }
    }

    private func deleteMemo() async {
        guard let memo, !isDeleting else { return }
        isDeleting = true
        formError = ""
        do {
            try await session.client.deleteMemo(id: memo.id)
            toasts.show("已删除")
            onFinished?()
            dismiss()
        } catch {
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            formError = error.userMessage
            toasts.error(error.userMessage)
            isDeleting = false
        }
    }
}
