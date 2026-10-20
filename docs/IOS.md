# 浮墨增强版 iOS 客户端契约（SwiftUI）

> 状态：**冻结 v1**。本文件是 iOS 客户端（`apps/ios/`）的唯一实现契约；与 `docs/SPEC.md`（服务端 HTTP API）、`docs/ANALYTICS.md`（统计口径）逐字段对齐。
> 服务端已上线：`http://192.168.0.111:35080`（端口 35080）。iOS 端**只消费**已有 API，不改服务端。

## 1. 目标与范围（v1 = 全功能）

用原生 SwiftUI 实现与 Web 端对齐的完整客户端：

1. 注册 / 登录 / 登出 / 修改密码（Cookie 会话）
2. 记录（memo）：列表（筛选 + 搜索 + 游标分页 + 下拉刷新）、新建、编辑、删除；模板字段表单（12 种字段类型）与文本模式（逐行「字段名：值」，粘贴自动识别）
3. 模板：列表、新建、编辑（含字段定义编辑）、删除（归档）/ 恢复、复制、**导入（文件选择）**、**导出（分享 JSON 文件）**
4. 洞察：模板选择 + 区间（最近 7 天 / 30 天 / 6 个月 / 自定义）、模板统计全量呈现（Swift Charts 图表）、CSV 导出（分享）
5. 设置：服务器地址（可配置，默认 `http://192.168.0.111:35080`）、健康检查、账号信息、修改密码、登出

不在 v1 范围：离线缓存、推送、多主题、Widget、iPad 专属布局（iPhone 竖屏优先，允许横屏）。

## 2. 平台与工程决策（冻结）

| 项 | 决策 | 理由 |
|---|---|---|
| UI 框架 | SwiftUI（唯一），`import Charts` 画图 | 系统框架，零第三方依赖 |
| 最低版本 | **iOS 17.0**（deployment target） | 支持 `@Observable`、`Charts`；覆盖近 4 年设备 |
| Xcode | 27.1（MacBook `192.168.0.106`，用户 `xinyuan`） | 已装；模拟器 runtime iOS 27.1 |
| 工程文件 | 手写 `project.pbxproj`（`objectVersion = 77`），使用 **`PBXFileSystemSynchronizedRootGroup`** 同步文件夹 | 新增/删除 Swift 文件**无需**改 pbxproj；多人并行开发零冲突 |
| 第三方依赖 | **禁止**（无 SPM / 无 CocoaPods / 无 XcodeGen） | 构建环境无 brew，保持可离线构建 |
| Swift 语言模式 | `SWIFT_VERSION = 5.0`，`SWIFT_STRICT_CONCURRENCY = minimal`，默认 actor 隔离不强制 | 降低并行开发的并发编译错误面 |
| 网络 | `URLSession`（`shared`），Cookie 由 `HTTPCookieStorage.shared` 自动管理 | 服务端是 `flomo_session` Cookie 会话，无需手动存 token |
| 明文 HTTP | `Info.plist` 中 `NSAppTransportSecurity.NSAllowsArbitraryLoads = true` + `NSLocalNetworkUsageDescription` | 局域网明文 API 必需；真机首次请求会弹「本地网络」权限 |
| 状态管理 | `@Observable` 类 + `.environment()` 注入 | 各 Feature 页面从环境取 `Session` / `ToastCenter` |
| Bundle ID | `dev.flomoenhanced.ios` | 免费 Apple ID 个人团队可用；冲突时可改 |
| 显示名 | `浮墨增强版`（CFBundleDisplayName） | 需求 |
| 版本号 | `1.0.0 (1)` | — |

### 2.1 目录结构（并行开发的**所有权边界**）

```
apps/ios/
├── FlomoEnhanced.xcodeproj/
│   ├── project.pbxproj                      # 手写，含同步文件夹；仅 PM 修改
│   └── xcshareddata/xcschemes/FlomoEnhanced.xcscheme
├── Support/Info.plist                       # 在同步文件夹之外，避免被当作资源复制
└── FlomoEnhanced/                           # ← 同步文件夹：此目录下所有文件自动进编译
    ├── App/                                 # PM：入口、根视图、Tab
    │   ├── FlomoEnhancedApp.swift
    │   ├── RootView.swift
    │   └── MainTabView.swift
    ├── Core/                                # PM：契约与共享实现，其他 agent 只读引用
    │   ├── APIClient.swift                  # 网络层（含全部端点方法）
    │   ├── APIError.swift
    │   ├── Models.swift                     # SPEC DTO
    │   ├── AnalyticsModels.swift            # ANALYTICS DTO
    │   ├── FieldValue.swift                 # 值联合类型 Codable
    │   ├── FieldTypes.swift                 # 12 类型元信息
    │   ├── Normalize.swift                  # 归一化（客户端预校验）
    │   ├── FieldFormat.swift                # 展示格式化
    │   ├── Dates.swift                      # 区间/日期换算
    │   ├── Tags.swift                       # TAG_PATTERN 提取/高亮分段
    │   ├── Session.swift                    # 登录态 + baseURL
    │   ├── ToastCenter.swift
    │   ├── ShareSheet.swift                 # 导出文件分享（UIActivityViewController）
    │   └── FileAccess.swift                 # .fileImporter 读取 + 临时文件写入
    └── Features/                            # 并行开发区：每个子目录一个 agent，互不修改
        ├── Auth/AuthView.swift              # Agent S
        ├── Settings/SettingsView.swift      # Agent S
        ├── Memos/*.swift                    # Agent M
        ├── Templates/*.swift                # Agent T
        └── Insights/*.swift                 # Agent I
```

