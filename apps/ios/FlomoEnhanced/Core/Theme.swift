//
//  Theme.swift
//  浮墨增强版 iOS
//
//  视觉规范（docs/IOS.md §3.7）——取自 Web 端 flomo 风格设计。
//

import SwiftUI

enum Theme {
    static let brand = Color(hex: 0x30CF79)
    static let brandDark = Color(hex: 0x22A85F)
    static let tagBlue = Color(hex: 0x2F6FED)
    static let tagBlueBg = Color(hex: 0xEAF1FE)
    static let bg = Color(hex: 0xF2F2F2)
    static let card = Color.white
    static let textPrimary = Color(hex: 0x1F2328)
    static let textSecondary = Color(hex: 0x6B7280)
    static let danger = Color(hex: 0xE5484D)
    static let warning = Color(hex: 0xF59E0B)
    static let divider = Color(hex: 0xE5E7EB)
    static let corner: CGFloat = 14
    static let cardShadow = Color.black.opacity(0.06)

    /// 图表配色（与 Web `chartOptions.ts` 同系）
    static let chartPalette: [Color] = [
        Color(hex: 0x30CF79),
        Color(hex: 0x2F6FED),
        Color(hex: 0xF59E0B),
        Color(hex: 0x8B5CF6),
        Color(hex: 0xEF4444),
        Color(hex: 0x14B8A6),
    ]
}

extension Color {
    init(hex: UInt32) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(.sRGB, red: r, green: g, blue: b, opacity: 1)
    }
}

/// 统一卡片样式（白底、圆角、轻阴影）
struct CardBackground: ViewModifier {
    var padding: CGFloat = 14

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
            .shadow(color: Theme.cardShadow, radius: 6, x: 0, y: 2)
    }
}

extension View {
    func card(padding: CGFloat = 14) -> some View {
        modifier(CardBackground(padding: padding))
    }
}

/// 标签胶囊（`#标签` 与模板标签共用）
struct TagPill: View {
    let text: String
    var highlighted: Bool = false

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(highlighted ? Theme.tagBlue : Theme.textSecondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(highlighted ? Theme.tagBlueBg : Theme.bg, in: Capsule())
    }
}

/// 主按钮样式（品牌绿）
struct PrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Theme.brand.opacity(configuration.isPressed ? 0.75 : 1))
            )
    }
}

/// 次级按钮样式（浅底）
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.medium))
            .foregroundStyle(Theme.textPrimary)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Theme.bg.opacity(configuration.isPressed ? 0.6 : 1))
            )
    }
}
