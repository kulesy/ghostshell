# Mac app against the page: visible differences for #177

Source: the pairs in /private/tmp/claude-501/parity-177/pairs/ (page left, Mac right, Mac shots from mac-branch), plus the Swift code for the page-only screens.

Swift paths are under `apple/GhostShellKit/Sources/GhostShellScreens/`. Page paths are under `public/`.

Left out: test data, the inactive-window look and the Mac title bar.

The pattern behind most items:
1. The Mac uses the phone sizes (16pt text, 44pt rows and fields) where the page at desktop width uses 13 to 14px.
2. The Mac draws 2 to 3pt rounded or system corners where Chrome draws the page's bevelled corners (`ghost.css`, `@supports (corner-shape: bevel)`).
3. The Mac puts screen titles and their main button in the window toolbar. The page draws a Geist header with an ink button.

## Sign-in (sign-in, wrong-password, locked)

Same app today: no. The page reads as a small calm card. The Mac card is bigger, has an extra field and a grey button.

1. The Mac shows an Address field above Password, and the page has only Password. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
2. The Mac's password field shows a "Password" placeholder, and the page's field is empty. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
3. The Mac greys out Sign in until a password is typed, and the page's button is always ink. That includes the wrong-password and locked states. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
4. The Mac draws the GHOST SHELL wordmark larger and heavier (Geist Mono 26 medium, tracking 4) than the page's thinner wordmark. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
5. The Mac's fields are 44pt high with 16pt text and 8pt corners, and the page's are shorter with 14px text and bevelled corners. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
6. The Mac's card has 14pt rounded corners and more padding, so it is taller and wider than the page's card. (Both sizes, light and dark. SignIn/SignInScreen.swift, login.html)
7. In light, the Mac's ground is #e6e6e6 and its card #fbfbfb, and the page's ground is #f5f5f5 with a #ffffff card. (Both sizes, light. SignIn/SignInScreen.swift, login.html)
8. In dark, the Mac's card is #1e1e1e, and the page's card is #171717, so the Mac card stands out less from the ground. (Both sizes, dark. SignIn/SignInScreen.swift, login.html)
9. At 640x420 the Mac card is taller than the window, so the Sign in button is cut off, and the page's card fits. (640x420, light and dark. SignIn/SignInScreen.swift, login.html)

## Shell with no sessions (list-empty)

Same app today: close at 960, no at 640.

10. The Mac's empty-list icon is `square.and.pencil`, and the page's is lucide `message-square-plus` on a grey tile. (Both sizes, light and dark. Sidebar/SidebarNotices.swift, ui/sessions-list.js)
11. The Mac's "No sessions found" is semibold, and the page's is regular weight. (Both sizes, light and dark. Sidebar/SidebarNotices.swift, ui/sessions-list.js)
12. The Mac writes the shortcut in "Press ⌘N" as plain text, and the page draws it in a grey kbd chip. (Both sizes, light and dark. Sidebar/SidebarNotices.swift, ui/sessions-list.js)
13. The Mac's main-pane hint stops at "or ⌘N to start a new one". The page adds a third clause for starting one in Home. (Both sizes, light and dark. Shell/RootView.swift, app.js)
14. The Mac's centre logo is a plain solid mark, and the page's sits on a grey disc with a ring. (Both sizes, light and dark. Shell/RootView.swift, app.js)
15. At 640 the Mac keeps the sidebar and the main pane side by side. The page goes to one column, with a "< Sessions" back link on inner screens. (640x420, light and dark. Shell/RootView.swift, ui/shell.js)

## Sidebar with routines (sidebar-routines)

Same app today: nearly. The rows line up. The weights, the divider and the footer tab give it away.

16. The Mac draws no divider between the Scheduled and Routines sections, and the page draws a rule. (Both sizes, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)
17. Some Mac routine titles render medium or bold ("Reports" is bold), and the page's are all regular weight. (Both sizes, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)
18. The Mac's chevron on the "Nightly check" row sits about 60px in from the right edge, and the page's lines up with the other rows at the edge. (Both sizes, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)
19. On a Skipped row the Mac shows the routine's full name and cuts the error short. The page cuts the name short and shows the full error. (Both sizes, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)
20. At 640 the page shows a "…" button on each row and an add icon on each section heading, and the Mac shows neither. (640x420, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)
21. The Mac footer does not highlight the current tab (Routines or Scheduled), and the page does. (Both sizes, light and dark. Sidebar/SidebarFooter.swift, ui/sessions-list.js)
22. The Mac's account button is the filled `person.crop.circle` at 19pt, and the page's is the outlined lucide `circle-user`, which is lighter and smaller. (Both sizes, light and dark, on every sidebar screen. Sidebar/SidebarFooter.swift, ui/sessions-list.js)

