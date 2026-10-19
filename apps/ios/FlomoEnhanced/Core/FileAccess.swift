//
//  FileAccess.swift
//  浮墨增强版 iOS
//
//  文件导入（.fileImporter）与导出临时文件。
//

import Foundation

enum FileAccess {
    /// 读取用户通过文件选择器导入的文件（处理 security-scoped 访问）
    static func readImportedFile(at url: URL) throws -> Data {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped {
                url.stopAccessingSecurityScopedResource()
            }
        }
        return try Data(contentsOf: url)
    }

    /// 把导出数据写入临时目录，返回可分享的文件 URL
    static func writeTemporary(_ data: Data, filename: String) throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("flomo-exports", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeName = sanitize(filename.isEmpty ? "export" : filename)
        let url = directory.appendingPathComponent(safeName)
        try data.write(to: url, options: .atomic)
        return url
    }

    /// 文件名安全化（去掉路径分隔符等非法字符）
    static func sanitize(_ name: String) -> String {
        let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|").union(.newlines)
        let cleaned = name.components(separatedBy: invalid).joined(separator: "_")
        let trimmed = cleaned.trimmingCharacters(in: .whitespaces)
        return trimmed.isEmpty ? "export" : String(trimmed.prefix(120))
    }
}
