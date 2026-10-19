//
//  FlomoEnhancedApp.swift
//  浮墨增强版 iOS —— 应用入口
//

import SwiftUI

@main
struct FlomoEnhancedApp: App {
    @State private var session = Session()
    @State private var toasts = ToastCenter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(session)
                .environment(toasts)
                .tint(Theme.brand)
                .task {
                    await session.bootstrap()
                    #if DEBUG
                    // QA 钩子：-qaLogout 强制登出，-qaUsername/-qaPassword 自动登录
                    if QASupport.shouldLogoutFirst, session.phase == .signedIn {
                        await session.logout()
                    }
                    if session.phase == .signedOut,
                       let username = QASupport.username,
                       let password = QASupport.password {
                        try? await session.login(username: username, password: password)
                    }
                    #endif
                }
        }
    }
}
