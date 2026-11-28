import Foundation
import XCTest
@testable import WallflowCore

final class CaptureContractTests: XCTestCase {
    func testPKCE() throws {
        XCTAssertEqual(PKCE.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
        XCTAssertNotEqual(try PKCE.verifier(), try PKCE.verifier())
    }

    func testExactLinkAndCallback() {
        let host = "wall.example"
        XCTAssertTrue(CaptureLink.opensComposer(CaptureLink.widget, host: host))
        XCTAssertTrue(CaptureLink.opensComposer(URL(string: "https://wall.example\(CaptureLink.capture)")!, host: host))
        for suffix in ["?code=abc", "#token", "/"] {
            XCTAssertFalse(CaptureLink.opensComposer(URL(string: "https://wall.example\(CaptureLink.capture)\(suffix)")!, host: host))
        }
        XCTAssertEqual(CaptureLink.authorizationCode(URL(string: "https://wall.example\(CaptureLink.callback)?code=abc")!, host: host), "abc")
        for prefix in ["http://wall.example", "https://evil.wall.example", "https://wall.example:444", "https://name@wall.example"] {
            XCTAssertNil(CaptureLink.authorizationCode(URL(string: "\(prefix)\(CaptureLink.callback)?code=abc")!, host: host))
        }
        XCTAssertNil(CaptureLink.authorizationCode(URL(string: "https://wall.example\(CaptureLink.callback)?code=a&code=b")!, host: host))
    }

    func testQueuePreservesUUIDAndEnforcesScope() throws {
        let project = "https://project.example"
        let owner = UUID()
        let operation = try CaptureOperation(project: project, owner: owner, content: "", board: UUID(), checklist: " First \nSecond ")
        var restored = try JSONDecoder().decode(CaptureOperation.self, from: JSONEncoder().encode(operation))
        restored.failure = "Board full"
        XCTAssertEqual(restored.id, operation.id)
        XCTAssertEqual(restored.checklist, ["First", "Second"])
        XCTAssertTrue(restored.belongs(to: project, owner: owner))
        XCTAssertFalse(restored.belongs(to: project, owner: UUID()))
        XCTAssertFalse(restored.belongs(to: "https://other.example", owner: owner))
        XCTAssertThrowsError(try CaptureOperation(project: project, owner: owner, content: String(repeating: "🔬", count: 121), board: nil, checklist: ""))
    }

    func testAbandonedWidgetSyncAgesOut() {
        XCTAssertEqual(WidgetStatus.syncing.display(at: Date(timeIntervalSince1970: 150), recorded: Date(timeIntervalSince1970: 0)), .offline)
        XCTAssertEqual(WidgetStatus.saved.display(at: Date(), recorded: .distantPast), .saved)
    }
}
