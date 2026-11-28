import CryptoKit
import Foundation
import Security

struct CaptureOperation: Codable, Identifiable, Equatable {
    let id: UUID
    let project: String
    let owner: UUID
    let content: String
    let board: UUID?
    let checklist: [String]
    var failure: String?

    init(project: String, owner: UUID, content: String, board: UUID?, checklist: String) throws {
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let items = checklist.components(separatedBy: .newlines).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }
        guard (!text.isEmpty || !items.isEmpty), text.utf16.count <= 240, items.count <= 24,
              items.allSatisfy({ $0.utf16.count <= 120 }) else { throw CaptureValidation.invalid }
        id = UUID()
        self.project = project
        self.owner = owner
        self.content = text
        self.board = board
        self.checklist = items
    }

    func belongs(to project: String, owner: UUID) -> Bool { self.project == project && self.owner == owner }
}

enum CaptureValidation: LocalizedError {
    case invalid
    var errorDescription: String? { "Enter up to 240 characters and up to 24 checklist items of 120 characters each." }
}

enum CaptureLink {
    static let capture = "/capture/native/ios"
    static let callback = "/auth/native/ios/callback"
    static let widget = URL(string: "wallflow-capture://compose")!

    static func matches(_ url: URL, host: String, path: String) -> Bool {
        guard !host.isEmpty, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return components.scheme == "https" && components.host?.lowercased() == host.lowercased()
            && components.port == nil && components.user == nil && components.password == nil && components.fragment == nil
            && components.percentEncodedPath == path
    }

    static func opensComposer(_ url: URL, host: String) -> Bool {
        url == widget || (matches(url, host: host, path: capture) && url.query == nil)
    }

    static func authorizationCode(_ url: URL, host: String) -> String? {
        guard matches(url, host: host, path: callback),
              let parameters = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              !parameters.contains(where: { $0.name == "error" || $0.name == "error_code" }),
              parameters.filter({ $0.name == "code" }).count == 1,
              let code = parameters.first(where: { $0.name == "code" })?.value,
              code.range(of: "^[A-Za-z0-9_-]{1,2048}$", options: .regularExpression) != nil else { return nil }
        return code
    }
}

enum PKCE {
    static func verifier() throws -> String {
        var bytes = Data(repeating: 0, count: 32)
        let result = bytes.withUnsafeMutableBytes { buffer in SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!) }
        guard result == errSecSuccess else { throw CocoaError(.featureUnsupported) }
        return encode(bytes)
    }

    static func challenge(_ verifier: String) -> String {
        encode(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    private static func encode(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

enum WidgetStatus: String {
    case signIn, ready, syncing, offline, failed, saved

    var label: String {
        switch self {
        case .signIn: "Sign in to capture"
        case .ready: "Ready for a note"
        case .syncing: "Syncing…"
        case .offline: "Pending connection"
        case .failed: "Open to retry"
        case .saved: "Last capture synced"
        }
    }

    func display(at now: Date, recorded: Date?) -> Self {
        if self == .syncing, let recorded, now.timeIntervalSince(recorded) >= 120 { return .offline }
        return self
    }
}
