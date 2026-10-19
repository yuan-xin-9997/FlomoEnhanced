//
//  ToastCenter.swift
//  浮墨增强版 iOS
//
//  轻量全局提示（顶部浮层，由 RootView 渲染）。
//

import Foundation
import Observation

@MainActor
@Observable
final class ToastCenter {
    struct Toast: Identifiable, Equatable {
        enum Kind: Equatable {
            case info
            case error
        }

        let id: UUID
        let text: String
        let kind: Kind

        init(text: String, kind: Kind) {
            self.id = UUID()
            self.text = text
            self.kind = kind
        }
    }

    private(set) var current: Toast?
    private var dismissTask: Task<Void, Never>?

    /// 一般提示（1.8s）
    func show(_ text: String) {
        present(text, kind: .info, seconds: 1.8)
    }

    /// 错误提示（3s）
    func error(_ text: String) {
        present(text, kind: .error, seconds: 3.0)
    }

    func dismiss() {
        dismissTask?.cancel()
        current = nil
    }

    private func present(_ text: String, kind: Toast.Kind, seconds: Double) {
        guard !text.isEmpty else { return }
        dismissTask?.cancel()
        current = Toast(text: text, kind: kind)
        dismissTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            guard !Task.isCancelled else { return }
            self?.current = nil
        }
    }
}
