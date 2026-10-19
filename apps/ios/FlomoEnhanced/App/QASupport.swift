//
//  QASupport.swift
//  浮墨增强版 iOS
//
//  仅用于 PM/自动验收的调试钩子（#if DEBUG）：
//  通过 simctl 启动参数注入，例如：
//    xcrun simctl launch booted dev.flomoenhanced.ios -qaUsername iosaccept -qaPassword iosaccept123 -qaTab 1
//  Release 构建不包含这些逻辑。
//

import Foundation

enum QASupport {
    #if DEBUG
    static var username: String? { value("qaUsername") }
    static var password: String? { value("qaPassword") }
    static var initialTab: Int? {
        // 注意：`-qaTab 1` 这类启动参数在 UserDefaults 里是字符串，不能 `as? Int`。
        guard let raw = UserDefaults.standard.object(forKey: "qaTab") else { return nil }
        if let number = raw as? NSNumber { return number.intValue }
        if let text = raw as? String { return Int(text) }
        return nil
    }
    static var shouldLogoutFirst: Bool { UserDefaults.standard.bool(forKey: "qaLogout") }

    private static func value(_ key: String) -> String? {
        guard let text = UserDefaults.standard.string(forKey: key), !text.isEmpty else { return nil }
        return text
    }
    #else
    static var username: String? { nil }
    static var password: String? { nil }
    static var initialTab: Int? { nil }
    static var shouldLogoutFirst: Bool { false }
    #endif
}
