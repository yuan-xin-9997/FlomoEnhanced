//
//  MemoFieldForm.swift
//  浮墨增强版 iOS
//
//  模板字段表单（12 种字段类型控件）与草稿 ↔ 取值的换算 / 本地预校验。
//  数值类字段保持**字符串草稿**（与 Web 一致），保存前统一走 `Normalize.value` 转换。
//

import Foundation
import SwiftUI

// MARK: - 本地校验结果

struct MemoFieldDraftResult {
    var values: [String: FieldValue] = [:]
    var errors: [String: String] = [:]

    var isValid: Bool { errors.isEmpty }
}

// MARK: - 草稿换算与校验

/// 字段草稿（`key -> FieldValue`）的形态约定：
/// - `text` / `longtext` / `url`：`.string`
/// - `number` / `currency` / `percent` / `rating` / `date` / `datetime` / `select`：`.string`（数值保持用户输入的字符串形态）
/// - `multiselect`：`.strings`
/// - `boolean`：`.bool` / `.null`（未填）
enum MemoFieldDraft {
    /// 内容长度上限（与服务端 `MEMO_CONTENT_MAX` 一致）
    static let contentMax = 10000

    // MARK: 草稿构造

    /// 空草稿（字段自身 `defaultValue` 优先）
    static func empty(fields: [FieldDefinition]) -> [String: FieldValue] {
        var draft: [String: FieldValue] = [:]
        for def in fields {
            draft[def.key] = draftValue(from: def.defaultValue, type: def.type)
        }
        return draft
    }

    /// 已有记录的 `values` → 草稿（补齐缺少的键，避免控件变非受控）
    static func draft(fields: [FieldDefinition], values: [String: FieldValue]) -> [String: FieldValue] {
        var draft: [String: FieldValue] = [:]
        for def in fields {
            if let raw = values[def.key] {
                draft[def.key] = draftValue(from: raw, type: def.type)
            } else {
                draft[def.key] = draftValue(from: def.defaultValue, type: def.type)
            }
        }
        return draft
    }

    /// 取值 → 草稿形态
    static func draftValue(from value: FieldValue?, type: FieldType) -> FieldValue {
        guard let value else { return .null }
        switch type {
        case .number, .currency, .percent, .rating:
            if let number = value.numberValue { return .string(MemoNumberText.text(from: number)) }
            if let text = value.stringValue, !text.isEmpty { return .string(text) }
            return .null
        case .boolean:
            if let flag = value.boolValue { return .bool(flag) }
            return .null
        case .multiselect:
            return .strings(value.arrayValue ?? [])
        default:
            if let text = value.stringValue { return .string(text) }
            return .null
        }
    }

    // MARK: 保存前校验（与 Web `normalizeDraft` 对齐）

    static func normalize(fields: [FieldDefinition], draft: [String: FieldValue]) -> MemoFieldDraftResult {
        var result = MemoFieldDraftResult()
        for def in fields {
            let name = label(of: def)
            let raw = draft[def.key] ?? .null

            switch def.type {
            case .number, .currency, .percent, .rating:
                let text = (raw.stringValue ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if text.isEmpty {
                    apply(def: def, raw: .null, name: name, into: &result)
                    continue
                }
                guard let number = Double(text) else {
                    result.errors[def.key] = "「\(name)」必须是数字"
                    continue
                }
                if def.type == .rating, number.rounded() != number {
                    result.errors[def.key] = "「\(name)」必须是整数评分"
                    continue
                }
                apply(def: def, raw: .number(number), name: name, into: &result)

            case .text, .longtext, .url:
                let text = raw.stringValue ?? ""
                if let max = maxLength(of: def), text.count > max {
                    result.errors[def.key] = "「\(name)」长度不能超过 \(max) 个字符"
                    continue
                }
                apply(def: def, raw: text.isEmpty ? .null : .string(text), name: name, into: &result)

            default:
                apply(def: def, raw: raw, name: name, into: &result)
            }
        }
        return result
    }

    private static func apply(
        def: FieldDefinition,
        raw: FieldValue,
        name: String,
        into result: inout MemoFieldDraftResult
    ) {
        switch Normalize.value(def, raw) {
        case .ok(let value):
            let normalized = value ?? .null
            if def.required == true && normalized.isEmpty {
                result.errors[def.key] = "「\(name)」为必填项"
            } else {
                result.values[def.key] = normalized
            }
        case .fail(let message):
            result.errors[def.key] = message
        }
    }

    // MARK: 元信息

    static func label(of def: FieldDefinition) -> String {
        let name = def.label.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty ? def.key : name
    }

    /// 文本类字段的有效长度上限（未显式配置时与 Web `FIELD_TYPE_META` 一致）
    static func maxLength(of def: FieldDefinition) -> Int? {
        if let max = def.maxLength, max > 0 { return max }
        switch def.type {
        case .text:
            return 200
        case .longtext:
            return 5000
        case .url:
            return 2048
        default:
            return nil
        }
    }

    static func isTextType(_ type: FieldType) -> Bool {
        type == .text || type == .longtext || type == .url
    }
}

// MARK: - 字段表单

struct MemoFieldFormView: View {
    let fields: [FieldDefinition]
    @Binding var draft: [String: FieldValue]
    var errors: [String: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if fields.isEmpty {
                Text("该模板尚未定义字段。")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                ForEach(fields) { def in
                    fieldBlock(def)
                }
            }
        }
    }

