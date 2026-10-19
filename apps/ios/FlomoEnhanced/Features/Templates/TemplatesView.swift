//
//  TemplatesView.swift
//  浮墨增强版 iOS
//
//  模板列表页（docs/IOS.md §4.3）：卡片列表 + 归档/恢复 + 复制 + 硬删除 + 导入/导出。
//

import Observation
import SwiftUI

struct TemplatesView: View {
    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var model = TemplateListModel()
    @State private var editorTarget: TemplateEditorTarget?
    @State private var isImporting = false
    @State private var exportedFile: TemplateExportedFile?
    @State private var archiveTarget: Template?
    @State private var deleteTarget: Template?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.bg.ignoresSafeArea()
                content
            }
            .navigationTitle("模板")
            .toolbar { toolbarContent }
        }
        .task(id: model.filter) { await reload() }
        .sheet(item: $editorTarget) { target in
            TemplateEditorView(template: target.template) {
                launch { await reload() }
            }
        }
        .sheet(isPresented: $isImporting) {
            TemplateImportView {
                launch { await reload() }
            }
        }
        .sheet(item: $exportedFile) { file in
            ShareSheet(items: [file.url])
        }
        .alert("归档模板", isPresented: archiveAlertBinding, presenting: archiveTarget) { template in
            Button("取消", role: .cancel) { archiveTarget = nil }
            Button("归档", role: .destructive) {
                archiveTarget = nil
                run(.archive, template: template)
            }
        } message: { template in
            Text("确定要归档「\(template.name)」吗？归档后不会再出现在记录编辑的模板选择里，可随时恢复。")
        }
        .alert("彻底删除模板", isPresented: deleteAlertBinding, presenting: deleteTarget) { template in
            Button("取消", role: .cancel) { deleteTarget = nil }
            Button("彻底删除", role: .destructive) {
                deleteTarget = nil
                run(.hardDelete, template: template)
            }
        } message: { template in
            Text("确定要彻底删除「\(template.name)」吗？该模板下有 \(template.memoCount) 条记录，删除后会解除它们与模板的关联（记录本身保留，字段值仍可查看）。此操作不可恢复。")
        }
    }

    // MARK: - 内容

    @ViewBuilder
    private var content: some View {
        VStack(spacing: 0) {
            header
            if model.loading {
                loadingView
            } else if let message = model.errorMessage {
                errorView(message)
            } else if model.templates.isEmpty {
                emptyView
            } else {
                listView
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("显示范围", selection: filterBinding) {
                ForEach(TemplateListModel.Filter.allCases) { filter in
                    Text(filter.label).tag(filter)
                }
            }
            .pickerStyle(.segmented)

            Text(summaryText)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    private var loadingView: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("加载中…")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 80)
    }

    private func errorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
            Button("重试") { launch { await reload() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .card(padding: 20)
        .padding(.horizontal, 16)
        .padding(.top, 24)
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Text("🧩")
                .font(.system(size: 42))
            Text(emptyTitle)
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)
            Text("创建模板后，记录时可以按字段结构化填写，并在洞察页做统计分析。")
                .font(.subheadline)
                .foregroundStyle(Theme.textSecondary)
                .multilineTextAlignment(.center)
            HStack(spacing: 10) {
                Button("新建模板") { editorTarget = TemplateEditorTarget(template: nil) }
                    .buttonStyle(PrimaryButtonStyle())
                Button("导入模板") { isImporting = true }
                    .buttonStyle(SecondaryButtonStyle())
            }
            .padding(.top, 4)
        }
        .card(padding: 20)
        .padding(.horizontal, 16)
        .padding(.top, 24)
    }

    private var listView: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(model.templates) { template in
                    templateCard(template)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .refreshable { await reload() }
    }

    // MARK: - 卡片

    private func templateCard(_ template: Template) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                if model.isSelectionMode {
                    Image(systemName: model.isSelected(template.id) ? "checkmark.circle.fill" : "circle")
                        .font(.system(size: 20))
                        .foregroundStyle(model.isSelected(template.id) ? Theme.brand : Theme.textSecondary)
                        .padding(.top, 10)
                }

                iconView(for: template)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(template.name)
                            .font(.headline)
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                        if template.isArchived {
                            TagPill(text: "已归档")
                        }
                    }
                    Text(template.description.isEmpty ? "（无描述）" : template.description)
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                if model.busyId == template.id {
                    ProgressView()
                        .padding(.top, 8)
                } else if !model.isSelectionMode {
                    rowMenu(template)
                }
            }

            HStack(spacing: 6) {
                Text("\(template.fields.count) 个字段")
                Text("·")
                Text("\(template.memoCount) 条记录")
                Text("·")
                Text("更新于 \(String(template.updatedAt.prefix(10)))")
            }
            .font(.caption)
            .foregroundStyle(Theme.textSecondary)
        }
        .card()
        .opacity(template.isArchived ? 0.74 : 1)
        .contentShape(Rectangle())
        .onTapGesture { cardTapped(template) }
        .contextMenu { menuItems(template) }
    }

    private func iconView(for template: Template) -> some View {
        let tint = TemplatePalette.color(from: template.color) ?? Theme.brand
        return Text(template.icon.isEmpty ? "📄" : template.icon)
            .font(.system(size: 22))
            .frame(width: 44, height: 44)
            .background(tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func rowMenu(_ template: Template) -> some View {
        Menu {
            menuItems(template)
        } label: {
            Image(systemName: "ellipsis.circle")
                .font(.system(size: 20))
                .foregroundStyle(Theme.textSecondary)
        }
        .accessibilityLabel(Text("模板操作"))
    }

    @ViewBuilder
    private func menuItems(_ template: Template) -> some View {
        Button {
            editorTarget = TemplateEditorTarget(template: template)
        } label: {
            Label("编辑", systemImage: "square.and.pencil")
        }

        Button {
            run(.duplicate, template: template)
        } label: {
            Label("复制", systemImage: "plus.square.on.square")
        }

        if template.isArchived {
            Button {
                run(.restore, template: template)
            } label: {
                Label("恢复", systemImage: "arrow.uturn.backward")
            }
        } else {
            Button {
                archiveTarget = template
            } label: {
                Label("归档", systemImage: "archivebox")
            }
        }

        Divider()

        Button(role: .destructive) {
            deleteTarget = template
        } label: {
            Label("彻底删除", systemImage: "trash")
        }
    }

    // MARK: - 工具条

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                editorTarget = TemplateEditorTarget(template: nil)
            } label: {
                Image(systemName: "plus")
            }
            .accessibilityLabel(Text("新建模板"))

            Button {
                isImporting = true
            } label: {
                Image(systemName: "square.and.arrow.down")
            }
            .accessibilityLabel(Text("导入模板"))

            Button {
                exportTapped()
            } label: {
                if model.exporting {
                    ProgressView()
                } else {
                    Image(systemName: "square.and.arrow.up")
                }
            }
            .disabled(model.exporting || model.templates.isEmpty)
            .accessibilityLabel(Text("导出模板"))

            Button {
                model.toggleSelectionMode()
            } label: {
                Image(systemName: model.isSelectionMode ? "checkmark.circle.fill" : "checkmark.circle")
            }
            .accessibilityLabel(Text("多选"))
        }
    }

    // MARK: - 行为

    private var filterBinding: Binding<TemplateListModel.Filter> {
        Binding(
            get: { model.filter },
            set: { model.filter = $0 }
        )
    }

    private var archiveAlertBinding: Binding<Bool> {
        Binding(
            get: { archiveTarget != nil },
            set: { presented in
                if !presented { archiveTarget = nil }
            }
        )
    }

    private var deleteAlertBinding: Binding<Bool> {
        Binding(
            get: { deleteTarget != nil },
            set: { presented in
                if !presented { deleteTarget = nil }
            }
        )
    }

    private var summaryText: String {
        if model.includeArchived {
            return "共 \(model.activeCount) 个可用模板 · 含归档共 \(model.templates.count) 个"
        }
        return "共 \(model.activeCount) 个可用模板"
    }

    private var emptyTitle: String {
        model.includeArchived ? "还没有任何模板" : "还没有可用的模板"
    }

    private func cardTapped(_ template: Template) {
        if model.isSelectionMode {
            model.toggleSelection(template.id)
        } else {
            editorTarget = TemplateEditorTarget(template: template)
        }
    }

    private func reload() async {
        await model.load(client: session.client)
    }

    /// 在 MainActor 上启动异步任务（显式丢弃句柄，避免单表达式闭包的返回值问题）
    private func launch(_ operation: @escaping @MainActor () async -> Void) {
        let task = Task { await operation() }
        _ = task
    }

    private func run(_ action: TemplateListModel.RowAction, template: Template) {
        let client = session.client
        launch {
            let result = await model.perform(action, client: client, template: template)
            switch result {
            case .success(let message):
                toasts.show(message)
            case .failure(let error):
                handle(error)
            }
        }
    }

    private func exportTapped() {
        let selected = model.selectedIds.sorted()
        if model.isSelectionMode && selected.isEmpty {
            toasts.error("请先选择要导出的模板")
            return
        }
        let ids: [String]? = model.isSelectionMode ? selected : nil
        let client = session.client
        launch {
            do {
                let file = try await model.export(client: client, ids: ids)
                let url = try FileAccess.writeTemporary(file.data, filename: file.filename)
                exportedFile = TemplateExportedFile(url: url)
                if let ids {
                    toasts.show("已导出 \(ids.count) 个模板")
                } else {
                    toasts.show("已导出全部模板")
                }
            } catch {
                handle(error)
            }
        }
    }

    private func handle(_ error: Error) {
        if let api = error as? APIError, api.isUnauthenticated {
            session.handleUnauthenticated()
            return
        }
        toasts.error(error.userMessage)
    }
}

