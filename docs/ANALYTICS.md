# FlomoEnhanced — 洞察分析统计口径（冻结版 v1）

> 本文定义 `/api/analytics/*` 的**逐字段**响应契约与计算口径。实现必须完全对齐，前端按此渲染。
> 统计计算的数学定义参考成熟方案，避免自造口径：
> - `numpy.percentile(..., method='linear')` 的线性插值分位数（`pandas.Series.describe()` / `numpy.median` 同义）
> - 样本标准差用 `ddof=1`（`numpy.std(ddof=1)`、`pandas.std()` 默认）
> - 直方图分箱用 **Freedman–Diaconis 规则**，退化时用 Sturges 规则（`numpy.histogram_bin_edges` 的同类做法）
> - 日/周/月分桶与「连续记录天数」参考 GitHub Contributions 热力图与 flomo「记录统计」的既有交互
> - 图表渲染统一使用 Apache ECharts（`calendar` 热力图、`line`、`bar`、`pie`、`scatter`、`boxplot`）

## 1. 时间与分桶

- 时区：`FLOMO_TZ`（默认 `Asia/Shanghai`），所有「日」的划分都按该时区本地日。
- 时区偏移计算（无第三方库）：对给定 UTC 毫秒 `t`，用
  `Intl.DateTimeFormat('en-CA', {timeZone, year,month,day,hour,minute,second,hour12:false}).formatToParts(new Date(t))` 取本地年月日时分秒；
  `localDayKey(t) = 'YYYY-MM-DD'`。
- 区间：`from`、`to` 归一化为该时区的**日边界**：`from` 取当日 `00:00:00.000` 本地时间对应的 UTC，`to` 取当日 `23:59:59.999` 本地时间对应的 UTC，两者都是**闭区间**。
- 分桶键：
  - `day` → `YYYY-MM-DD`
  - `week` → 该周（**周一为首日**）的 `YYYY-MM-DD`
  - `month` → `YYYY-MM`
- `granularity` 默认按跨度自动选择：≤ 62 天 → `day`；≤ 730 天 → `week`；否则 `month`。
- 分桶序列**补齐空桶**（计数 0），保证折线图连续；补齐范围 = `[from 所在桶, to 所在桶]`。

## 2. 通用结构

```jsonc
{
  "range": {
    "from": "2026-09-19T00:00:00.000+08:00",  // 归一化后的实际区间（ISO）
    "to":   "2026-10-18T23:59:59.999+08:00",
    "timezone": "Asia/Shanghai",
    "days": 30,                                 // 闭区间天数
    "granularity": "day",                       // 实际使用粒度
    "label": "最近 30 天"                        // 中文可读标签（自定义区间为 "2026-09-19 ~ 2026-10-18"）
  },
  "generatedAt": "2026-10-18T05:00:00.000Z",
  "tookMs": 12
}
```

百分点一律输出 **0..1 的小数**，字段名以 `ratio`/`share` 结尾；前端负责乘 100 显示。
金额/数值不做单位换算，保留原始数值；前端按字段定义的 `precision`/`currency` 格式化。

## 3. `GET /api/analytics/templates/:id/insights`