**规则**：一个 agent 只在自己 Features 子目录内创建/修改文件；需要跨区复用的东西，先在 IOS.md 中已冻结的 `Core/` 里找，找不到就提给 PM 加。不得修改 `Core/`、`App/`、`Support/`、pbxproj。

## 3. Core API 契约（名字与签名必须逐字一致）

### 3.1 `FieldValue`（`Core/FieldValue.swift`）

```swift
/// 服务端 FieldValue = string | number | boolean | string[] | null
enum FieldValue: Codable, Equatable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case strings([String])
    case null

    var isEmpty: Bool { ... }                    // null / "" / [] 为空；false、0 不算空
    var stringValue: String? { ... }             // .string 时返回
    var numberValue: Double? { ... }             // .number 时返回
    var boolValue: Bool? { ... }
    var arrayValue: [String]? { ... }
    var displayText: String { ... }              // 无定义上下文的简化展示（调试用）
}
```
- 解码顺序：`null → Bool → Double → String → [String]`。
- 编码：`.number` 整数时输出 JSON 数字（`Double` 编码即可，`5` 与 `5.0` 服务端均接受）。

### 3.2 DTO（`Core/Models.swift` / `Core/AnalyticsModels.swift`）

严格按 `packages/shared/src/types.ts` 与 `apps/web/src/lib/analyticsTypes.ts` 转写。**字段名可读性优先，用 `keyDecodingStrategy = .useDefaultKeys` + 显式 CodingKeys 兜底**（JSON 已是 camelCase）。必含：

```swift
struct User: Codable, Sendable, Identifiable { let id: String; let username: String; let createdAt: String }
struct MeResponse: Codable, Sendable { let user: User }

enum FieldType: String, Codable, CaseIterable, Sendable { case text, longtext, number, currency, percent, rating, date, datetime, select, multiselect, boolean, url }

struct FieldOption: Codable, Sendable, Hashable { let value: String; let label: String; let color: String? }

struct FieldDefinition: Codable, Sendable, Hashable, Identifiable {
    var id: String { key }
    var key: String
    var label: String
    var type: FieldType
    var required: Bool?
    var help: String?
    var placeholder: String?
    var defaultValue: FieldValue?
    var min: Double?
    var max: Double?
    var step: Double?
    var precision: Int?
    var currency: String?
    var scale: Int?
    var maxLength: Int?
    var options: [FieldOption]?
}

struct Template: Codable, Sendable, Identifiable, Hashable {
    let id: String; var name: String; var description: String; var icon: String; var color: String
    var fields: [FieldDefinition]; var version: Int; var memoCount: Int
    let createdAt: String; let updatedAt: String; var archivedAt: String?
}
struct TemplateUpsertBody: Codable, Sendable {
    var name: String; var description: String?; var icon: String?; var color: String?
    var fields: [FieldDefinition]
}
enum TemplateImportMode: String, Codable, Sendable { case skip, rename, overwrite }
struct TemplateImportResult: Codable, Sendable {
    let imported: [Template]
    let skipped: [SkippedTemplate]
    let overwritten: [Template]
    let errors: [ImportError]
    struct SkippedTemplate: Codable, Sendable { let name: String; let reason: String }
    struct ImportError: Codable, Sendable { let index: Int; let name: String; let message: String }
}
struct TemplateFileEntry: Codable, Sendable {
    var name: String; var description: String; var icon: String; var color: String
    var fields: [FieldDefinition]; var templateVersion: Int; var exportedId: String
}
struct TemplateFile: Codable, Sendable {
    var format: String            // 必须 "flomo-enhanced-template"
    var formatVersion: Int        // 必须 1
    var exportedAt: String
    var app: TemplateFileApp
    var templates: [TemplateFileEntry]
    struct TemplateFileApp: Codable, Sendable { var name: String; var version: String }
}

struct Memo: Codable, Sendable, Identifiable, Hashable {
    let id: String; var templateId: String?; var templateName: String?
    var content: String; var values: [String: FieldValue]; var tags: [String]
    let createdAt: String; let updatedAt: String
}
struct MemoListResponse: Codable, Sendable { let items: [Memo]; let nextCursor: String?; let total: Int }
struct MemoUpsertBody: Codable, Sendable {
    var content: String?
    var templateId: String??      // 注意：nil = 不改；.some(nil) = 显式置空（编码为 null）
    var values: [String: FieldValue]?
    var tags: [String]?
    var createdAt: String?
}
struct MemoSummary: Codable, Sendable {
    let total: Int
    let byTemplate: [TemplateCount]
    let heatmap: [DayCount]
    let activeDays: Int; let longestStreak: Int; let currentStreak: Int
    let firstMemoAt: String?; let lastMemoAt: String?
    struct TemplateCount: Codable, Sendable { let templateId: String?; let templateName: String; let count: Int }
    struct DayCount: Codable, Sendable { let date: String; let count: Int }
}
struct HealthResponse: Codable, Sendable {
    let status: String; let version: String; let uptimeSec: Double; let time: String
    let db: DB
    struct DB: Codable, Sendable { let ok: Bool; let users: Int; let memos: Int; let templates: Int; let schemaVersion: Int? }
}
```

> `MemoUpsertBody.templateId` 用 `String??`（双可选）以区分「不改」与「置空」。也可在 Agent M 内用显式 `encodeIfPresent` 处理，但**必须**支持 PATCH 时把 `templateId` 变成 JSON `null`。

洞察模型（`Core/AnalyticsModels.swift`）逐字段照抄 `analyticsTypes.ts`，命名转 Swift 风格但 **JSON key 保持原样**：

