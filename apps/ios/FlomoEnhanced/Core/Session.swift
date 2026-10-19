//
//  Session.swift
//  浮墨增强版 iOS
//
//  登录态与服务器地址（docs/IOS.md §3.5）。
//

import Foundation
import Observation

@MainActor
@Observable
final class Session {
    enum Phase: Equatable {
        case loading
        case signedOut
        case signedIn
    }

    static let defaultBaseURL = "http://192.168.0.111:35080"
    private static let defaultsKey = "flomo.baseURL"

    private(set) var phase: Phase = .loading
    private(set) var user: User?

    var baseURLString: String {
        didSet {
            UserDefaults.standard.set(baseURLString, forKey: Self.defaultsKey)
        }
    }

    init() {
        let stored = UserDefaults.standard.string(forKey: Self.defaultsKey) ?? Self.defaultBaseURL
        baseURLString = Self.normalize(stored)?.absoluteString ?? Self.defaultBaseURL
    }

    /// 由 baseURL 构造的 API 客户端（地址非法时回退默认地址）
    var client: APIClient {
        let url = Self.normalize(baseURLString) ?? URL(string: Self.defaultBaseURL)!
        return APIClient(baseURL: url)
    }

    // MARK: - 生命周期

    /// 启动引导：GET /api/auth/me 决定进入登录页还是主界面
    func bootstrap() async {
        do {
            user = try await client.me()
            phase = .signedIn
        } catch {
            user = nil
            phase = .signedOut
        }
    }

    func login(username: String, password: String) async throws {
        let loggedIn = try await client.login(username: username, password: password)
        user = loggedIn
        phase = .signedIn
    }

    func register(username: String, password: String) async throws {
        let registered = try await client.register(username: username, password: password)
        user = registered
        phase = .signedIn
    }

    func logout() async {
        try? await client.logout()
        user = nil
        phase = .signedOut
    }

    /// 刷新当前用户（服务器地址变更后校验连通性 / 会话）
    func refreshUser() async throws {
        user = try await client.me()
        phase = .signedIn
    }

    /// 401 统一处理：回登录页
    func handleUnauthenticated() {
        user = nil
        phase = .signedOut
    }

    // MARK: - 服务器地址

    /// 校验并保存服务器地址；返回错误文案（nil 表示成功）
    @discardableResult
    func setBaseURL(_ raw: String) -> String? {
        guard let url = Self.normalize(raw) else {
            return "服务器地址无效，请填写形如 http://192.168.0.111:35080 的地址"
        }
        baseURLString = url.absoluteString
        return nil
    }

    /// 归一化：补齐 scheme、去尾部斜杠；非法返回 nil
    static func normalize(_ raw: String) -> URL? {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") {
            text = "http://" + text
        }
        while text.hasSuffix("/") {
            text.removeLast()
        }
        guard let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty else {
            return nil
        }
        return url
    }
}
