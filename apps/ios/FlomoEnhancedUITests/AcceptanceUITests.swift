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
    func test07ManualLogin() {
        let app = start(signedIn: false)
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
}
