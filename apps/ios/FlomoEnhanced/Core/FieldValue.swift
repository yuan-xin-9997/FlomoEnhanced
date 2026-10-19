//
//  FieldValue.swift
//  浮墨增强版 iOS
//
//  服务端 `FieldValue = string | number | boolean | string[] | null`
//  （packages/shared/src/fieldTypes.ts）的 Swift 联合类型。
//

import Foundation

/// 字段取值联合类型（docs/IOS.md §3.1）
enum FieldValue: Codable, Equatable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case strings([String])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
            return
        }
        if let value = try? container.decode(Bool.self) {
            self = .bool(value)
            return
        }
        if let value = try? container.decode(Double.self) {
            self = .number(value)
            return
        }
        if let value = try? container.decode(String.self) {
            self = .string(value)
            return
        }
        if let value = try? container.decode([String].self) {
            self = .strings(value)
            return
        }
        throw DecodingError.typeMismatch(
            FieldValue.self,
            DecodingError.Context(
                codingPath: decoder.codingPath,
                debugDescription: "无法解析字段取值（支持 string/number/boolean/string[]/null）"
            )
        )
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .strings(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

extension FieldValue {
    /// 空值：null / 空白字符串 / 空数组；`false` 与 `0` 视为有值（与 TS `isFieldValueEmpty` 一致）
    var isEmpty: Bool {
        switch self {
        case .null: return true
        case .string(let value): return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .strings(let values): return values.isEmpty
        case .number: return false
        case .bool: return false
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var numberValue: Double? {
        switch self {
        case .number(let value): return value
        case .string(let value): return Double(value)
        case .bool(let value): return value ? 1 : 0
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var arrayValue: [String]? {
        switch self {
        case .strings(let values): return values
        case .string(let value): return [value]
        default: return nil
        }
    }

    /// 无字段定义上下文时的简化展示（调试/兜底用）
    var displayText: String {
        switch self {
        case .null: return ""
        case .string(let value): return value
        case .number(let value): return FieldFormat.compact(value)
        case .bool(let value): return value ? "是" : "否"
        case .strings(let values): return values.joined(separator: "、")
        }
    }
}
