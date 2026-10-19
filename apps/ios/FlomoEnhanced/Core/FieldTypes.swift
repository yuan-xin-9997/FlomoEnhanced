//
//  FieldTypes.swift
//  浮墨增强版 iOS
//
//  12 种字段类型的元信息：逐条照抄 packages/shared/src/fieldTypes.ts 的
//  `FIELD_TYPE_META` 与 `FIELD_TYPES`（docs/IOS.md §3.6）。
//  注意：`FieldType` 枚举本体定义在 Core/Models.swift，本文件只提供扩展。
//

import Foundation

/// 字段类型元信息（对应 TS `FieldTypeMeta`）
struct FieldTypeMeta {
    /// 中文名
    let label: String
    /// 是否数值型（参与数值统计）
    let numeric: Bool
    /// 是否选择型（有 options）
    let choice: Bool
    /// 新建字段时的默认值（`nil` 对应 TS 的 `null`）
    let defaultValue: FieldValue?
    /// 是否必须提供 options
    let requiresOptions: Bool
    /// 默认小数位（仅数值型有意义；rating 为 0）
    let precision: Int
    /// 默认最大长度（仅 text / longtext / url 有意义；`nil` 表示无默认上限）
    let maxLength: Int?
    /// 展示排序序号（越小越前）
    let order: Int
}

extension FieldType {
    /// 与 TS `FIELD_TYPE_META[type]` 逐字段一致
    /// （label / numeric / choice / defaultValue / requiresOptions / precision / maxLength / order）
    var meta: FieldTypeMeta {
        switch self {
        case .text:
            return FieldTypeMeta(
                label: "单行文本",
                numeric: false,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: 200,
                order: 1
            )
        case .longtext:
            return FieldTypeMeta(
                label: "多行文本",
                numeric: false,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: 5000,
                order: 2
            )
        case .number:
            return FieldTypeMeta(
                label: "数字",
                numeric: true,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 2,
                maxLength: nil,
                order: 3
            )
        case .currency:
            return FieldTypeMeta(
                label: "金额",
                numeric: true,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 2,
                maxLength: nil,
                order: 4
            )
        case .percent:
            return FieldTypeMeta(
                label: "百分比",
                numeric: true,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 2,
                maxLength: nil,
                order: 5
            )
        case .rating:
            return FieldTypeMeta(
                label: "评分",
                numeric: true,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: nil,
                order: 6
            )
        case .date:
            return FieldTypeMeta(
                label: "日期",
                numeric: false,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: nil,
                order: 7
            )
        case .datetime:
            return FieldTypeMeta(
                label: "日期时间",
                numeric: false,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: nil,
                order: 8
            )
        case .select:
            return FieldTypeMeta(
                label: "单选",
                numeric: false,
                choice: true,
                defaultValue: nil,
                requiresOptions: true,
                precision: 0,
                maxLength: nil,
                order: 9
            )
        case .multiselect:
            return FieldTypeMeta(
                label: "多选",
                numeric: false,
                choice: true,
                defaultValue: .strings([]),
                requiresOptions: true,
                precision: 0,
                maxLength: nil,
                order: 10
            )
        case .boolean:
            return FieldTypeMeta(
                label: "是/否",
                numeric: false,
                choice: false,
                defaultValue: .bool(false),
                requiresOptions: false,
                precision: 0,
                maxLength: nil,
                order: 11
            )
        case .url:
            return FieldTypeMeta(
                label: "链接",
                numeric: false,
                choice: false,
                defaultValue: nil,
                requiresOptions: false,
                precision: 0,
                maxLength: 2048,
                order: 12
            )
        }
    }

    /// 全部字段类型，按展示序号排列（对应 TS `FIELD_TYPES`）
    static var ordered: [FieldType] {
        FieldType.allCases.sorted { $0.meta.order < $1.meta.order }
    }
}