```jsonc
{
  "template": { "id": "...", "name": "每日开销", "icon": "💰", "color": "#3b82f6", "fields": [ /* FieldDefinition[] */ ] },
  "range": { /* §2 */ },
  "generatedAt": "...", "tookMs": 12,

  "summary": {
    "memoCount": 42,            // 区间内该模板的想法数
    "allMemoCount": 137,        // 区间内该用户全部想法数（用于占比）
    "shareOfAllMemos": 0.3066,
    "totalChars": 3210,         // content 字符数合计（按 Array.from(content).length 计，兼容 emoji/中文）
    "avgChars": 76.43,          // 每条的 content 平均字符数，无数据为 0
    "memosWithContent": 40,     // content 非空条数
    "activeDays": 12,           // 有记录的不同本地日数
    "dayCoverage": 0.4,         // activeDays / range.days
    "longestStreak": 5,         // 区间内最长连续记录天数
    "currentStreak": 2,         // 以 range.to 所在日为终点的连续天数
    "busiestDay": { "date": "2026-10-01", "count": 6 } | null,
    "firstMemoAt": "2026-09-20T01:00:00.000Z" | null,
    "lastMemoAt":  "2026-10-18T02:00:00.000Z" | null,
    "fieldFillRate": [ { "key": "amount", "label": "金额", "filled": 40, "missing": 2, "ratio": 0.9524 } ]
  },

  "timeline": {                       // 主趋势图（柱+折线）
    "granularity": "day",
    "points": [ { "bucket": "2026-09-19", "label": "09-19", "count": 3, "chars": 210 } ]
  },

  "heatmap": {                        // ECharts calendar 热力图
    "max": 6,                         // 单日最大计数（用于视觉映射 [0,max]）
    "days": [ { "date": "2026-09-19", "count": 3 } ]   // 仅区间内有记录的日期？否——补齐整个区间，count 可为 0
  },

  "weekday": { "buckets": [ { "weekday": 1, "label": "周一", "count": 5 } ] },  // weekday: 1=周一 … 7=周日，恒 7 项
  "hourOfDay": { "buckets": [ { "hour": 0, "count": 0 } ] },                    // 恒 24 项，按本地小时
  "tags": [ { "tag": "工作", "count": 12, "share": 0.2857 } ],                  // 按 count 降序，最多 20 项

  "fields": [ /* §4，仅包含该模板定义的字段，顺序同模板定义 */ ]
}
```

- `longestStreak` / `currentStreak`：基于「区间内每日计数 > 0」的连续段。
- `range.days` = `(to 本地日 - from 本地日)` 天数 + 1。

## 4. `fields[]`：按字段类型产出

所有字段都含：

```jsonc
{
  "key": "amount", "label": "金额", "type": "currency",
  "filled": 40,            // 区间内该字段有值的条数
  "missing": 2,            // memoCount - filled（required 字段理论上为 0）
  "fillRatio": 0.9524,
  "valueUnion": null       // 仅 select/multiselect：区间内出现过的 option value 集合（含模板定义但未出现的项由前端补 0）
}
```

### 4.1 `number` / `currency` / `percent` / `rating` → 附 `numeric` + `trend`

```jsonc
"numeric": {
  "count": 40,        // 有值条数
  "sum": 12345.6,
  "mean": 308.64,
  "median": 200,
  "min": 10, "max": 5000,
  "p25": 100, "p75": 400, "p90": 900, "p95": 1200,
  "stddev": 123.4,          // 样本标准差 ddof=1；count<2 时为 0
  "range": 4990,            // max - min
  "histogram": {
    "binCount": 8,
    "binWidth": 623.75,
    "bins": [ { "from": 10, "to": 633.75, "count": 12, "ratio": 0.3, "cumulativeRatio": 0.3 } ]
  },
  "outliers": { "method": "iqr", "lower": -350, "upper": 850, "count": 2 }   // 1.5×IQR 规则（Tukey）
},
"trend": {                  // 数值随时间的聚合（用于折线/柱状）
  "granularity": "day",
  "points": [ { "bucket": "2026-09-19", "label": "09-19", "count": 3, "sum": 900, "mean": 300, "min": 100, "max": 500 } ]
}
```

- `currency` 额外含 `"currency": "CNY"`（来自字段定义）；`percent` 额外含 `"unit": "%"`；`rating` 额外含 `"scale": 5` 与 `"distribution": [ { "value": 1, "count": 3, "share": 0.075 } ]`（0..scale 全量桶）。
- 直方图分箱：`binWidth = 2*IQR/n^(1/3)`（Freedman–Diaconis），`binCount = ceil(range/binWidth)` 后**夹取到 [5,20]**；若 `IQR==0` 或 `range==0` → `binCount = min(5, n)` 且所有值落同一桶；若 FD 结果非法则用 Sturges `ceil(log2(n))+1`。
- 分位数：线性插值（`h = (n-1)*p`，向下取整 `lo`、`lo+1` 之间按小数部分插值）。

### 4.2 `select` / `multiselect` → 附 `distribution`

```jsonc
"distribution": [ { "value": "food", "label": "餐饮", "count": 18, "share": 0.45 } ]   // 按 count 降序；multiselect 因一条可多值，share 分母为「该字段被引用的总次数」
"valueUnion": ["food", "traffic", "rent"]     // 区间内实际出现的 value
```

