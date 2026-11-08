// Drives a running app through its accessibility tree, by exact pid. shots.mjs compiles this into apple/build/ax.
// It sends no key or mouse event and never activates the app, so the app can stay in the background.
//
//   ax tree  <pid>                          every node under the first standard window, depth first, as JSON
//   ax act   <pid> <target> [action]        perform an action (default AXPress)
//   ax set   <pid> <target> <attr> <json>   set an attribute: a string, number, boolean or a [x, y] / [w, h] pair
//   ax type  <pid> <text>                   append text to the focused element's value
//   ax menu  <pid> <bar item> <item>        press an item in the app's menu bar
//   ax quit  <pid>                          ask the app to quit, as the Dock would
//   ax front                                the pid of the frontmost app
//
// A <target> is "focused", or a JSON array of child indexes down from the window ([] is the window itself).
import AppKit
import ApplicationServices

func out(_ v: Any) { FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]) + Data("\n".utf8)) }
func fail(_ s: String) -> Never { FileHandle.standardError.write(Data((s + "\n").utf8)); exit(2) }
func json(_ s: String) -> Any { (try? JSONSerialization.jsonObject(with: Data(s.utf8), options: [.fragmentsAllowed])) ?? fail("not JSON: \(s)") }

func attr(_ e: AXUIElement, _ name: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil }
// A scroll area's bars are not in its children. They are added after them, so shots.mjs can find the chat's bar.
func children(_ e: AXUIElement) -> [AXUIElement] {
    var all = (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    guard (attr(e, kAXRoleAttribute) as? String) == "AXScrollArea" else { return all }
    for name in ["AXHorizontalScrollBar", "AXVerticalScrollBar"] {
        if let bar = attr(e, name), !all.contains(where: { CFEqual($0, bar) }) { all.append(bar as! AXUIElement) }
    }
    return all
}

func plain(_ v: AnyObject?) -> Any? {
    guard let v else { return nil }
    if let s = v as? String { return s }
    if let n = v as? NSNumber { return n }
    if CFGetTypeID(v) == AXValueGetTypeID() {
        let ax = v as! AXValue
        var p = CGPoint.zero, s = CGSize.zero
        if AXValueGetValue(ax, .cgPoint, &p) { return [p.x, p.y] }
        if AXValueGetValue(ax, .cgSize, &s) { return [s.width, s.height] }
    }
    return nil
}

func window(_ app: AXUIElement) -> AXUIElement? {
    ((attr(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []).first { (attr($0, kAXSubroleAttribute) as? String) == "AXStandardWindow" }
}

func target(_ app: AXUIElement, _ spec: String) -> AXUIElement {
    if spec == "focused" {
        guard let f = attr(app, kAXFocusedUIElementAttribute) else { fail("no focused element") }
        return f as! AXUIElement
    }
    guard var e = window(app) else { fail("no window") }
    for i in json(spec) as! [Int] {
        let c = children(e)
        guard i < c.count else { fail("stale path \(spec)") }
        e = c[i]
    }
    return e
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "front" { out(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0); exit(0) }
guard args.count >= 2, let pid = pid_t(args[1]) else { fail("usage: ax <command> <pid> ...") }
let app = AXUIElementCreateApplication(pid)
AXUIElementSetMessagingTimeout(app, 5)

func result(_ error: AXError) -> Any { ["ok": error == .success, "code": error.rawValue] }

switch args[0] {
case "tree":
    guard let w = window(app) else { out([]); exit(0) }
    let fields = [("role", "AXRole"), ("subrole", "AXSubrole"), ("desc", "AXDescription"), ("title", "AXTitle"), ("value", "AXValue"), ("help", "AXHelp"),
                                ("id", "AXIdentifier"), ("disclosing", "AXDisclosing"), ("orientation", "AXOrientation"), ("focused", "AXFocused"), ("selected", "AXSelected"),
                                ("pos", "AXPosition"), ("size", "AXSize")]
    var nodes: [[String: Any]] = []
    func walk(_ e: AXUIElement, _ path: [Int]) {
        var node: [String: Any] = ["path": path]
        for (key, name) in fields { if let v = plain(attr(e, name)) { node[key] = v } }
        nodes.append(node)
        for (i, c) in children(e).enumerated() { walk(c, path + [i]) }
    }
    walk(w, [])
    out(nodes)
case "act":
    guard args.count >= 3 else { fail("usage: ax act <pid> <target> [action]") }
    out(result(AXUIElementPerformAction(target(app, args[2]), (args.count > 3 ? args[3] : "AXPress") as CFString)))
case "set":
    guard args.count >= 5 else { fail("usage: ax set <pid> <target> <attr> <json>") }
    let raw = json(args[4])
    var value: CFTypeRef = raw as AnyObject
    if let pair = raw as? [Double], pair.count == 2 {
        var size = CGSize(width: pair[0], height: pair[1]), point = CGPoint(x: pair[0], y: pair[1])
        value = args[3] == "AXSize" ? AXValueCreate(.cgSize, &size)! : AXValueCreate(.cgPoint, &point)!
    } else if let number = raw as? NSNumber {
        value = CFGetTypeID(number) == CFBooleanGetTypeID() ? number : NSNumber(value: number.doubleValue)
    }
    out(result(AXUIElementSetAttributeValue(target(app, args[2]), args[3] as CFString, value)))
case "type":
    guard args.count >= 3 else { fail("usage: ax type <pid> <text>") }
    let field = target(app, "focused")
    // A secure field reads back empty, so the text becomes its whole value.
    let current = attr(field, kAXValueAttribute) as? String ?? ""
    out(result(AXUIElementSetAttributeValue(field, kAXValueAttribute as CFString, (current + args[2]) as CFString)))
case "menu":
    guard args.count >= 4 else { fail("usage: ax menu <pid> <bar item> <item>") }
    guard let bar = attr(app, kAXMenuBarAttribute) else { fail("no menu bar") }
    guard let top = children(bar as! AXUIElement).first(where: { (attr($0, "AXTitle") as? String) == args[2] }), let menu = children(top).first else { fail("no menu \(args[2])") }
    guard let item = children(menu).first(where: { (attr($0, "AXTitle") as? String) == args[3] }) else { fail("no item \(args[3])") }
    out(result(AXUIElementPerformAction(item, "AXPress" as CFString)))
case "quit":
    out(NSRunningApplication(processIdentifier: pid)?.terminate() ?? false)
default:
    fail("unknown command \(args[0])")
}