// MARK: - 列表状态

/// 模板列表的数据与操作状态。
@MainActor
@Observable
final class TemplateListModel {
    enum Filter: String, CaseIterable, Identifiable {
        case active
        case includingArchived

        var id: String { rawValue }

        var label: String {
            switch self {
            case .active: return "在用的"
            case .includingArchived: return "含归档"
            }
        }
    }

    enum RowAction {
        case duplicate
        case archive
        case restore
        case hardDelete
    }

    var filter: Filter = .active
    private(set) var templates: [Template] = []
    private(set) var loading = false
    private(set) var errorMessage: String?
    private(set) var busyId: String?
    private(set) var exporting = false
    private(set) var selectedIds: Set<String> = []
    private(set) var isSelectionMode = false

    /// 防止旧的请求结果覆盖新的（切换筛选时）。
    private var loadGeneration = 0

    var includeArchived: Bool { filter == .includingArchived }

    var activeCount: Int { templates.filter { !$0.isArchived }.count }

    func isSelected(_ id: String) -> Bool { selectedIds.contains(id) }

    func toggleSelection(_ id: String) {
        if selectedIds.contains(id) {
            selectedIds.remove(id)
        } else {
            selectedIds.insert(id)
        }
    }

    func toggleSelectionMode() {
        isSelectionMode.toggle()
        if !isSelectionMode {
            selectedIds.removeAll()
        }
    }