### 4.3 `boolean` → 附 `boolean`

```jsonc
"boolean": { "trueCount": 12, "falseCount": 28, "trueRatio": 0.3 }
```

### 4.4 `date` / `datetime` → 附 `date`

```jsonc
"date": {
  "min": "2026-09-19", "max": "2026-10-18", "spanDays": 30,   // spanDays = max-min 天数差
  "byMonth": [ { "bucket": "2026-09", "count": 12 } ],        // 时间线（按该字段自身日期分桶，粒度同 range.granularity）
  "byWeekday": [ { "weekday": 1, "count": 4 } ],              // 恒 7 项
  "byHour": [ { "hour": 0, "count": 0 } ]                     // 仅 datetime，恒 24 项
}
```

### 4.5 `text` / `longtext` → 附 `text`

```jsonc
"text": {
  "totalChars": 2400, "avgChars": 60, "minChars": 3, "maxChars": 180, "medianChars": 55,
  "histogram": { "binCount": 5, "binWidth": 36, "bins": [ { "from": 3, "to": 39, "count": 10 } ] },
  "topWords": [ { "word": "复盘", "count": 9 } ],     // 最多 15 项
  "topWordsNote": "中文按 2-gram、英文/数字按词切分；过滤停用词与单字符"
}
```

- 分词规则（自实现，无第三方依赖）：先把文本按 `/[^\p{L}\p{N}]+/u` 切分；对每一段：纯 ASCII 片段（含数字/下划线）长度 ≥2 保留为词；含 CJK 的片段产出所有**相邻双字 bigram**。停用词表内置约 40 个中英文虚词（的、了、是、我、在、和、就、都、而、及、与、着、或、the、a、an、is、are、and、or、to、of、in、on、for 等）。

### 4.6 `url` → 附 `url`

```jsonc
"url": {
  "distinctDomains": [ { "domain": "github.com", "count": 7 } ],   // 按 count 降序，最多 15 项
  "distinctCount": 12,
  "httpsRatio": 0.9
}
```

## 5. `GET /api/analytics/overview`

```jsonc
{
  "range": { /* §2 */ },
  "generatedAt": "...", "tookMs": 5,
  "summary": { "memoCount": 137, "templateCount": 5,
               "byTemplate": [ { "templateId": "t1", "templateName": "每日开销", "icon": "💰", "count": 42, "share": 0.3066 },
                               { "templateId": null, "templateName": "无模板", "icon": "", "count": 60, "share": 0.438 } ],
               "totalChars": 12000, "avgChars": 87.6,
               "activeDays": 25, "dayCoverage": 0.833, "longestStreak": 9, "currentStreak": 3 },
  "timeline": { "granularity": "day", "points": [ { "bucket": "2026-09-19", "label": "09-19", "count": 3, "chars": 210 } ] },
  "heatmap": { "max": 9, "days": [ { "date": "2026-09-19", "count": 3 } ] },
  "weekday": { "buckets": [ /* 7 项 */ ] },
  "hourOfDay": { "buckets": [ /* 24 项 */ ] },
  "tags": [ { "tag": "工作", "count": 12, "share": 0.0876 } ],
  "numericFields": [                                 // 跨模板汇总所有数值型字段（key 冲突时以 templateName 前缀区分）
    { "templateId": "t1", "templateName": "每日开销", "key": "amount", "label": "金额",
      "type": "currency", "currency": "CNY", "count": 40, "sum": 12345.6, "mean": 308.64, "median": 200, "max": 5000 }
  ]
}
```

## 6. `GET /api/analytics/templates/:id/export.csv`

- 头部：`Content-Type: text/csv; charset=utf-8`，`Content-Disposition: attachment; filename="<模板名>-YYYYMMDD.csv"`（文件名做 ASCII 安全化 + RFC 5987 `filename*`）。
- 内容：UTF-8 **BOM**（`\uFEFF`）；CRLF 换行；`"` 转义按 RFC 4180。
- 列：`记录时间(本地)`, `记录时间(UTC)`, `内容`, `标签`, 然后是模板每个字段的 `label`（列顺序同字段定义）。
- 行：区间内该模板的所有未删除 memo，按 `created_at ASC`。
- `multiselect` 用 `|` 连接；`boolean` 输出 `是`/`否`；空值输出空字符串。

