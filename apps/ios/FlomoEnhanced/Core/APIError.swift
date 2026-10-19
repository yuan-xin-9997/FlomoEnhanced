//
//  APIError.swift
//  浮墨增强版 iOS
//
//  统一异常（docs/SPEC.md §8 错误码；docs/IOS.md §3.4）。
//

import Foundation

/// HTTP/网络层统一异常；`message` 可直接展示给用户（中文）。
struct APIError: Error, LocalizedError, Sendable {
    let code: String
    let status: Int
    let message: String
    var details: String?

    init(code: String, status: Int, message: String, details: String? = nil) {
        self.code = code
        self.status = status
        self.message = message
        self.details = details
    }

    var errorDescription: String? { message }

    /// 是否登录失效（401 / UNAUTHENTICATED）
    var isUnauthenticated: Bool { status == 401 || code == "UNAUTHENTICATED" }
}

extension APIError {
    /// 服务端统一错误体 `{ error: { code, message, details? } }`
    struct Body: Decodable {
        struct Inner: Decodable {
            let code: String
            let message: String
        }
        let error: Inner
    }

    /// 状态码兜底文案（与 Web `STATUS_FALLBACK` 一致）
    static func fallbackMessage(status: Int) -> String {
        switch status {
        case 400: return "请求内容有误，请检查后重试"
        case 401: return "登录状态已失效，请重新登录"
        case 403: return "没有权限执行该操作"
        case 404: return "请求的资源不存在"
        case 409: return "与现有数据冲突"
        case 413: return "提交的内容过大"
        case 422: return "提交的内容未通过校验"
        case 429: return "操作过于频繁，请稍后再试"
        case 500: return "服务器内部错误，请稍后重试"
        case 503: return "服务暂时不可用，请稍后重试"
        default: return "请求失败（HTTP \(status)）"
        }
    }

    static func network() -> APIError {
        APIError(code: "NETWORK_ERROR", status: 0, message: "网络连接失败，请检查网络或稍后重试")
    }

    /// 无法连接服务器（局域网地址错误 / 服务未启动）
    static func unreachable() -> APIError {
        APIError(code: "NETWORK_ERROR", status: 0, message: "无法连接服务器，请检查网络或服务器地址")
    }
}

extension Error {
    /// 统一取中文可读文案
    var userMessage: String {
        if let api = self as? APIError { return api.message }
        if let localized = self as? LocalizedError, let text = localized.errorDescription, !text.isEmpty {
            return text
        }
        if !(self as NSError).localizedDescription.isEmpty {
            return (self as NSError).localizedDescription
        }
        return "发生未知错误，请稍后重试"
    }
}
