import Foundation

enum WidgetSnapshot {
    static let kind = "WallflowQuickCapture"
    private static var defaults: UserDefaults? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "WallflowAppGroup") as? String, group.hasPrefix("group."),
              FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) != nil else { return nil }
        return UserDefaults(suiteName: group)
    }

    static func current(at date: Date = Date()) -> WidgetStatus {
        guard let value = defaults?.dictionary(forKey: "capture-status"),
              let raw = value["status"] as? String, let status = WidgetStatus(rawValue: raw) else { return .signIn }
        return status.display(at: date, recorded: value["at"] as? Date)
    }

    @discardableResult
    static func update(_ status: WidgetStatus) -> Bool {
        guard let defaults, current() != status else { return false }
        defaults.set(["status": status.rawValue, "at": Date()], forKey: "capture-status")
        return true
    }
}
