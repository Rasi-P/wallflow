import Foundation

struct EnvironmentSettings {
    let project: URL
    let key: String
    let host: String

    init?() {
        let info = Bundle.main.infoDictionary ?? [:]
        guard let address = info["WallflowSupabaseURL"] as? String, var url = URLComponents(string: address),
              url.scheme == "https", let projectHost = url.host, Self.validHost(projectHost), url.port == nil, url.user == nil,
              url.password == nil, (url.path.isEmpty || url.path == "/"), url.query == nil, url.fragment == nil,
              let key = info["WallflowSupabaseKey"] as? String,
              key.range(of: "^sb_publishable_[A-Za-z0-9_-]+$", options: .regularExpression) != nil,
              let host = info["WallflowWebHost"] as? String, Self.validHost(host) else { return nil }
        url.path = ""
        guard let project = url.url else { return nil }
        self.project = project
        self.key = key
        self.host = host.lowercased()
    }

    private static func validHost(_ value: String) -> Bool {
        value.range(of: "^[A-Za-z0-9][A-Za-z0-9.-]*\\.[A-Za-z]{2,}$", options: .regularExpression) != nil
            && value != "unconfigured.example"
    }
}

struct Identity: Codable {
    let id: UUID
    let email: String?
}

struct Session: Codable {
    let project: String
    let identity: Identity
    let access: String
    let refresh: String
    let expires: Date
}

struct Workspace: Codable {
    struct Board: Codable, Identifiable {
        let id: UUID
        let name: String
    }
    let id: UUID
    let activeBoardId: UUID
    let boards: [Board]
}

private struct TokenResponse: Decodable {
    let user: Identity
    let access_token: String
    let refresh_token: String
    let expires_in: TimeInterval
    let token_type: String
}

private struct CaptureReceipt: Decodable {
    private struct Note: Decodable { let id: UUID }
    let present: Bool

    private enum CodingKeys: String, CodingKey { case note, noteId, revision }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let id = try values.decode(UUID.self, forKey: .noteId)
        let revision = try values.decode(String.self, forKey: .revision)
        guard values.contains(.note), revision.range(of: "^[0-9]+$", options: .regularExpression) != nil else {
            throw URLError(.cannotParseResponse)
        }
        let note = try values.decodeIfPresent(Note.self, forKey: .note)
        guard note == nil || note?.id == id else { throw URLError(.cannotParseResponse) }
        present = note != nil
    }
}

struct ServerFailure: Error {
    let status: Int
    let detail: String

    var isAuth: Bool { status == 401 || status == 403 || detail == "42501" }
    var retryable: Bool { status == 429 || status >= 500 }

