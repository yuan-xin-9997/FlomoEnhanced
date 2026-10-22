//
//  APIClient.swift
//  浮墨增强版 iOS
//
//  SPEC §8 HTTP API 的 Swift 客户端（docs/IOS.md §3.3）。
//  - Cookie 会话由 HTTPCookieStorage.shared 自动管理（flomo_session）
//  - 写操作带 Content-Type: application/json，不发送 Origin/Referer
//

import Foundation

/// 下载结果（文件名已做安全化，取自 Content-Disposition）
struct DownloadedFile: Sendable {
    let data: Data
    let filename: String
}

struct APIClient: Sendable {
    let baseURL: URL

    /// 全局共享 URLSession（Cookie 存于 HTTPCookieStorage.shared）
    private static let urlSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpCookieStorage = HTTPCookieStorage.shared
        configuration.httpShouldSetCookies = true
        configuration.httpCookieAcceptPolicy = .always
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 60
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        return URLSession(configuration: configuration)
    }()

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    // MARK: - 通用请求

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await request("GET", path, query: query, json: nil)
    }

    func send<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String?] = [:],
        json: (any Encodable)? = nil
    ) async throws -> T {
        try await request(method, path, query: query, json: json)
    }

    func sendVoid(
        _ method: String,
        _ path: String,
        query: [String: String?] = [:],
        json: (any Encodable)? = nil
    ) async throws {
        _ = try await perform(method, path, query: query, json: json)
    }

    /// 下载文件（导出 JSON / CSV）
    func download(_ path: String, query: [String: String?] = [:], fallbackName: String) async throws -> DownloadedFile {
        guard let url = makeURL(path, query: query) else {
            throw APIError(code: "INVALID_URL", status: 0, message: "服务器地址无效，请在设置中检查")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "GET"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.urlSession.data(for: urlRequest)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled { throw error }
            throw Self.networkError(error)
        } catch {
            try Task.checkCancellation()
            throw APIError.network()
        }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw APIError.network() }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.errorBody(data: data, status: http.statusCode)
        }
        let filename = Self.filename(fromContentDisposition: http.value(forHTTPHeaderField: "Content-Disposition")) ?? fallbackName
        return DownloadedFile(data: data, filename: filename)
    }

    // MARK: - 内部实现

    private func request<T: Decodable>(
        _ method: String,
        _ path: String,
        query: [String: String?],
        json: (any Encodable)?
    ) async throws -> T {
        let data = try await perform(method, path, query: query, json: json)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError(
                code: "DECODE_FAILED",
                status: 200,
                message: "服务器返回的数据无法解析",
                details: String(describing: error)
            )
        }
    }

    @discardableResult
    private func perform(
        _ method: String,
        _ path: String,
        query: [String: String?],
        json: (any Encodable)?
    ) async throws -> Data {
        guard let url = makeURL(path, query: query) else {
            throw APIError(code: "INVALID_URL", status: 0, message: "服务器地址无效，请在设置中检查")
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
        if let json {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            do {
                urlRequest.httpBody = try JSONEncoder().encode(AnyEncodable(json))
            } catch {
                throw APIError(code: "ENCODE_FAILED", status: 0, message: "请求数据编码失败")
            }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.urlSession.data(for: urlRequest)
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError {
            if error.code == .cancelled { throw error }
            throw Self.networkError(error)
        } catch {
            try Task.checkCancellation()
            throw APIError.network()
        }
        try Task.checkCancellation()
        guard let http = response as? HTTPURLResponse else { throw APIError.network() }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.errorBody(data: data, status: http.statusCode)
        }
        return data
    }

    private func makeURL(_ path: String, query: [String: String?]) -> URL? {
        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard var components = URLComponents(url: baseURL.appendingPathComponent(trimmed), resolvingAgainstBaseURL: false) else {
            return nil
        }
        let items = query
            .compactMap { key, value -> URLQueryItem? in
                guard let value, !value.isEmpty else { return nil }
                return URLQueryItem(name: key, value: value)
            }
            .sorted { $0.name < $1.name }
        if !items.isEmpty {
            components.queryItems = items
        }
        return components.url
    }

    private static func networkError(_ error: URLError) -> APIError {
        switch error.code {
        case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost,
             .notConnectedToInternet, .dnsLookupFailed, .appTransportSecurityRequiresSecureConnection:
            return APIError.unreachable()
        default:
            return APIError.network()
        }
    }

    private static func errorBody(data: Data, status: Int) -> APIError {
        if let body = try? JSONDecoder().decode(APIError.Body.self, from: data) {
            let message = body.error.message.isEmpty ? APIError.fallbackMessage(status: status) : body.error.message
            return APIError(code: body.error.code, status: status, message: message)
        }
        return APIError(code: "INTERNAL", status: status, message: APIError.fallbackMessage(status: status))
    }

    /// 解析 Content-Disposition（优先 RFC 5987 filename*）
    static func filename(fromContentDisposition header: String?) -> String? {
        guard let header, !header.isEmpty else { return nil }
        if let starRange = header.range(of: "filename*=", options: .caseInsensitive) {
            let rest = header[starRange.upperBound...]
            let raw = rest.split(separator: ";").first.map(String.init) ?? String(rest)
            let cleaned = raw.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            let parts = cleaned.components(separatedBy: "''")
            let value = parts.count > 1 ? parts.dropFirst().joined(separator: "''") : cleaned
            if let decoded = value.removingPercentEncoding, !decoded.isEmpty {
                return decoded
            }
        }
        if let range = header.range(of: "filename=", options: .caseInsensitive) {
            let rest = header[range.upperBound...]
            let raw = rest.split(separator: ";").first.map(String.init) ?? String(rest)
            let cleaned = raw.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
            return cleaned.isEmpty ? nil : cleaned
        }
        return nil
    }
}