    func load(client: APIClient) async {
        loadGeneration += 1
        let generation = loadGeneration
        loading = true
        errorMessage = nil
        do {
            let items = try await client.listTemplates(includeArchived: includeArchived)
            guard generation == loadGeneration else { return }
            templates = items
            selectedIds = selectedIds.intersection(Set(items.map(\.id)))
            loading = false
        } catch {
            guard generation == loadGeneration else { return }
            templates = []
            errorMessage = error.userMessage
            loading = false
        }
    }

    func perform(_ action: RowAction, client: APIClient, template: Template) async -> Result<String, Error> {
        busyId = template.id
        defer { busyId = nil }
        do {
            switch action {
            case .duplicate:
                let copy = try await client.duplicateTemplate(id: template.id)
                await load(client: client)
                return .success("已复制为「\(copy.name)」")
            case .archive:
                try await client.deleteTemplate(id: template.id)
                await load(client: client)
                return .success("已归档「\(template.name)」")
            case .restore:
                _ = try await client.restoreTemplate(id: template.id)
                await load(client: client)
                return .success("已恢复「\(template.name)」")
            case .hardDelete:
                try await client.deleteTemplate(id: template.id, hard: true)
                await load(client: client)
                return .success("模板「\(template.name)」已彻底删除")
            }
        } catch {
            return .failure(error)
        }
    }

    func export(client: APIClient, ids: [String]?) async throws -> DownloadedFile {
        exporting = true
        defer { exporting = false }
        return try await client.exportTemplates(ids: ids)
    }
}

// MARK: - 呈现辅助

/// 编辑器 sheet 的标识（nil 模板 = 新建）
struct TemplateEditorTarget: Identifiable {
    let id = UUID()
    let template: Template?
}

/// 待分享的导出文件
struct TemplateExportedFile: Identifiable {
    let id = UUID()
    let url: URL
}
