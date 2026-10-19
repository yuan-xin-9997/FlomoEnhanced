//
//  ShareSheet.swift
//  浮墨增强版 iOS
//
//  导出文件分享（模板 JSON / CSV）。
//

import SwiftUI
import UIKit

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

/// 分享按钮：点击后弹出系统分享面板
struct ShareLinkButton: View {
    let title: String
    let url: URL
    var systemImage: String = "square.and.arrow.up"

    @State private var isPresenting = false

    var body: some View {
        Button {
            isPresenting = true
        } label: {
            Label(title, systemImage: systemImage)
        }
        .sheet(isPresented: $isPresenting) {
            ShareSheet(items: [url])
        }
    }
}