    var captureMessage: String {
        switch detail {
        case "board_full": "This board has 60 active notes. Archive a note and retry."
        case "board_unavailable": "The selected board is unavailable."
        case "capture_conflict": "This capture request ID was already used."
        default: "WALLFLOW couldn’t sync this capture."
        }
    }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class Supabase {
    let settings: EnvironmentSettings
    private let network: URLSession

    init(_ settings: EnvironmentSettings) {
        self.settings = settings
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        network = URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    func authorization(_ verifier: String) -> URL {
        var url = URLComponents(url: settings.project.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
        url.queryItems = [
            .init(name: "provider", value: "google"), .init(name: "prompt", value: "select_account"),
            .init(name: "redirect_to", value: "https://\(settings.host)\(CaptureLink.callback)"),
            .init(name: "code_challenge", value: PKCE.challenge(verifier)), .init(name: "code_challenge_method", value: "s256")
        ]
        return url.url!
    }

    func exchange(_ code: String, verifier: String) async throws -> Session {
        try await token("pkce", body: ["auth_code": code, "code_verifier": verifier])
    }

    func refresh(_ current: Session) async throws -> Session {
        guard current.project == settings.project.absoluteString else { throw ServerFailure(status: 401, detail: "project") }
        do {
            let next = try await token("refresh_token", body: ["refresh_token": current.refresh])
            guard next.identity.id == current.identity.id else { throw ServerFailure(status: 401, detail: "identity") }
            return next
        } catch let error as ServerFailure where (400...403).contains(error.status) {
            throw ServerFailure(status: 401, detail: "expired")
        }
    }

    func verify(_ current: Session) async throws -> Workspace {
        let identity = try JSONDecoder().decode(Identity.self, from: await request("auth/v1/user", session: current))
        guard identity.id == current.identity.id else { throw ServerFailure(status: 401, detail: "identity") }
        let id = try JSONDecoder().decode(UUID.self, from: await rpc("initialize_wallflow_workspace", current))
        let preview = try await workspace(current)
        guard preview.id == id else { throw URLError(.cannotParseResponse) }
        return preview
    }

    func workspace(_ current: Session) async throws -> Workspace {
        let data = try await rpc("read_wallflow_workspace_preview", current)
        guard let preview = try JSONDecoder().decode(Workspace?.self, from: data) else {
            throw ServerFailure(status: 403, detail: "workspace_unavailable")
        }
        guard preview.boards.contains(where: { $0.id == preview.activeBoardId }) else { throw URLError(.cannotParseResponse) }
        return preview
    }

    func capture(_ operation: CaptureOperation, using current: Session) async throws -> Bool {
        guard operation.belongs(to: settings.project.absoluteString, owner: current.identity.id) else {
            throw ServerFailure(status: 401, detail: "identity")
        }
        var body: [String: Any] = [
            "operation_id": operation.id.uuidString, "content": operation.content,
            "board_id": operation.board.map { $0.uuidString as Any } ?? NSNull()
        ]
        if !operation.checklist.isEmpty { body["checklist"] = operation.checklist }
        let data = try await rpc("quick_capture_wallflow_note", current, body: body)
        return try JSONDecoder().decode(CaptureReceipt.self, from: data).present
    }

    func logout(_ current: Session) async {
        _ = try? await request("auth/v1/logout", query: [.init(name: "scope", value: "local")], session: current, body: [:])
    }

    private func token(_ grant: String, body: [String: Any]) async throws -> Session {
        let response = try await request("auth/v1/token", query: [.init(name: "grant_type", value: grant)], body: body)
        let value = try JSONDecoder().decode(TokenResponse.self, from: response)
        guard value.token_type.lowercased() == "bearer", value.expires_in > 0, !value.access_token.isEmpty, !value.refresh_token.isEmpty
        else { throw URLError(.cannotParseResponse) }
        return Session(project: settings.project.absoluteString, identity: value.user, access: value.access_token,
                       refresh: value.refresh_token, expires: Date().addingTimeInterval(value.expires_in))
    }

    private func rpc(_ name: String, _ session: Session, body: [String: Any] = [:]) async throws -> Data {
        var fields = body
        fields["expected_owner_id"] = session.identity.id.uuidString
        return try await request("rest/v1/rpc/\(name)", session: session, body: fields)
    }

    private func request(_ path: String, query: [URLQueryItem] = [], session: Session? = nil,
                         body: [String: Any]? = nil) async throws -> Data {
        guard session == nil || session?.project == settings.project.absoluteString else {
            throw ServerFailure(status: 401, detail: "project")
        }
        var url = URLComponents(url: settings.project.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { url.queryItems = query }
        var request = URLRequest(url: url.url!)
        request.setValue(settings.key, forHTTPHeaderField: "apikey")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let session { request.setValue("Bearer \(session.access)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await network.data(for: request)
        guard let result = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(result.statusCode) else {
            let error = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let detail = error?["details"] as? String ?? error?["code"] as? String ?? ""
            throw ServerFailure(status: result.statusCode, detail: detail)
        }
        guard data.count < 8_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
        return data
    }
}
