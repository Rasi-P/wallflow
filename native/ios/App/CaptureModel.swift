import AuthenticationServices
import Foundation
import Network
import SwiftUI
import WidgetKit

private struct BoardCache: Codable {
    let project: String
    let owner: UUID
    let workspace: Workspace
}

@MainActor
final class BrowserSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func start(at url: URL, host: String) async throws -> URL {
        defer { session = nil }
        return try await withCheckedThrowingContinuation { continuation in
            let browser = ASWebAuthenticationSession(url: url, callback: .https(host: host, path: CaptureLink.callback)) { url, error in
                if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: error ?? URLError(.cancelled)) }
            }
            browser.presentationContextProvider = self
            session = browser
            if !browser.start() {
                session = nil
                continuation.resume(throwing: URLError(.cannotLoadFromNetwork))
            }
        }
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}

@MainActor
final class CaptureModel: ObservableObject {
    private let backend: Supabase?
    private let monitor = NWPathMonitor()
    private var reachable: Bool?
    private var foreground = false
    private var vault: Vault?
    private var session: Session?
    private var auth = BrowserSignIn()

    @Published private(set) var account: Identity?
    @Published private(set) var workspace: Workspace?
    @Published private(set) var pending: [CaptureOperation] = []
    @Published private(set) var busy = false
    @Published private(set) var message = "Opening WALLFLOW…"
    @Published private(set) var focusRequest = 0

    var host: String { backend?.settings.host ?? "" }
    var configured: Bool { backend != nil }

    init() {
        backend = EnvironmentSettings().map(Supabase.init)
        monitor.pathUpdateHandler = { [weak self] path in
            let connected = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let changed = self.reachable != connected
                self.reachable = connected
                if changed && self.foreground { await self.sync() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "com.wallflow.capture.reachability"))
    }

    deinit { monitor.cancel() }

    func activated(_ active: Bool) {
        foreground = active
        if active { Task { await sync() } }
    }

    func open(_ url: URL) {
        if CaptureLink.opensComposer(url, host: host) { focusRequest += 1 }
    }

    func focusComposer() { focusRequest += 1 }

    func signIn() async {
        guard let backend, !busy, account == nil else { return }
        busy = true
        defer { busy = false }
        do {
            let vault = try storage()
            let verifier = try PKCE.verifier()
            let callback = try await auth.start(at: backend.authorization(verifier), host: host)
            guard let code = CaptureLink.authorizationCode(callback, host: host) else { throw URLError(.userAuthenticationRequired) }
            let next = try await backend.exchange(code, verifier: verifier)
            let boards = try await backend.verify(next)
            try vault.write(BoardCache(project: next.project, owner: next.identity.id, workspace: boards), to: "boards")
            try vault.saveSession(next)
            session = next
            show(next, workspace: boards, pending: try queue(vault, next), status: .ready, message: "Ready to capture.")
            focusRequest += 1
        } catch {
            show(nil, status: .signIn, message: "Sign-in didn’t finish. Continue with Google to try again.")
            return
        }
        busy = false
        await sync()
    }

    func add(content: String, board: UUID?, checklist: String) async -> Bool {
        guard !busy, let current = session else { return false }
        do {
            let vault = try storage()
            let operation = try CaptureOperation(project: current.project, owner: current.identity.id, content: content,
                                                 board: board ?? workspace?.activeBoardId, checklist: checklist)
            var entries = try vault.read("outbox", as: [CaptureOperation].self) ?? []
            entries.append(operation)
            try vault.write(entries, to: "outbox")
            show(current, workspace: workspace, pending: matching(entries, current),
                 status: reachable == false ? .offline : .syncing, message: "Capture saved on this device.")
            Task { await sync() }
            return true
        } catch {
            message = (error as? CaptureValidation)?.localizedDescription ?? "WALLFLOW couldn’t save this capture on the device."
            return false
        }
    }

    func change(_ id: UUID, retry: Bool) async {
        guard !busy, let current = session else { return }
        do {
            let vault = try storage()
            var entries = try vault.read("outbox", as: [CaptureOperation].self) ?? []
            guard let index = entries.firstIndex(where: { $0.id == id && $0.belongs(to: current.project, owner: current.identity.id) && $0.failure != nil }) else { return }
            if retry { entries[index].failure = nil }
            else { entries.remove(at: index) }
            try vault.write(entries, to: "outbox")
            await sync()
        } catch { message = "The pending capture couldn’t be changed. Try again." }
    }

