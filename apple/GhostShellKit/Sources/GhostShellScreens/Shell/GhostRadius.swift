import CoreGraphics

/// The page's corner radii at phone width, where Safari has no bevelled corners and `public/ghost.css` falls back to these.
public enum GhostRadius {
    public static let sm: CGFloat = 2
    public static let md: CGFloat = 2
    public static let base: CGFloat = 3
    public static let lg: CGFloat = 3
    public static let xl: CGFloat = 4
}