```swift
enum Granularity: String, Codable, Sendable { case day, week, month }
struct AnalyticsRange: Codable, Sendable { let from, to, timezone, label: String; let days: Int; let granularity: Granularity }
struct TimelinePoint: Codable, Sendable, Identifiable { var id: String { bucket }; let bucket, label: String; let count, chars: Int }
struct Timeline: Codable, Sendable { let granularity: Granularity; let points: [TimelinePoint] }
struct HeatmapDay: Codable, Sendable, Identifiable { var id: String { date }; let date: String; let count: Int }
struct Heatmap: Codable, Sendable { let max: Int; let days: [HeatmapDay] }
struct WeekdayBucket: Codable, Sendable, Identifiable { var id: Int { weekday }; let weekday: Int; let label: String; let count: Int }
struct Weekday: Codable, Sendable { let buckets: [WeekdayBucket] }
struct HourBucket: Codable, Sendable, Identifiable { var id: Int { hour }; let hour: Int; let count: Int }
struct HourOfDay: Codable, Sendable { let buckets: [HourBucket] }
struct TagStat: Codable, Sendable, Identifiable { var id: String { tag }; let tag: String; let count: Int; let share: Double }
struct HistogramBin: Codable, Sendable, Identifiable { var id: Double { from }; let from, to: Double; let count: Int; let ratio, cumulativeRatio: Double }
struct Histogram: Codable, Sendable { let binCount: Int; let binWidth: Double; let bins: [HistogramBin] }
struct Outliers: Codable, Sendable { let method: String; let lower, upper: Double; let count: Int }
struct NumericStats: Codable, Sendable { let count: Int; let sum, mean, median, min, max, p25, p75, p90, p95, stddev, range: Double; let histogram: Histogram; let outliers: Outliers }
struct NumericTrendPoint: Codable, Sendable, Identifiable { var id: String { bucket }; let bucket, label: String; let count: Int; let sum, mean, min, max: Double }
struct NumericTrend: Codable, Sendable { let granularity: Granularity; let points: [NumericTrendPoint] }
struct DistributionEntry: Codable, Sendable, Identifiable { var id: String { "\(label ?? String(describing: value))-\(count)" }; let value: FieldValue; let label: String?; let count: Int; let share: Double }
struct BooleanStats: Codable, Sendable { let trueCount, falseCount: Int; let trueRatio: Double }
struct DateStats: Codable, Sendable { let min, max: String; let spanDays: Int; let byMonth: [MonthCount]; let byWeekday: [WeekdayCount]; let byHour: [HourCount]?
    struct MonthCount: Codable, Sendable, Identifiable { var id: String { bucket }; let bucket: String; let count: Int }
    struct WeekdayCount: Codable, Sendable, Identifiable { var id: Int { weekday }; let weekday: Int; let count: Int }
    struct HourCount: Codable, Sendable, Identifiable { var id: Int { hour }; let hour: Int; let count: Int } }
struct TextStats: Codable, Sendable { let totalChars: Int; let avgChars, minChars, maxChars, medianChars: Double; let histogram: Histogram; let topWords: [WordCount]; let topWordsNote: String?
    struct WordCount: Codable, Sendable, Identifiable { var id: String { word }; let word: String; let count: Int } }
struct UrlStats: Codable, Sendable { let distinctDomains: [DomainCount]; let distinctCount: Int; let httpsRatio: Double
    struct DomainCount: Codable, Sendable, Identifiable { var id: String { domain }; let domain: String; let count: Int } }
struct FieldFillRate: Codable, Sendable, Identifiable { var id: String { key }; let key, label: String; let filled, missing: Int; let ratio: Double }
struct FieldInsight: Codable, Sendable, Identifiable {
    var id: String { key }
    let key, label: String; let type: FieldType; let filled, missing: Int; let fillRatio: Double
    let valueUnion: [String]?
    let numeric: NumericStats?; let trend: NumericTrend?
    let currency: String?; let unit: String?; let scale: Int?
    let distribution: [DistributionEntry]?
    let boolean: BooleanStats?; let date: DateStats?; let text: TextStats?; let url: UrlStats?
}
struct TemplateSummary: Codable, Sendable {
    let memoCount, allMemoCount: Int; let shareOfAllMemos: Double
    let totalChars, avgChars, memosWithContent, activeDays: Int
    let dayCoverage: Double; let longestStreak, currentStreak: Int
    let busiestDay: BusiestDay?; let firstMemoAt, lastMemoAt: String?; let fieldFillRate: [FieldFillRate]
    struct BusiestDay: Codable, Sendable { let date: String; let count: Int }
}
struct TemplateInsights: Codable, Sendable {
    let template: InsightTemplate; let range: AnalyticsRange
    let generatedAt: String; let tookMs: Double
    let summary: TemplateSummary; let timeline: Timeline; let heatmap: Heatmap
    let weekday: Weekday; let hourOfDay: HourOfDay; let tags: [TagStat]; let fields: [FieldInsight]
    struct InsightTemplate: Codable, Sendable { let id, name, icon, color: String; let fields: [FieldDefinition] }
}
struct OverviewTemplateShare: Codable, Sendable, Identifiable { var id: String { templateId ?? "none" }; let templateId: String?; let templateName, icon: String; let count: Int; let share: Double }
struct OverviewNumericField: Codable, Sendable, Identifiable { var id: String { "\(templateId)/\(key)" }; let templateId, templateName, key, label: String; let type: FieldType; let currency: String?; let count: Int; let sum, mean, median, max: Double }
struct OverviewSummary: Codable, Sendable { let memoCount, templateCount: Int; let byTemplate: [OverviewTemplateShare]; let totalChars, avgChars, activeDays: Int; let dayCoverage: Double; let longestStreak, currentStreak: Int }
struct AnalyticsOverview: Codable, Sendable { let range: AnalyticsRange; let generatedAt: String; let tookMs: Double; let summary: OverviewSummary; let timeline: Timeline; let heatmap: Heatmap; let weekday: Weekday; let hourOfDay: HourOfDay; let tags: [TagStat]; let numericFields: [OverviewNumericField] }
```