    func signOut() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        let previous = session
        do {
            let vault = try storage()
            try vault.saveSession(nil)
            session = nil
            try? vault.clearBoards()
            show(nil, status: .signIn, message: "Signed out on this device.")
            if let previous, reachable != false { await backend?.logout(previous) }
        } catch { message = "Sign-out couldn’t clear this device’s session. Try again." }
    }

    func sync() async {
        guard !busy else { return }
        guard let backend else {
            show(nil, status: .signIn, message: "Configure the WALLFLOW web host and Supabase project to sign in.")
            return
        }

        busy = true
        defer { busy = false }
        do {
            let vault = try storage()
            guard var current = try vault.session(), current.project == backend.settings.project.absoluteString else {
                session = nil
                show(nil, status: .signIn, message: "Sign in with your WALLFLOW Google account.")
                return
            }
            session = current
            let cache = try vault.read("boards", as: BoardCache.self)
            let cached = cache?.project == current.project && cache?.owner == current.identity.id ? cache?.workspace : nil
            let entries = try queue(vault, current)
            if reachable == false {
                show(current, workspace: cached, pending: entries, status: .offline, message: "Offline. Captures stay here until WALLFLOW reconnects.")
                return
            }

            show(current, workspace: cached, pending: entries, status: .syncing, message: "Connecting to your workspace…")
            if current.expires.timeIntervalSinceNow < 60 { current = try await refresh(current, vault, backend) }
            let boards: Workspace
            do {
                boards = try await backend.workspace(current)
            } catch let error as ServerFailure where error.status == 401 {
                current = try await refresh(current, vault, backend)
                boards = try await backend.workspace(current)
            }
            try vault.write(BoardCache(project: current.project, owner: current.identity.id, workspace: boards), to: "boards")
            workspace = boards

            var all = try vault.read("outbox", as: [CaptureOperation].self) ?? []
            var result: String?
            for entry in matching(all, current) where entry.failure == nil {
                do {
                    if current.expires.timeIntervalSinceNow < 60 { current = try await refresh(current, vault, backend) }
                    let present = try await backend.capture(entry, using: current)
                    all.removeAll { $0.id == entry.id }
                    result = present ? "Note synced to your workspace." : "This capture was already saved and later deleted."
                } catch let error as ServerFailure where !error.retryable && !error.isAuth {
                    if let index = all.firstIndex(where: { $0.id == entry.id }) { all[index].failure = error.captureMessage }
                }
                try vault.write(all, to: "outbox")
            }
            let remaining = matching(all, current)
            let failed = remaining.contains { $0.failure != nil }
            let status: WidgetStatus = failed ? .failed : result == nil ? .ready : .saved
            show(current, workspace: boards, pending: remaining, status: status,
                 message: result ?? (failed ? "A capture needs attention." : "Ready to capture."))
        } catch let error as ServerFailure where error.isAuth {
            do {
                let vault = try storage()
                try vault.saveSession(nil)
                session = nil
                try? vault.clearBoards()
                show(nil, status: .signIn, message: "Sign in again. Pending captures stay with the original account.")
            } catch {
                session = nil
                show(nil, status: .failed, message: "WALLFLOW couldn’t clear this device’s session.")
            }
        } catch {
            let remaining = (try? session.flatMap { try queue(storage(), $0) }) ?? pending
            show(session, workspace: workspace, pending: remaining, status: .offline,
                 message: "Couldn’t complete sync. Pending captures stay on this device. Try again.")
        }
    }

    private func refresh(_ current: Session, _ vault: Vault, _ backend: Supabase) async throws -> Session {
        let updated = try await backend.refresh(current)
        try vault.saveSession(updated)
        session = updated
        return updated
    }

    private func storage() throws -> Vault {
        if let vault { return vault }
        let opened = try Vault()
        vault = opened
        return opened
    }

    private func matching(_ all: [CaptureOperation], _ current: Session) -> [CaptureOperation] {
        all.filter { $0.belongs(to: current.project, owner: current.identity.id) }
    }

    private func queue(_ vault: Vault, _ current: Session) throws -> [CaptureOperation] {
        matching(try vault.read("outbox", as: [CaptureOperation].self) ?? [], current)
    }

    private func show(_ current: Session?, workspace: Workspace? = nil, pending: [CaptureOperation] = [],
                      status: WidgetStatus, message: String) {
        account = current?.identity
        self.workspace = workspace
        self.pending = pending
        self.message = message
        if status == .syncing && pending.allSatisfy({ $0.failure != nil }) { return }
        if status == .ready && WidgetSnapshot.current() == .saved { return }
        if WidgetSnapshot.update(status) { WidgetCenter.shared.reloadTimelines(ofKind: WidgetSnapshot.kind) }
    }
}
