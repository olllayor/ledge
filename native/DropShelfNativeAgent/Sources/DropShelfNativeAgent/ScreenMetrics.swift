import AppKit
import CoreGraphics
import Foundation

/// Coordinate helper shared by the gesture and metrics paths.
///
/// AppKit rects use a bottom-left origin with `y` growing up; Quartz (and
/// Electron) use the primary display's top-left origin with `y` growing down.
enum ScreenCoordinates {
    static var primaryHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    static func quartzRect(_ rect: CGRect, primaryHeight: CGFloat) -> CGRect {
        CGRect(
            x: rect.origin.x,
            y: primaryHeight - (rect.origin.y + rect.size.height),
            width: rect.size.width,
            height: rect.size.height
        )
    }

    static func quartzFrame(for screen: NSScreen) -> CGRect {
        quartzRect(screen.frame, primaryHeight: primaryHeight)
    }

    static func displayID(for screen: NSScreen) -> CGDirectDisplayID {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID) ?? 0
    }
}

/// Notch measurement maths.
///
/// Technique borrowed from Sapphire (github.com/cshariq/Sapphire, AGPL-3.0 —
/// re-implemented here, no code copied): instead of guessing the notch from a
/// fraction of the display width, read it from AppKit. `safeAreaInsets.top`
/// distinguishes a notched panel, and `auxiliaryTopLeftArea` /
/// `auxiliaryTopRightArea` bracket the cut-out so its width can be measured
/// exactly. Everything is scaled against a fixed design reference resolution
/// so the silhouette is identical on a 14" and a 16" panel.
enum NotchGeometryMath {
    static let fallbackClosedWidth: CGFloat = 185
    static let fallbackClosedHeight: CGFloat = 32
    static let fallbackExternalWidth: CGFloat = 150
    static let designReferenceWidth: CGFloat = 1728
    static let designReferenceHeight: CGFloat = 1117
    static let scaleMin: CGFloat = 0.85
    static let scaleMax: CGFloat = 1.10

    /// Raw cut-out width, without the presentation bleed the consumer adds.
    static func notchWidth(
        leftAreaMaxX: CGFloat?,
        rightAreaMinX: CGFloat?,
        isBuiltin: Bool,
        screenWidth: CGFloat,
        scale: CGFloat
    ) -> CGFloat {
        if let leftAreaMaxX, let rightAreaMinX {
            let measured = rightAreaMinX - leftAreaMaxX
            if measured.isFinite, measured > 0 {
                return measured
            }
        }
        if isBuiltin {
            return (fallbackClosedWidth * scale).rounded()
        }
        return fallbackExternalWidth
    }

    /// A hair under the menu bar so the band sits visually flush with it.
    static func notchHeight(menuBarHeight: CGFloat, safeAreaTop: CGFloat) -> CGFloat {
        if menuBarHeight > 0 {
            return max(0, menuBarHeight - 0.2)
        }
        if safeAreaTop > 0 {
            return safeAreaTop
        }
        return fallbackClosedHeight
    }

    static func scale(screenWidth: CGFloat, screenHeight: CGFloat) -> CGFloat {
        let widthScale = screenWidth / designReferenceWidth
        let heightScale = screenHeight / designReferenceHeight
        return min(max(min(widthScale, heightScale), scaleMin), scaleMax)
    }

    /// Top inset only. `frame.height - visibleFrame.height` is menu bar *plus*
    /// Dock; on a notched MacBook that inflates the band by ~70pt and paints a
    /// slab instead of a silhouette.
    static func menuBarHeight(frame: CGRect, visibleFrame: CGRect) -> CGFloat {
        max(0, frame.maxY - visibleFrame.maxY)
    }

    static func menuBarHeight(for screen: NSScreen) -> CGFloat {
        menuBarHeight(frame: screen.frame, visibleFrame: screen.visibleFrame)
    }
}

/// Reports the measurements Electron cannot see (`screen.metrics`).
enum ScreenMetricsProvider {
    static func snapshot() -> JSONValue {
        .object([
            "screens": .array(NSScreen.screens.map { metrics(for: $0) })
        ])
    }

    static func metrics(for screen: NSScreen) -> JSONValue {
        let displayID = ScreenCoordinates.displayID(for: screen)
        let scale = NotchGeometryMath.scale(
            screenWidth: screen.frame.width,
            screenHeight: screen.frame.height
        )
        let menuBarHeight = NotchGeometryMath.menuBarHeight(for: screen)
        let safeAreaTop = screen.safeAreaInsets.top
        let hasNotch = safeAreaTop > 0
        let width = NotchGeometryMath.notchWidth(
            leftAreaMaxX: screen.auxiliaryTopLeftArea?.maxX,
            rightAreaMinX: screen.auxiliaryTopRightArea?.minX,
            isBuiltin: CGDisplayIsBuiltin(displayID) != 0,
            screenWidth: screen.frame.width,
            scale: scale
        )

        return .object([
            "displayId": .int(Int(displayID)),
            "frame": rect(ScreenCoordinates.quartzFrame(for: screen)),
            "visibleFrame": rect(
                ScreenCoordinates.quartzRect(
                    screen.visibleFrame,
                    primaryHeight: ScreenCoordinates.primaryHeight
                )
            ),
            "hasNotch": .bool(hasNotch),
            "notchWidth": .double(Double(width)),
            "notchHeight": .double(
                Double(NotchGeometryMath.notchHeight(menuBarHeight: menuBarHeight, safeAreaTop: safeAreaTop))
            ),
            "menuBarHeight": .double(Double(menuBarHeight)),
            "safeAreaTop": .double(Double(safeAreaTop))
        ])
    }

    private static func rect(_ value: CGRect) -> JSONValue {
        .object([
            "x": .double(Double(value.origin.x)),
            "y": .double(Double(value.origin.y)),
            "width": .double(Double(value.size.width)),
            "height": .double(Double(value.size.height))
        ])
    }
}