> 注意：`TemplateSummary.avgChars` 服务端是数字（可能小数）；`memosWithContent` 等为整数。以上类型如与实际 JSON 不符，以**实际 API 响应**为准（可在 Mac 上用 curl 抓一份真实响应核对）。

### 3.3 `APIClient`（`Core/APIClient.swift`）

```swift
struct DownloadedFile { let data: Data; let filename: String }   // filename 已做安全化

struct APIClient: Sendable {
    let baseURL: URL
    init(baseURL: URL)

    // —— 通用 ——
    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T
    func send<T: Decodable>(_ method: String, _ path: String, query: [String: String?] = [:] , json: (any Encodable)? = nil) async throws -> T
    func sendVoid(_ method: String, _ path: String, query: [String: String?] = [], json: (any Encodable)? = nil) async throws
    func download(_ path: String, query: [String: String?] = [:], fallbackName: String) async throws -> DownloadedFile

    // —— 认证（§8.1）——
    func register(username: String, password: String) async throws -> User     // POST /api/auth/register → MeResponse.user
    func login(username: String, password: String) async throws -> User        // POST /api/auth/login
    func logout() async throws                                                 // POST /api/auth/logout（204）
    func me() async throws -> User                                             // GET /api/auth/me
    func changePassword(current: String, new: String) async throws             // PATCH /api/auth/password（204）

    // —— 模板（§8.2）——
    func listTemplates(includeArchived: Bool = false) async throws -> [Template]
    func createTemplate(_ body: TemplateUpsertBody) async throws -> Template
    func getTemplate(id: String) async throws -> Template
    func updateTemplate(id: String, _ body: TemplateUpsertBody) async throws -> Template
    func deleteTemplate(id: String, hard: Bool = false) async throws
    func restoreTemplate(id: String) async throws -> Template
    func duplicateTemplate(id: String) async throws -> Template
    func exportTemplates(ids: [String]? = nil) async throws -> DownloadedFile      // GET /api/templates/export
    func importTemplates(file: TemplateFile, mode: TemplateImportMode) async throws -> TemplateImportResult

    // —— 记录（§8.3）——
    func listMemos(_ q: MemoQuery) async throws -> MemoListResponse
    func createMemo(_ body: MemoUpsertBody) async throws -> Memo
    func getMemo(id: String) async throws -> Memo
    func updateMemo(id: String, _ body: MemoUpsertBody) async throws -> Memo
    func deleteMemo(id: String) async throws
    func memoSummary(from: String? = nil, to: String? = nil) async throws -> MemoSummary

    // —— 洞察（§8.4）——
    func analyticsOverview(from: String? = nil, to: String? = nil) async throws -> AnalyticsOverview
    func templateInsights(templateId: String, from: String? = nil, to: String? = nil, granularity: Granularity? = nil) async throws -> TemplateInsights
    func exportCsv(templateId: String, from: String? = nil, to: String? = nil, fallbackName: String) async throws -> DownloadedFile

    // —— 健康（§8.5）——
    func health() async throws -> HealthResponse
}

/// 记录列表查询参数（字段语义与 Web `filtersToQuery` 一致）
struct MemoQuery: Sendable {
    var templateId: TemplateFilter = .all     // .all 不传；.none 传 "null"；.id(x) 传 x
    var from: String? = nil                   // ISO（本地日 00:00 的 UTC）
    var to: String? = nil                     // ISO（本地日 23:59:59.999 的 UTC）
    var tag: String? = nil                    // 裸标签
    var q: String? = nil
    var limit: Int = 50                       // 最大 200
    var cursor: String? = nil
    enum TemplateFilter: Sendable, Equatable { case all, none, id(String) }
}
```

实现要点（**必须**遵守）：
- 请求：`Content-Type: application/json`（有 body 时）；写操作**不带** `Origin`/`Referer` 头（服务端只在存在时校验同源）。
- 会话：`URLSessionConfiguration.default` + `httpCookieStorage = .shared` + `httpShouldSetCookies = true`；`Accept-Language` 不设。
- 错误：非 2xx → 解析 `{error:{code,message,details}}` 抛 `APIError`；网络失败抛 `APIError(code: "NETWORK_ERROR", status: 0, message: "网络连接失败，请检查网络或稍后重试")`；无 JSON body 时用状态码兜底文案（与 Web `STATUS_FALLBACK` 一致）。
- 401：`APIError.status == 401` → 由 `Session` 统一接管（清除用户 → 回登录页）。
- 2xx 空 body（204）→ `sendVoid` 不解析。

### 3.4 `APIError`（`Core/APIError.swift`）

```swift
struct APIError: Error, LocalizedError, Sendable {
    let code: String        // VALIDATION_FAILED / UNAUTHENTICATED / ... / NETWORK_ERROR
    let status: Int
    let message: String     // 中文，直接可展示
    var details: String?
    var isUnauthenticated: Bool { status == 401 || code == "UNAUTHENTICATED" }
}
extension Error { var userMessage: String { ... } }   // 统一取中文文案
```

### 3.5 `Session`（`Core/Session.swift`）

