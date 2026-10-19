//
//  SettingsView.swift
//  浮墨增强版 iOS
//
//  设置页（docs/IOS.md §4.5）：服务器地址、健康检查、账号信息、修改密码、登出、关于。
//

import Foundation
import SwiftUI

struct SettingsView: View {
    // MARK: - 局部类型

    private enum PasswordField: Hashable {
        case current
        case new
        case confirm
    }

    /// 输入框统一外观：浅底、圆角、错误时红边
    private struct InputStyle: ViewModifier {
        var invalid = false

        func body(content: Content) -> some View {
            content
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(Theme.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(invalid ? Theme.danger.opacity(0.7) : Color.clear, lineWidth: 1)
                )
        }
    }

    private static let appVersion = "1.0.0"
    private static let passwordMinLength = 8
    private static let passwordMaxLength = 128

    // MARK: - 环境

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    // MARK: - 状态

    @State private var isHealthLoading = false
    @State private var health: HealthResponse?
    @State private var healthError: String?

    @State private var isSummaryLoading = false
    @State private var summary: MemoSummary?
    @State private var summaryError: String?

    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var passwordErrors: [PasswordField: String] = [:]
    @State private var passwordSubmitError: String?
    @State private var isChangingPassword = false
    @FocusState private var passwordFocus: PasswordField?

    @State private var showServerSheet = false
    @State private var showLogoutConfirm = false

