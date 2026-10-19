//
//  TemplateEditorView.swift
//  浮墨增强版 iOS
//
//  模板编辑器（docs/IOS.md §4.3）：新建 / 编辑共用。
//  基本信息 + 字段列表（增删、上下移动、复制）+ 保存前校验（Normalize.validateTemplateFields）。
//

import SwiftUI

struct TemplateEditorView: View {
    let template: Template?
    var onSaved: () -> Void = {}

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var draft: TemplateDraft
    @State private var errors: [String] = []
    @State private var submitError: String?
    @State private var isSaving = false
    @State private var isPickingType = false

    init(template: Template?, onSaved: @escaping () -> Void = {}) {
        self.template = template
        self.onSaved = onSaved
        if let template {
            _draft = State(initialValue: TemplateDraft(template: template))
        } else {
            _draft = State(initialValue: TemplateDraft.blank())
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let submitError {
                        errorBanner(submitError)
                    }
                    if !errors.isEmpty {
                        errorList
                    }
                    basicSection
                    fieldsSection
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(Text(editorTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
        }
        .sheet(isPresented: $isPickingType) {
            TemplateFieldTypePicker { type in
                addField(type: type)
            }
        }
    }

    // MARK: - 提示

    private func errorBanner(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var errorList: some View {
        let shown = Array(errors.prefix(12))
        return VStack(alignment: .leading, spacing: 6) {
            ForEach(shown.indices, id: \.self) { index in
                Text("• \(shown[index])")
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if errors.count > shown.count {
                Text("…还有 \(errors.count - shown.count) 条问题")
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
        .card()
    }

    // MARK: - 基础信息

    private var basicSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("基础信息")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            labeled("名称（必填，≤40）") {
                TextField("如：每日开销", text: nameBinding)
                    .textFieldStyle(.roundedBorder)
            }

            labeled("描述（≤200）") {
                TextField("这个模板用来记录什么？", text: descriptionBinding)
                    .textFieldStyle(.roundedBorder)
            }

            labeled("图标") {
                VStack(alignment: .leading, spacing: 8) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 8)], spacing: 8) {
                        ForEach(TemplatePalette.icons, id: \.self) { icon in
                            Button {
                                draft.icon = icon
                            } label: {
                                Text(icon)
                                    .font(.system(size: 22))
                                    .frame(width: 44, height: 44)
                                    .background(
                                        draft.icon == icon ? Theme.brand.opacity(0.18) : Theme.bg,
                                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    )
                                    .overlay {
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .stroke(draft.icon == icon ? Theme.brand : Color.clear, lineWidth: 1.5)
                                    }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    TextField("或手动输入 emoji", text: iconBinding)
                        .textFieldStyle(.roundedBorder)
                }
            }

            labeled("颜色（#RRGGBB）") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 8) {
                        ForEach(TemplatePalette.colors, id: \.self) { hex in
                            Button {
                                draft.color = hex
                            } label: {
                                Circle()
                                    .fill(TemplatePalette.color(from: hex) ?? Theme.bg)
                                    .frame(width: 26, height: 26)
                                    .overlay {
                                        Circle().stroke(
                                            draft.color.lowercased() == hex ? Theme.textPrimary : Color.clear,
                                            lineWidth: 2
                                        )
                                    }
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    TextField("#30cf79", text: colorBinding)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if !draft.color.isEmpty && !TemplatePalette.isHexColor(draft.color) {
                        Text("颜色需形如 #RRGGBB；留空表示不使用模板颜色。")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .card()
    }

    // MARK: - 字段列表

    private var fieldsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("字段（共 \(draft.fields.count) 个）")
                    .font(.headline)
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 6)
                Button("添加字段") { isPickingType = true }
                    .buttonStyle(SecondaryButtonStyle())
            }

            if draft.fields.isEmpty {
                Text("还没有字段，点击「添加字段」开始。")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }

            ForEach(draft.fields.indices, id: \.self) { index in
                TemplateFieldEditorView(
                    index: index,
                    field: draft.fields[index],
                    otherKeys: otherKeys(excluding: index),
                    isKeyLocked: draft.lockedKeys.contains(draft.fields[index].key),
                    isFirst: index == 0,
                    isLast: index == draft.fields.count - 1,
                    onChange: { updated in updateField(at: index, with: updated) },
                    onMoveUp: { moveField(at: index, by: -1) },
                    onMoveDown: { moveField(at: index, by: 1) },
                    onDuplicate: { duplicateField(at: index) },
                    onDelete: { removeField(at: index) }
                )
            }
        }
    }

    // MARK: - 工具条

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("取消") { dismiss() }
                .disabled(isSaving)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button(saveButtonTitle) { save() }
                .disabled(isSaving)
        }
    }

    private var editorTitle: String {
        template == nil ? "新建模板" : "编辑模板"
    }

    private var saveButtonTitle: String {
        if isSaving {
            return "保存中…"
        }
        return template == nil ? "创建" : "保存"
    }

    // MARK: - 绑定

    private var nameBinding: Binding<String> {
        Binding(
            get: { draft.name },
            set: { draft.name = String($0.prefix(40)) }
        )
    }

    private var descriptionBinding: Binding<String> {
        Binding(
            get: { draft.description },
            set: { draft.description = String($0.prefix(200)) }
        )
    }

    private var iconBinding: Binding<String> {
        Binding(
            get: { draft.icon },
            set: { draft.icon = String($0.prefix(8)) }
        )
    }

    private var colorBinding: Binding<String> {
        Binding(
            get: { draft.color },
            set: { draft.color = String($0.prefix(7)) }
        )
    }

    // MARK: - 草稿操作

    private func otherKeys(excluding index: Int) -> [String] {
        draft.fields.indices.compactMap { position in
            position == index ? nil : draft.fields[position].key
        }
    }

    private func updateField(at index: Int, with field: FieldDefinition) {
        guard draft.fields.indices.contains(index) else { return }
        draft.fields[index] = field
    }

    private func addField(type: FieldType) {
        draft.fields.append(TemplateDraft.makeField(type: type, existing: draft.fields))
    }

    private func removeField(at index: Int) {
        guard draft.fields.indices.contains(index) else { return }
        draft.fields.remove(at: index)
    }

    private func moveField(at index: Int, by delta: Int) {
        let target = index + delta
        guard draft.fields.indices.contains(index), draft.fields.indices.contains(target) else { return }
        draft.fields.swapAt(index, target)
    }

    private func duplicateField(at index: Int) {
        guard draft.fields.indices.contains(index) else { return }
        let source = draft.fields[index]
        var copy = source
        copy.key = TemplateDraft.slugify(source.key, existing: draft.fields.map(\.key))
        copy.label = String("\(source.label) 副本".prefix(40))
        copy.options = source.options?.map { option in
            FieldOption(value: option.value, label: option.label, color: option.color)
        }
        draft.fields.insert(copy, at: index + 1)
    }

    // MARK: - 保存

    private func save() {
        let validation = draft.validationErrors()
        errors = validation
        guard validation.isEmpty else {
            submitError = "模板校验未通过，请修正下面列出的问题"
            return
        }
        submitError = nil
        isSaving = true
        let isCreating = template == nil
        launch {
            do {
                if let template {
                    _ = try await session.client.updateTemplate(id: template.id, draft.upsertBody)
                } else {
                    _ = try await session.client.createTemplate(draft.upsertBody)
                }
                toasts.show(isCreating ? "模板已创建" : "模板已保存")
                onSaved()
                dismiss()
            } catch {
                if let api = error as? APIError, api.isUnauthenticated {
                    session.handleUnauthenticated()
                } else {
                    submitError = error.userMessage
                }
            }
            isSaving = false
        }
    }

    // MARK: - 通用

    /// 在 MainActor 上启动异步任务（显式丢弃句柄，避免单表达式闭包的返回值问题）
    private func launch(_ operation: @escaping @MainActor () async -> Void) {
        let task = Task { await operation() }
        _ = task
    }

    @ViewBuilder
    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            content()
        }
    }
}

