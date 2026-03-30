import Foundation

enum SelfTestRunner {
    static func run() -> Int32 {
        let cases: [(String, Bool)] = [
            ("balanced drag shake is detected", balancedDragShakeIsDetected()),
            ("small drag jitter does not trigger shake", smallDragJitterDoesNotTriggerShake()),
            ("excluded apps ignore drag samples", excludedAppIgnoresDragSamples()),
            ("mouse up clears partial shake state", mouseUpClearsPartialShakeState()),
            ("firm sensitivity needs more reversals", firmSensitivityNeedsMoreReversals())
        ]

        for (name, passed) in cases {
            if passed {
                fputs("PASS: \(name)\n", stdout)
            } else {
                fputs("FAIL: \(name)\n", stderr)
                return 1
            }
        }

        return 0
    }

    private static func balancedDragShakeIsDetected() -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .balanced),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (80, 0.10),
            (10, 0.20),
            (92, 0.28),
            (18, 0.38)
        ]

        return samples.contains { point in
            containsShakeDetected(
                tracker.handleMouseDragged(
                    point: CGPoint(x: point.0, y: 48),
                    timestamp: point.1,
                    isGestureEnabled: true,
                    excludedBundleIds: []
                )
            )
        }
    }

    private static func smallDragJitterDoesNotTriggerShake() -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .balanced),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (8, 0.05),
            (2, 0.11),
            (10, 0.16),
            (3, 0.20)
        ]

        return !samples.contains { point in
            containsShakeDetected(
                tracker.handleMouseDragged(
                    point: CGPoint(x: point.0, y: 48),
                    timestamp: point.1,
                    isGestureEnabled: true,
                    excludedBundleIds: []
                )
            )
        }
    }

    private static func excludedAppIgnoresDragSamples() -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .balanced),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (80, 0.10),
            (10, 0.20),
            (92, 0.28),
            (18, 0.38)
        ]

        return samples.allSatisfy { point in
            let events = tracker.handleMouseDragged(
                point: CGPoint(x: point.0, y: 48),
                timestamp: point.1,
                isGestureEnabled: true,
                excludedBundleIds: ["com.apple.finder"]
            )
            return !containsShakeDetected(events) && !containsDragStarted(events)
        }
    }

    private static func mouseUpClearsPartialShakeState() -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .balanced),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let firstDrag: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (80, 0.10),
            (10, 0.20)
        ]

        let secondDrag: [(CGFloat, TimeInterval)] = [
            (20, 1.00),
            (100, 1.10),
            (30, 1.20)
        ]

        let firstTriggered = firstDrag.contains { point in
            containsShakeDetected(
                tracker.handleMouseDragged(
                    point: CGPoint(x: point.0, y: 48),
                    timestamp: point.1,
                    isGestureEnabled: true,
                    excludedBundleIds: []
                )
            )
        }

        _ = tracker.handleMouseUp()
        tracker.handleMouseDown()

        let secondTriggered = secondDrag.contains { point in
            containsShakeDetected(
                tracker.handleMouseDragged(
                    point: CGPoint(x: point.0, y: 48),
                    timestamp: point.1,
                    isGestureEnabled: true,
                    excludedBundleIds: []
                )
            )
        }

        return !firstTriggered && !secondTriggered
    }

    private static func firmSensitivityNeedsMoreReversals() -> Bool {
        let tracker = DragGestureTracker(
            shakeDetector: ShakeDetector(sensitivity: .firm),
            currentBundleId: { "com.apple.finder" }
        )
        tracker.handleMouseDown()

        let samples: [(CGFloat, TimeInterval)] = [
            (0, 0.00),
            (120, 0.09),
            (20, 0.16),
            (132, 0.26),
            (28, 0.33)
        ]

        return !samples.contains { point in
            containsShakeDetected(
                tracker.handleMouseDragged(
                    point: CGPoint(x: point.0, y: 48),
                    timestamp: point.1,
                    isGestureEnabled: true,
                    excludedBundleIds: []
                )
            )
        }
    }

    private static func containsDragStarted(_ events: [DragGestureEvent]) -> Bool {
        events.contains { event in
            if case .dragStarted = event {
                return true
            }
            return false
        }
    }

    private static func containsShakeDetected(_ events: [DragGestureEvent]) -> Bool {
        events.contains { event in
            if case .shakeDetected = event {
                return true
            }
            return false
        }
    }
}
