//
//  TemplateImportView.swift
//  浮墨增强版 iOS
//
//  模板导入（docs/IOS.md §4.3）：.fileImporter → FileAccess.readImportedFile →
//  解码 TemplateFile（校验 format / formatVersion）→ 选择冲突模式 → 导入 → 结果明细。
//

import SwiftUI
import UniformTypeIdentifiers

struct TemplateImportView: View {
    var onImported: () -> Void = {}

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts
    @Environment(\.dismiss) private var dismiss

    @State private var isPickingFile = false
    @State private var fileName = ""
    @State private var file: TemplateFile?
    @State private var previewError: String?
    @State private var mode: TemplateImportMode = .rename
    @State private var isImporting = false
    @State private var submitError: String?
    @State private var result: TemplateImportResult?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    fileCard

                    if let previewError {
                        errorCard(previewError)
                    }

                    if let file {
                        infoCard(file)
                        modeCard
                        entriesCard(file)
                    }

                    if let submitError {
                        errorCard(submitError)
                    }

                    if let result {
                        resultCard(result)
                    }
                }
                .padding(16)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(Text("导入模板"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
        }
        .fileImporter(
            isPresented: $isPickingFile,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { outcome in
            handlePick(outcome)
        }
    }

    // MARK: - 选文件

    private var fileCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("选择模板文件")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            Text("支持本应用（或 Web 端）导出的 `.flomo-template.json` 文件。文件会先在本地做格式与字段定义校验。")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)

            HStack(spacing: 10) {
                Button("选择文件…") { isPickingFile = true }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(isImporting)

                if !fileName.isEmpty {
                    Text(fileName)
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
        }
        .card()
    }

    // MARK: - 预览

    private func infoCard(_ file: TemplateFile) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("文件信息")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)
            Text("来自 \(file.app.name) \(file.app.version)，导出于 \(TemplateImportView.displayStamp(file.exportedAt))，共 \(file.templates.count) 个模板。")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            if file.templates.isEmpty {
                Text("文件中没有可导入的模板。")
                    .font(.caption)
                    .foregroundStyle(Theme.danger)
            }
        }
        .card()
    }

    private var modeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("同名冲突处理")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            Picker("同名冲突处理", selection: $mode) {
                ForEach(TemplateImportMode.allCases, id: \.self) { candidate in
                    Text(candidate.label).tag(candidate)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()

            Text(modeHint)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    private func entriesCard(_ file: TemplateFile) -> some View {
        let entries = file.templates
        return VStack(alignment: .leading, spacing: 10) {
            Text("将导入（\(entries.count) 个）")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            ForEach(entries.indices, id: \.self) { index in
                let entry = entries[index]
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(entry.icon.isEmpty ? "📄" : entry.icon)
                            .font(.system(size: 18))
                        Text(entry.name)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text("v\(entry.templateVersion)")
                            .font(.caption2)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    if !entry.description.isEmpty {
                        Text(entry.description)
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                            .lineLimit(2)
                    }
                    Text("\(entry.fields.count) 个字段"
                         + (TemplateImportView.typeSummary(entry.fields).isEmpty
                            ? ""
                            : "（\(TemplateImportView.typeSummary(entry.fields))）"))
                        .font(.caption2)
                        .foregroundStyle(Theme.textSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
        }
        .card()
    }

    // MARK: - 结果

    private func resultCard(_ result: TemplateImportResult) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("导入结果")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)

            Text("新增 \(result.imported.count) 个\(names(result.imported.map(\.name)))")
                .font(.caption)
                .foregroundStyle(Theme.textPrimary)
            Text("覆盖 \(result.overwritten.count) 个\(names(result.overwritten.map(\.name)))")
                .font(.caption)
                .foregroundStyle(Theme.textPrimary)
            Text("跳过 \(result.skipped.count) 个\(skippedDetail(result.skipped))")
                .font(.caption)
                .foregroundStyle(Theme.textPrimary)
            Text("失败 \(result.errors.count) 个")
                .font(.caption)
                .foregroundStyle(result.errors.isEmpty ? Theme.textPrimary : Theme.danger)

            if !result.errors.isEmpty {
                ForEach(result.errors.indices, id: \.self) { index in
                    let item = result.errors[index]
                    Text("第 \(item.index + 1) 个「\(item.name)」：\(item.message)")
                        .font(.caption2)
                        .foregroundStyle(Theme.danger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .card()
    }

    private func errorCard(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(Theme.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    // MARK: - 工具条

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("关闭") { dismiss() }
                .disabled(isImporting)
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button(importButtonTitle) { startImport() }
                .disabled(isImporting || (file?.templates.isEmpty ?? true))
        }
    }

    private var importButtonTitle: String {
        isImporting ? "导入中…" : "开始导入"
    }

    // MARK: - 行为

    private var modeHint: String {
        switch mode {
        case .skip:
            return "同名模板已存在时跳过，不修改现有模板。"
        case .rename:
            return "同名模板自动加「 2」「 3」后缀（默认）。"
        case .overwrite:
            return "同名模板覆盖其字段定义与描述，保留原 id 与已有记录关联。"
        }
    }

    private func handlePick(_ outcome: Result<[URL], Error>) {
        result = nil
        submitError = nil
        previewError = nil

        switch outcome {
        case .failure:
            file = nil
            fileName = ""
            previewError = "无法读取所选文件，请重新选择。"
        case .success(let urls):
            guard let url = urls.first else {
                file = nil
                fileName = ""
                previewError = "没有选择文件。"
                return
            }
            do {
                let data = try FileAccess.readImportedFile(at: url)
                try TemplateImportView.ensureJSONObject(data)
                let decoded = try JSONDecoder().decode(TemplateFile.self, from: data)
                try TemplateImportView.validate(decoded)
                file = decoded
                fileName = url.lastPathComponent
            } catch let issue as TemplateImportIssue {
                file = nil
                fileName = ""
                previewError = issue.message
            } catch is DecodingError {
                file = nil
                fileName = ""
                previewError = "文件内容不完整：templates / name / fields 等字段缺失或类型不正确。"
            } catch {
                file = nil
                fileName = ""
                previewError = "读取文件失败，请重新选择。"
            }
        }
    }

    private func startImport() {
        guard let file else { return }
        submitError = nil
        result = nil
        isImporting = true
        let selectedMode = mode
        launch {
            do {
                let outcome = try await session.client.importTemplates(file: file, mode: selectedMode)
                result = outcome
                onImported()
                if outcome.errors.isEmpty {
                    toasts.show("导入完成：新增 \(outcome.imported.count) 个模板")
                } else {
                    toasts.error("导入完成，但有 \(outcome.errors.count) 个模板失败")
                }
            } catch {
                if let api = error as? APIError, api.isUnauthenticated {
                    session.handleUnauthenticated()
                } else {
                    submitError = error.userMessage
                }
            }
            isImporting = false
        }
    }

    /// 在 MainActor 上启动异步任务（显式丢弃句柄，避免单表达式闭包的返回值问题）
    private func launch(_ operation: @escaping @MainActor () async -> Void) {
        let task = Task { await operation() }
        _ = task
    }

    // MARK: - 本地校验

    /// 区分「不是合法 JSON」与「顶层不是对象」（对应 shared `parseTemplateFile` 的文案）
    private static func ensureJSONObject(_ data: Data) throws {
        let object = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        guard let object else {
            throw TemplateImportIssue(message: "文件不是合法的 JSON")
        }
        guard object is [String: Any] else {
            throw TemplateImportIssue(message: "文件顶层必须是对象")
        }
    }

    private static func validate(_ file: TemplateFile) throws {
        guard file.format == TemplateFile.expectedFormat else {
            throw TemplateImportIssue(message: "文件格式不匹配：需要 format = \"\(TemplateFile.expectedFormat)\"")
        }
        guard file.formatVersion == TemplateFile.expectedVersion else {
            throw TemplateImportIssue(message: "文件版本不受支持：需要 formatVersion = \(TemplateFile.expectedVersion)，实际为 \(file.formatVersion)")
        }
        for entry in file.templates {
            let fieldErrors = Normalize.validateTemplateFields(entry.fields)
            if !fieldErrors.isEmpty {
                throw TemplateImportIssue(message: "模板「\(entry.name)」字段定义非法：\(fieldErrors.joined(separator: "；"))")
            }
        }
    }

    static func typeSummary(_ fields: [FieldDefinition]) -> String {
        var counts: [FieldType: Int] = [:]
        for field in fields {
            counts[field.type, default: 0] += 1
        }
        var parts: [String] = []
        for type in FieldType.ordered {
            if let count = counts[type], count > 0 {
                parts.append("\(type.meta.label) ×\(count)")
            }
        }
        return parts.joined(separator: "、")
    }

    static func displayStamp(_ iso: String) -> String {
        guard iso.count >= 19 else { return iso }
        let text = String(iso.prefix(19))
        return text.replacingOccurrences(of: "T", with: " ")
    }

    private func names(_ list: [String]) -> String {
        list.isEmpty ? "" : "：\(list.joined(separator: "、"))"
    }

    private func skippedDetail(_ list: [TemplateImportResult.SkippedTemplate]) -> String {
        guard !list.isEmpty else { return "" }
        let detail = list.map { item in "\(item.name)（\(item.reason)）" }.joined(separator: "、")
        return "：\(detail)"
    }
}

/// 本地导入校验失败（message 为中文，可直接展示）
struct TemplateImportIssue: LocalizedError {
    let message: String

    var errorDescription: String? { message }
}
