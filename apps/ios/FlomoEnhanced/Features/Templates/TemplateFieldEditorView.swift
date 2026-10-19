//
//  TemplateFieldEditorView.swift
//  浮墨增强版 iOS
//
//  单字段编辑卡片（docs/IOS.md §4.3）：key/显示名/类型/必填/占位符/帮助/默认值 +
//  按类型展开的专属配置（min/max/step/precision/currency/scale/maxLength/options）。
//

import SwiftUI
import UIKit

// MARK: - 字段卡片

struct TemplateFieldEditorView: View {
    let index: Int
    let field: FieldDefinition
    let otherKeys: [String]
    let isKeyLocked: Bool
    let isFirst: Bool
    let isLast: Bool
    var onChange: (FieldDefinition) -> Void
    var onMoveUp: () -> Void
    var onMoveDown: () -> Void
    var onDuplicate: () -> Void
    var onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            labeled("显示名（≤40）") {
                TextField("如：金额", text: Binding(
                    get: { field.label },
                    set: { newValue in
                        onChange(TemplateDraft.labelChanged(
                            field: field,
                            newLabel: String(newValue.prefix(40)),
                            otherKeys: otherKeys,
                            isKeyLocked: isKeyLocked
                        ))
                    }
                ))
                .textFieldStyle(.roundedBorder)
            }

            keySection

            typeSection

            labeled("占位符（≤60）") {
                TextField("选填", text: Binding(
                    get: { field.placeholder ?? "" },
                    set: { newValue in patch { $0.placeholder = newValue.isEmpty ? nil : String(newValue.prefix(60)) } }
                ))
                .textFieldStyle(.roundedBorder)
            }

            labeled("帮助文本（≤120）") {
                TextField("选填，展示在输入框下方", text: Binding(
                    get: { field.help ?? "" },
                    set: { newValue in patch { $0.help = newValue.isEmpty ? nil : String(newValue.prefix(120)) } }
                ))
                .textFieldStyle(.roundedBorder)
            }

            typeConfig

            Toggle("必填字段", isOn: Binding(
                get: { field.required == true },
                set: { isOn in patch { $0.required = isOn } }
            ))
            .toggleStyle(.switch)