    // MARK: 单个字段

    private func fieldBlock(_ def: FieldDefinition) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(MemoFieldDraft.label(of: def))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                if def.required == true {
                    Text("*")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(Theme.danger)
                }
                if def.type == .currency {
                    Text("（\(MemoCurrency.symbol(of: MemoCurrency.code(of: def)))）")
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
                Spacer(minLength: 0)
                if MemoFieldDraft.isTextType(def.type), let max = MemoFieldDraft.maxLength(of: def) {
                    let count = stringValue(def.key).count
                    Text("\(count)/\(max)")
                        .font(.caption2)
                        .foregroundStyle(count > max ? Theme.danger : Theme.textSecondary.opacity(0.8))
                }
            }
            control(def)
            if let help = def.help, !help.isEmpty {
                Text(help)
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
            if let message = errors[def.key] {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
    }

    // MARK: 控件（12 种字段类型）

    @ViewBuilder
    private func control(_ def: FieldDefinition) -> some View {
        switch def.type {
        case .text:
            TextField(def.placeholder ?? "", text: textBinding(def.key))
                .font(.subheadline)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(inputBackground, in: inputShape)
                .overlay { inputBorder(def.key) }

        case .longtext:
            TextEditor(text: textBinding(def.key))
                .font(.subheadline)
                .frame(minHeight: 88)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
                .background(inputBackground, in: inputShape)
                .overlay { inputBorder(def.key) }

        case .number, .currency, .percent:
            HStack(spacing: 6) {
                if def.type == .currency {
                    Text(MemoCurrency.symbol(of: MemoCurrency.code(of: def)))
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
                TextField(def.placeholder ?? "0", text: textBinding(def.key))
                    .font(.subheadline)
                    .keyboardType(.decimalPad)
                if def.type == .percent {
                    Text("%")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(inputBackground, in: inputShape)
            .overlay { inputBorder(def.key) }

        case .rating:
            ratingControl(def)

        case .date:
            dateControl(def, includeTime: false)

        case .datetime:
            dateControl(def, includeTime: true)

        case .select:
            selectControl(def)

        case .multiselect:
            multiSelectControl(def)

        case .boolean:
            booleanControl(def)

        case .url:
            TextField(def.placeholder ?? "https://", text: textBinding(def.key))
                .font(.subheadline)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(inputBackground, in: inputShape)
                .overlay { inputBorder(def.key) }
        }
    }

    /// 评分：点同一星取消（0..scale，整数）
    private func ratingControl(_ def: FieldDefinition) -> some View {
        let scale = max(1, min(10, def.scale ?? 5))
        let current = Double(stringValue(def.key))
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                ForEach(1...scale, id: \.self) { score in
                    Button {
                        setRating(def.key, score: current == Double(score) ? nil : Double(score))
                    } label: {
                        Image(systemName: (current ?? 0) >= Double(score) ? "star.fill" : "star")
                            .font(.system(size: 20))
                            .foregroundStyle((current ?? 0) >= Double(score) ? Theme.warning : Theme.textSecondary.opacity(0.45))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("\(score) 分"))
                }
                Spacer(minLength: 0)
            }
            Text(current == nil ? "未评分（满分 \(scale)）" : "\(MemoNumberText.text(from: current ?? 0)) / \(scale)")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
        }
    }

    /// 日期 / 日期时间：`DatePicker`（日期存 `yyyy-MM-dd`，时间存 UTC ISO-8601 带毫秒）
    private func dateControl(_ def: FieldDefinition, includeTime: Bool) -> some View {
        let hasValue = !stringValue(def.key).isEmpty
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                DatePicker(
                    "",
                    selection: dateBinding(def.key, includeTime: includeTime),
                    displayedComponents: includeTime ? [.date, .hourAndMinute] : .date
                )
                .labelsHidden()
                Spacer(minLength: 0)
                if hasValue {
                    Button("清除") { draft[def.key] = .null }
                        .font(.caption)
                        .foregroundStyle(Theme.tagBlue)
                }
            }
            if !hasValue {
                Text("未填写（改动日期即视为填写）")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary.opacity(0.9))
            }
        }
    }

    private func selectControl(_ def: FieldDefinition) -> some View {
        let options = def.options ?? []
        return VStack(alignment: .leading, spacing: 4) {
            Picker("", selection: textBinding(def.key)) {
                Text("— 请选择 —").tag("")
                ForEach(options, id: \.value) { option in
                    Text(option.label).tag(option.value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 6)
            .background(inputBackground, in: inputShape)
            if options.isEmpty {
                Text("该字段尚未配置选项")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private func multiSelectControl(_ def: FieldDefinition) -> some View {
        let options = def.options ?? []
        let picked = draft[def.key]?.arrayValue ?? []
        return VStack(alignment: .leading, spacing: 6) {
            if options.isEmpty {
                Text("该字段尚未配置选项")
                    .font(.caption2)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 92), spacing: 8)],
                    alignment: .leading,
                    spacing: 8
                ) {
                    ForEach(options, id: \.value) { option in
                        let active = picked.contains(option.value)
                        Button {
                            toggleMulti(def.key, value: option.value)
                        } label: {
                            Text(option.label)
                                .font(.caption)
                                .lineLimit(1)
                                .foregroundStyle(active ? Color.white : Theme.textPrimary)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 7)
                                .frame(maxWidth: .infinity)
                                .background(
                                    active ? Theme.brand : Theme.bg,
                                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// 是 / 否 / 未填（三态 segmented；未填提交 `.null`）
    private func booleanControl(_ def: FieldDefinition) -> some View {
        Picker("", selection: booleanBinding(def.key)) {
            Text("未填").tag(0)
            Text("是").tag(1)
            Text("否").tag(2)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
    }

    // MARK: Bindings

    private var inputBackground: Color { Theme.bg.opacity(0.6) }

    private var inputShape: RoundedRectangle { RoundedRectangle(cornerRadius: 9, style: .continuous) }

    @ViewBuilder
    private func inputBorder(_ key: String) -> some View {
        inputShape.stroke(errors[key] == nil ? Color.clear : Theme.danger, lineWidth: 1)
    }

    private func stringValue(_ key: String) -> String {
        draft[key]?.stringValue ?? ""
    }

    private func textBinding(_ key: String) -> Binding<String> {
        Binding(
            get: { draft[key]?.stringValue ?? "" },
            set: { newValue in
                draft[key] = newValue.isEmpty ? FieldValue.null : FieldValue.string(newValue)
            }
        )
    }

    private func booleanBinding(_ key: String) -> Binding<Int> {
        Binding(
            get: {
                guard let value = draft[key] else { return 0 }
                switch value {
                case .bool(let flag):
                    return flag ? 1 : 2
                default:
                    return 0
                }
            },
            set: { newValue in
                switch newValue {
                case 1:
                    draft[key] = FieldValue.bool(true)
                case 2:
                    draft[key] = FieldValue.bool(false)
                default:
                    draft[key] = FieldValue.null
                }
            }
        )
    }

    private func dateBinding(_ key: String, includeTime: Bool) -> Binding<Date> {
        Binding(
            get: {
                let text = stringValue(key)
                if includeTime, let date = MemoDateTime.date(fromIso: text) {
                    return date
                }
                if !includeTime, let date = MemoDay.date(fromKey: text) {
                    return date
                }
                return MemoDay.todayDate()
            },
            set: { newValue in
                draft[key] = FieldValue.string(
                    includeTime ? MemoDateTime.iso(from: newValue) : MemoDay.key(from: newValue)
                )
            }
        )
    }

    // MARK: 交互

    private func setRating(_ key: String, score: Double?) {
        if let score {
            draft[key] = FieldValue.string(MemoNumberText.text(from: score))
        } else {
            draft[key] = FieldValue.null
        }
    }

    private func toggleMulti(_ key: String, value: String) {
        var picked = draft[key]?.arrayValue ?? []
        if let index = picked.firstIndex(of: value) {
            picked.remove(at: index)
        } else {
            picked.append(value)
        }
        draft[key] = FieldValue.strings(picked)
    }
}
