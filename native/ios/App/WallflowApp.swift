import AppIntents
import SwiftUI

struct OpenQuickCapture: AppIntent {
    static var title: LocalizedStringResource = "Open WALLFLOW Quick Capture"
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        NotificationCenter.default.post(name: .wallflowCaptureRequested, object: nil)
        return .result()
    }
}

extension Notification.Name {
    static let wallflowCaptureRequested = Notification.Name("com.wallflow.capture.compose")
}

struct WallflowShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: OpenQuickCapture(), phrases: ["Open Quick Capture in \(.applicationName)"],
                    shortTitle: "Quick Capture", systemImageName: "bolt.fill")
    }
}

@main
struct WallflowApp: App {
    @StateObject private var model = CaptureModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            CaptureScreen(model: model)
                .onOpenURL(perform: model.open)
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) {
                    if let url = $0.webpageURL { model.open(url) }
                }
                .onReceive(NotificationCenter.default.publisher(for: .wallflowCaptureRequested)) { _ in model.focusComposer() }
                .onChange(of: phase, initial: true) { _, phase in model.activated(phase == .active) }
        }
    }
}

private struct CaptureScreen: View {
    @ObservedObject var model: CaptureModel
    @State private var note = ""
    @State private var checklist = ""
    @State private var showsChecklist = false
    @State private var target: UUID?
    @State private var confirmsSignOut = false
    @State private var discard: CaptureOperation?
    @FocusState private var typing: Bool
    private let coral = Color(red: 0.92, green: 0.47, blue: 0.37)

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("WALLFLOW", systemImage: "note.text").font(.footnote.weight(.heavy))
                            .tracking(1.5).foregroundStyle(.secondary)
                        Text("Quick Capture").font(.system(.largeTitle, design: .rounded, weight: .bold))
                        HStack(alignment: .top) {
                            if model.busy { ProgressView().controlSize(.small) }
                            Text(model.message).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 10)
                }
                if model.account != nil {
                    composer
                    if !model.pending.isEmpty { outbox }
                }
                if model.configured {
                    Section {
                        if let account = model.account {
                            if let email = account.email { Text(email).textSelection(.enabled) }
                            Button("Sign out", role: .destructive) { confirmsSignOut = true }
                                .disabled(model.busy)
                        } else {
                            Button("Continue with Google") { Task { await model.signIn() } }
                                .disabled(model.busy)
                        }
                        if let url = URL(string: "https://\(model.host)/app/") {
                            Link(destination: url) { Label("Open workspace", systemImage: "arrow.up.right") }
                        }
                    }
                }
            }
            .navigationTitle("WALLFLOW")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                if model.account != nil {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Sync now", systemImage: "arrow.clockwise") { Task { await model.sync() } }
                            .disabled(model.busy)
                    }
                }
            }
            .onChange(of: model.account?.id) { _, _ in
                note = ""
                checklist = ""
                target = nil
                showsChecklist = false
                if model.account != nil && model.focusRequest > 0 { typing = true }
            }
            .onChange(of: model.focusRequest) { _, _ in if model.account != nil { typing = true } }
            .onChange(of: model.workspace?.boards.map(\.id)) { _, ids in
                if let target, ids?.contains(target) != true { self.target = nil }
            }
            .confirmationDialog("Sign out on this device?", isPresented: $confirmsSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
            .confirmationDialog("Discard this failed capture?", isPresented: Binding(get: { discard != nil }, set: { if !$0 { discard = nil } }),
                                titleVisibility: .visible, presenting: discard) { entry in
                Button("Discard", role: .destructive) { Task { await model.change(entry.id, retry: false) } }
            }
        }
    }

    private var composer: some View {
        Section("New note") {
            Picker("Board", selection: $target) {
                let active = model.workspace?.boards.first { $0.id == model.workspace?.activeBoardId }?.name
                Text(active.map { "Current board · \($0)" } ?? "Active board at sync").tag(nil as UUID?)
                ForEach(model.workspace?.boards ?? []) { Text($0.name).tag(Optional($0.id)) }
            }
            TextField("What’s on your mind?", text: $note, axis: .vertical)
                .lineLimit(3...6)
                .focused($typing)
                .accessibilityLabel("Note")
            Text("\(note.utf16.count)/240").font(.caption).foregroundStyle(.secondary)
            DisclosureGroup("Checklist", isExpanded: $showsChecklist) {
                TextField("One checklist item per line", text: $checklist, axis: .vertical)
                    .lineLimit(2...5).accessibilityLabel("Checklist items")
            }
            Button {
                Task {
                    if await model.add(content: note, board: target, checklist: showsChecklist ? checklist : "") {
                        note = ""
                        checklist = ""
                        typing = false
                    }
                }
            } label: {
                Label("Capture note", systemImage: "paperplane.fill")
                    .font(.headline).frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.borderedProminent).tint(coral).foregroundStyle(Color(red: 0.17, green: 0.08, blue: 0.05))
            .disabled(model.busy || note.utf16.count > 240 || (note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && (!showsChecklist || checklist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)))
        }
    }

    private var outbox: some View {
        Section("Capture outbox") {
            ForEach(model.pending) { entry in
                VStack(alignment: .leading, spacing: 6) {
                    Text(entry.content.isEmpty ? entry.checklist.first ?? "Checklist note" : entry.content).lineLimit(3)
                    Text(entry.failure ?? "Pending sync").font(.caption).foregroundStyle(.secondary)
                    if entry.failure != nil {
                        HStack {
                            Button("Retry") { Task { await model.change(entry.id, retry: true) } }
                            Button("Discard", role: .destructive) { discard = entry }
                        }.buttonStyle(.borderless).disabled(model.busy)
                    }
                }
            }
        }
    }
}
