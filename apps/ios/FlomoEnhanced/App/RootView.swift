//
//  RootView.swift
//  浮墨增强版 iOS
//
//  根视图：按登录态切换「启动加载 / 登录注册 / 主界面」，并渲染全局提示浮层。
//

import SwiftUI

struct RootView: View {
    @Environment(Session.self) private var session
    @Environment(ToastCenter.self) private var toasts

    var body: some View {
        Group {
            switch session.phase {
            case .loading:
                LoadingView()
            case .signedOut:
                AuthView()
            case .signedIn:
                MainTabView()
            }
        }
        .overlay(alignment: .top) {
            if let toast = toasts.current {
                toastBanner(toast)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: toasts.current)
    }

    private func toastBanner(_ toast: ToastCenter.Toast) -> some View {
        Text(toast.text)
            .font(.subheadline)
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(
                (toast.kind == .error ? Theme.danger : Color.black.opacity(0.82)),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .shadow(color: .black.opacity(0.15), radius: 8, y: 4)
            .padding(.top, 8)
            .padding(.horizontal, 24)
            .onTapGesture { toasts.dismiss() }
    }
}

/// 启动加载页
struct LoadingView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "square.and.pencil")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Theme.brand)
            ProgressView()
            Text("浮墨增强版")
                .font(.headline)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.bg)
    }
}

#Preview {
    RootView()
        .environment(Session())
        .environment(ToastCenter())
}
