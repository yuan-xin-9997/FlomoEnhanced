//
//  MainTabView.swift
//  浮墨增强版 iOS
//
//  主界面四个 Tab：记录 / 洞察 / 模板 / 设置。
//

import SwiftUI

struct MainTabView: View {
    @State private var selection: Int = QASupport.initialTab ?? 0

    var body: some View {
        TabView(selection: $selection) {
            MemoListView()
                .tabItem { Label("记录", systemImage: "square.and.pencil") }
                .tag(0)

            InsightsView()
                .tabItem { Label("洞察", systemImage: "chart.bar.xaxis") }
                .tag(1)

            TemplatesView()
                .tabItem { Label("模板", systemImage: "square.grid.2x2") }
                .tag(2)

            SettingsView()
                .tabItem { Label("设置", systemImage: "gearshape") }
                .tag(3)
        }
    }
}

#Preview {
    MainTabView()
        .environment(Session())
        .environment(ToastCenter())
}