            TemplateFieldDefaultEditor(field: field) { value in
                patch { $0.defaultValue = value }
            }
        }
        .card()
    }

    // MARK: - 头部

    private var header: some View {
        HStack(spacing: 8) {
            Text("#\(index + 1)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.textSecondary)

            Text(field.label.isEmpty ? "未命名字段" : field.label)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)

            TagPill(text: field.type.meta.label, highlighted: true)

            if field.required == true {
                TagPill(text: "必填")
            }

            Spacer(minLength: 6)

            Menu {
                Button { onMoveUp() } label: { Label("上移", systemImage: "arrow.up") }
                    .disabled(isFirst)
                Button { onMoveDown() } label: { Label("下移", systemImage: "arrow.down") }
                    .disabled(isLast)
                Button { onDuplicate() } label: { Label("复制字段", systemImage: "plus.square.on.square") }
                Divider()
                Button(role: .destructive) { onDelete() } label: { Label("删除字段", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityLabel(Text("字段操作"))
        }
    }

    // MARK: - key

    @ViewBuilder
    private var keySection: some View {
        if isKeyLocked {
            VStack(alignment: .leading, spacing: 4) {
                Text("机器名 key")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                    Text(field.key)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundStyle(Theme.textPrimary)
                    Spacer(minLength: 0)
                }
                Text("已有模板的 key 不可修改（历史记录按 key 存储取值）。")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        } else {
            VStack(alignment: .leading, spacing: 4) {
                Text("机器名 key")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                TextField("如：amount", text: Binding(
                    get: { field.key },
                    set: { newValue in patch { $0.key = String(newValue.prefix(40)) } }
                ))
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .font(.system(.footnote, design: .monospaced))

                if !TemplateDraft.isValidKey(field.key) {
                    warning("key 需满足 ^[a-z][a-z0-9_]{0,39}$（小写字母开头，仅小写字母、数字、下划线，≤40 字符）")
                } else if otherKeys.contains(field.key) {
                    warning("key 与其它字段重复")
                }
            }
        }
    }

    // MARK: - 类型

    private var typeSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("类型")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)

            Picker("类型", selection: typeBinding) {
                ForEach(FieldType.ordered, id: \.self) { type in
                    Text("\(type.meta.label)（\(type.rawValue)）").tag(type)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()

            if isKeyLocked {
                Text("修改类型不会迁移历史记录中的已有取值，只影响新建记录时的表单。")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var typeBinding: Binding<FieldType> {
        Binding(
            get: { field.type },
            set: { newType in onChange(TemplateDraft.changedType(field: field, to: newType)) }
        )
    }

    private var currencyBinding: Binding<String> {
        Binding(
            get: { field.currency ?? "CNY" },
            set: { code in patch { $0.currency = code } }
        )
    }

    // MARK: - 类型专属配置

    @ViewBuilder
    private var typeConfig: some View {
        if field.type.meta.numeric {
            numericConfig
        } else if let defaultMaxLength = field.type.meta.maxLength {
            labeled("最大长度 maxLength（默认 \(defaultMaxLength)）") {
                TemplateIntegerField(title: "", placeholder: "\(defaultMaxLength)", value: field.maxLength) { value in
                    patch { $0.maxLength = value }
                }
            }
        }

        if field.type.meta.requiresOptions {
            optionsConfig
        }
    }

    private var numericConfig: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                TemplateNumberField(title: "最小值 min", value: field.min) { value in
                    patch { $0.min = value }
                }
                TemplateNumberField(title: "最大值 max", value: field.max) { value in
                    patch { $0.max = value }
                }
            }

            if field.type == .rating {
                TemplateIntegerField(title: "满分 scale（1-10）", placeholder: "5", value: field.scale) { value in
                    patch { $0.scale = value }
                }
            } else {
                HStack(alignment: .top, spacing: 10) {
                    TemplateNumberField(title: "步长 step", value: field.step) { value in
                        patch { $0.step = value }
                    }
                    TemplateIntegerField(
                        title: "小数位 precision（0-6）",
                        placeholder: "\(field.type.meta.precision)",
                        value: field.precision
                    ) { value in
                        patch { $0.precision = value }
                    }
                }

                if field.type == .currency {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("币种（ISO-4217）")
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                        Picker("币种", selection: currencyBinding) {
                            ForEach(TemplatePalette.currencies, id: \.self) { code in
                                Text(code).tag(code)
                            }
                        }
                        .pickerStyle(.menu)
                        .labelsHidden()
                    }
                }
            }
        }
    }

    private var optionsConfig: some View {
        let options = field.options ?? []
        let limit = field.type == .multiselect ? 100 : 50
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("选项（value / 显示名 / 颜色）")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 6)
                Button("添加选项") {
                    patch { current in
                        let existing = current.options ?? []
                        current.options = existing + [TemplateDraft.nextOption(existing: existing)]
                    }
                }
                .font(.footnote)
                .disabled(options.count >= limit)
            }

            if options.isEmpty {
                warning("至少需要 1 个选项，否则模板无法保存。")
            }

            ForEach(options.indices, id: \.self) { optionIndex in
                optionRow(optionIndex)
            }
        }
    }

    @ViewBuilder
    private func optionRow(_ optionIndex: Int) -> some View {
        let option = field.options?.indices.contains(optionIndex) == true ? field.options?[optionIndex] : nil

        HStack(spacing: 6) {
            TextField("value", text: Binding(
                get: { option?.value ?? "" },
                set: { newValue in patchOption(optionIndex) { $0.value = String(newValue.prefix(40)) } }
            ))
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.system(.footnote, design: .monospaced))

            TextField("显示名", text: Binding(
                get: { option?.label ?? "" },
                set: { newValue in patchOption(optionIndex) { $0.label = String(newValue.prefix(40)) } }
            ))
            .textFieldStyle(.roundedBorder)

            Menu {
                Button("清除颜色") { patchOption(optionIndex) { $0.color = nil } }
                ForEach(TemplatePalette.optionColors, id: \.self) { hex in
                    Button(TemplatePalette.label(for: hex)) { patchOption(optionIndex) { $0.color = hex } }
                }
            } label: {
                Circle()
                    .fill(TemplatePalette.color(from: option?.color ?? "") ?? Theme.bg)
                    .frame(width: 22, height: 22)
                    .overlay(Circle().stroke(Theme.divider, lineWidth: 1))
            }

            Button(role: .destructive) {
                removeOption(optionIndex)
            } label: {
                Image(systemName: "minus.circle")
            }
        }
    }

    // MARK: - 工具

    private func patch(_ mutate: (inout FieldDefinition) -> Void) {
        var next = field
        mutate(&next)
        onChange(next)
    }

    private func patchOption(_ optionIndex: Int, _ mutate: (inout FieldOption) -> Void) {
        guard var options = field.options, options.indices.contains(optionIndex) else { return }
        mutate(&options[optionIndex])
        patch { $0.options = options }
    }

    private func removeOption(_ optionIndex: Int) {
        guard var options = field.options, options.indices.contains(optionIndex) else { return }
        options.remove(at: optionIndex)
        patch { $0.options = options }
    }

    private func warning(_ text: String) -> some View {
        Text(text)
            .font(.caption2)
            .foregroundStyle(Theme.danger)
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

// MARK: - 默认值编辑

struct TemplateFieldDefaultEditor: View {
    let field: FieldDefinition
    var onChange: (FieldValue?) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("默认值（新建记录时自动填入，可留空）")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 6)
                if !(field.defaultValue?.isEmpty ?? true) {
                    Button("清除") { onChange(nil) }
                        .font(.caption)
                }
            }

            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch field.type {
        case .text, .longtext, .url:
            TextField("留空表示无默认值", text: Binding(
                get: { field.defaultValue?.stringValue ?? "" },
                set: { newValue in
                    let limit = TemplateFieldDefaultEditor.textLimit(field)
                    let trimmed = String(newValue.prefix(limit))
                    onChange(trimmed.isEmpty ? nil : .string(trimmed))
                }
            ))
            .textFieldStyle(.roundedBorder)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(field.type == .url ? .URL : .default)

        case .number, .currency, .percent:
            TemplateNumberField(title: "", placeholder: "留空表示无默认值", value: field.defaultValue?.numberValue) { value in
                onChange(value.map { FieldValue.number($0) })
            }

        case .rating:
            Picker("默认评分", selection: ratingBinding) {
                Text("未设置").tag(0)
                ForEach(1...scaleLimit, id: \.self) { value in
                    Text("\(value) / \(scaleLimit)").tag(value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()

        case .date:
            dateRow([.date])

        case .datetime:
            dateRow([.date, .hourAndMinute])

        case .select:
            Picker("默认选项", selection: selectBinding) {
                Text("未设置").tag("")
                ForEach(field.options ?? [], id: \.value) { option in
                    Text(option.label.isEmpty ? option.value : option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()

        case .multiselect:
            multiSelectChips

        case .boolean:
            Picker("默认值", selection: booleanBinding) {
                Text("未填").tag(0)
                Text("是").tag(1)
                Text("否").tag(2)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
        }
    }

    private var scaleLimit: Int {
        let raw = field.scale ?? 5
        return min(max(raw, 1), 10)
    }

    private var ratingBinding: Binding<Int> {
        Binding(
            get: { Int(field.defaultValue?.numberValue ?? 0) },
            set: { value in onChange(value <= 0 ? nil : .number(Double(value))) }
        )
    }

    private var selectBinding: Binding<String> {
        Binding(
            get: { field.defaultValue?.stringValue ?? "" },
            set: { value in onChange(value.isEmpty ? nil : .string(value)) }
        )
    }

    private var booleanBinding: Binding<Int> {
        Binding(
            get: {
                switch field.defaultValue?.boolValue {
                case .some(true): return 1
                case .some(false): return 2
                case .none: return 0
                }
            },
            set: { value in
                switch value {
                case 1: onChange(.bool(true))
                case 2: onChange(.bool(false))
                default: onChange(nil)
                }
            }
        )
    }

    @ViewBuilder
    private func dateRow(_ components: DatePicker.Components) -> some View {
        if let raw = field.defaultValue?.stringValue,
           let date = TemplateDateHelper.date(from: raw, isDateTime: field.type == .datetime) {
            HStack(spacing: 10) {
                DatePicker("", selection: Binding(
                    get: { date },
                    set: { newValue in
                        onChange(.string(TemplateDateHelper.string(from: newValue, isDateTime: field.type == .datetime)))
                    }
                ), displayedComponents: components)
                .labelsHidden()

                Button("清除") { onChange(nil) }
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        } else {
            Button("设置默认值") {
                onChange(.string(TemplateDateHelper.string(from: Date(), isDateTime: field.type == .datetime)))
            }
            .font(.footnote)
            .buttonStyle(SecondaryButtonStyle())
        }
    }

    private var multiSelectChips: some View {
        VStack(alignment: .leading, spacing: 6) {
            if (field.options ?? []).isEmpty {
                Text("先添加选项后才能设置默认值。")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
            ForEach(field.options ?? [], id: \.value) { option in
                let selected = (field.defaultValue?.arrayValue ?? []).contains(option.value)
                Button {
                    toggleMultiSelect(option.value)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected ? Theme.brand : Theme.textSecondary)
                        Text(option.label.isEmpty ? option.value : option.label)
                            .font(.footnote)
                            .foregroundStyle(Theme.textPrimary)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        selected ? Theme.brand.opacity(0.12) : Theme.bg,
                        in: RoundedRectangle(cornerRadius: 8, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func toggleMultiSelect(_ value: String) {
        var current = Set(field.defaultValue?.arrayValue ?? [])
        if current.contains(value) {
            current.remove(value)
        } else {
            current.insert(value)
        }
        let ordered = (field.options ?? []).map(\.value).filter { current.contains($0) }
        onChange(ordered.isEmpty ? nil : .strings(ordered))
    }

    static func textLimit(_ field: FieldDefinition) -> Int {
        field.maxLength ?? field.type.meta.maxLength ?? 200
    }
}

// MARK: - 字段类型选择

struct TemplateFieldTypePicker: View {
    var onPick: (FieldType) -> Void

    @Environment(\.dismiss) private var dismiss

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: 10)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(FieldType.ordered, id: \.self) { type in
                        Button {
                            onPick(type)
                            dismiss()
                        } label: {
                            VStack(spacing: 6) {
                                Text(type.meta.label)
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Theme.textPrimary)
                                Text(type.rawValue)
                                    .font(.caption2)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("选择字段类型")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

// MARK: - 数值输入

struct TemplateNumberField: View {
    let title: String
    let placeholder: String
    let value: Double?
    var onCommit: (Double?) -> Void

    @State private var text: String

    init(title: String, placeholder: String = "", value: Double?, onCommit: @escaping (Double?) -> Void) {
        self.title = title
        self.placeholder = placeholder
        self.value = value
        self.onCommit = onCommit
        _text = State(initialValue: TemplateNumberField.format(value))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !title.isEmpty {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.decimalPad)
                .onChange(of: text) { _, newValue in
                    let cleaned = TemplateNumberField.sanitize(newValue)
                    if cleaned != newValue {
                        text = cleaned
                        return
                    }
                    onCommit(TemplateNumberField.parse(cleaned))
                }
                .onChange(of: value) { _, newValue in
                    if TemplateNumberField.parse(text) != newValue {
                        text = TemplateNumberField.format(newValue)
                    }
                }
        }
    }

    static func sanitize(_ raw: String) -> String {
        String(raw.filter { character in "0123456789.-".contains(character) })
    }

    static func parse(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "-" || trimmed == "." || trimmed == "-." { return nil }
        guard let value = Double(trimmed), value.isFinite else { return nil }
        return value
    }

    static func format(_ value: Double?) -> String {
        guard let value else { return "" }
        var text = String(value)
        if text.hasSuffix(".0") {
            text.removeLast(2)
        }
        return text
    }
}

struct TemplateIntegerField: View {
    let title: String
    let placeholder: String
    let value: Int?
    var onCommit: (Int?) -> Void

    @State private var text: String

    init(title: String, placeholder: String = "", value: Int?, onCommit: @escaping (Int?) -> Void) {
        self.title = title
        self.placeholder = placeholder
        self.value = value
        self.onCommit = onCommit
        _text = State(initialValue: value.map { number in String(number) } ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if !title.isEmpty {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            TextField(placeholder, text: $text)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.numberPad)
                .onChange(of: text) { _, newValue in
                    let cleaned = String(newValue.filter { character in "0123456789".contains(character) })
                    if cleaned != newValue {
                        text = cleaned
                        return
                    }
                    onCommit(Int(cleaned))
                }
                .onChange(of: value) { _, newValue in
                    if Int(text) != newValue {
                        text = newValue.map { number in String(number) } ?? ""
                    }
                }
        }
    }
}

// MARK: - 视觉辅助

enum TemplatePalette {
    static let icons = ["📝", "💰", "🏃", "📚", "🍜", "✈️", "🎯", "🧠", "🌱", "💤", "🛒", "🧾"]
    static let colors = ["#30cf79", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#0ea5e9", "#ec4899"]
    static let optionColors = ["#30cf79", "#3b82f6", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6"]
    static let currencies = ["CNY", "USD", "EUR", "JPY", "GBP", "HKD"]

    /// `#RRGGBB` → Color（非法返回 nil）
    static func color(from hex: String) -> Color? {
        var text = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.hasPrefix("#") {
            text.removeFirst()
        }
        guard text.count == 6, let value = UInt32(text, radix: 16) else { return nil }
        return Color(hex: value)
    }

    static func isHexColor(_ hex: String) -> Bool {
        color(from: hex) != nil
    }

    static func label(for hex: String) -> String {
        switch hex.lowercased() {
        case "#30cf79": return "品牌绿"
        case "#3b82f6": return "蓝色"
        case "#f59e0b": return "橙色"
        case "#8b5cf6": return "紫色"
        case "#ef4444": return "红色"
        case "#14b8a6": return "青色"
        case "#0ea5e9": return "天蓝"
        case "#ec4899": return "粉色"
        default: return hex
        }
    }
}

/// date / datetime 字符串（`yyyy-MM-dd` / ISO8601 UTC）与 Date 互转
enum TemplateDateHelper {
    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.timeZone = TimeZone.current
        return formatter
    }()

    private static let isoFractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let isoPlainFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func dayKey(from date: Date) -> String {
        dayFormatter.string(from: date)
    }

    static func dayDate(from key: String) -> Date? {
        dayFormatter.date(from: key)
    }

    static func isoString(from date: Date) -> String {
        isoFractionalFormatter.string(from: date)
    }

    static func isoDate(from text: String) -> Date? {
        isoFractionalFormatter.date(from: text) ?? isoPlainFormatter.date(from: text)
    }

    static func string(from date: Date, isDateTime: Bool) -> String {
        isDateTime ? isoString(from: date) : dayKey(from: date)
    }

    static func date(from text: String, isDateTime: Bool) -> Date? {
        isDateTime ? isoDate(from: text) : dayDate(from: text)
    }
}
