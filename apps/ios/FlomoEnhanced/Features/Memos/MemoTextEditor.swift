//
//  MemoTextEditor.swift
//  浮墨增强版 iOS
//
//  模板字段的文本模式编辑器：
//  - 每行「字段名：值」；
//  - 粘贴时把「插入后的完整文本」交给父视图立即解析；
//  - 手工输入只更新文本，由切换回模板模式 / 保存时再解析。
//

import SwiftUI
import UIKit

struct MemoTextEditorView: View {
    @Binding var text: String
    var lineErrors: [MemoTextLineError] = []
    var fieldErrors: [String: String] = [:]
    /// 解析成功的提示（如「已识别 3 个字段」）
    var notice: String = ""
    var onPaste: (String) -> Void
    var minHeight: CGFloat = 160

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ZStack(alignment: .topLeading) {
                PasteAwareTextEditor(text: $text, onPaste: onPaste)
                    .accessibilityIdentifier("memoTextFieldsInput")
                    .frame(height: minHeight)
                    .background(
                        Theme.bg.opacity(0.6),
                        in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(messages.isEmpty ? Color.clear : Theme.danger, lineWidth: 1)
                    }
                if text.isEmpty {
                    Text("每行一个字段，例如：\n日期：2026-10-19\n金额：35.5\n备注：第一行\n第二行")
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Theme.textSecondary.opacity(0.65))
                        .padding(.horizontal, 13)
                        .padding(.vertical, 12)
                        .allowsHitTesting(false)
                }
            }

            Text("每行一个字段：字段名：值。粘贴会自动识别；切回模板模式或保存时会重新解析。")
                .font(.caption2)
                .foregroundStyle(Theme.textSecondary)

            if !messages.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(messages.enumerated()), id: \.offset) { _, message in
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(Theme.danger)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    Theme.danger.opacity(0.08),
                    in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                )
            } else if !notice.isEmpty {
                Text(notice)
                    .font(.caption)
                    .foregroundStyle(Theme.brandDark)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        Theme.brand.opacity(0.1),
                        in: RoundedRectangle(cornerRadius: 9, style: .continuous)
                    )
            }
        }
    }

    /// 行错误 + 字段错误（去重，字段错误按 key 排序保证稳定）
    private var messages: [String] {
        var seen = Set<String>()
        var result: [String] = []
        for error in lineErrors {
            let message = "第 \(error.line) 行：\(error.message)"
            if seen.insert(message).inserted {
                result.append(message)
            }
        }
        for key in fieldErrors.keys.sorted() {
            guard let message = fieldErrors[key] else { continue }
            if seen.insert(message).inserted {
                result.append(message)
            }
        }
        return result
    }
}

// MARK: - 粘贴感知的 UITextView

private struct PasteAwareTextEditor: UIViewRepresentable {
    @Binding var text: String
    var onPaste: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> PasteAwareUITextView {
        let view = PasteAwareUITextView()
        view.delegate = context.coordinator
        view.onPasteText = { next in
            context.coordinator.parent.text = next
            context.coordinator.parent.onPaste(next)
        }
        view.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        view.textColor = UIColor(Theme.textPrimary)
        view.backgroundColor = .clear
        view.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
        view.isScrollEnabled = true
        view.alwaysBounceVertical = false
        view.autocapitalizationType = .none
        view.autocorrectionType = .no
        view.spellCheckingType = .no
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.text = text
        return view
    }

    func updateUIView(_ view: PasteAwareUITextView, context: Context) {
        context.coordinator.parent = self
        if view.text != text {
            view.text = text
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: PasteAwareTextEditor

        init(_ parent: PasteAwareTextEditor) {
            self.parent = parent
        }

        /// 手工输入 / 删除：只更新文本，不立即解析
        func textViewDidChange(_ textView: UITextView) {
            parent.text = textView.text ?? ""
        }
    }
}

/// 重写 `paste(_:)`：在插入前算出完整文本，交给 SwiftUI 层立即解析。
private final class PasteAwareUITextView: UITextView {
    var onPasteText: ((String) -> Void)?

    override func paste(_ sender: Any?) {
        guard let pasted = UIPasteboard.general.string, !pasted.isEmpty else {
            super.paste(sender)
            return
        }

        let current = text as NSString
        let range = selectedRange
        let next = current.replacingCharacters(in: range, with: pasted)
        let caret = range.location + (pasted as NSString).length

        text = next
        selectedRange = NSRange(location: caret, length: 0)
        onPasteText?(next)
    }
}
