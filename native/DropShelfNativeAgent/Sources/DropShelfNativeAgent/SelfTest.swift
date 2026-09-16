import Foundation

enum SelfTestRunner {
    static func run() -> Int32 {
        let cases: [(String, Bool)] = [
            ("balanced drag shake is detected", balancedDragShakeIsDetected()),
            ("small drag jitter does not trigger shake", smallDragJitterDoesNotTriggerShake()),
            ("excluded apps ignore drag samples", excludedAppIgnoresDragSamples()),
            ("mouse up clears partial shake state", mouseUpClearsPartialShakeState()),
            ("firm sensitivity needs more reversals", firmSensitivityNeedsMoreReversals()),
            ("notch width is measured from the auxiliary top areas", notchWidthIsMeasuredFromAuxiliaryAreas()),
            ("notch width falls back without auxiliary areas", notchWidthFallsBackWithoutAuxiliaryAreas()),
            ("notch height sits flush with the menu bar", notchHeightSitsFlushWithMenuBar()),
            ("menu bar height excludes the Dock", menuBarHeightExcludesDock()),
            ("notch scale is clamped to the design band", notchScaleIsClampedToTheDesignBand()),
            ("reveal swipe in the notch zone triggers once per gesture", revealSwipeInZoneTriggersOnce()),
            ("momentum scroll does not re-trigger a reveal", momentumScrollDoesNotRetrigger()),
            ("a new swipe reveals again after the debounce", newSwipeRevealsAfterDebounce()),
            ("negative vertical delta still reveals", negativeDeltaReveals()),
            ("horizontal swipe does not reveal the notch", horizontalSwipeDoesNotReveal()),
            ("swipe outside the reveal zone is ignored", swipeOutsideZoneIsIgnored())
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

    private static func notchWidthIsMeasuredFromAuxiliaryAreas() -> Bool {
        let width = NotchGeometryMath.notchWidth(
            leftAreaMaxX: 640,
            rightAreaMinX: 840,
            isBuiltin: true,
            screenWidth: 1728,
            scale: 1
        )
        return width == 200
    }

    private static func notchWidthFallsBackWithoutAuxiliaryAreas() -> Bool {
        let builtin = NotchGeometryMath.notchWidth(
            leftAreaMaxX: nil,
            rightAreaMinX: nil,
            isBuiltin: true,
            screenWidth: 1728,
            scale: 1
        )
        let external = NotchGeometryMath.notchWidth(
            leftAreaMaxX: 100,
            rightAreaMinX: 100,
            isBuiltin: false,
            screenWidth: 2560,
            scale: 1.2
        )
        return builtin == 185 && external == 150
    }

    private static func notchHeightSitsFlushWithMenuBar() -> Bool {
        let height = NotchGeometryMath.notchHeight(menuBarHeight: 38, safeAreaTop: 38)
        let fallback = NotchGeometryMath.notchHeight(menuBarHeight: 0, safeAreaTop: 0)
        return abs(height - 37.8) < 0.001 && fallback == 32
    }

    /// AppKit origin is bottom-left: a 70pt Dock and 24pt menu bar must report
    /// 24, not `frame.height - visibleFrame.height` (= 94).
    private static func menuBarHeightExcludesDock() -> Bool {
        let frame = CGRect(x: 0, y: 0, width: 1512, height: 982)
        let visible = CGRect(x: 0, y: 70, width: 1512, height: 888)
        let height = NotchGeometryMath.menuBarHeight(frame: frame, visibleFrame: visible)
        return abs(height - 24) < 0.001
    }

    private static func notchScaleIsClampedToTheDesignBand() -> Bool {
        let reference = NotchGeometryMath.scale(screenWidth: 1728, screenHeight: 1117)
        let small = NotchGeometryMath.scale(screenWidth: 1280, screenHeight: 800)
        let huge = NotchGeometryMath.scale(screenWidth: 3840, screenHeight: 2160)
        return abs(reference - 1) < 0.001 && small == 0.85 && huge == 1.10
    }

    private static func revealSwipeInZoneTriggersOnce() -> Bool {
        let gesture = NotchRevealGesture()
        let zones = [testZone()]
        let location = CGPoint(x: 300, y: 20)

        let first = gesture.handleScroll(
            deltaX: 0,
            deltaY: 14,
            location: location,
            timestamp: 1.0,
            isGestureStart: true,
            zones: zones
        )
        let second = gesture.handleScroll(
            deltaX: 0,
            deltaY: 14,
            location: location,
            timestamp: 1.1,
            isGestureStart: false,
            zones: zones
        )

        return first != nil && second == nil
    }

    private static func momentumScrollDoesNotRetrigger() -> Bool {
        let gesture = NotchRevealGesture()
        let zones = [testZone()]
        let location = CGPoint(x: 300, y: 20)

        _ = gesture.handleScroll(
            deltaX: 0,
            deltaY: 14,
            location: location,
            timestamp: 1.0,
            isGestureStart: true,
            zones: zones
        )
        // Trackpad momentum keeps streaming deltas long after the fingers
        // lifted; none of them may open the panel a second time.
        let momentum = gesture.handleScroll(
            deltaX: 0,
            deltaY: 30,
            location: location,
            timestamp: 5.0,
            isGestureStart: false,
            zones: zones
        )

        return momentum == nil
    }

    private static func newSwipeRevealsAfterDebounce() -> Bool {
        let gesture = NotchRevealGesture()
        let zones = [testZone()]
        let location = CGPoint(x: 300, y: 20)

        _ = gesture.handleScroll(
            deltaX: 0,
            deltaY: 14,
            location: location,
            timestamp: 1.0,
            isGestureStart: true,
            zones: zones
        )
        let secondSwipe = gesture.handleScroll(
            deltaX: 0,
            deltaY: 18,
            location: location,
            timestamp: 2.0,
            isGestureStart: true,
            zones: zones
        )

        return secondSwipe?.displayId == 42
    }

    private static func horizontalSwipeDoesNotReveal() -> Bool {
        let gesture = NotchRevealGesture()
        return gesture.handleScroll(
            deltaX: 40,
            deltaY: 4,
            location: CGPoint(x: 300, y: 20),
            timestamp: 1.0,
            isGestureStart: true,
            zones: [testZone()]
        ) == nil
    }

    private static func negativeDeltaReveals() -> Bool {
        let gesture = NotchRevealGesture()
        return gesture.handleScroll(
            deltaX: 0,
            deltaY: -14,
            location: CGPoint(x: 300, y: 20),
            timestamp: 1.0,
            isGestureStart: true,
            zones: [testZone()]
        ) != nil
    }

    private static func swipeOutsideZoneIsIgnored() -> Bool {
        let gesture = NotchRevealGesture()
        return gesture.handleScroll(
            deltaX: 0,
            deltaY: 40,
            location: CGPoint(x: 40, y: 300),
            timestamp: 1.0,
            isGestureStart: true,
            zones: [testZone()]
        ) == nil
    }

    private static func testZone() -> NotchRevealZone {
        NotchRevealZone(
            displayId: 42,
            displayIndex: 0,
            rect: CGRect(x: 0, y: -8, width: 640, height: 56)
        )
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