```swift
@MainActor @Observable final class Session {
    enum Phase: Equatable { case loading, signedOut, signedIn }
    private(set) var phase: Phase = .loading
    private(set) var user: User?
    var baseURLString: String            // UserDefaults 持久化，默认 "http://192.168.0.111:35080"
    var client: APIClient { ... }        // 由 baseURLString 构造；baseURL 非法时回退默认值

    func bootstrap() async                // 启动：GET /api/auth/me；401 → signedOut
    func login(username: String, password: String) async throws
    func register(username: String, password: String) async throws
    func logout() async
    func setBaseURL(_ raw: String) -> String?   // 校验 URL；返回错误文案或 nil
    func handleUnauthenticated()          // 401 统一处理
}
```

### 3.6 其他 Core 工具

```swift
// ToastCenter.swift
@MainActor @Observable final class ToastCenter {
    struct Toast: Equatable { let id: UUID; let text: String; let kind: Kind; enum Kind { case info, error } }
    private(set) var current: Toast?
    func show(_ text: String)                       // info，1.8s 自动消失
    func error(_ text: String)                      // error，3s 自动消失
}

// ShareSheet.swift —— 导出分享
struct ShareSheet: UIViewControllerRepresentable   // 包装 UIActivityViewController
struct ShareLinkButton: View                       // 标题 + 点击后 present ShareSheet(items: [URL])

// FileAccess.swift
enum FileAccess {
    static func readImportedFile(at url: URL) throws -> Data   // 处理 security-scoped 访问
    static func writeTemporary(_ data: Data, filename: String) throws -> URL
}

// Dates.swift（纯函数，与 Web `apps/web/src/lib/dates.ts` 逐行对齐）
enum RangePreset: String, CaseIterable, Identifiable { case d7 = "7d", d30 = "30d", m6 = "6m", custom
    var id: String { rawValue }
    var label: String { /* 最近 7 天 / 最近 30 天 / 最近 6 个月 / 自定义 */ }
}
struct DayRange: Equatable { var from: String; var to: String }   // "YYYY-MM-DD" 本地日
enum Dates {
    static func todayKey() -> String
    static func toDayKey(_ date: Date) -> String
    static func parseDayKey(_ key: String) -> DateComponents?      // 合法日校验
    static func addDays(_ key: String, _ days: Int) -> String
    static func addMonths(_ key: String, _ months: Int) -> String  // 日期溢出回落
    static func dayDiff(_ from: String, _ to: String) -> Int
    static func inclusiveDays(_ from: String, _ to: String) -> Int
    static func dayStartIso(_ key: String) -> String               // 本地 00:00:00.000 → UTC ISO8601（如 2026-10-12T16:00:00.000Z）
    static func dayEndIso(_ key: String) -> String                 // 本地 23:59:59.999 → UTC ISO8601
    static func rangeForPreset(_ preset: RangePreset, today: String, current: DayRange? = nil) -> DayRange   // 7d: -6 天；30d: -29 天；6m: -6 自然月
    static func validateRange(_ range: DayRange) -> String?        // from ≤ to；跨度 ≤ 3660 天
    static func formatTimestamp(_ iso: String) -> String           // 本地 "yyyy-MM-dd HH:mm"
    static func todayFilenameStamp() -> String                     // "YYYYMMDD"
}

// Tags.swift
enum Tags {
    static let pattern: NSRegularExpression        // #([^\s#,，。；;：:!！?？()（）\[\]【】{}<>《》"'’“”]+)
    static func extract(from content: String) -> [String]          // 裸标签、去重、按出现顺序、≤50 字符、最多 50 个
    static func segments(of content: String) -> [(text: String, isTag: Bool)]   // 高亮用
}

// FieldTypes.swift
struct FieldTypeMeta { let label: String; let numeric: Bool; let choice: Bool; let defaultValue: FieldValue?; let requiresOptions: Bool; let precision: Int; let maxLength: Int?; let order: Int }
extension FieldType { var meta: FieldTypeMeta { ... }       // 12 类型元信息（照抄 fieldTypes.ts）
    static var ordered: [FieldType] { FieldType.allCases.sorted { $0.meta.order < $1.meta.order } } }

// Normalize.swift —— 照抄 normalizeFieldValue 规则（客户端预校验，服务端仍会再校验）
enum Normalize {
    static func value(_ def: FieldDefinition, _ raw: FieldValue?) -> Result   // .ok(FieldValue?) / .fail(String)（中文文案与 Web 一致）
    static func validateTemplateFields(_ fields: [FieldDefinition]) -> [String]
}
extension FieldDefinition {
    var maxLengthEffective: Int? { ... }   // maxLength ?? type 默认
    var precisionEffective: Int { ... }
    var currencyEffective: String { ... }  // 默认 "CNY"
    var scaleEffective: Int { ... }        // 默认 5
}

// FieldFormat.swift
enum FieldFormat {
    static func value(_ def: FieldDefinition, _ value: FieldValue?) -> String
    // currency: 千分位 + 币种符号（NumberFormatter, locale zh_CN, currencyCode）；percent: "12.34%"；number: 千分位；rating: "4 / 5"；boolean: 是/否；date: 原样；datetime: 原样；select/multiselect: option label（multiselect 用「、」连接）；text/longtext/url 原样
    static func compact(_ value: Double) -> String      // 图表轴/卡片：去多余小数
}
```

### 3.7 视觉规范（`Core/Theme.swift` — PM 提供）

```swift
enum Theme {
    static let brand = Color(hex: 0x30CF79)        // 品牌绿（取自 Web 设计）
    static let brandDark = Color(hex: 0x22A85F)
    static let tagBlue = Color(hex: 0x2F6FED)
    static let tagBlueBg = Color(hex: 0xEAF1FE)
    static let bg = Color(hex: 0xF2F2F2)
    static let card = Color.white
    static let textPrimary = Color(hex: 0x1F2328)
    static let textSecondary = Color(hex: 0x6B7280)
    static let danger = Color(hex: 0xE5484D)
    static let corner: CGFloat = 14
    static let cardShadow = Color.black.opacity(0.06)
}
extension Color { init(hex: UInt32) }
```

