import AppKit
import CoreGraphics
import Foundation

/// One display's reveal zone, in Quartz/Electron screen points.
struct NotchRevealZone {
    let displayId: CGDirectDisplayID
    let displayIndex: Int
    let rect: CGRect
}

/// Scroll-swipe reveal.
///
/// Borrowed from Sapphire's `HiddenNotchRevealMonitor` (AGPL-3.0 — behaviour
/// re-implemented, no code copied): on a hidden/auto-collapsing panel the
/// gesture people actually try is a downward swipe at the top centre, so a
/// scroll whose vertical delta dominates and which lands in the top-centre
/// band reveals the panel. One reveal per gesture, debounced, because trackpad
/// momentum keeps firing deltas long after the fingers lifted.
final class NotchRevealGesture {
    private let minimumDeltaY: CGFloat = 6
    private let debounce: TimeInterval = 0.55
    private var hasProcessedCurrentGesture = false
    private var lastTriggerTime: TimeInterval = -.greatestFiniteMagnitude

    func reset() {
        hasProcessedCurrentGesture = false
        lastTriggerTime = -.greatestFiniteMagnitude
    }

    /// Returns the display whose zone was swiped, or `nil` when the event is
    /// not a reveal.
    func handleScroll(
        deltaX: CGFloat,
        deltaY: CGFloat,
        location: CGPoint,
        timestamp: TimeInterval,
        isGestureStart: Bool,
        zones: [NotchRevealZone]
    ) -> NotchRevealZone? {
        guard let zone = zones.first(where: { $0.rect.contains(location) }) else {
            // Out of the zone: the next gesture starts fresh.
            hasProcessedCurrentGesture = false
            return nil
        }

        if isGestureStart {
            hasProcessedCurrentGesture = false
        }

        // Absolute value: natural scrolling flips the sign of the point delta,
        // and a one-direction check makes the gesture dead for half of users.
        guard abs(deltaY) > minimumDeltaY, abs(deltaY) > abs(deltaX) else { return nil }
        guard !hasProcessedCurrentGesture else { return nil }
        guard timestamp - lastTriggerTime > debounce else { return nil }

        hasProcessedCurrentGesture = true
        lastTriggerTime = timestamp
        return zone
    }
}

enum NotchRevealZoneMath {
    static func zones() -> [NotchRevealZone] {
        NSScreen.screens.enumerated().compactMap { index, screen in
            NotchRevealZone(
                displayId: ScreenCoordinates.displayID(for: screen),
                displayIndex: index,
                rect: zone(for: screen)
            )
        }
    }

    /// Wider than the notch (min 640pt of the display, capped at 45% of its
    /// width) so a slightly sloppy swipe still lands, and inflated a touch to
    /// forgive trackpad drift.
    static func zone(for screen: NSScreen) -> CGRect {
        let quartzFrame = ScreenCoordinates.quartzFrame(for: screen)
        let menuBarHeight = max(24, NotchGeometryMath.menuBarHeight(for: screen))
        let zoneWidth = min(quartzFrame.width, max(640, quartzFrame.width * 0.45))
        let zoneHeight = max(menuBarHeight + 28, 56)
        let rect = CGRect(
            x: quartzFrame.midX - zoneWidth / 2,
            y: quartzFrame.minY,
            width: zoneWidth,
            height: zoneHeight
        )
        return rect.insetBy(dx: -20, dy: -8)
    }
}