// MARK: - 编辑草稿

/// 模板编辑草稿（与 Web `templateDraft.ts` 对齐的纯函数集合）
struct TemplateDraft {
    var name: String
    var description: String
    var icon: String
    var color: String
    var fields: [FieldDefinition]
    /// 编辑已有模板时，原有字段的 key 视为不可变
    var lockedKeys: Set<String>

    static let keyPattern = "^[a-z][a-z0-9_]{0,39}$"

    init(
        name: String,
        description: String,
        icon: String,
        color: String,
        fields: [FieldDefinition],
        lockedKeys: Set<String>
    ) {
        self.name = name
        self.description = description
        self.icon = icon
        self.color = color
        self.fields = fields
        self.lockedKeys = lockedKeys
    }

    /// 新建模板的初始草稿（含 1 个文本字段，避免编辑器空荡荡）
    static func blank() -> TemplateDraft {
        TemplateDraft(
            name: "",
            description: "",
            icon: "📝",
            color: "#3b82f6",
            fields: [makeField(type: .text, existing: [])],
            lockedKeys: []
        )
    }

    init(template: Template) {
        self.init(
            name: template.name,
            description: template.description,
            icon: template.icon.isEmpty ? "📝" : template.icon,
            color: template.color,
            fields: template.fields,
            lockedKeys: Set(template.fields.map(\.key))
        )
    }

