//
//  MemoListView.swift
//  浮墨增强版 iOS
//
//  记录列表页（docs/IOS.md §4.2）：
//  NavigationStack + ScrollView/LazyVStack 卡片列表、筛选 sheet、游标分页（limit = 20）、
//  下拉刷新、加载中 / 空态 / 错误三态、右下角悬浮「+」新建。
//

import Foundation
import SwiftUI

// MARK: - 编辑器路由

/// sheet 目标：`.create` = 新建，`.edit(memo)` = 编辑
struct MemoEditorRoute: Identifiable {
    let id: String
    let memo: Memo?

    static let create = MemoEditorRoute(id: "__create__", memo: nil)

    static func edit(_ memo: Memo) -> MemoEditorRoute {
        MemoEditorRoute(id: memo.id, memo: memo)
    }
}

// MARK: - 列表页

struct MemoListView: View {
    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    @State private var model = MemoListModel()
    @State private var showFilters = false
    @State private var editorRoute: MemoEditorRoute?

    var body: some View {
        NavigationStack {
            ZStack {
                Theme.bg.ignoresSafeArea()
                listContent
            }
            .navigationTitle("记录")
            .toolbar { toolbarContent }
            .overlay(alignment: .bottomTrailing) { createButton }
            .sheet(isPresented: $showFilters) { filterSheet }
            .sheet(item: $editorRoute) { route in
                MemoEditorView(memo: route.memo) {
                    Task { await model.reload(session, showLoading: false) }
                }
            }
            .task { await initialLoad() }
        }
    }

    // MARK: - 列表

    private var listContent: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                header
                if let message = model.errorMessage, !model.memos.isEmpty {
                    errorBanner(message)
                }
                if model.isLoading && model.memos.isEmpty {
                    loadingView
                } else if model.memos.isEmpty {
                    if let message = model.errorMessage {
                        errorState(message)
                    } else {
                        emptyView
                    }
                } else {
                    cardList
                    footer
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, 110)
        }
        .refreshable { await refresh() }
    }

    /// 首屏加载失败：整块错误态 + 重试
    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 32, weight: .semibold))
                .foregroundStyle(Theme.danger.opacity(0.85))
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Button("重试") {
                Task { await refresh() }
            }
            .buttonStyle(PrimaryButtonStyle())
            .frame(maxWidth: 200)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 40)
        .card()
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(model.listTitle)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            if model.hasLoaded {
                Text("共 \(model.total) 条")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Text("加载中…")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            if model.hasActiveFilters {
                Text("已筛选")
                    .font(.caption2)
                    .foregroundStyle(Theme.tagBlue)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Theme.tagBlueBg, in: Capsule())
            }
            Spacer(minLength: 0)
            if model.hasActiveFilters {
                Button("清除筛选") {
                    Task { await clearFilters() }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.tagBlue)
            }
        }
        .padding(.horizontal, 2)
    }

    @ViewBuilder
    private var cardList: some View {
        ForEach(model.memos) { memo in
            MemoCardView(
                memo: memo,
                template: model.template(for: memo),
                onTagTap: { tag in applyTagFilter(tag) },
                onTemplateTap: { id in applyTemplateFilter(id) }
            )
            .contentShape(Rectangle())
            .onTapGesture { editorRoute = .edit(memo) }
            .onAppear { loadMoreIfNeeded(memo) }
        }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isLoadingMore {
            ProgressView()
                .padding(.vertical, 10)
        } else if !model.canLoadMore && model.memos.count >= MemoListModel.pageSize {
            Text("没有更多了")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
                .padding(.vertical, 10)
        }
    }

    private var loadingView: some View {
        VStack(spacing: 10) {
            ProgressView()
            Text("加载中…")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56)
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(Theme.brand.opacity(0.85))
            Text(model.hasActiveFilters ? "没有符合条件的记录" : "还没有任何记录")
                .font(.headline)
                .foregroundStyle(Theme.textPrimary)
            Text(model.hasActiveFilters ? "试试调整或清除筛选条件" : "点右下角 + 写下第一条想法")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
            if model.hasActiveFilters {
                Button("清除筛选") {
                    Task { await clearFilters() }
                }
                .buttonStyle(SecondaryButtonStyle())
            } else {
                Button("写一条") { editorRoute = .create }
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(maxWidth: 200)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 44)
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.subheadline)
                .foregroundStyle(Theme.danger)
            VStack(alignment: .leading, spacing: 6) {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Button("重试") {
                    Task { await refresh() }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(Theme.brand)
            }
            Spacer(minLength: 0)
        }
        .card()
    }

    // MARK: - 工具条 / 悬浮按钮

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button {
                Task { await refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(model.isLoading)
            .accessibilityLabel("刷新")
        }
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                showFilters = true
            } label: {
                Image(
                    systemName: model.hasActiveFilters
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease.circle"
                )
                .foregroundStyle(model.hasActiveFilters ? Theme.brand : Theme.textPrimary)
                .overlay(alignment: .topTrailing) { filterBadge }
            }
            .accessibilityLabel(
                Text(model.hasActiveFilters ? "筛选（已生效）" : "筛选")
            )
        }
    }

    @ViewBuilder
    private var filterBadge: some View {
        if model.activeFilterCount > 0 {
            Text("\(model.activeFilterCount)")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.white)
                .frame(minWidth: 16, minHeight: 16)
                .background(Circle().fill(Theme.brand))
                .offset(x: 8, y: -8)
        }
    }

    private var createButton: some View {
        Button {
            editorRoute = .create
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(Circle().fill(Theme.brand))
                .shadow(color: Theme.brand.opacity(0.35), radius: 10, x: 0, y: 4)
        }
        .buttonStyle(.plain)
        .padding(.trailing, 20)
        .padding(.bottom, 26)
        .accessibilityLabel("新建记录")
    }

    private var filterSheet: some View {
        MemoFilterView(filters: model.filters, templates: model.templates) { filters in
            showFilters = false
            model.filters = filters
            Task { await model.reload(session) }
        }
    }

    // MARK: - 行为

    private func initialLoad() async {
        guard !model.hasLoaded else { return }
        await model.loadTemplates(session)
        await model.reload(session)
    }

    private func refresh() async {
        await model.loadTemplates(session)
        await model.reload(session, showLoading: false)
    }

    private func clearFilters() async {
        model.clearFilters()
        await model.reload(session)
    }

    private func applyTagFilter(_ tag: String) {
        model.applyTagFilter(tag)
        Task { await model.reload(session) }
    }

    private func applyTemplateFilter(_ id: String) {
        model.applyTemplateFilter(id)
        Task { await model.reload(session) }
    }

    /// 触底加载下一页
    private func loadMoreIfNeeded(_ memo: Memo) {
        guard memo.id == model.memos.last?.id else { return }
        Task {
            if let message = await model.loadMore(session) {
                toasts.error(message)
            }
        }
    }
}

// MARK: - 预览

#Preview {
    MemoListView()
        .environment(Session())
        .environment(ToastCenter())
}
