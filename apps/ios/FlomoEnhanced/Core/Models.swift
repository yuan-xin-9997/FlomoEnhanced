//
//  Models.swift
//  浮墨增强版 iOS
//
//  SPEC §8 公共 DTO（packages/shared/src/types.ts）的 Swift 转写。
//

import Foundation

// MARK: - 用户（§8.1）

struct User: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let username: String
    let createdAt: String
}

struct MeResponse: Codable, Sendable {
    let user: User
}

// MARK: - 字段定义（§6）

enum FieldType: String, Codable, CaseIterable, Sendable {
    case text
    case longtext
    case number
    case currency
    case percent
    case rating
    case date
    case datetime
    case select
    case multiselect
    case boolean
    case url
}

struct FieldOption: Codable, Sendable, Hashable {
    var value: String
    var label: String
    var color: String?
}

struct FieldDefinition: Codable, Sendable, Hashable, Identifiable {
    var key: String
    var label: String
    var type: FieldType
    var required: Bool?
    var help: String?
    var placeholder: String?
    var defaultValue: FieldValue?

    // number / currency / percent / rating
    var min: Double?
    var max: Double?
    var step: Double?
    var precision: Int?
    var currency: String?
    var scale: Int?

    // text / longtext / url
    var maxLength: Int?

    // select / multiselect
    var options: [FieldOption]?

    var id: String { key }
}

// MARK: - 模板（§8.2）

struct Template: Codable, Sendable, Identifiable, Hashable {
    let id: String
    var name: String
    var description: String
    var icon: String
    var color: String
    var fields: [FieldDefinition]
    var version: Int
    var memoCount: Int
    let createdAt: String
    let updatedAt: String
    var archivedAt: String?

    var isArchived: Bool { archivedAt != nil }
}

struct TemplateListResponse: Codable, Sendable {
    let items: [Template]
}

struct TemplateUpsertBody: Codable, Sendable {
    var name: String
    var description: String?
    var icon: String?
    var color: String?
    var fields: [FieldDefinition]
}

enum TemplateImportMode: String, Codable, Sendable, CaseIterable {
    case skip
    case rename
    case overwrite

    var label: String {
        switch self {
        case .skip: return "跳过重名"
        case .rename: return "重命名"
        case .overwrite: return "覆盖"
        }
    }
}

struct TemplateImportResult: Codable, Sendable {
    let imported: [Template]
    let skipped: [SkippedTemplate]
    let overwritten: [Template]
    let errors: [ImportError]

    struct SkippedTemplate: Codable, Sendable {
        let name: String
        let reason: String
    }

    struct ImportError: Codable, Sendable {
        let index: Int
        let name: String
        let message: String
    }

    var isEmpty: Bool { imported.isEmpty && skipped.isEmpty && overwritten.isEmpty && errors.isEmpty }
}

// MARK: - 模板文件（§7）

struct TemplateFileApp: Codable, Sendable {
    var name: String
    var version: String
}

struct TemplateFileEntry: Codable, Sendable {
    var name: String
    var description: String
    var icon: String
    var color: String
    var fields: [FieldDefinition]
    var templateVersion: Int
    var exportedId: String
}

struct TemplateFile: Codable, Sendable {
    var format: String
    var formatVersion: Int
    var exportedAt: String
    var app: TemplateFileApp
    var templates: [TemplateFileEntry]

    static let expectedFormat = "flomo-enhanced-template"
    static let expectedVersion = 1
}

// MARK: - 想法（§8.3）

struct Memo: Codable, Sendable, Identifiable, Hashable {
    let id: String
    var templateId: String?
    var templateName: String?
    var content: String
    var values: [String: FieldValue]
    var tags: [String]
    let createdAt: String
    let updatedAt: String
}

struct MemoListResponse: Codable, Sendable {
    let items: [Memo]
    let nextCursor: String?
    let total: Int
}

/// 创建/更新请求体。
/// `templateId` 使用双层可选：`nil` = 不发送该键；`.some(nil)` = 显式置空（JSON null）；`.some("id")` = 指定模板。
struct MemoUpsertBody: Codable, Sendable {
    var content: String?
    var templateId: String??
    var values: [String: FieldValue]?
    var tags: [String]?
    var createdAt: String?

    init(
        content: String? = nil,
        templateId: String?? = nil,
        values: [String: FieldValue]? = nil,
        tags: [String]? = nil,
        createdAt: String? = nil
    ) {
        self.content = content
        self.templateId = templateId
        self.values = values
        self.tags = tags
        self.createdAt = createdAt
    }

    enum CodingKeys: String, CodingKey {
        case content, templateId, values, tags, createdAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        content = try container.decodeIfPresent(String.self, forKey: .content)
        if container.contains(.templateId) {
            templateId = .some(try container.decodeIfPresent(String.self, forKey: .templateId))
        } else {
            templateId = nil
        }
        values = try container.decodeIfPresent([String: FieldValue].self, forKey: .values)
        tags = try container.decodeIfPresent([String].self, forKey: .tags)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(content, forKey: .content)
        switch templateId {
        case .none:
            break
        case .some(.some(let id)):
            try container.encode(id, forKey: .templateId)
        case .some(.none):
            try container.encodeNil(forKey: .templateId)
        }
        try container.encodeIfPresent(values, forKey: .values)
        try container.encodeIfPresent(tags, forKey: .tags)
        try container.encodeIfPresent(createdAt, forKey: .createdAt)
    }
}

extension MemoUpsertBody {
    /// 新建想法（`templateId` 一定发送，可为 null）
    static func create(
        content: String,
        templateId: String?,
        values: [String: FieldValue]? = nil,
        tags: [String]? = nil
    ) -> MemoUpsertBody {
        MemoUpsertBody(content: content, templateId: .some(templateId), values: values, tags: tags)
    }

    /// 更新想法（默认不发送 `templateId`；传 `.some(nil)` 表示取消模板）
    static func update(
        content: String? = nil,
        templateId: String?? = nil,
        values: [String: FieldValue]? = nil,
        tags: [String]? = nil
    ) -> MemoUpsertBody {
        MemoUpsertBody(content: content, templateId: templateId, values: values, tags: tags)
    }
}

struct MemoSummary: Codable, Sendable {
    let total: Int
    let byTemplate: [TemplateCount]
    let heatmap: [DayCount]
    let activeDays: Int
    let longestStreak: Int
    let currentStreak: Int
    let firstMemoAt: String?
    let lastMemoAt: String?

    struct TemplateCount: Codable, Sendable, Identifiable {
        var id: String { templateId ?? "__none__" }
        let templateId: String?
        let templateName: String
        let count: Int
    }

    struct DayCount: Codable, Sendable, Identifiable {
        var id: String { date }
        let date: String
        let count: Int
    }
}

// MARK: - 健康检查（§8.5）

struct HealthResponse: Codable, Sendable {
    let status: String
    let version: String
    let uptimeSec: Double
    let time: String
    let db: DB

    var isOk: Bool { status == "ok" && db.ok }

    struct DB: Codable, Sendable {
        let ok: Bool
        let users: Int
        let memos: Int
        let templates: Int
        let schemaVersion: Int?
    }
}
