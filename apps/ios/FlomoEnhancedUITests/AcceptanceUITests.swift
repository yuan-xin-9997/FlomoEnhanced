//
//  AcceptanceUITests.swift
//  浮墨增强版 iOS —— PM 验收用 UI 测试
//
//  通过启动参数（-qaUsername / -qaPassword / -qaLogout / -qaTab）驱动调试钩子，
//  真实点击遍历各页面并截图（附件形式写入 xcresult，可用
//  `xcrun xcresulttool export attachments` 导出）。
//
//  注意：iOS 27 模拟器（iPhone Duo）把 TabView 渲染为右侧竖排浮动栏，
//  XCUITest 的 app.tabBars 常常查不到；因此切换 Tab 时优先尝试真实点击，
//  失败则带 -qaTab 重新启动直达目标页（页面、数据与交互仍然真实）。
//
//  运行：
//    xcodebuild test -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced \
//      -destination 'platform=iOS Simulator,name=iPhone Duo' \
//      -derivedDataPath /tmp/flomo-dd -resultBundlePath /tmp/flomo-uitest.xcresult
//

import XCTest
import UIKit

final class AcceptanceUITests: XCTestCase {
    private let username = "iosaccept"
    private let password = "iosaccept123"

    // Tab 序号：与 MainTabView 一致
    private let memoTab = 0
    private let insightsTab = 1
    private let templatesTab = 2
    private let settingsTab = 3

    override func setUpWithError() throws {
        continueAfterFailure = true
    }

    // MARK: - 工具

    private func launchArguments(signedIn: Bool, tab: Int?) -> [String] {
        var arguments: [String] = []
        if signedIn {
            arguments += ["-qaUsername", username, "-qaPassword", password]
        } else {
            arguments += ["-qaLogout", "1"]
        }
        if let tab {
            arguments += ["-qaTab", String(tab)]
        }
        return arguments
    }

    private func start(signedIn: Bool, tab: Int? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = launchArguments(signedIn: signedIn, tab: tab)
        app.launch()
        return app
    }

    private func relaunch(_ app: XCUIApplication, signedIn: Bool, tab: Int? = nil) {
        app.terminate()
        app.launchArguments = launchArguments(signedIn: signedIn, tab: tab)
        app.launch()
    }

    private func attach(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @discardableResult
    private func waitFor(_ element: XCUIElement, timeout: TimeInterval = 20) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if element.exists { return true }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return element.exists
    }

