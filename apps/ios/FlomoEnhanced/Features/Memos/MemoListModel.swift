//
//  MemoListModel.swift
//  浮墨增强版 iOS
//
//  记录列表的状态与游标分页（筛选条件、模板缓存、错误、加载更多）。
//

import Foundation
import Observation

// MARK: - 筛选条件

/// 记录列表筛选条件（与 Web `MemoFilters` 对齐；日期为本地日 key）
struct MemoFilters: Equatable {
    enum TemplateSelection: Hashable {
        case all
        case none
        case id(String)
    }

    var template: TemplateSelection = .all
    /// 裸标签（不含 `#`）
    var tag: String = ""
    /// `yyyy-MM-dd`（本地日），空串表示不限
    var fromDay: String = ""
    var toDay: String = ""
    /// 内容模糊搜索
    var keyword: String = ""

    var isActive: Bool { activeCount > 0 }

    /// 生效中的筛选维度数量（工具条标记用）
    var activeCount: Int {
        var count = 0
        if template != .all { count += 1 }
        if !MemoTagInput.clean(tag).isEmpty { count += 1 }
        if !fromDay.isEmpty || !toDay.isEmpty { count += 1 }
        if !keyword.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        return count
    }

    /// 筛选条件 → `GET /api/memos` 查询参数
    func query(limit: Int, cursor: String?) -> MemoQuery {
        var query = MemoQuery()
        switch template {
        case .all:
            query.templateId = .all
        case .none:
            query.templateId = .none
        case .id(let value):
            query.templateId = .id(value)
        }
        let tagValue = MemoTagInput.clean(tag)
        query.tag = tagValue.isEmpty ? nil : tagValue
        query.from = fromDay.isEmpty ? nil : Dates.dayStartIso(fromDay)
        query.to = toDay.isEmpty ? nil : Dates.dayEndIso(toDay)
        let keywordValue = keyword.trimmingCharacters(in: .whitespacesAndNewlines)
        query.q = keywordValue.isEmpty ? nil : keywordValue
        query.limit = limit
        query.cursor = cursor
        return query
    }
}

// MARK: - 列表模型

@MainActor
@Observable
final class MemoListModel {
    /// 分页大小（docs/IOS.md §4.2：limit = 20）
    static let pageSize = 20

    private(set) var memos: [Memo] = []
    private(set) var total = 0
    private(set) var nextCursor: String?
    private(set) var templates: [Template] = []
    private(set) var isLoading = false
    private(set) var isLoadingMore = false
    private(set) var errorMessage: String?
    /// 是否成功加载过一次（用于区分「加载中」与「空态」）
    private(set) var hasLoaded = false

    var filters = MemoFilters()

    /// 请求序号：避免筛选快速切换时旧响应覆盖新结果
    private var requestSeq = 0

    var canLoadMore: Bool { nextCursor != nil }
    var hasActiveFilters: Bool { filters.isActive }
    var activeFilterCount: Int { filters.activeCount }

    /// 列表头标题：全部笔记 / 无模板 / 模板名
    var listTitle: String {
        switch filters.template {
        case .all:
            return "全部笔记"
        case .none:
            return "无模板"
        case .id(let id):
            let name = templates.first { $0.id == id }?.name ?? ""
            return name.isEmpty ? "指定模板" : name
        }
    }

    /// 记录对应的模板定义（已归档 / 已删除时为 nil，卡片走降级展示）
    func template(for memo: Memo) -> Template? {
        guard let id = memo.templateId, !id.isEmpty else { return nil }
        return templates.first { $0.id == id }
    }

    // MARK: - 加载

    /// 模板列表（只用于徽标与字段标签，失败不阻塞记录列表）
    func loadTemplates(_ session: Session) async {
        do {
            templates = try await session.client.listTemplates(includeArchived: false)
        } catch {
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
        }
    }

    /// 重新加载第一页（下拉刷新 / 筛选变化 / 保存后）
    func reload(_ session: Session, showLoading: Bool = true) async {
        requestSeq += 1
        let seq = requestSeq
        if showLoading { isLoading = true }
        errorMessage = nil
        do {
            let response = try await session.client.listMemos(filters.query(limit: Self.pageSize, cursor: nil))
            guard seq == requestSeq else { return }
            memos = response.items
            total = response.total
            nextCursor = response.nextCursor
            hasLoaded = true
            isLoading = false
        } catch {
            guard seq == requestSeq else { return }
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            errorMessage = error.userMessage
            hasLoaded = true
            isLoading = false
        }
    }

    /// 触底加载下一页；返回错误文案（nil 表示成功）
    func loadMore(_ session: Session) async -> String? {
        guard !isLoading, !isLoadingMore, let cursor = nextCursor else { return nil }
        isLoadingMore = true
        defer { isLoadingMore = false }
        // 记录请求序号：期间发生刷新 / 筛选切换时丢弃本次结果，避免旧条件的记录混入
        let seq = requestSeq
        do {
            let response = try await session.client.listMemos(filters.query(limit: Self.pageSize, cursor: cursor))
            guard seq == requestSeq else { return nil }
            let existing = Set(memos.map(\.id))
            memos.append(contentsOf: response.items.filter { !existing.contains($0.id) })
            total = response.total
            nextCursor = response.nextCursor
            return nil
        } catch {
            guard seq == requestSeq else { return nil }
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
            return error.userMessage
        }
    }

    // MARK: - 本地维护

    func clearFilters() {
        filters = MemoFilters()
    }

    func applyTemplateFilter(_ id: String) {
        filters.template = .id(id)
    }

    func applyTagFilter(_ tag: String) {
        filters.tag = MemoTagInput.clean(tag)
    }

    func removeLocally(_ id: String) {
        let before = memos.count
        memos.removeAll { $0.id == id }
        if memos.count != before, total > 0 {
            total -= 1
        }
    }
}
