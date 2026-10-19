//
//  AuthView.swift
//  浮墨增强版 iOS
//
//  登录 / 注册页（docs/IOS.md §4.1）——未登录根视图。
//  含服务器地址入口（未登录时也要能改 baseURL）。
//

import Foundation
import SwiftUI

struct AuthView: View {
    // MARK: - 局部类型

    private enum Mode: String, CaseIterable, Identifiable, Hashable {
        case login
        case register

        var id: String { rawValue }

        var title: String {
            switch self {
            case .login: return "登录"
            case .register: return "注册"
            }
        }
    }

    private enum Field: Hashable {
        case username
        case password
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

    // MARK: - 环境

    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    // MARK: - 状态

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var fieldErrors: [Field: String] = [:]
    @State private var submitError: String?
    @State private var isSubmitting = false
    @State private var showServerSheet = false
    @FocusState private var focusedField: Field?

    // MARK: - 主体

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 18) {
                    brandHeader
                    formCard
                    serverEntry
                }
                .padding(.horizontal, 20)
                .padding(.top, 36)
                .padding(.bottom, 28)
                .frame(maxWidth: 460)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .sheet(isPresented: $showServerSheet) {
            ServerAddressSheet()
        }
        .onChange(of: mode) { _, _ in
            fieldErrors = [:]
            submitError = nil
            password = ""
            confirmPassword = ""
            focusedField = nil
        }
    }

    // MARK: - 品牌区

    private var brandHeader: some View {
        VStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Theme.brand, Theme.brandDark],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 72, height: 72)
                .overlay(
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(.white)
                )
                .shadow(color: Theme.brand.opacity(0.35), radius: 10, x: 0, y: 5)

            Text("浮墨增强版")
                .font(.title2.weight(.bold))
                .foregroundStyle(Theme.textPrimary)

            Text("知识记录 · 数据分析")
                .font(.footnote)
                .foregroundStyle(Theme.textSecondary)
        }
        .padding(.bottom, 4)
    }

    // MARK: - 表单卡片

    private var formCard: some View {
        VStack(spacing: 16) {
            Picker("模式", selection: $mode) {
                ForEach(Mode.allCases) { item in
                    Text(item.title).tag(item)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .disabled(isSubmitting)

            if let submitError {
                inlineBanner(submitError)
            }

            usernameField
            passwordField

            if mode == .register {
                confirmField
            }

            submitButton
        }
        .card(padding: 18)
        .animation(.easeInOut(duration: 0.18), value: mode)
    }

    private var usernameField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("用户名")

            TextField("3-32 位字母、数字、_ 或 -", text: $username)
                .modifier(InputStyle(invalid: fieldErrors[.username] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.username)
                .submitLabel(.next)
                .focused($focusedField, equals: .username)
                .disabled(isSubmitting)
                .onSubmit { focusedField = .password }

            errorText(fieldErrors[.username])
        }
    }

    private var passwordField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("密码")

            SecureField(mode == .login ? "输入密码" : "至少 8 位", text: $password)
                .modifier(InputStyle(invalid: fieldErrors[.password] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(mode == .login ? .password : .newPassword)
                .submitLabel(mode == .login ? .go : .next)
                .focused($focusedField, equals: .password)
                .disabled(isSubmitting)
                .onSubmit {
                    if mode == .login {
                        performSubmit()
                    } else {
                        focusedField = .confirm
                    }
                }

            errorText(fieldErrors[.password])
        }
    }

    private var confirmField: some View {
        VStack(alignment: .leading, spacing: 6) {
            fieldLabel("确认密码")

            SecureField("再次输入密码", text: $confirmPassword)
                .modifier(InputStyle(invalid: fieldErrors[.confirm] != nil))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .textContentType(.newPassword)
                .submitLabel(.go)
                .focused($focusedField, equals: .confirm)
                .disabled(isSubmitting)
                .onSubmit { performSubmit() }

            errorText(fieldErrors[.confirm])
        }
    }

    private var submitButton: some View {
        Button(action: { performSubmit() }) {
            HStack(spacing: 8) {
                if isSubmitting {
                    ProgressView()
                        .tint(.white)
                }
                Text(submitTitle)
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(isSubmitting)
        .opacity(isSubmitting ? 0.75 : 1)
        .padding(.top, 2)
    }

    private var submitTitle: String {
        switch mode {
        case .login: return isSubmitting ? "登录中…" : "登录"
        case .register: return isSubmitting ? "注册中…" : "注册并进入"
        }
    }

    // MARK: - 服务器地址入口

    @MainActor
    private var serverEntry: some View {
        VStack(spacing: 8) {
            Button {
                showServerSheet = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "server.rack")
                        .font(.footnote)
                        .foregroundStyle(Theme.brandDark)

                    VStack(alignment: .leading, spacing: 2) {
                        Text("服务器地址")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                        Text(session.baseURLString)
                            .font(.system(.footnote, design: .monospaced))
                            .foregroundStyle(Theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }

                    Spacer(minLength: 8)

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Theme.textSecondary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Text("需要与服务器在同一局域网")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    // MARK: - 小工具

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

    // MARK: - 提交

    private func performSubmit() {
        guard !isSubmitting else { return }
        focusedField = nil
        Task { await submit() }
    }

    @MainActor
    private func submit() async {
        guard !isSubmitting else { return }

        let trimmedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines)
        var errors: [Field: String] = [:]
        if let message = Self.validateUsername(trimmedUsername) { errors[.username] = message }
        if let message = Self.validatePassword(password) { errors[.password] = message }
        if mode == .register, let message = Self.validateConfirmPassword(password, confirmPassword) {
            errors[.confirm] = message
        }
        fieldErrors = errors
        submitError = nil
        guard errors.isEmpty else { return }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            if mode == .login {
                try await session.login(username: trimmedUsername, password: password)
            } else {
                try await session.register(username: trimmedUsername, password: password)
            }
            // 成功后 Session 会把 phase 置为 .signedIn，RootView 自动切主界面
            password = ""
            confirmPassword = ""
            fieldErrors = [:]
        } catch {
            let message = error.userMessage
            submitError = message
            toasts.error(message)
        }
    }

    // MARK: - 校验（规则与 SPEC §8.1 / Web lib/auth.ts 一致）

    private static func validateUsername(_ value: String) -> String? {
        if value.isEmpty { return "请输入用户名" }
        if value.range(of: "^[A-Za-z0-9_-]{3,32}$", options: .regularExpression) == nil {
            return "用户名需为 3-32 位字母、数字、下划线或连字符"
        }
        return nil
    }

    private static func validatePassword(_ value: String) -> String? {
        if value.isEmpty { return "请输入密码" }
        if value.count < 8 { return "密码至少 8 位" }
        if value.count > 128 { return "密码不能超过 128 位" }
        return nil
    }

    private static func validateConfirmPassword(_ password: String, _ confirm: String) -> String? {
        if confirm.isEmpty { return "请再次输入密码" }
        if password != confirm { return "两次输入的密码不一致" }
        return nil
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
                            Text("需要与服务器在同一局域网，例如 http://192.168.0.111:35080")
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
            toasts.show("已保存")
            dismiss()
        }
    }
}

#Preview("登录 / 注册") {
    AuthView()
        .environment(Session())
        .environment(ToastCenter())
}