## Routines list (routines-list)

Same app today: no. The Mac reads as a native Mac window holding the page's rows.

23. The Mac puts "Routines" in the window toolbar in the system font with a round "+" button. The page has a semibold Geist "Routines" header with an ink "New routine" button. (Both sizes, light and dark. Routines/RoutinesScreen.swift, ui/routines.js)
24. The Mac's list ground is #ececec in light and #101010 in dark, and the page's is #f6f6f6 and #181818. (Both sizes, light and dark. Routines/RoutinesScreen.swift, ghost.css)
25. The Mac's row menu shows as "…" with a small down chevron, and the page's is a plain "…" button. (Both sizes, light and dark. Routines/RoutineParts.swift, ui/routines.js)
26. The Mac's "Last run" link has a 44pt minimum height and the rows have more padding, so each row is taller than the page's. (Both sizes, light and dark. Routines/RoutineParts.swift, ui/routines.js)
27. The Mac's buttons ("Run now" and the like) have 2pt rounded corners, and the page's are bevelled. (Both sizes, light and dark. Shell/GhostButtons.swift, ghost.css)
28. At 640 the Mac wraps each row's controls onto a line under the text. The page keeps them on the right. (640x420, light and dark. Routines/RoutineParts.swift, ui/routines.js)
29. With the routines screen open, the Mac sidebar loses its logo row and its footer, and the page's sidebar keeps both. (Both sizes, light and dark. Sidebar/SidebarScreen.swift, ui/sessions-list.js)

## Routines with none (routines-empty, from code)

Same app today: probably not, from the code.

30. The Mac's empty state uses a Geist 16 title and 16pt muted text with 16pt padding (FlatEmpty), and the page's uses smaller text. The wording matches. (All sizes and schemes, from code. Shell/FlatColumn.swift, ui/routines.js)
31. The Mac's "New routine" button in the empty state is outline with 3pt corners, and the page's is bevelled. (All sizes and schemes, from code. Routines/RoutinesScreen.swift, ui/routines.js)
32. The empty Mac screen still has the toolbar "+" in place of the page's ink "New routine" header button. (All sizes and schemes, from code. Routines/RoutinesScreen.swift, ui/routines.js)

## Routine form (routine-form)

Same app today: no. This is the furthest from the page.

33. The Mac titles the screen "Edit routine" in the toolbar. The page shows a "< Routines" back link and the routine's name in bold. (960x640, light and dark. Routines/RoutineFormScreen.swift, ui/routines.js)
34. The Mac puts Delete, Cancel and Save in the toolbar as system capsule buttons, Save blue-prominent. The page puts Save (ink), Cancel (outline) and Delete (destructive) at the foot of the form. (960x640, light and dark. Routines/RoutineParts.swift FormToolbar, ui/routines.js)
35. The Mac's Group and Folder fields are a text field plus a chevron menu with a double chevron, and the page's are plain inputs with a suggestion list. (960x640, light and dark. Routines/RoutineParts.swift SuggestField, ui/routines.js)
36. The Mac stacks Model, Effort and Permission mode as system pop-up buttons. The page puts three selects side by side in one row. (960x640, light and dark. Routines/RoutineParts.swift ChoicePicker, ui/routines.js)
37. The Mac shows the prompt kind as system radio buttons, and the page uses its own styled choice. (960x640, light and dark. Routines/RoutineFormScreen.swift, ui/routines.js)
38. The Mac's field text is 16pt and looks semibold, its labels look bolder, and the page's field text is 14px regular. (960x640, light and dark. Shell/FlatColumn.swift, ui/form-parts.js)
39. The Mac writes the next run times in a proportional font joined by " · ". The page shows a "Next" label and the times in mono with spacing. (960x640, light and dark. Routines/RoutineFormScreen.swift, ui/routines.js)
40. The Mac's schedule hint says "in the GhostShell server's time zone (GMT)", and the page's says "in this Mac's time". (960x640, light and dark. Routines/RoutineFormScreen.swift, ui/routines.js)
41. The Mac sidebar does not highlight the routine being edited, and the page's does. (960x640, light and dark. Routines/RoutineSlots.swift, ui/sessions-list.js)