    /// 提交体（name 去空白）
    var upsertBody: TemplateUpsertBody {
        TemplateUpsertBody(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            description: description,
            icon: icon,
            color: color,
            fields: fields
        )
    }

    /// 本地校验 + `Normalize.validateTemplateFields`（与服务端同一套规则）
    func validationErrors() -> [String] {
        var errors: [String] = []

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedName.isEmpty {
            errors.append("模板名称不能为空")
        } else if trimmedName.count > 40 {
            errors.append("模板名称不能超过 40 个字符")
        }
        if description.count > 200 {
            errors.append("模板描述不能超过 200 个字符")
        }
        if icon.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            errors.append("请为模板选择一个图标（可用 emoji）")
        }
        if fields.isEmpty {
            errors.append("模板至少需要 1 个字段")
        }
        if fields.count > 50 {
            errors.append("模板字段不能超过 50 个")
        }

        errors.append(contentsOf: Normalize.validateTemplateFields(fields))
        return errors
    }

    // MARK: - 字段操作（纯函数）

    static func isValidKey(_ key: String) -> Bool {
        key.range(of: keyPattern, options: .regularExpression) != nil
    }

    /// 由标签生成合法且不冲突的 key（中文/emoji 用 FNV-1a 哈希兜底）
    static func slugify(_ label: String, existing: [String]) -> String {
        var ascii = asciiSlug(label)
        let startsWithLetter = ascii.first.map { character in character.isLetter && character.isLowercase } ?? false
        if ascii.isEmpty || !startsWithLetter {
            let seed = label.trimmingCharacters(in: .whitespacesAndNewlines)
            let hash = fnv1aBase36(seed.isEmpty ? "field" : seed)
            ascii = startsWithLetter ? "\(ascii)_f\(hash)" : "f\(hash)"
        }

        var base = String(ascii.prefix(40))
        if base.isEmpty {
            base = "field"
        }

        let taken = Set(existing)
        if !taken.contains(base) {
            return base
        }
        for suffix in 2..<10_000 {
            let tail = "_\(suffix)"
            let candidate = String(base.prefix(max(1, 40 - tail.count))) + tail
            if !taken.contains(candidate) {
                return candidate
            }
        }
        return String("f\(fnv1aBase36("\(label)-\(taken.count)"))".prefix(40))
    }

    /// 新建字段（key 自动生成，专属配置按类型补全）
    static func makeField(type: FieldType, existing: [FieldDefinition]) -> FieldDefinition {
        var field = FieldDefinition(
            key: slugify(type.rawValue, existing: existing.map(\.key)),
            label: type.meta.label,
            type: type
        )
        field.required = false
        applyTypeDefaults(&field)
        return field
    }

    /// 切换类型：保留 key/label/required/help/placeholder，其余按新类型重置
    static func changedType(field: FieldDefinition, to type: FieldType) -> FieldDefinition {
        var next = FieldDefinition(key: field.key, label: field.label, type: type)
        next.required = field.required
        next.help = field.help
        next.placeholder = field.placeholder
        applyTypeDefaults(&next)
        return next
    }

    /// 修改显示名时同步 key（仅限本次新增的字段，且 key 仍是自动生成的值）
    static func labelChanged(
        field: FieldDefinition,
        newLabel: String,
        otherKeys: [String],
        isKeyLocked: Bool
    ) -> FieldDefinition {
        var next = field
        next.label = newLabel
        if isKeyLocked {
            return next
        }
        let oldBase = field.label.isEmpty ? field.type.rawValue : field.label
        guard field.key == slugify(oldBase, existing: otherKeys) else {
            return next
        }
        let newBase = newLabel.isEmpty ? field.type.rawValue : newLabel
        next.key = slugify(newBase, existing: otherKeys)
        return next
    }

    /// 新增选项（value 自动避开已有值）
    static func nextOption(existing: [FieldOption]) -> FieldOption {
        let values = Set(existing.map(\.value))
        var serial = existing.count + 1
        var value = "option_\(serial)"
        while values.contains(value) {
            serial += 1
            value = "option_\(serial)"
        }
        return FieldOption(value: value, label: "选项 \(serial)", color: nil)
    }

    /// 按类型补全 / 清理专属配置
    static func applyTypeDefaults(_ field: inout FieldDefinition) {
        let meta = field.type.meta

        if field.type == .currency {
            if field.currency == nil {
                field.currency = "CNY"
            }
            if field.precision == nil {
                field.precision = meta.precision
            }
        } else {
            field.currency = nil
            if field.type == .rating {
                if field.scale == nil {
                    field.scale = 5
                }
                field.precision = nil
            } else if meta.numeric {
                if field.precision == nil {
                    field.precision = meta.precision
                }
                field.scale = nil
            } else {
                field.precision = nil
                field.scale = nil
            }
        }

        if !meta.numeric {
            field.min = nil
            field.max = nil
            field.step = nil
        }

        if let defaultMaxLength = meta.maxLength {
            if field.maxLength == nil {
                field.maxLength = defaultMaxLength
            }
        } else {
            field.maxLength = nil
        }

        if meta.requiresOptions {
            if (field.options ?? []).isEmpty {
                field.options = [FieldOption(value: "option_1", label: "选项 1", color: nil)]
            }
        } else {
            field.options = nil
        }
    }

    // MARK: - 内部工具

    private static func asciiSlug(_ text: String) -> String {
        var result = ""
        for scalar in text.lowercased().unicodeScalars {
            switch scalar.value {
            case 97...122, 48...57:
                result.unicodeScalars.append(scalar)
            default:
                result.append("_")
            }
        }
        while result.contains("__") {
            result = result.replacingOccurrences(of: "__", with: "_")
        }
        while result.hasPrefix("_") {
            result.removeFirst()
        }
        while result.hasSuffix("_") {
            result.removeLast()
        }
        return result
    }

    private static func fnv1aBase36(_ text: String) -> String {
        var hash: UInt32 = 0x811c9dc5
        for scalar in text.unicodeScalars {
            hash ^= scalar.value
            hash = hash &* 0x01000193
        }
        if hash == 0 {
            return "0"
        }
        let alphabet = Array("0123456789abcdefghijklmnopqrstuvwxyz")
        var value = hash
        var digits = ""
        while value > 0 {
            let index = Int(value % 36)
            digits = String(alphabet[index]) + digits
            value /= 36
        }
        return digits
    }
}
