# 浮墨增强版 iOS 客户端（SwiftUI）

原生 iOS 客户端，连接自建服务器（默认 `http://192.168.0.111:35080`）。

- 契约与设计：`docs/IOS.md`（冻结）
- 服务端 API：`docs/SPEC.md` §8；统计口径：`docs/ANALYTICS.md`
- 最低系统：iOS 17.0；iPhone 竖屏优先
- 零第三方依赖；Xcode 16+（本仓库在 Xcode 27.1 上验证），支持 synchronized folders（新增文件无需改 `project.pbxproj`）

## 用 Xcode 打开（开发/调试）

```bash
open apps/ios/FlomoEnhanced.xcodeproj
```

选择任意 iPhone 模拟器，⌘R 运行。

## 装到自己的 iPhone（免费 Apple ID）

1. iPhone 用数据线连到 Mac（首次连接需在手机上「信任此电脑」）。
2. Xcode → Settings → Accounts → `+` → Apple ID，登录你的 Apple ID（免费账号即可，无需开发者付费）。
3. 打开 `FlomoEnhanced.xcodeproj`，选中左上角 target `FlomoEnhanced` → Signing & Capabilities：
   - 勾选 `Automatically manage signing`；
   - Team 选择你的个人团队（`你的名字 (Personal Team)`）；
   - 如提示 bundle id 已被占用，把 `Bundle Identifier` 改成 `dev.<你的名字>.flomoenhanced`。
4. 顶部设备选择你的 iPhone，点 ▶️ Run。
5. 首次运行 iPhone 会提示「未受信任的开发者」：设置 → 通用 → VPN 与设备管理 → 信任你的 Apple ID 证书。
6. 首次请求服务器时 iPhone 会弹「本地网络」权限，选「允许」（否则连不上局域网服务器）。
7. App 内「设置 → 服务器地址」填你的服务器地址（例如 `http://192.168.0.111:35080`）。

> 免费 Apple ID 签名的 App **有效期 7 天**，过期后重新 Run 一次即可；数据都在服务器上，不丢。

## 命令行构建（无需签名，模拟器）

```bash
cd apps/ios
xcodebuild -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced \
  -configuration Debug -destination 'platform=iOS Simulator,name=iPhone Duo' \
  -derivedDataPath /tmp/flomo-dd CODE_SIGNING_ALLOWED=NO build
```

> 模拟器机型名以 `xcrun simctl list devices available` 为准（本仓库验证机为 `iPhone Duo`）。

## 验收测试（UI 自动化 + 截图）

```powershell
# 在 Windows 仓库根执行（同步到 Mac → 跑测试 → 回传截图到 .tmp-shots/）
powershell -File scripts\ios-build.ps1 -Test
powershell -File scripts\ios-build.ps1 -Test -Only test06InsightsTemplate   # 单跑某用例
```

测试登录账号为 `iosaccept / iosaccept123`，验收数据由 `node scripts/ios-seed.mjs` 生成
（1 个 12 字段模板 + 14 条跨 45 天的记录）。用例与截图清单见 `docs/IOS.md` §8。

## 工程结构

```
FlomoEnhanced/
├── App/        # 入口、根视图、Tab
├── Core/       # 网络层（APIClient）、DTO 模型、日期/字段/标签工具、登录态、主题
└── Features/   # Auth / Memos / Templates / Insights / Settings
Support/Info.plist   # ATS 例外（局域网明文 HTTP）与本地网络权限说明
```

> `FlomoEnhanced/` 是 Xcode synchronized folder：在其中新增 `.swift` 文件会自动加入编译，无需修改工程文件。