## Scheduled list (scheduled-list)

Same app today: no, for the same header and ground reasons as Routines.

42. The Mac puts "Scheduled" in the toolbar with a round "+". The page has a Geist header with an ink "Schedule a session" button. (Both sizes, light and dark. Routines/ScheduledScreen.swift, ui/scheduled.js)
43. The Mac's status line ("Starts in…") is Geist 16, and the page's is 13px like the lines under it. (Both sizes, light and dark. Routines/ScheduledScreen.swift, ui/scheduled.js)
44. The Mac shows a Skipped error in orange-brown with a filled triangle. The page shows it in red with an outlined triangle. (Both sizes, light and dark. Routines/ScheduledScreen.swift, ui/scheduled.js)
45. The Mac underlines all of "Started Mon 16 Nov" and leaves a 44pt gap after it. The page underlines only the date. (Both sizes, light and dark. Routines/ScheduledScreen.swift, ui/scheduled.js)
46. The Mac's row menu is "…" with a down chevron again, against the page's plain "…". The list ground and button corners differ as in items 24 and 27. (Both sizes, light and dark. Routines/ScheduledScreen.swift, ui/scheduled.js)

## Scheduled with none (scheduled-empty, from code)

Same app today: probably not, from the code.

47. The Mac's "No scheduled sessions." empty state uses the 16pt FlatEmpty text and an outline "Schedule a session" button with 3pt corners. The page uses smaller text and a bevelled button. The wording matches. (All sizes and schemes, from code. Routines/ScheduledScreen.swift, ui/scheduled.js)

## Account menu (account-menu, from code)

Same app today: no, on wording.

48. The Mac menu adds a "Notifications" item with a bell between Passkeys and the divider, and the page's menu has no such item. (All sizes and schemes, from code. Sidebar/SidebarFooter.swift and Notifications/NotificationToggle.swift, ui/sessions-list.js)
49. The Mac always shows "Accounts", and the page shows it only when the server supports accounts. (All sizes and schemes, from code. Sidebar/SidebarFooter.swift, ui/sessions-list.js)

## Accounts (accounts)

Same app today: close. The content matches. The plan bars and the notice read differently.

50. The Mac puts "62% used, resets in 1 hr 35 min" to the right of each plan label, with no line under the bar. The page shows the percent on the right, then the bar, then a muted "Resets in…" line. (Both sizes, light and dark. Accounts/PlanBars.swift, ui/accounts.js)
51. The Mac puts the "Accounts" title in the toolbar, and the page draws it as a Geist header. (Both sizes, light and dark. Accounts/AccountsScreen.swift, ui/accounts.js)
52. The Mac's Chrome notice has 3pt corners and its numbered steps sit flush at body size. The page's notice is bevelled with an indented numbered list. (Both sizes, light and dark. Accounts/AccountsScreen.swift and Accounts/Notice.swift, ui/accounts.js)
53. The Mac's lead paragraph is 16pt, and the page's is 14px. (Both sizes, light and dark. Accounts/AccountsScreen.swift, ui/accounts.js)

## Accounts with none (accounts-empty, from code)

Same app today: close, from the code. The layout and words match.

54. The Mac's "Add and sign in" button sits beside a 16pt, 36pt-high field. The page's field and button are shorter with 14px text and bevelled corners. (All sizes and schemes, from code. Accounts/AccountsScreen.swift, ui/accounts.js)
55. The Mac's "Switch accounts by itself" label is medium weight. The page's is regular. (All sizes and schemes, from code. Accounts/AccountsScreen.swift, ui/accounts.js)

## Passkeys (passkeys)

Same app today: close, apart from the add button.

56. The Mac shows "Add a passkey from the page in a browser." with a blue link, and the page shows an ink "Add a passkey" button. (Both sizes, light and dark. Accounts/PasskeysScreen.swift, ui/passkeys.js)
57. The Mac's passkey names are semibold and its lead text is 16pt, and the page's names are medium and the lead 14px. (Both sizes, light and dark. Accounts/PasskeysScreen.swift, ui/passkeys.js)
58. The Mac's Remove buttons have 2pt corners, and the page's are bevelled. (Both sizes, light and dark. Shell/GhostButtons.swift, ghost.css)
59. The Mac puts "Passkeys" in the toolbar in small grey text, and the page draws a bold header. (Both sizes, light and dark. Accounts/PasskeysScreen.swift, ui/passkeys.js)