    @discardableResult
    private func waitForAny(_ elements: [XCUIElement], timeout: TimeInterval = 20) -> XCUIElement? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for element in elements where element.exists {
                return element
            }
            Thread.sleep(forTimeInterval: 0.3)
        }
        return nil
    }

    private func findButton(containing text: String, in app: XCUIApplication) -> XCUIElement? {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let matches = app.buttons.containing(predicate)
        if matches.count > 0 { return matches.element(boundBy: 0) }
        let direct = app.buttons.matching(predicate)
        if direct.count > 0 { return direct.element(boundBy: 0) }
        return nil
    }

    /// Picker 菜单项 / 列表项：按 label 包含关系依次查 buttons、menuItems、staticTexts。
    private func findLabeledElement(containing text: String, in app: XCUIApplication) -> XCUIElement? {
        let predicate = NSPredicate(format: "label CONTAINS %@", text)
        let queries = [
            app.buttons.matching(predicate),
            app.menuItems.matching(predicate),
            app.staticTexts.matching(predicate),
        ]
        for query in queries where query.count > 0 {
            return query.element(boundBy: 0)
        }
        return nil
    }

    /// 目标页是否就绪：以导航栏标题为准（记录 / 洞察 / 模板 / 设置）。
    private func screenReady(_ app: XCUIApplication, title: String) -> Bool {
        app.navigationBars[title].exists
    }

    /// 真实点击 Tab 按钮（iOS 27 竖排 Tab 栏的可访问性层级可能是 buttons 而非 tabBars）。
    private func tapTabButton(_ app: XCUIApplication, _ title: String) -> Bool {
        let candidates: [XCUIElement] = [
            app.tabBars.buttons[title],
            app.buttons[title],
            app.otherElements[title],
        ]
        for element in candidates where element.exists {
            element.tap()
            Thread.sleep(forTimeInterval: 1.5)
            return true
        }
        return false
    }

    /// 确保当前位于指定 Tab：先尝试真实点击，失败则带 -qaTab 重新启动直达。
    @discardableResult
    private func ensureTab(_ app: XCUIApplication, _ title: String, tab: Int) -> Bool {
        if screenReady(app, title: title) { return true }
        if tapTabButton(app, title), waitFor(app.navigationBars[title], timeout: 15) {
            return true
        }
        relaunch(app, signedIn: true, tab: tab)
        return waitFor(app.navigationBars[title], timeout: 60)
    }

    /// 通过系统编辑菜单粘贴文本；自动处理 iOS 16+ 的跨 App 粘贴授权弹窗。
    /// 先点击聚焦再长按，键盘弹出后编辑菜单更稳定。
    private func paste(_ text: String, into element: XCUIElement, app: XCUIApplication) -> Bool {
        UIPasteboard.general.string = text
        for _ in 0..<2 {
            element.tap()
            Thread.sleep(forTimeInterval: 1.0)
            element.press(forDuration: 1.2)
            if let pasteItem = waitForAny(pasteCandidates(in: app), timeout: 5) {
                pasteItem.tap()
                allowPasteIfNeeded(app)
                return true
            }
        }
        return false
    }

    /// 编辑菜单里的「粘贴」项（中英文都尝试；iOS 27 的菜单层级可能是 menuItems 或 buttons）
    private func pasteCandidates(in app: XCUIApplication) -> [XCUIElement] {
        var items: [XCUIElement] = []
        for label in ["粘贴", "Paste"] {
            items.append(app.menuItems[label])
            items.append(app.buttons[label])
            items.append(app.staticTexts[label])
            items.append(app.menuItems.matching(NSPredicate(format: "label CONTAINS %@", label)).firstMatch)
        }
        return items
    }

    /// 处理系统「允许粘贴」授权弹窗（可能由 SpringBoard 呈现）
    private func allowPasteIfNeeded(_ app: XCUIApplication) {
        Thread.sleep(forTimeInterval: 1.2)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for host in [app, springboard] {
            let alert = host.alerts.firstMatch
            guard alert.exists else { continue }
            let buttons = alert.buttons.allElementsBoundByIndex
            let allow = buttons.first {
                ($0.label.contains("允许") && !$0.label.contains("不允许"))
                    || ($0.label.contains("Allow") && !$0.label.contains("Don't"))
            }
            (allow ?? buttons.last)?.tap()
            Thread.sleep(forTimeInterval: 0.8)
            break
        }
    }

    /// 打开「新建记录」→ 选用「iOS 验收模板」→ 切到文本模式；返回文本编辑器元素
    private func openMemoTextMode(_ app: XCUIApplication) -> XCUIElement? {
        let entry = waitForAny([
            app.buttons["新建记录"],
            app.buttons["addMemo"],
        ], timeout: 8) ?? findButton(containing: "新建", in: app)
        guard let entry else {
            XCTFail("未找到「新建记录」入口按钮")
            return nil
        }
        entry.tap()
        Thread.sleep(forTimeInterval: 2.5)

        var picker = app.buttons["memoTemplatePicker"]
        if !waitFor(picker, timeout: 6), let fallback = findLabeledElement(containing: "不使用模板", in: app) {
            picker = fallback
        }
        guard waitFor(picker, timeout: 4) else {
            XCTFail("未找到模板 Picker（memoTemplatePicker）")
            return nil
        }
        picker.tap()
        Thread.sleep(forTimeInterval: 1.5)
        guard let templateOption = findLabeledElement(containing: "验收模板", in: app) else {
            XCTFail("模板菜单里未出现「iOS 验收模板」")
            return nil
        }
        templateOption.tap()
        Thread.sleep(forTimeInterval: 2.0)

        let textModeButton = app.segmentedControls["memoFieldModePicker"].buttons["文本模式"].exists
            ? app.segmentedControls["memoFieldModePicker"].buttons["文本模式"]
            : app.buttons["文本模式"]
        guard waitFor(textModeButton, timeout: 10) else {
            XCTFail("未找到「文本模式」切换")
            return nil
        }
        textModeButton.tap()
        Thread.sleep(forTimeInterval: 1.5)

        let editor = app.textViews["memoTextFieldsInput"]
        guard waitFor(editor, timeout: 10) else {
            XCTFail("文本模式编辑器未出现")
            return nil
        }
        return editor
    }

    // MARK: - 用例

    /// 未登录：登录页渲染
    func test01LoginScreen() {
        let app = start(signedIn: false)
        let title = waitForAny([app.staticTexts["浮墨增强版"], app.textFields.firstMatch], timeout: 30)
        XCTAssertNotNil(title, "登录页未渲染出「浮墨增强版」或输入框")
        Thread.sleep(forTimeInterval: 1.0)
        attach("01-登录页")
    }

    /// 已登录：四个 Tab 全部可切换并截图
    func test02MainTabs() {
        let app = start(signedIn: true, tab: memoTab)
        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 60), "记录页未出现")
        Thread.sleep(forTimeInterval: 3.0)
        attach("02-记录列表")

        XCTAssertTrue(ensureTab(app, "洞察", tab: insightsTab), "洞察页未出现")
        Thread.sleep(forTimeInterval: 6.0)
        attach("03-洞察")

        XCTAssertTrue(ensureTab(app, "模板", tab: templatesTab), "模板页未出现")
        Thread.sleep(forTimeInterval: 3.0)
        attach("04-模板列表")

        XCTAssertTrue(ensureTab(app, "设置", tab: settingsTab), "设置页未出现")
        Thread.sleep(forTimeInterval: 3.0)
        attach("05-设置")
    }

    /// 记录页：打开新建记录弹窗并截图
    func test03MemoEditor() {
        let app = start(signedIn: true, tab: memoTab)
        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 60), "记录页未出现")
        Thread.sleep(forTimeInterval: 3.0)

        let entry = waitForAny([
            app.buttons["新建记录"],
            app.buttons["addMemo"],
        ], timeout: 8)

        var opened = false
        if let entry {
            entry.tap()
            opened = true
        } else if let loose = findButton(containing: "新建", in: app) {
            loose.tap()
            opened = true
        }

        XCTAssertTrue(opened, "未找到「新建记录」入口按钮（请检查按钮可访问性标识）")
        Thread.sleep(forTimeInterval: 3.0)
        attach("06-新建记录弹窗")

        // 关闭弹窗
        if app.buttons["取消"].exists {
            app.buttons["取消"].tap()
        } else {
            app.swipeDown()
        }
        Thread.sleep(forTimeInterval: 1.0)
    }

    /// 模板页：进入模板编辑器（点击第一张卡片）并截图
    func test04TemplateEditor() {
        let app = start(signedIn: true, tab: templatesTab)
        XCTAssertTrue(waitFor(app.navigationBars["模板"], timeout: 60), "模板页未出现")
        Thread.sleep(forTimeInterval: 3.0)

        var opened = false
        if let cardName = waitForAny([app.staticTexts["iOS 验收模板"]], timeout: 6) {
            cardName.tap()
            opened = true
        } else if app.buttons["新建模板"].exists {
            app.buttons["新建模板"].tap()
            opened = true
        }
        XCTAssertTrue(opened, "未找到模板卡片或「新建模板」按钮")
        Thread.sleep(forTimeInterval: 3.0)
        attach("07-模板编辑器")
    }

    /// 模板页：导入弹窗 + 导出分享面板
    func test08TemplateImportExport() {
        let app = start(signedIn: true, tab: templatesTab)
        XCTAssertTrue(waitFor(app.navigationBars["模板"], timeout: 60), "模板页未出现")
        Thread.sleep(forTimeInterval: 3.0)

        // 导入模板（.fileImporter 选择文件前的弹窗）
        let importButton = app.buttons["导入模板"]
        XCTAssertTrue(waitFor(importButton, timeout: 10), "未找到「导入模板」按钮")
        importButton.tap()
        Thread.sleep(forTimeInterval: 2.5)
        attach("14-模板导入")

        // 关闭导入弹窗（按钮文案是「关闭」）
        if app.buttons["关闭"].exists {
            app.buttons["关闭"].tap()
        } else if app.buttons["取消"].exists {
            app.buttons["取消"].tap()
        } else {
            app.swipeDown()
        }
        XCTAssertTrue(waitFor(app.staticTexts["选择模板文件"], timeout: 5) == false, "导入弹窗未关闭")
        Thread.sleep(forTimeInterval: 1.5)

        // 导出模板（全部）→ 系统分享面板
        let exportButton = app.buttons["导出模板"]
        XCTAssertTrue(waitFor(exportButton, timeout: 10), "未找到「导出模板」按钮")
        exportButton.tap()
        Thread.sleep(forTimeInterval: 6.0)
        attach("15-模板导出（分享面板）")
    }

    /// 设置页：账号信息与健康检查
    func test05Settings() {
        let app = start(signedIn: true, tab: settingsTab)
        XCTAssertTrue(waitFor(app.navigationBars["设置"], timeout: 60), "设置页未出现")
        Thread.sleep(forTimeInterval: 5.0)
        attach("08-设置详情")

        app.swipeUp()
        Thread.sleep(forTimeInterval: 1.5)
        attach("08b-设置详情-下半")
    }

    /// 洞察页：选择模板后查看字段统计（含图表）
    func test06InsightsTemplate() {
        let app = start(signedIn: true, tab: insightsTab)
        XCTAssertTrue(waitFor(app.navigationBars["洞察"], timeout: 60), "洞察页未出现")
        Thread.sleep(forTimeInterval: 8.0)
        attach("09-全局概览")

        // 通过模板 Picker 选择「iOS 验收模板」
        let picker = app.buttons["insightsTemplatePicker"]
        XCTAssertTrue(waitFor(picker, timeout: 10), "未找到模板 Picker（insightsTemplatePicker）")
        picker.tap()
        Thread.sleep(forTimeInterval: 2.0)

        guard let option = findLabeledElement(containing: "验收模板", in: app) else {
            XCTFail("Picker 菜单里未出现「iOS 验收模板」选项")
            return
        }
        option.tap()
        Thread.sleep(forTimeInterval: 8.0)
        attach("10-模板洞察")

        app.swipeUp()
        app.swipeUp()
        Thread.sleep(forTimeInterval: 2.5)
        attach("11-模板洞察-字段统计")

        app.swipeUp()
        app.swipeUp()
        Thread.sleep(forTimeInterval: 2.5)
        attach("11b-模板洞察-字段统计-更多")
    }

    /// 真实登录流程：在登录页输入用户名/密码并提交
    func test07ManualLogin() {        let app = start(signedIn: false)
        XCTAssertTrue(waitFor(app.textFields.firstMatch, timeout: 30), "登录页输入框未出现")

        let usernameField = app.textFields.element(boundBy: 0)
        usernameField.tap()
        usernameField.typeText(username)

        let secureField = app.secureTextFields.element(boundBy: 0)
        XCTAssertTrue(secureField.exists, "登录页缺少密码输入框")
        secureField.tap()
        secureField.typeText(password)
        attach("12-登录页已填表")

        // 点击登录/注册提交按钮（优先「登录」）
        let submit = findButton(containing: "登录", in: app) ?? findButton(containing: "注册", in: app)
        XCTAssertNotNil(submit, "未找到登录提交按钮")
        submit?.tap()

        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 60), "登录后未进入主界面")
        Thread.sleep(forTimeInterval: 3.0)
        attach("13-登录成功")
    }

    /// 记录页：文本模式粘贴无法识别的行 → 逐项报错 + 保存被阻断
    func test09MemoTextModeErrors() {
        let app = start(signedIn: true, tab: memoTab)
        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 60), "记录页未出现")
        Thread.sleep(forTimeInterval: 3.0)

        guard let editor = openMemoTextMode(app) else { return }
        attach("16-文本模式-编辑器")

        let invalidText = "哈哈哈哈：哈哈哈哈哈"
        XCTAssertTrue(paste(invalidText, into: editor, app: app), "粘贴失败")
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(
            waitFor(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "无法识别")).firstMatch,
                timeout: 8
            ),
            "未出现未识别行的错误提示"
        )
        attach("17-文本模式-解析报错")

        app.segmentedControls["memoFieldModePicker"].buttons["模板模式"].tap()
        app.buttons["保存"].tap()
        XCTAssertTrue(
            waitFor(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "请切回文本模式修正")).firstMatch, timeout: 8),
            "切到模板模式后，非法文本仍应阻断保存"
        )
        app.segmentedControls["memoFieldModePicker"].buttons["文本模式"].tap()
        XCTAssertEqual(editor.value as? String, invalidText, "模式切换丢失了原始文本")

        app.buttons["保存"].tap()
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertTrue(
            waitFor(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "文本识别未通过")).firstMatch,
                timeout: 8
            ),
            "存在未识别行时保存未被阻断"
        )
        attach("18-文本模式-保存阻断")

        app.buttons["取消"].tap()
        Thread.sleep(forTimeInterval: 1.0)
    }

    /// 记录页：文本模式粘贴完整字段文本 → 全部识别 → 切回模板模式回填 → 保存成功
    func test10MemoTextModeSave() {
        let app = start(signedIn: true, tab: memoTab)
        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 60), "记录页未出现")
        Thread.sleep(forTimeInterval: 3.0)

        guard let editor = openMemoTextMode(app) else { return }

        let goodText = """
        标题：iOS 文本模式验收
        体重(kg)：70.5
        金额：¥88.50
        完成度：50%
        心情：3
        日期：2026-10-19
        时间点：2026-10-19 22:30+08:00
        餐次：午餐
        运动：跑步、游泳
        已完成：是
        参考链接：https://example.com
        详情：第一行
        第二行
        """
        XCTAssertTrue(paste(goodText, into: editor, app: app), "粘贴失败")
        Thread.sleep(forTimeInterval: 2.0)
        XCTAssertTrue(
            waitFor(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "已识别 12 个字段")).firstMatch,
                timeout: 8
            ),
            "未提示识别到 12 个字段"
        )
        attach("19-文本模式-识别成功")

        // 切回模板模式：字段值回填
        let templateModeButton = app.segmentedControls["memoFieldModePicker"].buttons["模板模式"].exists
            ? app.segmentedControls["memoFieldModePicker"].buttons["模板模式"]
            : app.buttons["模板模式"]
        XCTAssertTrue(waitFor(templateModeButton, timeout: 8), "未找到「模板模式」切换")
        templateModeButton.tap()
        Thread.sleep(forTimeInterval: 1.5)
        let titleField = app.textFields.matching(
            NSPredicate(format: "value == %@", "iOS 文本模式验收")
        ).firstMatch
        XCTAssertTrue(waitFor(titleField, timeout: 8), "切回模板模式后标题未回填")
        attach("20-文本模式-切回模板模式")

        app.segmentedControls["memoFieldModePicker"].buttons["文本模式"].tap()
        XCTAssertEqual(app.textViews["memoTextFieldsInput"].value as? String, goodText, "未改字段时，合法原文也应完整保留")
        templateModeButton.tap()

        // 保存 → 回到记录页，卡片出现新记录
        app.buttons["保存"].tap()
        XCTAssertTrue(waitFor(app.navigationBars["记录"], timeout: 30), "保存后未回到记录页")
        Thread.sleep(forTimeInterval: 3.0)
        XCTAssertTrue(
            waitFor(
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "iOS 文本模式验收")).firstMatch,
                timeout: 15
            ),
            "记录列表未出现新记录"
        )
        attach("21-文本模式-保存成功")
    }
}