`Core/Theme.swift` 同时提供以下**共享 UI 组件**（各 Feature 直接复用，不要重复实现）：
- `View.card(padding: CGFloat = 14)` —— 白底圆角卡片修饰符
- `TagPill(text: String, highlighted: Bool = false)` —— 标签胶囊
- `PrimaryButtonStyle` / `SecondaryButtonStyle` —— 主/次按钮样式
- `ShareSheet(items: [Any])` / `ShareLinkButton(title:url:systemImage:)` —— 系统分享面板与分享按钮（导出用）

- 卡片：白色、圆角 `Theme.corner`、细阴影。
- 主按钮：品牌绿填充、白字、圆角；破坏性操作红色。
- 列表背景 `Theme.bg`；标签胶囊用 `tagBlue` / `tagBlueBg`。
- 图表配色：依次 `#30cf79` `#2f6fed` `#f59e0b` `#8b5cf6` `#ef4444` `#14b8a6`（与 Web `chartOptions.ts` 同系）。

## 4. 屏幕清单与行为（Feature agents 的验收面）

### 4.1 Auth（Agent S）`Features/Auth/AuthView.swift`
- 未登录根视图：`AuthView`（登录 / 注册两种模式切换，`Picker` 或分段控件）。
- 登录：用户名 + 密码（`SecureField`），提交调 `session.login`；错误内联展示（`Error.userMessage`）。
- 注册：用户名 + 密码 + 确认密码；本地校验：用户名 `^[A-Za-z0-9_-]{3,32}$`，密码 8..128；两地密码一致。成功即进入主界面。
- 首次启动 `session.phase == .loading` 时显示启动 loading（由 `RootView` 处理，AuthView 只管未登录）。
- 页面含服务器地址提示（只读文案 + 「去设置」入口不需要，设置在已登录后可用；**未登录时**也可以在 AuthView 底部提供「服务器地址」入口，弹 sheet 修改 baseURL）。

### 4.2 Memos（Agent M）`Features/Memos/`
- `MemoListView`：`NavigationStack`；工具条：筛选按钮（sheet `MemoFilterView`）、刷新；列表用 `List`/`ScrollView` + `LazyVStack`。
  - 筛选：模板（全部 / 无模板 / 具体模板）、标签（文本输入或从已加载标签选）、日期区间（从/到，`DatePicker`）、关键词（content 模糊）。
  - 分页：`limit = 20`，`nextCursor` 触底加载更多（`total` 显示总数）；下拉刷新重置。
  - `MemoCardView`：内容（`#标签` 高亮为蓝色胶囊）、`templateName` 徽标（模板色）、字段值表格（`FieldFormat.value`）、时间（`Dates.formatTimestamp`）、标签胶囊；有模板字段时每条卡片可独立切换「模板模式 / 文本模式」。
  - 空态 / 加载中 / 错误（含重试按钮）三态齐全。
  - 右下角悬浮「+」→ `MemoEditorView(memo: nil)`。
- `MemoEditorView(memo: Memo?)`（新建 / 编辑共用，sheet 呈现）：
  - 模板选择（无模板 / 各模板，`.pickerStyle(.menu)`）；切换模板时字段值重置（编辑态提示将清空）。
  - 字段表单按 `field.type` 渲染（见 §5）；`required` 字段未填给出提示（服务端会 422，本地先拦）。
  - 字段区可切换「模板模式 / 文本模式」：文本按 `MemoTextCodec.format` 序列化，每行「字段名：值」；粘贴时通过 `MemoTextEditorView` 的 `UITextView.paste(_:)` 感知并按完整文本解析；手工输入在切回模板模式 / 保存时重新解析。解析错误逐行展示，存在未识别行或非法值时阻止保存。
  - 内容 `TextEditor`（多行，自动高度合适）+ 标签输入（逗号/空格分隔，或直接写 `#标签`，编辑器下方实时预览提取结果）。
  - 保存：`createMemo` / `updateMemo`；`createdAt` 新建时默认不传（服务端用 now）；编辑保留原值。
  - 删除（编辑态，二次确认）。
  - 校验：内容与字段值至少一个有内容，否则禁用保存并提示。

### 4.3 Templates（Agent T）`Features/Templates/`
- `TemplatesView`：列表（图标 emoji + 名称 + 字段数 + memoCount + 归档徽标）；`segmented` 或开关切换「在用的 / 含归档」；行内操作：编辑、复制、归档/恢复、删除（含归档时 `hard`），都需二次确认（归档可轻量确认）。
- `TemplateEditorView(template: Template?)`：新建 / 编辑。
  - 基本信息：名称（必填 ≤40）、描述（≤200）、图标（预设 emoji 选择器 + 手输）、颜色（预设色板）。
  - 字段编辑：增删、上下移动、每字段编辑 key（正则 `^[a-z][a-z0-9_]{0,39}$`，不可变提示：编辑已有模板时禁止改 key）、label（≤40）、type（12 种 Picker）、required 开关、placeholder、help、
    - 数值型：min / max / step / precision
    - currency：币种（CNY/USD/EUR/JPY/...）、precision
    - rating：scale 1..10
    - text/longtext/url：maxLength
    - select/multiselect：options 增删改（value/label/颜色）
  - 保存前用 `Normalize.validateTemplateFields` 校验并展示错误；保存调 `createTemplate` / `updateTemplate`。