## Passkeys with none (passkeys-empty, from code)

Same app today: close, from the code.

60. The Mac's "No passkeys added yet." is 16pt muted. The page's is 14px between two rules. (All sizes and schemes, from code. Accounts/PasskeysScreen.swift, ui/passkeys.js)
61. The Mac's "Add a passkey" button is outline, and the page's is ink. (All sizes and schemes, from code. Accounts/PasskeysScreen.swift, ui/passkeys.js)

## Banners (banners)

Same app today: no. The stack sits in the wrong place and looks heavier.

62. The Mac draws the banner stack above the sidebar's logo row, and the page draws it below. (Both sizes, light and dark. Accounts/BannerStack.swift, ui/banners.js)
63. The Mac's neutral banner is a flat grey card (#e6e6e6 light, #262626 dark). The page's is a lifted card (#fbfbfb light, #1e1e1e dark) with a shadow. (Both sizes, light and dark. Accounts/BannerCardView.swift, ghost.css)
64. The Mac caps the stack at 220pt with a hard cut and a divider, which slices a button in half. The page fades the bottom of the stack out. (Both sizes, light and dark. Accounts/BannerStack.swift, ui/banners.js)
65. The Mac's stack has about 25px on the right against 8px on the left, and the page's margins are even. (Both sizes, light and dark. Accounts/BannerStack.swift, ui/banners.js)
66. The Mac's banner corners are near square, and the page's are bevelled. (Both sizes, light and dark. Accounts/BannerCardView.swift, ghost.css)
67. The Mac lists the merged changes as plain lines, and the page shows them as a bulleted list of underlined links. (Both sizes, light and dark. Accounts/BannerCardView.swift, ui/banner.js)
68. At 640 the Mac wraps the banner text into a narrow column, and the page's text runs the sidebar's full width. (640x420, light and dark. Accounts/BannerCardView.swift, ui/banners.js)

## Force restart question (force-question)

Same app today: no. The Mac shows a stock macOS alert.

69. The Mac asks with a system alert: centred narrow card, bold small title, body wrapped over two lines, two capsule buttons of equal width. The page shows a wide left-aligned dialog with a larger title and Cancel (outline) and Force restart (solid red) on the right. (Both sizes, light and dark. Accounts/BannerStack.swift, ui/dialog.js)
70. The Mac dims only behind its own alert. The page dims the whole window, sidebar included. (Both sizes, light and dark. Accounts/BannerStack.swift, ui/dialog.js)

## Tool tiles in the chat (tool-tiles)

Same app today: close for the tiles. The links and the chat chrome around them differ.

71. The Mac's tiles are 92x68 with 8pt corners and a separator stroke, and the page's have smaller corners. (Both sizes, light and dark. Files/Attachments.swift, ui/gallery.js)
72. The Mac draws file links in blue with no underline. The page draws them in ink with an underline. (Both sizes, light and dark. Chat/MarkdownView.swift, ui/links.js)
73. The Mac's chat header shows only the title in grey, and the page adds a mono "work/example main Sonnet 5.5" line under a bold title. (Both sizes, light and dark. Chat/ChatScreen.swift, ui/chat.js)
74. The Mac puts the Model, Effort and permission pickers inside the composer box, and the page shows "default" and "Sonnet 5.5" as plain text under it. (Both sizes, light and dark. Composer/ComposerView.swift, ui/composer.js)

## Image viewer (viewer-tool, viewer-picture)

Same app today: no.

75. The Mac's viewer covers only the chat pane and leaves the sidebar bright. The page's covers the whole window. (Both sizes, light and dark. Files/ImageViewer.swift via Chat/ChatScreen.swift, ui/viewer.js)
76. The Mac stretches the picture edge to edge with square corners. The page fits it with a margin and rounded corners. (Both sizes, light and dark. Files/Zoom.swift, ui/viewer.js)
77. The Mac's top-right buttons are outline Fit or Actual size and Close. The page's are dark filled Zoom, Open in a new tab and Close, so the Mac has no Open button. (Both sizes, light and dark. Files/ImageViewer.swift, ui/viewer.js)
78. The Mac's "< 3 of 7 >" controls sit over the composer, which shows through the backdrop. The page's sit on a solid dimmed backdrop. (Both sizes, light and dark. Files/ImageViewer.swift, ui/viewer.js)
79. The page-only picture viewer, from code, would get the same Mac treatment as items 75 to 77. (All sizes and schemes, from code. Files/ImageViewer.swift, ui/viewer.js)

## File panel (file-markdown, file-text-line, file-pdf, file-audio, file-binary, file-missing)

Same app today: no. This is the biggest layout gap.

80. The Mac opens the file as an inspector beside the chat, squeezing the chat to about 200px. The page's file panel takes the whole main pane. (Both sizes, light and dark. Chat/ChatScreen.swift `.inspector`, ui/files.js)
81. The Mac's panel runs past the window's right edge, so the header buttons and long lines are cut off. The page wraps the lines and shows every button. (Both sizes, light and dark. Files/FilePanel.swift, ui/file-view.js)
82. The Mac has no "File" tab chip and close X above the file header, and the page has both. (Both sizes, light and dark. Files/FilePanel.swift, ui/files.js)
83. The Mac's header buttons are SF Symbols (pencil, `arrow.down.circle`) in its own style. The page's are lucide icons in bevelled outline boxes: edit, source, open, download, close. (Both sizes, light and dark. Files/FilePanel.swift, ui/file-view.js)
84. On PDF, audio, binary and missing files the Mac shows no header buttons in view, and the page shows open, download and close. (960x640, light and dark. Files/FilePanel.swift, ui/file-view.js)
85. The Mac's read-only note has a lock icon at 14pt on no band. The page's is 13px on a grey band with no icon. (Both sizes, light and dark. Files/FilePanel.swift, ui/file-view.js)
86. The Mac scrolls a jump-to-line file so the line sits near the middle, and the page puts it about a quarter of the way down. (Both sizes, light and dark. Files/FilePanel.swift, ui/file-view.js)
87. The Mac draws the PDF as a white page on grey, and the page's panel is plain grey. (960x640, light and dark. Files/PDFPane.swift, ui/file-view.js)
88. The Mac's audio player is a bare slider with a round button and no time, volume or more menu. The page shows the browser's full player with pause, time, progress, volume and a menu. (Both sizes, light and dark. Files/AudioPane.swift, ui/file-audio.js)
89. The Mac's audio "Next" button is cut off, and its track list is 16pt with a full-width selected band. The page's list is 14px with a rounded selected row. (Both sizes, light and dark. Files/AudioPane.swift, ui/file-audio.js)
90. The Mac's Download button on a binary file has square corners and 16pt text, and the page's is bevelled with 14px text. (960x640, light and dark. Files/FilePanel.swift, ui/file-view.js)
91. For a missing file the Mac says "There is no file at that path." in red. The page shows a "TXT file, NaN MB" card with a Download button. (960x640, light and dark. Files/FilePanel.swift, ui/file-view.js)
92. In every file shot the Mac's chat title is drawn over scrolled message text ("Read the notes" over "diagram.png"), and the page's header is solid. (Both sizes, light and dark. Chat/ChatScreen.swift, ui/chat.js)

## Unsure

1. The routine switch looks grey on the Mac, but the window was inactive. It may be primary-tinted in a key window. (Routines/RoutineParts.swift)
2. A chat-bubble icon shows on the RELEASE heading in the Mac sidebar shots. It may be a session state icon from the test data. (Sidebar/SidebarHeadingRow.swift)
3. The routine-form 640 page shot shows the routines list, not the form, so that size has no fair comparison.
4. The orange "Desktop groups unavailable" banner on the Mac list-empty shot looks like the test environment, not a design difference.
5. The Address field (item 1) and the Notifications menu item (item 48) may be deliberate Mac-only features. The owner should decide whether they stay.
6. The page shows three tool tiles and the Mac shows four with "+2", but both sides use the same overflow rule. The test chats likely hold different picture counts.
7. Item 91 may be a page bug ("NaN MB"), where the Mac's wording is the better one to keep.
8. The PDF in the page shot did not render. It may be the test file, so item 87 may be about loading, not looks.
9. Item 56: a Mac app may not be able to run the passkey ceremony for the server's origin, so the browser link may be on purpose.
