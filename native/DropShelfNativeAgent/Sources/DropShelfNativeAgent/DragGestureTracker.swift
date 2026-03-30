import CoreGraphics
import Foundation

enum DragGestureEvent {
    case dragStarted(sourceBundleId: String)
    case shakeDetected(point: CGPoint, sourceBundleId: String)
    case dragEnded
}

final class DragGestureTracker {
    private let shakeDetector: ShakeDetector
    private let currentBundleId: () -> String
    private var isArmed = false
    private var dragActive = false

    init(
        shakeDetector: ShakeDetector = ShakeDetector(),
        currentBundleId: @escaping () -> String = { "" }
    ) {
        self.shakeDetector = shakeDetector
        self.currentBundleId = currentBundleId
    }

    func updateSensitivity(_ sensitivity: ShakeSensitivity) {
        shakeDetector.updateSensitivity(sensitivity)
    }

    func handleMouseDown() {
        isArmed = true
        dragActive = false
        shakeDetector.reset()
    }

    func handleMouseDragged(
        point: CGPoint,
        timestamp: TimeInterval,
        isGestureEnabled: Bool,
        excludedBundleIds: Set<String>
    ) -> [DragGestureEvent] {
        guard isGestureEnabled, isArmed else {
            return []
        }

        let bundleId = currentBundleId()
        guard !excludedBundleIds.contains(bundleId) else {
            return []
        }

        var events: [DragGestureEvent] = []

        if !dragActive {
            dragActive = true
            events.append(.dragStarted(sourceBundleId: bundleId))
        }

        if shakeDetector.ingest(x: point.x, timestamp: timestamp) {
            events.append(.shakeDetected(point: point, sourceBundleId: bundleId))
        }

        return events
    }

    func handleMouseUp() -> [DragGestureEvent] {
        let shouldEmitDragEnded = dragActive
        reset()
        return shouldEmitDragEnded ? [.dragEnded] : []
    }

    func reset() {
        isArmed = false
        dragActive = false
        shakeDetector.reset()
    }
}