- 导入/导出：
  - 导出：`exportTemplates(ids:)` → `ShareLinkButton` 分享 `.json` 文件（Content-Disposition 文件名）。
  - 导入：`.fileImporter`（`UTType.json`）→ `FileAccess.readImportedFile` → `JSONDecoder` 解 `TemplateFile` → 预览条目数 + 选择模式（skip / rename / overwrite）→ `importTemplates` → 结果摘要（imported / skipped / overwritten / errors）。

### 4.4 Insights（Agent I）`Features/Insights/`
- `InsightsView`：顶部：模板 `Picker`（「全局概览」+ 各模板）+ 区间选择（最近 7 天 / 30 天 / 6 个月 / 自定义；自定义用两个 `DatePicker`）。
  - 区间换算：`rangeForPreset` → `dayStartIso(from)` / `dayEndIso(to)` 传给 API。
- **全局概览**（未选模板）：`analyticsOverview`
  - 摘要卡：记录数、模板数、总字数、平均字数、活跃天数、最长/当前连续。
  - 图表：时间线（折线或柱状）、热力图（近区间日历格子）、星期分布柱状、时段分布柱状、标签 Top（横向条）、跨模板数值字段汇总表。
- **模板洞察**：`templateInsights`
  - 摘要卡：该模板记录数、占比、字数、活跃天数、天数覆盖率、连续记录、最忙碌日、字段填写率（进度条列表）。
  - 图表：时间线（count/chars 切换）、热力图、星期 / 时段分布、标签 Top。
  - 每字段卡片 `FieldInsightCardView`：
    - numeric（number/currency/percent/rating）：count/sum/mean/median/min/max/p25/p75/p90/p95/stddev/range + 直方图 + 趋势折线 + 离群值提示；currency 用币种格式化，percent 加 `%`，rating 用 `x / scale`。
    - select / multiselect：分布（横向条 + share%）。
    - boolean：是否占比（饼或条）。
    - date / datetime：min/max/跨度 + byMonth 柱状 + byWeekday（datetime 另加 byHour）。
    - text / longtext：字数统计 + 直方图 + topWords（横向条；注意 `topWordsNote`）。
    - url：域名分布 + https 占比 + distinctCount。
- CSV 导出：选中具体模板时可用（工具条按钮）→ `exportCsv` → `ShareLinkButton` 分享。
- 全部图表用 **Swift Charts**；空数据 → 友好空态（「该区间没有数据」），不要空白图表。

### 4.5 Settings（Agent S）`Features/Settings/`
- 服务器地址：当前值展示 + 编辑（校验 URL http/https；保存后 `session.setBaseURL`；重新 `me()` 校验连通性，失败提示但不回滚）。
- 健康检查：`health()` → 显示 `status/version/uptimeSec/db` 卡片（含刷新）。
- 账号：`username`、`createdAt`、记录统计（`memoSummary()` 轻量展示 total / activeDays / currentStreak）。
- 修改密码：当前密码 + 新密码 + 确认；调 `changePassword`（成功后提示需重新登录？——服务端会吊销其它会话，当前会话保留；提示「已更新」即可）。
- 登出：二次确认 → `session.logout()`。
- 关于：版本号 1.0.0、服务端地址、数据说明。

## 5. 12 种字段类型的表单控件与取值（统一规则）

| type | 控件 | 取值（`values[key]`） | 备注 |
|---|---|---|---|
| text | `TextField` | `.string` | ≤200（或 def.maxLength） |
| longtext | `TextEditor` | `.string` | ≤5000 |
| number | `TextField`（数字键盘）+ 步进可选 | `.number` | 千分位展示；min/max/step |
| currency | `TextField` 数字 + 币种后缀 | `.number` | 币种 `currencyEffective`；precision |
| percent | 数字输入（带 `%`） | `.number` | 0..100 |
| rating | 星级/滑块（1..scale） | `.number`（整数） | 必须整数 |
| date | `DatePicker(.date)` | `.string`（`yyyy-MM-dd`） | 本地日 |
| datetime | `DatePicker(.dateAndTime)` | `.string`（ISO8601 含时区，UTC `Z`，毫秒） | 例：`2026-10-19T02:30:00.000Z` |
| select | `Picker(.menu)` + 清除 | `.string`（option value） | 只能选 options 中的值 |
| multiselect | 多选列表/标签 | `.strings([value])` | 结果按 options 顺序 |
| boolean | `Toggle` | `.bool` | 未填可为 `.null`？——控件用 Toggle + 「未填」三态可用 segmented（是/否/未填）；提交未填用 `.null` |
| url | `TextField`（URL 键盘） | `.string` | 必须 http/https，≤2048 |

数值输入统一用字符串草稿 + `Normalize.value` 转换，空串 → `.null`。

## 6. 日期与区间语义（与 Web 完全一致）

- 所有「日」按**设备本地时区**计算；`from`/`to` 传本地日边界对应的 UTC ISO（`Z`）。
- 快捷区间：7 天 = `today-6 .. today`；30 天 = `today-29 .. today`；6 个月 = `addMonths(today, -6) .. today`。
- 服务端 `range.label` 由服务端生成，客户端直接显示。
- `datetime` 字段值：写入用 `ISO8601DateFormatter`（`.withInternetDateTime + .withFractionalSeconds`，UTC）；展示转本地 `yyyy-MM-dd HH:mm`。
- `Memo.createdAt` 等时间戳展示：`Dates.formatTimestamp`。

## 7. 错误处理与登录态