## 7. 实现约束

1. 所有统计在 SQL 聚合 + 一次内存计算中完成：先 `SELECT ... WHERE user_id=? AND template_id=? AND deleted_at IS NULL AND created_at BETWEEN ? AND ?`，取出 `created_at, content, values_json, tags_json` 后一次性计算，**禁止 N+1 查询**。
2. 计算函数必须是**纯函数**（输入 memo 数组 + 字段定义 + 区间 → 输出 JSON），放在 `apps/api/src/domain/analytics.ts`，并导出可单测的 `computeTemplateInsights()` / `computeOverview()`。
3. 空数据必须返回**结构完整**的响应（各数组为 `[]`、计数为 0、`numeric` 为 `null`），不允许出现 `undefined` 或 `NaN`（`NaN` 一律转 `null`）——前端不应写空值防御分支。
4. 任何输出都必须 JSON 可序列化（无 `BigInt`、无 `Date` 对象、无循环引用）。

## 8. 项目经理裁决附录（v1 冻结，2026-10-18）

实现方在落地时遇到 13 处文档未写死或存在张力的判断点。以下为**最终裁决**，实现与测试以此为准；后续修改需同时更新本节。

| # | 判断点 | 裁决 |
|---|---|---|
| D1 | rating 无数据时的 `distribution` | 有数据时输出 `scale+1` 个桶（含计数为 0 的桶）；**完全无数据时输出 `[]`**（与 §7.3「空数组」一致） |
| D2 | `trend` 空桶数值 | 空桶输出 `count/sum/mean/min/max = 0`（便于前端直接连线，不产生断点） |
| D3 | `date.byMonth` 的桶粒度 | 保留字段名 `byMonth`（前端已按此渲染），**语义 = 该字段自身时间线，粒度跟随 `range.granularity`**；仅当粒度为 `month` 时才是 `YYYY-MM` |
| D4 | §5 `byTemplate` 中「无模板」项排序 | 非空模板按 `count` 降序，「无模板」项**恒排最后** |
| D5 | §5 `numericFields` 的 key 冲突 | 后出现的同名 key 改为 `${templateName}.${key}`，原 `key` 字段保留原值 |
| D6 | §6 CSV 中 select/multiselect 取值 | 导出**选项 label**（`\|` 连接）；boolean → `是`/`否`；number 原样 `String(n)`（不格式化、不四舍五入） |
| D7 | §6 CSV 多标签分隔符 | 与 multiselect 一致用 `\|` |
| D8 | §6 CSV 文件名日期 | 取区间 `to`（而非导出当天），格式 `<模板名>-YYYYMMDD.csv` |
| D9 | §5 `templateCount` | = 区间内**实际使用过的去重模板数**（不含「无模板」，不含未使用的模板） |
| D10 | `weekday`/`hourOfDay` 恒 N 项 vs 空数组 | 以 §3 为准：**恒定 7 项 / 24 项**，空数据也全零铺满 |
| D11 | 空数据时 `timeline`/`heatmap` | 以 §1 为准：**补齐整个区间**（全 0），不返回空数组 |
| D12 | `range.label` | 当 `to` 等于今天时输出「最近 N 天」，否则输出 `YYYY-MM-DD ~ YYYY-MM-DD`；即使调用方显式传入 `to` 也如此 |
| D13 | `InsightQuery.now` 注入 | 仅测试用途，**不暴露给 HTTP API** |

**数值精度约定（补充 §2）**：所有统计量（均值、分位数、标准差、占比、比率）在输出前四舍五入到 **6 位小数**（`roundTo(x, 6)`）；非有限数一律输出 `null`。前端展示时的格式化由前端负责，比较时请使用 `1e-5` 级容差。

**过滤「无模板」想法（补充 SPEC §8.3）**：`GET /api/memos?templateId=null`（字面量 `null`）表示筛选**未使用任何模板**的想法；`templateId` 省略表示不过滤。前端首页的「无模板」筛选走该参数（不在前端二次过滤，以免游标分页漏数据）。