/// 任意 Encodable 的包装（用于 `json: (any Encodable)?`）
private struct AnyEncodable: Encodable {
    let value: any Encodable

    init(_ value: any Encodable) {
        self.value = value
    }

    func encode(to encoder: Encoder) throws {
        try value.encode(to: encoder)
    }
}

// MARK: - 记录列表查询参数

/// 记录列表查询（字段语义与 Web `filtersToQuery` 一致）
struct MemoQuery: Sendable, Equatable {
    enum TemplateFilter: Sendable, Equatable {
        /// 不筛选
        case all
        /// 仅无模板（查询串 `templateId=null`）
        case none
        /// 指定模板
        case id(String)
    }

    var templateId: TemplateFilter = .all
    /// ISO 时间（本地日 00:00 对应的 UTC）
    var from: String?
    /// ISO 时间（本地日 23:59:59.999 对应的 UTC）
    var to: String?
    /// 裸标签（不含 #）
    var tag: String?
    /// 内容模糊搜索
    var q: String?
    var limit: Int = 50
    var cursor: String?

    func queryItems() -> [String: String?] {
        var query: [String: String?] = [:]
        switch templateId {
        case .all: break
        case .none: query["templateId"] = "null"
        case .id(let id): query["templateId"] = id
        }
        query["from"] = from
        query["to"] = to
        query["tag"] = tag
        query["q"] = q
        query["limit"] = String(limit)
        query["cursor"] = cursor
        return query
    }
}

// MARK: - 端点（SPEC §8）

extension APIClient {
    // MARK: 认证（§8.1）

    func register(username: String, password: String) async throws -> User {
        let response: MeResponse = try await send("POST", "api/auth/register", json: ["username": username, "password": password])
        return response.user
    }

    func login(username: String, password: String) async throws -> User {
        let response: MeResponse = try await send("POST", "api/auth/login", json: ["username": username, "password": password])
        return response.user
    }

    func logout() async throws {
        defer {
            let url = baseURL.appendingPathComponent("api/auth/logout")
            for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] where cookie.name == "flomo_session" {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }
        try await sendVoid("POST", "api/auth/logout")
    }