    // MARK: - 主体

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    serverCard
                    healthCard
                    accountCard
                    passwordCard
                    logoutButton
                    aboutCard
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 28)
            }
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle("设置")
            .scrollDismissesKeyboard(.interactively)
            .sheet(isPresented: $showServerSheet) {
                ServerAddressSheet()
            }
            .confirmationDialog(
                "确定要退出登录吗？",
                isPresented: $showLogoutConfirm,
                titleVisibility: .visible
            ) {
                Button("退出登录", role: .destructive) {
                    Task { await session.logout() }
                }
                Button("取消", role: .cancel) {}
            } message: {
                Text("退出后需要重新输入用户名和密码。")
            }
        }
        .task { await loadHealth() }
        .task { await loadSummary() }
        .onChange(of: session.baseURLString) { _, _ in
            Task { await loadHealth() }
            Task { await loadSummary() }
        }
    }

    // MARK: - 服务器地址

    @MainActor
    private var serverCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardHeader("服务器地址") {
                Button("编辑") { showServerSheet = true }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.tagBlue)
            }

            Text(session.baseURLString)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Theme.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)

            Text("保存后立即生效；数据存储在该服务器上。")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    // MARK: - 健康检查

    private var healthCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            cardHeader("健康检查") {
                Button("刷新") { Task { await loadHealth() } }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.tagBlue)
                    .disabled(isHealthLoading)
            }

            if let health {
                statusRow(health)
                infoRow("版本", health.version)
                infoRow("运行时长", formatUptime(health.uptimeSec))
                infoRow("数据库", "用户 \(health.db.users) · 记录 \(health.db.memos) · 模板 \(health.db.templates)")
            } else if isHealthLoading {
                loadingRow("正在检查服务器…")
            } else if let healthError {
                errorBlock(healthError) {
                    Task { await loadHealth() }
                }
            } else {
                Text("尚未检查")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .card()
    }

    private func statusRow(_ health: HealthResponse) -> some View {
        HStack(spacing: 8) {
            TagPill(text: health.status, highlighted: health.isOk)
            Text(health.isOk ? "运行正常" : "服务异常")
                .font(.footnote)
                .foregroundStyle(health.isOk ? Theme.brandDark : Theme.danger)
            Spacer(minLength: 8)
            if isHealthLoading {
                ProgressView()
                    .controlSize(.small)
            }
        }
    }

    // MARK: - 账号

    @MainActor
    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            cardHeader("账号") {
                Button("刷新") { Task { await loadSummary() } }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Theme.tagBlue)
                    .disabled(isSummaryLoading)
            }

            infoRow("用户名", session.user?.username ?? "未登录")
            infoRow("注册时间", createdAtText)

            Divider()

            if let summary {
                HStack(spacing: 0) {
                    statItem("记录总数", "\(summary.total)")
                    statItem("活跃天数", "\(summary.activeDays)")
                    statItem("连续天数", "\(summary.currentStreak)")
                }
            } else if isSummaryLoading {
                loadingRow("正在加载记录统计…")
            } else if let summaryError {
                errorBlock(summaryError) {
                    Task { await loadSummary() }
                }
            } else {
                Text("暂无统计")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        .card()
    }

    @MainActor
    private var createdAtText: String {
        guard let createdAt = session.user?.createdAt, !createdAt.isEmpty else { return "—" }
        return Dates.formatTimestamp(createdAt)
    }

    // MARK: - 修改密码

    private var passwordCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            cardHeader("修改密码")

            if let passwordSubmitError {
                inlineBanner(passwordSubmitError)
            }

            VStack(alignment: .leading, spacing: 14) {
                currentPasswordField
                newPasswordField
                confirmPasswordField
            }

            Button(action: { performPasswordSubmit() }) {
                HStack(spacing: 8) {
                    if isChangingPassword {
                        ProgressView()
                            .tint(.white)
                    }
                    Text(isChangingPassword ? "提交中…" : "修改密码")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isChangingPassword)
            .opacity(isChangingPassword ? 0.75 : 1)

            Text("修改成功后，该账号在其它设备上的登录会话会被吊销。")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    private var currentPasswordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("当前密码")

            SecureField("当前密码", text: $currentPassword)
                .modifier(InputStyle(invalid: passwordErrors[.current] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.password)
                .submitLabel(.next)
                .focused($passwordFocus, equals: .current)
                .disabled(isChangingPassword)
                .onSubmit { passwordFocus = .new }

            errorText(passwordErrors[.current])
        }
    }

    private var newPasswordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("新密码")

            SecureField("至少 8 位", text: $newPassword)
                .modifier(InputStyle(invalid: passwordErrors[.new] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.newPassword)
                .submitLabel(.next)
                .focused($passwordFocus, equals: .new)
                .disabled(isChangingPassword)
                .onSubmit { passwordFocus = .confirm }

            errorText(passwordErrors[.new])
        }
    }

    private var confirmPasswordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("确认新密码")

            SecureField("再次输入新密码", text: $confirmPassword)
                .modifier(InputStyle(invalid: passwordErrors[.confirm] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.newPassword)
                .submitLabel(.go)
                .focused($passwordFocus, equals: .confirm)
                .disabled(isChangingPassword)
                .onSubmit { performPasswordSubmit() }

            errorText(passwordErrors[.confirm])
        }
    }

    // MARK: - 登出

    private var logoutButton: some View {
        Button {
            showLogoutConfirm = true
        } label: {
            Text("退出登录")
                .font(.headline)
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Theme.danger)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - 关于

    @MainActor
    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            cardHeader("关于")

            Text("浮墨增强版 iOS \(Self.appVersion)")
                .font(.footnote.weight(.medium))
                .foregroundStyle(Theme.textPrimary)

            infoRow("服务端", session.baseURLString)

            Text("数据存储在你的自建服务器上。")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    // MARK: - 通用小组件

    private func cardHeader(_ title: String) -> some View {
        cardHeader(title) { EmptyView() }
    }

    private func cardHeader<Trailing: View>(_ title: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 8) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            trailing()
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
            Spacer(minLength: 12)
            Text(value)
                .font(.footnote)
                .foregroundStyle(Theme.textPrimary)
                .multilineTextAlignment(.trailing)
        }
    }

    private func statItem(_ label: String, _ value: String) -> some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.title3.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func fieldLabel(_ text: String) -> some View {
        Text(text)
            .font(.footnote.weight(.medium))
            .foregroundStyle(Theme.textSecondary)
    }

    @ViewBuilder
    private func errorText(_ message: String?) -> some View {
        if let message {
            Text(message)
                .font(.footnote)
                .foregroundStyle(Theme.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func inlineBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.circle.fill")
                .font(.footnote)
            Text(message)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(Theme.danger)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func loadingRow(_ text: String) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .controlSize(.small)
            Text(text)
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
    }

    private func errorBlock(_ message: String, retry: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.footnote)
                Text(message)
                    .font(.footnote)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .foregroundStyle(Theme.danger)
            .frame(maxWidth: .infinity, alignment: .leading)

            Button("重试", action: retry)
                .buttonStyle(SecondaryButtonStyle())
        }
    }

    private func formatUptime(_ seconds: Double) -> String {
        let safe = seconds.isFinite ? max(0, seconds) : 0
        let total = Int(safe)
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        return "\(hours) 小时 \(minutes) 分钟"
    }

    // MARK: - 数据加载

    @MainActor
    private func loadHealth() async {
        guard !isHealthLoading else { return }
        isHealthLoading = true
        healthError = nil
        defer { isHealthLoading = false }

        do {
            health = try await session.client.health()
        } catch {
            health = nil
            healthError = error.userMessage
        }
    }

    @MainActor
    private func loadSummary() async {
        guard !isSummaryLoading else { return }
        isSummaryLoading = true
        summaryError = nil
        defer { isSummaryLoading = false }

        do {
            summary = try await session.client.memoSummary()
        } catch {
            summary = nil
            summaryError = error.userMessage
            if let api = error as? APIError, api.isUnauthenticated {
                session.handleUnauthenticated()
            }
        }
    }

    // MARK: - 修改密码

    private func performPasswordSubmit() {
        guard !isChangingPassword else { return }
        passwordFocus = nil
        Task { await submitPasswordChange() }
    }

    @MainActor
    private func submitPasswordChange() async {
        guard !isChangingPassword else { return }

        let errors = validatePasswordChange()
        passwordErrors = errors
        passwordSubmitError = nil
        guard errors.isEmpty else { return }

        isChangingPassword = true
        defer { isChangingPassword = false }

        do {
            try await session.client.changePassword(current: currentPassword, new: newPassword)
            toasts.show("密码已更新")
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
        } catch {
            let message = error.userMessage
            if let api = error as? APIError, api.isUnauthenticated {
                toasts.error(message)
                session.handleUnauthenticated()
            } else {
                passwordSubmitError = message
            }
        }
    }

    /// 与 Web `validatePasswordChange` 文案一致
    private func validatePasswordChange() -> [PasswordField: String] {
        var errors: [PasswordField: String] = [:]

        if currentPassword.isEmpty {
            errors[.current] = "请输入当前密码"
        }

        if newPassword.isEmpty {
            errors[.new] = "请输入新密码"
        } else if newPassword.count < Self.passwordMinLength {
            errors[.new] = "密码至少 \(Self.passwordMinLength) 位"
        } else if newPassword.count > Self.passwordMaxLength {
            errors[.new] = "密码不能超过 \(Self.passwordMaxLength) 位"
        } else if newPassword == currentPassword {
            errors[.new] = "新密码不能与当前密码相同"
        }

        if confirmPassword.isEmpty {
            errors[.confirm] = "请再次输入密码"
        } else if newPassword != confirmPassword {
            errors[.confirm] = "两次输入的密码不一致"
        }

        return errors
    }

    // MARK: - 服务器地址编辑（sheet）

    private struct ServerAddressSheet: View {
        @Environment(Session.self) private var session
        @Environment(ToastCenter.self) private var toasts
        @Environment(\.dismiss) private var dismiss

        @State private var text = ""
        @State private var errorText: String?

        var body: some View {
            NavigationStack {
                Form {
                    Section {
                        TextField("http://192.168.0.111:35080", text: $text)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .textContentType(.URL)
                            .font(.system(.body, design: .monospaced))

                        Button("使用默认地址") {
                            text = Session.defaultBaseURL
                        }
                        .font(.footnote)
                    } header: {
                        Text("服务器地址")
                    } footer: {
                        if let errorText {
                            Text(errorText)
                                .foregroundStyle(Theme.danger)
                        } else {
                            Text("需要与手机在同一局域网，例如 http://192.168.0.111:35080")
                        }
                    }
                }
                .navigationTitle("服务器地址")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存") {
                            Task { await save() }
                        }
                    }
                }
            }
            .onAppear { text = session.baseURLString }
            .presentationDetents([.medium])
        }

        @MainActor
        private func save() async {
            if let message = session.setBaseURL(text) {
                errorText = message
                return
            }
            errorText = nil
            toasts.show("已切换")
            dismiss()
            await verifyConnection()
        }

        /// 切址后用 me() 校验连通性/会话；失败只提示，不回滚地址（§4.5）
        @MainActor
        private func verifyConnection() async {
            do {
                try await session.refreshUser()
            } catch {
                if let api = error as? APIError, api.isUnauthenticated {
                    toasts.error("服务器已切换，请重新登录")
                    session.handleUnauthenticated()
                } else {
                    toasts.error(error.userMessage)
                }
            }
        }
    }
}

#Preview("设置") {
    SettingsView()
        .environment(Session())
        .environment(ToastCenter())
}
