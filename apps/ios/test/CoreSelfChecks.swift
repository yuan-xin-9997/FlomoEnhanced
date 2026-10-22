import Foundation

@main
struct CoreSelfChecks {
    static func main() async throws {
        checkTextRoundTrips()
        try await checkCancellation()
        await checkOfflineLogout()
        print("PASS: iOS text round trips, request cancellation and offline logout")
    }

    private static func roundTrip(_ fields: [FieldDefinition], _ values: [String: FieldValue]) {
        let text = MemoTextCodec.format(fields: fields, values: values)
        let parsed = MemoTextDraft.parse(fields: fields, text: text)
        precondition(parsed.ok, "Could not parse serialized text: \(parsed.errors), \(parsed.lineErrors)")
        precondition(parsed.values == values, "Text mode changed field values: \(text)")
    }

    private static func checkTextRoundTrips() {
        for type in [FieldType.number, .currency, .percent] {
            var field = FieldDefinition(key: "n", label: "数值", type: type)
            field.precision = 0
            roundTrip([field], ["n": .number(1.23456789)])
            roundTrip([field], ["n": .number(1e-20)])
        }
        let options = [
            FieldOption(value: "a", label: "重复"),
            FieldOption(value: "b", label: "重复"),
            FieldOption(value: "c", label: "a"),
            FieldOption(value: "x,y", label: "含、分隔符"),
            FieldOption(value: "line\nbreak", label: "跨\n行"),
            FieldOption(value: "\"quoted\"", label: "\"quoted label\""),
        ]
        var select = FieldDefinition(key: "s", label: "选择", type: .select)
        select.options = options
        for option in options {
            roundTrip([select], ["s": .string(option.value)])
        }
        precondition(!MemoTextCodec.parse(fields: [select], text: "选择：重复").ok)
        var multi = select
        multi.type = .multiselect
        roundTrip([multi], ["s": .strings(options.map(\.value))])
        precondition(!MemoTextCodec.parse(fields: [multi], text: "选择：重复").ok)
        let fields = [
            FieldDefinition(key: "title", label: "正文", type: .text),
            FieldDefinition(key: "body", label: "title", type: .longtext),
        ]
        roundTrip(fields, ["title": .string("标题"), "body": .string("第一行\ntitle：正文中的内容\n末行")])
        roundTrip(fields, ["title": .string("第一行\n第二行"), "body": .string("\"保留引号\"")])
        roundTrip(fields, ["title": .string("\"引号\""), "body": .string("第一行\r\n第二行")])
        let quoted = MemoTextDraft.parse(fields: fields, text: MemoTextCodec.format(fields: fields, values: ["title": .string("  \"引号\"")]))
        precondition(quoted.ok && quoted.values["title"] == .string("\"引号\""))
        let unknown = MemoTextDraft.parse(fields: fields, text: "哈哈哈哈：哈哈哈哈哈")
        precondition(!unknown.ok && unknown.lineErrors.count == 1)
        print("PASS: numeric precision, ambiguous options, JSON values and field-like text")
    }

    private static func isCancellation(_ error: Error) -> Bool {
        error is CancellationError || (error as? URLError)?.code == .cancelled
    }

    private static func checkCancellation() async throws {
        let client = APIClient(baseURL: URL(string: "http://127.0.0.1:1")!)
        let request = Task { try await client.me() }
        request.cancel()
        do {
            _ = try await request.value
            preconditionFailure("A cancelled request succeeded")
        } catch {
            precondition(isCancellation(error), "Cancellation became a normal API error: \(error)")
        }
        let download = Task { try await client.download("file", fallbackName: "test.json") }
        download.cancel()
        do {
            _ = try await download.value
            preconditionFailure("A cancelled download succeeded")
        } catch {
            precondition(isCancellation(error), "Download cancellation became a normal API error: \(error)")
        }
    }

    private static func checkOfflineLogout() async {
        let host = "flomo-selfcheck-\(UUID().uuidString.lowercased()).invalid"
        let url = URL(string: "http://\(host)")!
        let otherURL = URL(string: "http://other-\(host)")!
        let storage = HTTPCookieStorage.shared
        func cookie(_ name: String, host: String) -> HTTPCookie {
            HTTPCookie(properties: [.domain: host, .path: "/", .name: name, .value: "selfcheck", .expires: Date().addingTimeInterval(3600)])!
        }
        let sessionCookie = cookie("flomo_session", host: host)
        let unrelated = cookie("keep", host: host)
        let otherServer = cookie("flomo_session", host: otherURL.host!)
        for cookie in [sessionCookie, unrelated, otherServer] { storage.setCookie(cookie) }
        defer { for cookie in [sessionCookie, unrelated, otherServer] { storage.deleteCookie(cookie) } }
        precondition(storage.cookies(for: url)?.contains(sessionCookie) == true)
        let logout = Task { try await APIClient(baseURL: url).logout() }
        logout.cancel()
        _ = try? await logout.value
        precondition(storage.cookies(for: url)?.contains(where: { $0.name == "flomo_session" }) != true)
        precondition(storage.cookies(for: url)?.contains(unrelated) == true)
        precondition(storage.cookies(for: otherURL)?.contains(otherServer) == true)
    }
}