    func me() async throws -> User {
        let response: MeResponse = try await get("api/auth/me")
        return response.user
    }

    func changePassword(current: String, new: String) async throws {
        try await sendVoid("PATCH", "api/auth/password", json: ["currentPassword": current, "newPassword": new])
    }

    // MARK: 模板（§8.2）

    func listTemplates(includeArchived: Bool = false) async throws -> [Template] {
        let response: TemplateListResponse = try await get(
            "api/templates",
            query: includeArchived ? ["includeArchived": "1"] : [:]
        )
        return response.items
    }

    func createTemplate(_ body: TemplateUpsertBody) async throws -> Template {
        try await send("POST", "api/templates", json: body)
    }

    func getTemplate(id: String) async throws -> Template {
        try await get("api/templates/\(Self.escape(id))")
    }

    func updateTemplate(id: String, _ body: TemplateUpsertBody) async throws -> Template {
        try await send("PATCH", "api/templates/\(Self.escape(id))", json: body)
    }

    func deleteTemplate(id: String, hard: Bool = false) async throws {
        try await sendVoid("DELETE", "api/templates/\(Self.escape(id))", query: hard ? ["hard": "1"] : [:])
    }

    func restoreTemplate(id: String) async throws -> Template {
        try await send("POST", "api/templates/\(Self.escape(id))/restore")
    }

    func duplicateTemplate(id: String) async throws -> Template {
        try await send("POST", "api/templates/\(Self.escape(id))/duplicate")
    }

    func exportTemplates(ids: [String]? = nil) async throws -> DownloadedFile {
        let joined = (ids ?? []).filter { !$0.isEmpty }.joined(separator: ",")
        return try await download(
            "api/templates/export",
            query: joined.isEmpty ? [:] : ["ids": joined],
            fallbackName: "flomo-templates.json"
        )
    }

    func importTemplates(file: TemplateFile, mode: TemplateImportMode) async throws -> TemplateImportResult {
        try await send("POST", "api/templates/import", query: ["mode": mode.rawValue], json: file)
    }

    // MARK: 记录（§8.3）

    func listMemos(_ query: MemoQuery) async throws -> MemoListResponse {
        try await get("api/memos", query: query.queryItems())
    }

    func createMemo(_ body: MemoUpsertBody) async throws -> Memo {
        try await send("POST", "api/memos", json: body)
    }

    func getMemo(id: String) async throws -> Memo {
        try await get("api/memos/\(Self.escape(id))")
    }

    func updateMemo(id: String, _ body: MemoUpsertBody) async throws -> Memo {
        try await send("PATCH", "api/memos/\(Self.escape(id))", json: body)
    }

    func deleteMemo(id: String) async throws {
        try await sendVoid("DELETE", "api/memos/\(Self.escape(id))")
    }

    func memoSummary(from: String? = nil, to: String? = nil) async throws -> MemoSummary {
        try await get("api/memos/summary", query: ["from": from, "to": to])
    }

    // MARK: 洞察（§8.4）

    func analyticsOverview(from: String? = nil, to: String? = nil) async throws -> AnalyticsOverview {
        try await get("api/analytics/overview", query: ["from": from, "to": to])
    }

    func templateInsights(
        templateId: String,
        from: String? = nil,
        to: String? = nil,
        granularity: Granularity? = nil
    ) async throws -> TemplateInsights {
        try await get(
            "api/analytics/templates/\(Self.escape(templateId))/insights",
            query: ["from": from, "to": to, "granularity": granularity?.rawValue]
        )
    }

    func exportCsv(
        templateId: String,
        from: String? = nil,
        to: String? = nil,
        fallbackName: String
    ) async throws -> DownloadedFile {
        try await download(
            "api/analytics/templates/\(Self.escape(templateId))/export.csv",
            query: ["from": from, "to": to],
            fallbackName: fallbackName
        )
    }

    // MARK: 健康检查（§8.5）

    func health() async throws -> HealthResponse {
        try await get("api/health")
    }

    private static func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }
}
