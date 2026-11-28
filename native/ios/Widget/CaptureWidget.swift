import SwiftUI
import WidgetKit

struct CaptureEntry: TimelineEntry {
    let date: Date
    let status: WidgetStatus
}

struct CaptureTimeline: TimelineProvider {
    func placeholder(in context: Context) -> CaptureEntry {
        CaptureEntry(date: .now, status: .ready)
    }

    func getSnapshot(in context: Context, completion: @escaping (CaptureEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : CaptureEntry(date: .now, status: WidgetSnapshot.current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CaptureEntry>) -> Void) {
        let now = Date()
        let status = WidgetSnapshot.current(at: now)
        let entry = CaptureEntry(date: now, status: status)
        // User actions refresh the timeline. An interrupted sync also gets a later status check.
        completion(Timeline(entries: [entry], policy: status == .syncing ? .after(now.addingTimeInterval(15 * 60)) : .never))
    }
}

struct CaptureWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    let entry: CaptureEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Label("WALLFLOW", systemImage: "note.text")
                .font(.caption.weight(.heavy)).tracking(0.7)
            Spacer(minLength: 0)
            Text(entry.status.label).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            if family == .systemMedium {
                Link(destination: CaptureLink.widget) { captureLabel }
            } else {
                captureLabel
            }
        }
        .widgetURL(CaptureLink.widget)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            if scheme == .dark { Color(red: 0.19, green: 0.15, blue: 0.13) }
            else { Color(red: 0.97, green: 0.92, blue: 0.85) }
        }
    }

    private var captureLabel: some View {
        Label("Quick Capture", systemImage: "bolt.fill")
            .font(.caption.weight(.bold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, minHeight: 36)
            .background(Color(red: 0.93, green: 0.48, blue: 0.36), in: RoundedRectangle(cornerRadius: 10))
            .foregroundStyle(Color(red: 0.16, green: 0.08, blue: 0.06))
    }
}

@main
struct CaptureWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: WidgetSnapshot.kind, provider: CaptureTimeline()) { entry in CaptureWidgetView(entry: entry) }
            .configurationDisplayName("WALLFLOW Quick Capture")
            .description("Open a new sticky note from your Home Screen.")
            .supportedFamilies([.systemSmall, .systemMedium])
    }
}