- 任何 API 抛 `APIError` → `error.userMessage` 直接可展示；页面内联错误 + 重试。
- `isUnauthenticated` → `session.handleUnauthenticated()`（本会话已由 Session 统一处理一次即可，页面只负责跳转后的空白）。
- 429 限流：「操作过于频繁，请稍后再试」（服务端会给中文 message，直接展示）。
- 冲突/校验：服务端 message 已是中文，直接展示；模板字段编辑的本地校验提示与 Web 文案一致。
- 网络不可达（局域网服务没开 / 手机不在同一网络）：提示「无法连接服务器，请检查网络或服务器地址」。

## 8. 构建、同步与验收（MacBook 侧）

**开发机（Windows）→ Mac 同步**（PowerShell，仓库根；已封装为 `scripts/ios-build.ps1`）：

```powershell
# 同步 + 编译 + 安装启动 + 截图，一步到位：
powershell -File scripts\ios-build.ps1            # 仅同步
powershell -File scripts\ios-build.ps1 -Build      # 同步 + 编译
powershell -File scripts\ios-build.ps1 -Build -Run # 同步 + 编译 + 安装启动
powershell -File scripts\ios-build.ps1 -Test       # 跑 UI 验收测试并回传截图
powershell -File scripts\ios-build.ps1 -Test -Only test02MainTabs  # 只跑单个用例（迭代用）
```

等价的手工命令（供参考）：

```powershell
tar -czf $env:TEMP\ios-sync.tgz -C E:\dev\FlomoEnhanced apps/ios
scp $env:TEMP\ios-sync.tgz macbook-wifi:/tmp/ios-sync.tgz
ssh macbook-wifi "rm -rf ~/FlomoIos/apps && mkdir -p ~/FlomoIos && tar -xzf /tmp/ios-sync.tgz -C ~/FlomoIos"

# 构建（模拟器，无需签名）
ssh macbook-wifi "cd ~/FlomoIos/apps/ios && xcodebuild -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced -configuration Debug -destination 'platform=iOS Simulator,name=iPhone Duo' -derivedDataPath /tmp/flomo-dd CODE_SIGNING_ALLOWED=NO build"

# UI 验收测试 + 截图导出（测试运行需要模拟器 ad-hoc 签名，勿加 CODE_SIGNING_ALLOWED=NO）
ssh macbook-wifi "cd ~/FlomoIos/apps/ios && xcodebuild test -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced -destination 'platform=iOS Simulator,name=iPhone Duo' -derivedDataPath /tmp/flomo-dd -resultBundlePath /tmp/flomo-uitest.xcresult"
ssh macbook-wifi "xcrun xcresulttool export attachments --path /tmp/flomo-uitest.xcresult --output-path /tmp/flomo-shots"
```

**环境备忘（实测）**：
- 本机 Xcode 27.1 的 iOS 27.1 模拟器 runtime **只支持 `iPhone Duo`** 设备类型（其它机型均报 `Incompatible device`）。
- Xcode 27 的模拟器宿主 App 是 `DeviceHub.app`（位于 `/Applications/Xcode.app/Contents/Applications/`），不再是 `Simulator.app`。
- `xcrun simctl io <udid> screenshot` 在设备窗口未打开时输出全黑；**验收截图统一走 XCUITest 附件**（`xcresulttool export attachments`）。
- **iOS 27 的 Tab 栏是右侧竖排浮动栏**：`app.tabBars` 查询不到，但 `app.buttons["洞察"]` 等按钮**真实存在且可点击**（已用活动日志确认）。验收测试的 `ensureTab` 优先真实点击，找不到时用 `-qaTab N` 重启直达，保证每屏都能出图。
- `-qaUsername/-qaPassword/-qaTab/-qaLogout` 由 `UserDefaults` 参数域注入；**`-qaTab` 的值是字符串**，解析时不能直接 `as? Int`（`QASupport.initialTab` 已按字符串/NSNumber 双兼容处理）。
- **洞察数据契约实测**：`text/longtext` 的直方图分箱只有 `{from,to,count}`，`numeric/currency/percent/rating` 的分箱才带 `{ratio,cumulativeRatio}` —— `HistogramBin.ratio/cumulativeRatio` 必须是可选，否则模板洞察整页解码失败（表现为「服务器返回的数据无法解析」）。
- 模板洞察的完整链路可用真实响应离线验证：`node scripts/ios-json-shape.mjs <json>` 看结构，`swiftc` 编译 `Core/*.swift` + 小程序解码（`TemplateInsights`），能给出精确的 `DecodingError.codingPath`。

**验收标准（PM 逐项过）**：
1. `xcodebuild build` 0 error（warning 可接受）。
2. UI 验收测试（`FlomoEnhancedUITests`）全绿（10 用例 / 22 张截图）：登录页渲染 / 四 Tab 切换 /
   新建记录弹窗 / 模板编辑器 / 模板导入弹窗 + 导出分享面板 / 设置页（含健康检查、改密、登出）/
   洞察页（全局概览 + 选模板后模板洞察与字段统计）/ 真实手动登录 /
   模板文本模式（粘贴解析报错并阻断保存、完整识别后切回模板模式并保存）。
3. 截图逐屏留档（`.tmp-shots/`，经 `xcresulttool export attachments` 导出）。
4. 真机安装说明（免费 Apple ID）见 `apps/ios/README.md`。

## 9. 已知边界 / 非目标

- 服务端无 WebSocket/推送：列表用下拉刷新，不做实时同步。
- 中文文案全部来自服务端或本地常量，不做多语言。
- 免费 Apple ID 签名有效期 7 天（重装即可），不做自动续签。
- 模拟器验证为主；真机由用户用自己的 Apple ID 在 Xcode 中 Run。
