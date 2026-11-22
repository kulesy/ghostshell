# Parity ledger: the Mac app against the web page

This ledger tracks how closely the Mac app matches the web page. The web page under `public/` is the reference and the Mac app under `apple/` is the target. Each row is one thing a person can see or do on the page, with the code that does it on each side and the shots that show it.

- **Pair run.** `npm run apple:parity` lays each Mac shot beside its web shot. The `parity` job in the `Swift app` workflow runs it after the Mac shots and keeps the side-by-side images as the `parity-pairs` artifact. `apple/scripts/parity-pairs.json` maps the shot names that differ, and `apple/README.md` says how to read a run.
- **Built.** 21 Nov 2026 from commit d19857db, with one side-by-side pass. The Pass log at the end says what it covered.
- **Rows.** 370: direct 238, translated 3, partial 59, missing 49, unsupported 8, extra 12, manual 1.

## Statuses

| Status | Meaning |
|---|---|
| direct | Same content, actions and states on both. |
| translated | Same job the Mac way, with the page's layout and reach. The row names the platform rule or system control, and the decision if one chose it. |
| partial | Present, with named pieces missing. The Notes or the Differences list name them. |
| missing | The page has it and the Mac app does not. The Target column says where the code would go. |
| unsupported | Left out by a platform limit, or by a recorded decision that weighed the page's version, with the link. |
| extra | The Mac app has it and the page does not. |
| manual | Can't be checked from code or shots. |

A status describes what the Mac app can do. A look difference with no missing piece keeps its status and goes in the Differences list.

The web page is how the app looks and works. A Mac difference is `translated` or a convention only when a named platform rule or a recorded decision chose it. A decision has to weigh the page's version and choose against it, so a PR that ships the Mac version without mentioning the page's does not count, and nor does a code comment calling a Mac control the page's counterpart. A convention swaps a control for the platform's own and never changes the layout: a docked panel turned into a popup menu, or a list hidden behind a button, is a gap. A difference nobody chose is a gap, however long it has shipped.

## Reading a row

- **Reference** and **Target** cite `path:line` or the full URL of the decision. "would go near" marks where code for a missing row belongs.
- **Mac shot** is the base name of a Mac shot from `apple/scripts/shots.mjs`. The run adds `-light-default`, `-dark-min` and so on.
- **Page shot** is `set/screen` from `apple/scripts/page-shots.mjs`, saved as `page/<width>/<scheme>/<screen>.png`.
- `-` means no shot shows the row yet.

## Keeping it current

- A PR that adds or changes something on the web page adds or updates its row here.
- A Mac PR that closes a gap updates its row, its Differences entry and the counts above.
- A UI PR runs the visual review lane in like-for-like mode against the rows it touches.

## 1. Window and sidebar

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 1.1 | Native window, title bar, menu bar and shortcuts | unsupported | `public/index.html:96` | `apple/GhostShell/GhostShellApp.swift:29` | 1-list-rows | chat/02-sidebar | Kept native on purpose, see https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623 |
| 1.2 | Unsupported-browser message | unsupported | `public/index.html:106` | `apple/GhostShell/GhostShellApp.swift:29` | - | - | Platform limit: the Mac app runs in no browser, so there is no browser to be too old for |
| 1.3 | Two-column layout at wide sizes | direct | `public/app.js:8` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:34` | 1-session-chosen | chat/02-sidebar | - |
| 1.4 | Narrow width (640): one column plus "Sessions" back link | unsupported | `public/ui/chat.js:33` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:34` | 1-session-chosen-min | chat/02-sidebar | Left out by the decision in https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623: the Mac keeps both columns at 640 and gives the sidebar the page width. See 1.4a |
| 1.5 | Empty main pane text | partial | `public/app.js:372` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:136` | 1-list-rows | chat/02-sidebar | See 1.5a and 1.5b |
| 1.6 | Sidebar header brand mark | direct | `public/index.html:113` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:88` | 1-list-rows | chat/02-sidebar | - |
| 1.7 | Projects toggle button | partial | `public/index.html:112` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:82` | 5-project-view | groups/organise-projects-menu | The button sits in the page's place since https://github.com/kulesy/ghostshell/pull/189, but opens a View menu (ViewMenuContent) instead of the rail. See 1.7a |
| 1.8 | Projects rail docked on wide screens and as a left sheet on narrow ones | missing | `public/ui/projects.js:26` | would go near `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:34` | 5-project-view | groups/organise-projects-menu | No rail, docked or as a sheet. The View menu (`apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/ViewMenuContent.swift:12`, from https://github.com/kulesy/ghostshell/pull/101) stands in for it, and no PR or PBI weighed the rail. See 1.8a |
| 1.9 | Project row lamp, count badge and "elsewhere" dot | partial | `public/ui/projects.js:105` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/ViewMenuContent.swift:24` | 5-project-view | groups/organise-projects-menu | Lamp and count shown; the "elsewhere" dot and its screen-reader text are not |
| 1.10 | Home view | direct | `public/ui/projects.js:19` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/ViewMenuContent.swift:13` | 1-list-rows | organise/list-rows | - |
| 1.11 | Add menu: New session | direct | `public/ui/sessions-list.js:127` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:100` | 1-list-new-chat | groups/organise-new-menu | - |
| 1.12 | Add menu: New session in Home | partial | `public/ui/sessions-list.js:347` | `apple/GhostShell/GhostShellApp.swift:40` | 7-new-session | groups/organise-new-menu | On the Mac it is only in the File menu and Shift+Cmd+N, not in the header menu |
| 1.13 | Add menu: New group | direct | `public/ui/sessions-list.js:285` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:101` | 8-new-group-sheet | groups/organise-new-menu | - |
| 1.14 | Find button and search field | partial | `public/ui/spotlight.js:230` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:24` | 5-search-archived | groups/organise-find | Inline field in the sidebar instead of the page's dialog. Cmd+F is the HIG Find key (1.5b). See 1.14a |
| 1.15 | Search closes with Esc or the close button | partial | `public/ui/spotlight.js:253` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:35` | 5-search-archived | groups/organise-find | The close button works as on the page. See 1.15a |
| 1.16 | Search type chips: All, Projects, Groups, Sessions, Routines, Scheduled, Archived | missing | `public/ui/spotlight.js:239` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:5` | - | groups/organise-find | Mac shows only Sessions, Sub sessions and Archived sections, no chips |
| 1.17 | Search results for projects, groups and actions | missing | `public/ui/search-rules.js:146` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:5` | - | groups/organise-find-results | Mac lists sessions only |
| 1.18 | Search hit with lamp, title, meta and time | partial | `public/ui/spotlight.js:67` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:17` | 5-search-archived | groups/organise-find-results | Rows are the sidebar rows; no folder or branch meta line |
| 1.19 | Search hit PR badges and search by linked PR | missing | `public/ui/spotlight.js:103` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:17` | - | - | Added to the page by https://github.com/kulesy/ghostshell/pull/50 |
| 1.20 | Search empty state "Nothing matches." | partial | `public/ui/search-rules.js:164` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarNotices.swift:19` | 5-search-archived | groups/organise-find-results | See 1.20a |
| 1.21 | Search loading state | partial | `public/ui/spotlight.js:250` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:32` | 1-loading | - | See 1.21a |
| 1.22 | Search footer key hints (Open, Change type, Unarchive) | missing | `public/ui/spotlight.js:253` | would go near `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:11` | - | groups/organise-find | No hint bar and no keys to change type or unarchive. No PR or PBI decided it. See 1.22a |
| 1.23 | Unarchive from a search hit (Shift+Enter, swipe) | missing | `public/ui/spotlight.js:124` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:11` | - | - | Mac opens an archived chat but offers no unarchive in the sidebar; the group card has one (GroupCards.swift) |
| 1.24 | Section lists: Pinned, groups, Ungrouped, Terminal and other | direct | `public/ui/sections.js:11` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSections.swift:5` | 1-list-rows | organise/list-rows | - |
| 1.25 | Sessions sorted A to Z within sections | direct | https://github.com/kulesy/ghostshell/pull/11 | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSections.swift:5` | 1-list-rows | organise/list-rows | - |
| 1.26 | Session row: status dot, error triangle, title | direct | `public/ui/sessions-list.js:60` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:5` | 1-list-rows | organise/list-rows | - |
| 1.27 | Session row: running time | direct | `public/ui/sessions-list.js:60` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSessionLine.swift:22` | 1-list-rows | organise/list-rows | - |
| 1.28 | Session row: idle note | partial | `public/ui/sessions-list.js:26` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:48` | 1-list-rows | organise/list-rows | Idle words only in the help tip |
| 1.29 | Session row: hover tip with folder, branch, state, time | translated | `public/ui/sessions-list.js:40` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSessionLine.swift:22` | 1-list-rows | organise/list-rows | The system help tag (`.help`) in place of the page's styled tooltip, macOS HIG, Offering help. Same content on hover |
| 1.30 | Session row: selected screen-reader label | direct | `public/ui/sessions-list.js:73` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:27` | 8-multi-selection | organise/organise-select | - |
| 1.31 | Session row: "Actions for X" button | direct | `public/ui/sessions-list.js:81` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:99` | 8-multi-selection | groups/organise-row-menu | - |
| 1.32 | Row fold chevron for nested sessions | direct | `public/ui/sessions-list.js:215` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:39` | 1-list-rows | organise/list-rows | - |
| 1.33 | Nested session fold note ("N sub sessions") | partial | `public/ui/sessions-list.js:35` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:39` | 1-list-rows | organise/list-rows | Fold label only, no family note line |
| 1.34 | "New session under X" button on a family row | missing | `public/ui/sessions-list.js:222` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:39` | - | groups/organise-new-menu | Added by https://github.com/kulesy/ghostshell/pull/63; Mac has no per-row button |
| 1.35 | Group heading: fold chevron and count badge | direct | `public/ui/sessions-list.js:130` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeadingRow.swift:40` | 11-sidebar-heading | groups/groups-1-sidebar | - |
| 1.36 | Group heading: group-chat link | direct | `public/ui/group-button.js:12` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupHeadingButton.swift:15` | 11-sidebar-heading | groups/groups-1-sidebar | - |
| 1.37 | Group heading: "New session in X" button | missing | `public/ui/group-button.js:18` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeadingRow.swift:7` | - | groups/groups-1-sidebar | Mac relies on the New menu and Cmd+N in the open project |
| 1.38 | Group heading: menu button and right-click menu | partial | `public/ui/sessions-list.js:1213` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:148` | 11-sidebar-heading | groups/organise-row-menu | Mac has right-click only, no visible menu button |
| 1.39 | Group heading folds persist | direct | `public/ui/sessions-list.js:14` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarState.swift:6` | 5-fold-kept | - | - |
| 1.40 | Heading: routines under folding headings | direct | https://github.com/kulesy/ghostshell/pull/77 | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeadingRow.swift:7` | 9-sidebar-routines | routines/sidebar-routines | - |
| 1.41 | Routine row: title, status note, retry note | direct | `public/ui/sessions-list.js:26` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:57` | 9-sidebar-routines | routines/sidebar-routines | - |
| 1.42 | Routine row fold "N earlier runs" | direct | `public/ui/sessions-list.js:145` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarState.swift:15` | 9-sidebar-routines | routines/sidebar-routines | - |
| 1.43 | Idle routine row with menu and right-click | direct | `public/ui/sessions-list.js:174` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:5` | 9-project-routines | routines/sidebar-routines | - |
| 1.44 | Scheduled row with note and tone | direct | `public/ui/sessions-list.js:193` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:62` | 9-sidebar-routines | routines/scheduled-list | - |
| 1.45 | Sidebar empty state "No sessions found / Press N to start one" | direct | `public/ui/sessions-list.js:290` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarNotices.swift:17` | 2-list-empty | empty/list-empty | Same words. The key hint is Cmd+N (1.5b) |
| 1.46 | Project empty state "No groups yet" with New group button | partial | `public/ui/sessions-list.js:285` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:76` | 5-empty-project | - | Text only; no New group button, hint points to the + menu |
| 1.47 | Sidebar loading state | partial | `public/index.html:119` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:32` | 1-loading | - | See 1.47a |
| 1.48 | Sidebar load error "Could not load sessions" | partial | `public/ui/sessions-list.js:1387` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:102` | 3-unreachable | - | See 1.48a |
| 1.49 | Sidebar problem line | direct | `public/ui/sessions-list.js:363` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:45` | 1-cannot-reach | - | - |
| 1.50 | Footer: Routines and Scheduled links with current highlight | direct | `public/index.html:122` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:4` | 9-sidebar-routines | routines/sidebar-routines | Page has footer links; Mac uses per-project header buttons |
| 1.51 | Footer: account menu button | direct | `public/ui/sessions-list.js:1134` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:23` | 1-toolbar-notifications-on | chat/11-account-menu | - |
| 1.52 | Account menu: Accounts | partial | `public/ui/sessions-list.js:5` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:53` | 6-accounts | chat/11-account-menu | See 1.52a |
| 1.53 | Account menu: Passkeys | direct | `public/ui/sessions-list.js:1134` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:54` | 6-passkeys | chat/11-account-menu | - |
| 1.54 | Account menu: Sign out | direct | `public/ui/sessions-list.js:1129` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:57` | 1-signed-out | chat/11-account-menu | - |
| 1.55 | Account menu: Notifications | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationToggle.swift:13` | 1-toolbar-notifications-on | - | Mac-only extra, kept by decision in https://github.com/kulesy/ghostshell/issues/177 |
| 1.56 | Multi-select pick bar: "N selected", Move, Archive, Clear | partial | `public/ui/sessions-list.js:1393` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:70` | 8-multi-selection | organise/organise-select | Mac bar has Archive, Actions menu and Done; Move sits inside Actions |
| 1.57 | Select with Cmd or Ctrl click, Shift click and Shift+arrow range | partial | `public/ui/pick.js:15` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:35` | 8-multi-selection | organise/organise-select | List selection gives Cmd and Shift click and arrow range; not verified against the page's rules |
| 1.58 | Escape clears the selection | missing | `public/ui/sessions-list.js:1069` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:66` | - | - | No Escape handler found; Done button clears it |
| 1.59 | Arrow-key walk with Left and Right folding | partial | `public/ui/sessions-list.js:318` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:35` | - | - | Native List arrows; Left and Right folding not found in code |
| 1.60 | Alt+Up and Alt+Down open the next or previous session | missing | `public/ui/shortcuts.js:23` | `would go near apple/GhostShell/GhostShellApp.swift:46` | - | - | Added by https://github.com/kulesy/ghostshell/pull/48; would be a menu bar command |
| 1.61 | Cmd+A archives the open session | missing | `public/ui/shortcuts.js:2` | `would go near apple/GhostShell/GhostShellApp.swift:46` | - | - | Mac Cmd+A is Select All in the field; no archive command found |
| 1.62 | Cmd+N and Shift+Cmd+N | direct | https://github.com/kulesy/ghostshell/pull/185 | `apple/GhostShell/GhostShellApp.swift:38` | 7-new-session | - | - |
| 1.63 | B toggles the projects rail | missing | `public/ui/shortcuts.js:22` | would go near `apple/GhostShell/GhostShellApp.swift:46` | - | - | Falls with 1.8: the Mac has no rail to toggle |
| 1.64 | Quote shortcut and terminal toggle (Ctrl+backtick) | missing | `public/ui/shortcuts.js:22` | `would go near apple/GhostShell/GhostShellApp.swift:46` | 12-term-toggle-off | chat/term-chat | Terminal opens from the header button; no shortcut |
| 1.65 | Double-click a row to rename | missing | `public/ui/sessions-list.js:1384` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSessionLine.swift:23` | - | - | Rename is in the row menu only |
| 1.66 | Row opens with Enter | direct | `public/ui/sessions-list.js:294` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarList.swift:35` | - | - | Native List |
| 1.67 | Swipe a row to archive (touch) | missing | https://github.com/kulesy/ghostshell/pull/28 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarRow.swift:99` | - | - | No swipeActions found; likely wanted for iPhone, not Mac |
| 1.68 | Toasts after an action (Archived with Undo, Moved, Pinned) | partial | `public/ui/toast.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseHost.swift:21` | - | - | Mac shows only an error alert for organise actions; groups have a toast bar with Undo (SubSessionsPanel.swift) |
| 1.69 | Archive ask dialog "Stop and archive" | direct | `public/ui/chat-archive.js:38` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseHost.swift:21` | - | - | - |
| 1.70 | Opening the next session after an archive | missing | https://github.com/kulesy/ghostshell/pull/53 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseModel.swift:138` | - | - | No next-session open found in OrganiseModel |
| 1.71 | Polling and optimistic place, nest, archive | direct | `public/app.js:129` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseModel.swift:8` | - | - | - |
| 1.72 | Reload bar after an update | unsupported | `public/ui/reload.js:1` | `apple/GhostShell/GhostShellApp.swift:29` | - | - | Platform limit: the Mac app's code ships in its own build, so a server update leaves nothing on the Mac to reload. The Update banner covers the server, see Banners |
| 1.73 | Toast region and stacked toasts | missing | `public/ui/toast.js:142` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:45` | - | - | No general toast layer; Mac has an alert for errors only |

## 2. Organise

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 2.1 | Row menu: Rename | direct | `public/ui/sessions-list.js:17` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:13` | 8-rename-field | groups/organise-sheet-rename-session | Not offered for routine runs on either side |
| 2.2 | Row menu: Move out of "parent" | direct | `public/ui/sessions-list.js:812` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:50` | 8-moved-into-group | groups/organise-row-menu | - |
| 2.3 | Row menu: Nest under (with search) | partial | `public/ui/sessions-list.js:812` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:136` | 8-multi-selection | groups/organise-move | Mac submenu has no search field (NOTE in the code) |
| 2.4 | Row menu: Move to (with search, projects then Home) | partial | `public/ui/sessions-list.js:107` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:119` | 8-moved-into-group | groups/organise-move | No search field |
| 2.5 | Row menu: Pin and Unpin | direct | `public/ui/sessions-list.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:57` | - | groups/organise-row-menu | - |
| 2.6 | Row menu: Account submenu (pin, overflow, Chrome note) | direct | https://github.com/kulesy/ghostshell/pull/62 | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:78` | - | - | - |
| 2.7 | Row menu: Select and Deselect | direct | `public/ui/sessions-list.js:977` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:62` | 8-multi-selection | organise/organise-select | - |
| 2.8 | Row menu: Archive or Stop and archive with Cmd+A hint | partial | `public/ui/sessions-list.js:687` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:67` | - | groups/organise-row-menu | No Cmd+A key hint |
| 2.9 | Row menu: Stop (running chat) | direct | `public/ui/sessions-list.js:41` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:66` | - | - | - |
| 2.10 | Row menu: routine items (Run now, Pause, Resume, Edit, Delete) | direct | `public/ui/routines.js:105` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:4` | 9-sidebar-routines | routines/sidebar-routines | - |
| 2.11 | Row menu: Move routine to project | missing | `public/ui/routines.js:91` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:32` | - | - | Added by https://github.com/kulesy/ghostshell/pull/156; Mac routine menu has Run now, Edit, Delete only |
| 2.12 | Selection menu: Move to, Nest under, Move out, Archive N, Clear selection | direct | `public/ui/sessions-list.js:948` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:90` | 8-multi-selection | organise/organise-select | - |
| 2.13 | Selection menu: New parent session | missing | `public/ui/parent-form.js:22` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:90` | - | - | Added by https://github.com/kulesy/ghostshell/pull/20; no ParentForm on the Mac |
| 2.14 | New parent form: where it goes, Create, Cancel | missing | `public/ui/parent-form.js:29` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarFooter.swift:70` | - | - | Would sit beside SidebarSelectBar |
| 2.15 | Group menu: Rename | direct | `public/ui/sessions-list.js:17` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:13` | 8-rename-field | groups/organise-sheet-rename-session | - |
| 2.16 | Group menu: New session | missing | `public/ui/sessions-list.js:127` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:148` | - | - | Not in the Mac group menu |
| 2.17 | Group menu: Move up and Move down | direct | `public/ui/sessions-list.js:1233` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:164` | - | - | - |
| 2.18 | Group menu: Move to project | direct | https://github.com/kulesy/ghostshell/pull/142 | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:167` | - | - | - |
| 2.19 | Group menu: Account (pin) | missing | `public/ui/sessions-list.js:5` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:148` | - | - | Mac pins accounts on sessions only |
| 2.20 | Group menu: Delete group with confirm detail | direct | `public/ui/sessions-list.js:17` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:170` | 8-delete-group-confirm | - | - |
| 2.21 | Project menu: New group here | partial | `public/ui/sessions-list.js:503` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarHeader.swift:101` | - | groups/organise-projects-menu | Header New group acts on the viewed project |
| 2.22 | Project menu: Rename | direct | `public/ui/projects.js:150` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:13` | 8-rename-field | groups/organise-projects-menu | - |
| 2.23 | Project menu: Move up and Move down | missing | https://github.com/kulesy/ghostshell/pull/149 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:5` | - | groups/organise-projects-menu | Mac project menu has New, Rename, Delete only |
| 2.24 | Project menu: Account | missing | `public/ui/sessions-list.js:1197` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:5` | - | - | - |
| 2.25 | Project menu: Delete project with confirm text | direct | `public/ui/sessions-list.js:1197` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:14` | - | - | - |
| 2.26 | New project inline form with reason line | partial | `public/ui/projects.js:135` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:4` | 8-new-group-sheet | - | See 2.26a |
| 2.27 | Rename and new-name field (emoji allowed) | partial | `public/ui/forms.js:20` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarNameField.swift:3` | 8-rename-field | groups/organise-sheet-rename-session | Sessions and groups rename in place since https://github.com/kulesy/ghostshell/pull/189. Projects still use a sheet, see 2.26a |
| 2.28 | Drag a row to a section (move) | direct | `public/ui/drag.js:20` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:26` | - | - | - |
| 2.29 | Drag a row onto a row (nest), with "Nest here" and "Can't nest" labels | partial | `public/ui/sessions-list.js:74` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:20` | - | - | Drop works; the labels are not found in code |
| 2.30 | Drag a group among groups or onto a project | missing | `public/ui/group-drag-rules.js:1` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:20` | - | - | Added by https://github.com/kulesy/ghostshell/pull/142; Mac drags sessions only |
| 2.31 | Drag a project to reorder | missing | https://github.com/kulesy/ghostshell/pull/149 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:20` | - | - | - |
| 2.32 | Multi-row drag | direct | https://github.com/kulesy/ghostshell/pull/37 | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:25` | - | - | - |
| 2.33 | Drag handle on a group heading and the MoveStrip | missing | `public/ui/drag.js:18` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseDrag.swift:20` | - | - | - |
| 2.34 | Organise error alert "That did not work" | direct | `public/ui/toast.js:19` | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseHost.swift:21` | - | - | - |
| 2.35 | Sub session archive with parent | direct | https://github.com/kulesy/ghostshell/pull/27 | `apple/GhostShellKit/Sources/GhostShellScreens/Organise/OrganiseMenus.swift:112` | - | - | - |

## 3. Chat thread

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 3.1 | Chat header: title and subtitle (folder, branch, model) | direct | `public/ui/chat.js:122` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:22` | 1-chat-real | chat/03-chat-rich | Subtitle in mono, matches after https://github.com/kulesy/ghostshell/issues/191 |
| 3.2 | Chat header: Back to sessions | unsupported | `public/ui/chat.js:33` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:34` | 1-session-chosen-min | chat/03-chat-rich | No Back link, because the Mac keeps the sidebar at every width by the decision in https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623 (row 1.4) |
| 3.3 | Chat header: rename pencil | missing | `public/ui/chat.js:127` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:21` | - | - | Renamed through the sidebar row menu on the Mac |
| 3.4 | Chat header: archive button | direct | `public/ui/chat-archive.js:31` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:50` | 1-chat-real | chat/03-chat-rich | - |
| 3.5 | Chat header: archive confirm "Stop and archive" | direct | `public/ui/chat-archive.js:38` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:37` | - | - | - |
| 3.6 | Chat header: archive failure alert | direct | `public/ui/chat-archive.js:31` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:40` | - | - | - |
| 3.7 | Chat header: terminal button | direct | `public/ui/chat.js:37` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalControls.swift:6` | 12-term-chat | chat/term-chat | - |
| 3.8 | Chat header: Subagents button with dot | direct | `public/ui/chat.js:24` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:111` | 6-chat-rich | chat/03-chat-rich | Header button with the page's robot and a green dot while one runs. It opens a popover, see 3.40 |
| 3.9 | Chat header: sub sessions button | direct | `public/ui/chat.js:26` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionsPanel.swift:7` | 11-view | groups/groups-2-group-chat | - |
| 3.10 | Start-in-group chip on a new chat ("In X") | direct | `public/ui/chat.js:130` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/NewSessionScreen.swift:39` | 7-new-session | - | - |
| 3.11 | Document title per chat | translated | `public/ui/chat.js:12` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatScreen.swift:27` | - | - | The window title is the chat's title, macOS HIG, Windows. The page adds " · GhostShell" in a browser tab |
| 3.12 | New chat hint "Say what Claude should do" | missing | `public/ui/transcript.js:196` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:48` | 7-new-session | - | Mac shows the folder field and a different empty line |
| 3.13 | Thread loading state | direct | `public/ui/transcript.js:197` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:34` | 1-loading | - | - |
| 3.14 | Thread failed state with Try again | direct | `public/ui/transcript.js:198` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:40` | - | - | - |
| 3.15 | Empty thread | partial | `public/ui/transcript.js:27` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:48` | 6-chat-empty | chat/chat-empty | See 3.15a |
| 3.16 | Load earlier messages | direct | `public/ui/transcript.js:199` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:77` | 6-chat-long-scrolled-up | chat/04-chat-scrolled | - |
| 3.17 | History-loading spinner | direct | https://github.com/kulesy/ghostshell/pull/5 | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:77` | - | - | - |
| 3.18 | Scroll to end button | direct | `public/ui/transcript.js:208` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:60` | 6-chat-long-scrolled-up | chat/04-chat-scrolled | - |
| 3.19 | User message bubble | direct | `public/ui/rows.js:169` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:102` | 6-chat-rich | chat/03-chat-rich | - |
| 3.20 | Assistant message with markdown | direct | `public/ui/rows.js:168` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/MarkdownView.swift:243` | 6-chat-rich | chat/03-chat-rich | - |
| 3.21 | Markdown images inline | missing | https://github.com/kulesy/ghostshell/pull/195 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/MarkdownView.swift:243` | 6-chat-rich | - | Web only: https://github.com/kulesy/ghostshell/pull/195 changed public/md.mjs and transcript.js, no Swift |
| 3.22 | Code block with Copy button and "Copied" | direct | `public/ui/chat.js:143` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/MarkdownView.swift:379` | 6-chat-rich | chat/03-chat-rich | - |
| 3.23 | Code block Run (terminal) button | partial | `public/ui/run.js:6` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalControls.swift:38` | 12-term-chat | chat/term-chat | See 3.23a |
| 3.24 | Message timestamps | direct | https://github.com/kulesy/ghostshell/pull/71 | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:67` | 6-chat-rich | chat/03-chat-rich | - |
| 3.25 | Message Copy (context menu) | direct | `public/ui/quote.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:102` | - | - | Selection copy works (`MarkdownView.swift:391`), and the Mac also adds Copy to each message's menu. See 3.25a |
| 3.26 | Quote a selection or message | partial | `public/ui/quote.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:248` | 7-composer-quote | - | Mac quotes the whole message from its menu. https://github.com/kulesy/ghostshell/pull/106 left selection quotes out without deciding. See 3.26a |
| 3.27 | Quoted block in a sent message | direct | `public/ui/quote.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:86` | 7-composer-quote | - | - |
| 3.28 | Sending (pending) message state | direct | `public/ui/transcript.js:94` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:127` | 1-chat-real-after-send | - | - |
| 3.29 | Message with attached images and files | direct | `public/ui/thread.js:16` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:133` | 10-attachments | files/10-tool-tiles | - |
| 3.30 | Notices and "From X" sub session message | direct | `public/ui/rows.js:152` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:165` | - | - | - |
| 3.31 | Thinking block (Thought) | direct | `public/ui/thread.js:80` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:240` | 6-chat-rich | chat/03-chat-rich | - |
| 3.32 | Live thinking and writing indicator | partial | `public/ui/transcript.js:40` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLive.swift:18` | 6-chat-streaming | chat/chat-streaming | See 3.32a |
| 3.33 | Working line with time and tokens, and its tooltip | missing | `public/ui/transcript.js:26` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLive.swift:18` | 6-chat-streaming | chat/chat-streaming | No elapsed time and token line found |
| 3.34 | Tool lines (Reading, Editing, Running ...) | direct | `public/ui/thread.js:77` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:450` | 10-tool-tiles | files/10-tool-tiles | - |
| 3.35 | Edit summary +added -removed | direct | `public/ui/approvals.js:57` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:392` | 10-tool-tiles | files/10-tool-tiles | - |
| 3.36 | Bash tool card: command, output, Copy command | direct | `public/ui/bash.js:36` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:483` | 12-term-chat | chat/term-chat | - |
| 3.37 | Bash card: Run again | direct | `public/ui/bash.js:44` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:234` | 12-term-after-run | chat/term-chat | - |
| 3.38 | Suggested task card | direct | `public/ui/rows.js:114` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatRows.swift:358` | 11-chip-open | - | Chip Start and Dismiss in ChipActions.swift |
| 3.39 | Suggested task: Open, Start, Dismiss, Started, error | direct | https://github.com/kulesy/ghostshell/pull/73 | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/ChipActions.swift:78` | 11-chip-started | - | - |
| 3.40 | Subagents list above the composer | partial | `public/ui/subagents.js:58` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatHeader.swift:131` | 6-chat-rich | chat/03-chat-rich | Mac lists them in a popover from the header button. See 3.40a |
| 3.41 | Subagent card: steps and reply | missing | `public/ui/subagents.js:35` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLive.swift:96` | - | - | Mac row shows state only, no steps or reply |
| 3.42 | Subagents side panel (resizable) | missing | https://github.com/kulesy/ghostshell/pull/7 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLive.swift:96` | - | - | - |
| 3.43 | Side panel tabs: Terminal, Subagents, Sub sessions, close and resize | partial | `public/ui/panel.js:209` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:6` | 12-term-panel | chat/term-panel | Terminal panel exists; no tab strip or resize handle |
| 3.44 | Links in messages: PR and issue badges and details card | missing | https://github.com/kulesy/ghostshell/pull/12 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLinks.swift:12` | - | - | Links open; no status badge or card |
| 3.45 | File links open the file panel | direct | `public/ui/links.js:224` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatLinks.swift:10` | 10-viewer-tool | files/10-viewer-tool | - |
| 3.46 | Context meter in the header | direct | `public/ui/context.js:176` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/ContextMeter.swift:139` | 6-meter | chat/03-chat-rich | - |
| 3.47 | Context popover: breakdown table | direct | `public/ui/context.js:40` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/ContextMeter.swift:162` | 6-meter-popover | - | - |
| 3.48 | Context popover: plan usage | direct | https://github.com/kulesy/ghostshell/pull/32 | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/ContextMeter.swift:119` | 6-meter-popover | - | - |
| 3.49 | Context popover: MCP servers and Reload | missing | `public/ui/context.js:70` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Accounts/ContextMeter.swift:162` | - | - | Added by https://github.com/kulesy/ghostshell/pull/135 |
| 3.50 | Context popover: not-running note | direct | `public/ui/context.js:94` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/ContextMeter.swift:147` | - | - | - |
| 3.51 | Chat notices: Lost contact, Not sent, turn error | partial | `public/ui/session.js:175` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerModel.swift:204` | 7-composer-error | - | Lost-contact notice not found |
| 3.52 | Blocked notice with Switch and continue | direct | `public/ui/accounts.js:107` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/Notice.swift:4` | 6-banners | - | - |
| 3.53 | Spill notice and out-of-usage notice | direct | `public/ui/accounts.js:244` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/Notice.swift:4` | 6-banners | - | - |
| 3.54 | Chat open for a missing or failed session | direct | `public/ui/transcript.js:198` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatThreadView.swift:40` | - | - | Same words and Try again. See 3.54a |
| 3.55 | Unsent per-chat drafts | direct | https://github.com/kulesy/ghostshell/pull/39 | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerStore.swift:41` | 1-composer-real-draft | chat/composer-draft | - |
| 3.56 | Open an archived chat read-only | direct | `public/ui/spotlight.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarSearch.swift:11` | 5-search-archived | - | - |

## 4. Composer

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 4.1 | Message box with placeholder "Type / for commands" | direct | `public/ui/composer.js:334` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerTextView.swift:53` | 1-composer-real-draft | chat/composer-draft | - |
| 4.2 | Terminal placeholder "or ! to run a command" | missing | `public/ui/composer.js:334` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerTextView.swift:53` | 12-term-chat | chat/term-chat | Mac placeholder not found |
| 4.3 | Bang (!) command mode: Run command button and hint | missing | `public/ui/composer.js:321` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerModel.swift:45` | 12-term-typed | chat/term-chat | Hint "Runs in <folder>. Claude sees the result." |
| 4.4 | Send button | direct | `public/ui/composer.js:321` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:200` | 1-composer-real-sent-soon | chat/composer-draft | - |
| 4.5 | Stop button while a turn runs | direct | `public/ui/composer.js:122` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:198` | 7-composer-busy | chat/chat-streaming | - |
| 4.6 | Starting state on a new chat | partial | `public/ui/composer.js:80` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:199` | 7-new-session | - | Mac button reads "Start session"; no separate Starting state found |
| 4.7 | Attach files or images | direct | `public/ui/composer.js:322` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:95` | 10-attachments | - | Mac adds "Attach photos" on iPhone |
| 4.8 | Attachment chips: image thumb with remove | direct | `public/ui/composer.js:21` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerChips.swift:119` | 10-attachments | - | - |
| 4.9 | Attachment chips: file card with remove and uploading state | direct | `public/ui/composer.js:10` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerChips.swift:44` | 10-attachments | - | - |
| 4.10 | Quote chips with remove | direct | `public/ui/composer.js:46` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerChips.swift:19` | 7-composer-quote | - | - |
| 4.11 | Paste or drop an image | partial | `public/ui/composer.js:7` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerTextView.swift:7` | - | - | Not verified in code |
| 4.12 | Slash command menu | direct | `public/ui/commands.js:32` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/SlashMenu.swift:31` | 7-composer-slash | - | - |
| 4.13 | Slash menu loading and error states | missing | `public/ui/commands.js:123` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Composer/SlashMenu.swift:31` | - | - | Page shows Loading commands and an error line |
| 4.14 | Model picker with Fast and More models | direct | `public/ui/composer.js:356` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerPickers.swift:69` | 7-composer-draft | chat/composer-draft | - |
| 4.15 | Model list includes Fable 5.2 | direct | https://github.com/kulesy/ghostshell/pull/182 | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerPickers.swift:65` | 7-composer-draft | - | List comes from the server |
| 4.16 | Effort picker | direct | `public/ui/composer.js:136` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerPickers.swift:92` | 7-composer-draft | - | See 4.16a |
| 4.17 | Permission mode picker | direct | `public/ui/composer.js:23` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerPickers.swift:109` | 7-composer-draft | - | Pickers sit inside the box on the page, beside it on the Mac |
| 4.18 | Pickers disabled until status loads | direct | https://github.com/kulesy/ghostshell/pull/49 | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerModel.swift:96` | 1-composer-real-draft | - | - |
| 4.19 | Composer error notice with Dismiss | direct | `public/ui/composer.js:206` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:229` | 7-composer-error | - | - |
| 4.20 | Composer blocked by an approval | direct | `public/ui/composer.js:117` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:229` | 7-composer-approval | - | - |
| 4.21 | Composer while busy | direct | `public/ui/composer.js:55` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerView.swift:198` | 7-composer-busy | - | - |
| 4.22 | Message sent before status loads | direct | https://github.com/kulesy/ghostshell/pull/49 | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerModel.swift:45` | 1-composer-real-sent-soon | - | - |
| 4.23 | New session screen: which folder it starts in | partial | `public/ui/chat.js:20` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/NewSessionScreen.swift:59` | 7-new-session | - | See 4.23a |
| 4.24 | Start-with-pin or account choice on a new session | partial | `public/ui/group-rules.js:137` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/NewSessionScreen.swift:39` | 7-new-session | - | Not verified |
| 4.25 | Composer draft survives sessions | direct | `public/ui/draft.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Composer/ComposerStore.swift:41` | 1-composer-relaunched | - | - |

## 5. Approvals

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 5.1 | Bash approval card | direct | `public/ui/approvals.js:38` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:145` | 7-approval-bash | chat/08-approval-bash | - |
| 5.2 | Bash approval error state | direct | `public/ui/approvals.js:67` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:145` | 7-approval-bash-error | - | - |
| 5.3 | Edit and Write approval with diff | direct | `public/ui/approvals.js:39` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:145` | 7-approval-edit | chat/approval-edit | - |
| 5.4 | Read, Notebook, Agent and message-another-session approvals | direct | `public/ui/approvals.js:47` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalPrompts.swift:5` | 7-approval-bash | - | Titles come from the shared ApprovalRules.swift |
| 5.5 | Capcom tool approvals (archive, rename, move, create) | direct | `public/ui/approvals.js:24` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalPrompts.swift:5` | - | - | - |
| 5.6 | Allow, Always allow, Deny buttons | direct | `public/ui/approvals.js:88` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:148` | 7-approval-bash | chat/08-approval-bash | - |
| 5.7 | "All input" disclosure | partial | `public/ui/approvals.js:86` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:103` | 7-approval-bash | - | Missing on the edit and plan cards, see 5.7a |
| 5.8 | Question card (Claude is asking) with options | direct | `public/ui/approvals.js:117` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:200` | 7-approval-question | chat/06-approval-question | - |
| 5.9 | Question: pick any, own answer field, picked state | partial | `public/ui/approvals.js:123` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:243` | 7-approval-question-picked | chat/06-approval-question | See 5.9a |
| 5.10 | Question: Skip | direct | `public/ui/approvals.js:127` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:202` | 7-approval-question | - | - |
| 5.11 | Plan approval: Approve plan, Always allow, Keep planning | extra | `public/ui/approvals.js:76` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:174` | 7-approval-plan | chat/07-approval-plan | Mac ahead: the page shows the generic card for ExitPlanMode |
| 5.12 | Plan approval buttons at narrow width | extra | `public/ui/approvals.js:76` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalCards.swift:178` | 7-approval-plan-min | chat/07b-approval-plan-buttons | As 5.11 |
| 5.13 | Several approvals stacked | direct | `public/ui/approvals.js:136` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalPrompts.swift:5` | 7-approval-stacked | - | - |
| 5.14 | Waiting-for-answer lamp | direct | `public/ui/approvals.js:81` | `apple/GhostShellKit/Sources/GhostShellScreens/Approvals/ApprovalPrompts.swift:33` | 7-approval-question | - | - |
| 5.15 | Chrome tool approvals | direct | https://github.com/kulesy/ghostshell/pull/47 | `apple/GhostShellKit/Sources/GhostShellKit/Rules/ApprovalRules.swift:177` | - | - | - |

## 6. Widgets

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 6.1 | Inline widget frame in the thread | direct | `public/ui/widget.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetView.swift:5` | 7-widgets | chat/05-chat-widgets | - |
| 6.2 | Widget theming to match light and dark | direct | `public/ui/widget-theme.js:88` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetWebView.swift:11` | 7-widgets | chat/05-chat-widgets | - |
| 6.3 | Widget sends a request: Send, Cancel, Show all | direct | `public/ui/widget.js:90` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetAsk.swift:29` | 7-widget-ask | - | - |
| 6.4 | Widget opens a link: Open link | direct | `public/ui/widget.js:93` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetAsk.swift:36` | 7-widget-ask | - | - |
| 6.5 | Widget send failure "That did not send" | partial | `public/ui/widget.js:7` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetAsk.swift:41` | - | - | Failure text not found |
| 6.6 | Widget after click | direct | `public/ui/widget.js:83` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetView.swift:5` | 7-widgets-after-click | - | - |
| 6.7 | Widget closed note ("tried to open another page") | direct | `public/ui/widget.js:209` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetView.swift:31` | - | - | - |
| 6.8 | Widget loading wait | direct | `public/ui/widget-wait.js:38` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetActivity.swift:12` | - | - | - |
| 6.9 | Widget icons | direct | `public/ui/widget-frame.js:7` | `apple/GhostShellKit/Sources/GhostShellScreens/Widgets/WidgetIcons.swift:7` | - | - | - |

## 7. Files viewer

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 7.1 | Tool-result tiles (picture and file) | direct | `public/ui/gallery.js:10` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/Attachments.swift:5` | 10-tool-tiles | files/10-tool-tiles | See 7.1a |
| 7.2 | Image viewer overlay | partial | `public/ui/viewer.js:301` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/ImageViewer.swift:22` | 10-viewer-tool | files/10-viewer-tool | See 7.2a |
| 7.3 | Image viewer: Zoom and Fit to screen | direct | `public/ui/viewer.js:223` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/Zoom.swift:160` | 10-viewer-tool | files/10-viewer-picture | Pinch and double-click on the Mac |
| 7.4 | Image viewer: Open in new tab | missing | `public/ui/viewer.js:306` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Files/ImageViewer.swift:21` | 10-viewer-tool | files/10-viewer-tool | Noted in https://github.com/kulesy/ghostshell/issues/177 |
| 7.5 | Image viewer: Close (Esc) | direct | `public/ui/viewer.js:21` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/ImageViewer.swift:21` | 10-viewer-tool | files/10-viewer-tool | - |
| 7.6 | Image viewer: Previous and Next | direct | `public/ui/viewer.js:317` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/ImageViewer.swift:109` | 10-viewer-next | - | - |
| 7.7 | Image viewer: loading and error states | direct | `public/ui/viewer.js:298` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/ImageViewer.swift:79` | - | - | - |
| 7.8 | File panel beside the chat | partial | `public/ui/files.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Chat/ChatScreen.swift:158` | 10-file-text-line | files/10-file-text-line | Mac lays the file over the whole main pane since https://github.com/kulesy/ghostshell/pull/192. See 7.8b |
| 7.9 | File panel header: file name, path and "File" tab | direct | `public/ui/file-view.js:165` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:73` | 10-file-text-line | files/10-file-text-line | - |
| 7.10 | No file open | direct | `public/ui/file-view.js:24` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:28` | - | - | - |
| 7.11 | Text file with line numbers and line highlight | direct | `public/ui/file-view.js:82` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:347` | 10-file-text-line | files/10-file-text-line | - |
| 7.12 | Empty file note | direct | `public/ui/file-view.js:97` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:295` | - | - | - |
| 7.13 | Truncated file note | direct | `public/ui/file-view.js:161` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:191` | - | - | - |
| 7.14 | Too large to open note | direct | `public/ui/file-view.js:41` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:260` | - | - | - |
| 7.15 | Markdown rendered and source toggle | direct | `public/ui/file-view.js:174` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:114` | 10-file-markdown-rendered | files/10-file-markdown | - |
| 7.16 | PDF viewer | direct | `public/ui/file-view.js:117` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/PDFPane.swift:5` | 10-file-pdf | files/10-file-pdf | - |
| 7.17 | Audio player and Previous and Next clips | partial | `public/ui/file-audio.js:64` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/AudioPane.swift:71` | 10-file-audio | files/10-file-audio | See 7.17a |
| 7.18 | Audio "browser cannot play" error | direct | `public/ui/file-audio.js:59` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/AudioPane.swift:22` | - | - | "GhostShell cannot play this file." |
| 7.19 | Binary file card | direct | `public/ui/file-card.js:6` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:119` | 10-file-binary | files/10-file-binary | - |
| 7.20 | Missing file card | direct | `public/ui/file-view.js:97` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:243` | 10-file-missing | files/10-file-missing | See 7.20a |
| 7.21 | Loading state | direct | `public/ui/file-view.js:23` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:239` | - | - | - |
| 7.22 | Header: Download | direct | `public/ui/file-view.js:78` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:119` | 10-file-text-line | files/10-file-text-line | Save to Files on iPhone |
| 7.23 | Header: Open in a new tab | missing | `public/ui/file-view.js:119` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:119` | 10-file-markdown | files/10-file-markdown | - |
| 7.24 | Header: Close file | direct | `public/ui/file-view.js:177` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:76` | 10-file-text-line | files/10-file-text-line | - |
| 7.25 | Edit a text file | direct | https://github.com/kulesy/ghostshell/pull/60 | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:112` | 10-file-editing | - | - |
| 7.26 | Edit: Save, Cancel and Cmd+S | direct | `public/ui/file-edit.js:112` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:107` | 10-file-editing | - | - |
| 7.27 | Edit: saved toast | missing | `public/ui/file-edit.js:112` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:107` | - | - | No toast layer |
| 7.28 | Edit: conflict (changed on disk) with Copy text | direct | `public/ui/file-edit.js:130` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:39` | 10-file-conflict | - | - |
| 7.29 | Edit: Discard confirm | direct | `public/ui/file-edit.js:96` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:49` | - | - | - |
| 7.30 | Edit: unsaved edits kept notice and restored hint | partial | `public/ui/file-edit.js:137` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/FileDrafts.swift:6` | - | - | Drafts kept; hint line not found |
| 7.31 | Chat attachments list (file cards) | direct | `public/ui/file-card.js:9` | `apple/GhostShellKit/Sources/GhostShellScreens/Files/Attachments.swift:5` | 10-attachments | - | - |
| 7.32 | Esc closes the file panel | missing | `public/ui/panel.js:163` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Files/FilePanel.swift:76` | - | - | See 7.32a |

## 8. Terminal

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 8.1 | Terminal panel | direct | `public/ui/terminal.js:129` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:6` | 12-term-panel | chat/term-panel | - |
| 8.2 | Terminal empty text "Commands start in ..." | partial | `public/ui/terminal.js:131` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:134` | 12-term-panel | chat/term-panel | Wording not found |
| 8.3 | Terminal connecting state | partial | `public/ui/terminal.js:131` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalStore.swift:11` | - | - | - |
| 8.4 | Command blocks with state and output | direct | `public/ui/terminal.js:26` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:128` | 12-term-blocks-top | chat/term-chat | - |
| 8.5 | ANSI colours | direct | `public/ui/ansi.js:104` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/AnsiText.swift:6` | 12-term-blocks-end | - | - |
| 8.6 | Input line: Run command and Send line | direct | `public/ui/terminal.js:140` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalInput.swift:143` | 12-term-typed | - | - |
| 8.7 | Ctrl+C and Ctrl+D hints | direct | `public/ui/terminal.js:144` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalInput.swift:143` | 12-term-after-input | - | - |
| 8.8 | Stop command | direct | `public/ui/terminal.js:31` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalInput.swift:135` | 12-term-after-stop | - | - |
| 8.9 | Clear finished commands | direct | `public/ui/panel.js:213` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:64` | 12-term-panel | - | - |
| 8.10 | Close terminal panel | direct | `public/ui/panel.js:214` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:66` | 12-term-toggle-off | - | - |
| 8.11 | Copy output | missing | `public/ui/terminal.js:25` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:128` | - | - | Copy toast has no Mac equivalent |
| 8.12 | Hidden-characters refusal | direct | `public/ui/run.js:10` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalStore.swift:11` | - | - | - |
| 8.13 | Terminal and a file at wide width | partial | `public/ui/panel.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Terminal/TerminalPanel.swift:6` | 12-term-wide-file | - | The page shows one panel tab at a time beside the chat. The Mac lays the file over the chat and the terminal, see 7.8b. https://github.com/kulesy/ghostshell/issues/173 is about the old inspector layout |

## 9. Accounts and passkeys

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 9.1 | Accounts screen header and back | direct | `public/ui/accounts.js:5` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:110` | 6-accounts | chat/09-accounts | - |
| 9.2 | Running chats list | direct | `public/ui/accounts.js:67` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:188` | 6-accounts | chat/09-accounts | - |
| 9.3 | Account row: name, Active badge, plan bars | direct | `public/ui/accounts.js:100` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PlanBars.swift:5` | 6-meter | chat/09b-accounts-scrolled | Layout of bars differs, per https://github.com/kulesy/ghostshell/issues/177 |
| 9.4 | Account row: Switch to this | direct | `public/ui/accounts.js:83` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:166` | 6-accounts | chat/09-accounts | - |
| 9.5 | Account row: Sign in, Waiting for the Mac | missing | `public/ui/accounts.js:108` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:166` | - | - | Not found on the Accounts screen (the banner has it) |
| 9.6 | Account row: Rename | direct | `public/ui/accounts.js:93` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:146` | 6-accounts | - | - |
| 9.7 | Account row: pinned note and Chrome note | direct | `public/ui/accounts.js:6` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:120` | 6-accounts | - | - |
| 9.8 | Add an account | direct | `public/ui/accounts.js:139` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:66` | 6-accounts | chat/09-accounts | Button reads "Add and sign in" |
| 9.9 | Switch accounts by itself | direct | `public/ui/accounts.js:168` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:32` | 6-accounts | chat/09-accounts | - |
| 9.10 | Accounts loading and empty | direct | `public/ui/accounts.js:172` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/AccountsScreen.swift:41` | 6-accounts-empty | empty/accounts-empty | - |
| 9.11 | Passkeys list: device, Used today, Never used | direct | `public/ui/passkeys.js:23` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:78` | 6-passkeys | chat/10-passkeys | - |
| 9.12 | Passkeys lead text | direct | `public/ui/passkeys.js:70` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:16` | 6-passkeys | chat/10-passkeys | - |
| 9.13 | Passkeys empty "No passkeys added yet." | direct | `public/ui/passkeys.js:159` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:21` | 6-passkeys-empty | empty/passkeys-empty | - |
| 9.14 | Add a passkey | unsupported | `public/ui/passkeys.js:72` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:32` | 6-passkeys | chat/10-passkeys | Adding a passkey stays on the page because it needs paid signing, https://github.com/kulesy/ghostshell/issues/93#issuecomment-6716263302; Mac links to the page |
| 9.15 | Passkey added status | direct | `public/ui/passkeys.js:69` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:35` | - | - | - |
| 9.16 | Remove a passkey: Keep and Remove | direct | `public/ui/passkeys.js:92` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:85` | - | - | - |
| 9.17 | Passkeys unsupported reason | direct | `public/ui/passkeys.js:146` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:16` | - | - | - |
| 9.18 | Passkeys loading | direct | `public/ui/passkeys.js:160` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/PasskeysScreen.swift:50` | - | - | - |
| 9.19 | Passkey offer after sign-in ("Add a passkey" / "Not now") | unsupported | `public/ui/passkeys.js:73` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerStack.swift:5` | - | - | Left out with 9.14 in https://github.com/kulesy/ghostshell/pull/104: "the page's one-time offer to sign in with a passkey stays on the page" |

## 10. Banners

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 10.1 | Banner stack at the top of the sidebar | direct | `public/ui/banners.js:4` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerStack.swift:6` | 6-banners | banners/6-banners | - |
| 10.2 | Sign-in banner: Sign in on the Mac, Waiting for the Mac | direct | `public/ui/banner-rules.js:35` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:42` | 6-banners | banners/6-banners | - |
| 10.3 | Signed-out banner (account or Claude) | direct | `public/ui/banner-rules.js:43` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:47` | 6-banners | banners/6-banners | - |
| 10.4 | Sign-in ends banner | direct | `public/ui/banner-rules.js:51` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:60` | 6-banners | - | - |
| 10.5 | Out-of-usage banner | direct | `public/ui/accounts.js:180` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerCardView.swift:5` | 6-banners | banners/6-banners | - |
| 10.6 | Switched-by-itself banner with Dismiss | direct | `public/ui/accounts.js:192` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerCardView.swift:5` | 6-banners | banners/6-banners | - |
| 10.7 | Chrome extension banner (hidden on Accounts) | direct | `public/ui/accounts.js:162` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:108` | 6-banners | banners/6-banners | See 10.7a |
| 10.8 | Update banner: Update, Update and restart, Restart | direct | `public/ui/banner-rules.js:62` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:70` | 6-banners | banners/6-banners | - |
| 10.9 | Update banner: merged changes list as links | partial | `public/ui/banner-rules.js:69` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerCardView.swift:69` | 6-banners | banners/6-banners | Page lists bulleted links; Mac shows "and N more" |
| 10.10 | Update progress: Updating, Restarting once N chats finish | direct | `public/ui/banner-rules.js:64` | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:73` | 6-restarting | - | - |
| 10.11 | Force restart button | direct | `public/ui/banners.js:90` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerStack.swift:68` | 6-force-question | banners/6-force-question | - |
| 10.12 | Force restart question dialog | direct | `public/ui/banner-rules.js:74` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerStack.swift:116` | 6-force-question | banners/6-force-question | The page's dialog over the window since https://github.com/kulesy/ghostshell/pull/192. The stock alert is iPhone only. See 10.12b |
| 10.13 | Reload bar for a changed page | unsupported | `public/ui/reload.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerStack.swift:6` | - | - | Platform limit, see 1.72 |
| 10.14 | Banner stack shadow, fade and position | direct | `public/ui/banner.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Accounts/BannerCardView.swift:5` | 6-banners | banners/6-banners | Brought closer to the page in https://github.com/kulesy/ghostshell/pull/192, from the list in https://github.com/kulesy/ghostshell/issues/177. See 10.14a |

## 11. Routines and scheduled

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 11.1 | Routines list screen | partial | `public/ui/routines.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:5` | 9-routines-list | routines/routines-list | See 11.1a |
| 11.2 | Routines toolbar: New routine | direct | `public/ui/routines.js:175` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:32` | 9-routines-list | routines/routines-list | Mac uses a toolbar button; page a header button |
| 11.3 | Routines empty state | direct | `public/ui/routines.js:218` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:32` | 9-routines-empty | empty/routines-empty | - |
| 11.4 | Routines loading | direct | `public/ui/routines.js:226` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:29` | - | - | - |
| 11.5 | Routines load error with Try again | direct | `public/ui/routines.js:225` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:22` | - | - | - |
| 11.6 | Routine card: title, schedule, Next fire time | direct | `public/ui/routines.js:127` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:141` | 9-routines-list | routines/routines-list | - |
| 11.7 | Routine card: Running state | direct | `public/ui/routines.js:135` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:121` | 9-routines-list | routines/routines-list | - |
| 11.8 | Routine card: on and off switch | direct | `public/ui/routines.js:120` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:167` | 9-routines-list | routines/routines-list | - |
| 11.9 | Routine card: Run now | direct | `public/ui/routines.js:105` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:4` | 9-routines-list | routines/routines-list | - |
| 11.10 | Routine card: Actions menu (Edit, Delete, Move to project) | partial | `public/ui/routines.js:91` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:32` | 9-routines-list | routines/routines-list | No Move to project item |
| 11.11 | Routine run started notice with Open | partial | `public/ui/routines.js:37` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineParts.swift:4` | 9-routine-refused | - | - |
| 11.12 | Routine delete confirm | direct | `public/ui/routines.js:72` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutinesScreen.swift:56` | - | - | - |
| 11.13 | Routine form | direct | `public/ui/routines.js:235` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:6` | 9-routine-form | routines/routine-form | - |
| 11.14 | Routine form: title, heading, schedule, jitter | direct | `public/ui/routines.js:137` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:134` | 9-routine-form | routines/routine-form | - |
| 11.15 | Routine form: folder and group fields with suggestions | partial | `public/ui/form-parts.js:10` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineParts.swift:89` | 9-routine-form | routines/routine-form | The page suggests values for Group only. The Mac's menu of past folders is an addition. See 11.15a |
| 11.16 | Routine form: model, effort, permission selects | direct | `public/ui/routines.js:235` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:6` | 9-routine-form | routines/routine-form | - |
| 11.17 | Routine form: prompt file path | direct | `public/ui/routines.js:235` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:199` | 9-routine-form | routines/routine-form | - |
| 11.18 | Routine form: prompt text | direct | `public/ui/routines.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:13` | 9-routine-form | routines/routine-form | - |
| 11.19 | Routine form: Next fire times and timezone hint | direct | `public/ui/routines.js:242` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:244` | 9-routine-form | routines/routine-form | See 11.19a |
| 11.20 | Routine form: Run on its schedule toggle | direct | `public/ui/routines.js:48` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:160` | 9-routine-form | routines/routine-form | - |
| 11.21 | Routine form: Save, Cancel, Delete at the foot | direct | `public/ui/routines.js:438` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineParts.swift:149` | 9-routine-form | routines/routine-form | At the foot since https://github.com/kulesy/ghostshell/pull/192. The toolbar is iPhone only |
| 11.22 | Routine form: refused by server | direct | `public/ui/routines.js:39` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:113` | 9-routine-refused | - | - |
| 11.23 | Routine form: server-capability wait | direct | `public/ui/routines.js:15` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:116` | - | - | - |
| 11.24 | Routine belongs to a project | direct | https://github.com/kulesy/ghostshell/pull/156 | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:120` | 9-project-routines | - | - |
| 11.25 | Project sidebar total counts routines with no run | direct | https://github.com/kulesy/ghostshell/pull/167 | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/ViewMenuContent.swift:23` | 9-project-routines | - | - |
| 11.26 | Routine queue and retry note | direct | https://github.com/kulesy/ghostshell/pull/25 | `apple/GhostShellKit/Sources/GhostShellKit/Rules/RoutineRules.swift:120` | 9-sidebar-routines | routines/sidebar-routines | - |
| 11.27 | Rename a routine from its row | missing | https://github.com/kulesy/ghostshell/pull/23 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:5` | - | - | Mac row menu has no Rename |
| 11.28 | Sidebar highlights the routine being edited | missing | `public/ui/routines.js:29` | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineSlots.swift:5` | 9-routine-form | routines/routine-form | Per https://github.com/kulesy/ghostshell/issues/177 |
| 11.29 | Scheduled list screen | partial | `public/ui/scheduled.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:5` | 9-scheduled-list | routines/scheduled-list | See 11.1a |
| 11.30 | Scheduled: Schedule a session button | direct | `public/ui/scheduled.js:143` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:34` | 9-scheduled-list | routines/scheduled-list | - |
| 11.31 | Scheduled empty | direct | `public/ui/scheduled.js:153` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:34` | 9-scheduled-empty | empty/scheduled-empty | - |
| 11.32 | Scheduled loading and error | direct | `public/ui/scheduled.js:158` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:24` | - | - | - |
| 11.33 | Scheduled not supported by the server | direct | `public/ui/scheduled.js:14` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:19` | - | - | - |
| 11.34 | Scheduled row: Start now, Edit, Cancel, Delete | direct | `public/ui/scheduled.js:73` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:112` | 9-scheduled-list | routines/scheduled-list | - |
| 11.35 | Scheduled row: started time | direct | `public/ui/scheduled.js:91` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:125` | 9-scheduled-list | routines/scheduled-list | - |
| 11.36 | Scheduled delete confirm | direct | `public/ui/scheduled.js:50` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledScreen.swift:58` | - | - | - |
| 11.37 | Scheduled form | direct | `public/ui/scheduled.js:168` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledFormScreen.swift:5` | 9-scheduled-form | - | Page shot set has no scheduled form |
| 11.38 | Scheduled form: date and time picker | translated | `public/ui/scheduled.js:168` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledFormScreen.swift:78` | 9-scheduled-form | - | The system date picker in place of the browser's own control, macOS HIG, Date pickers. Same field, same steps. Hint wording is 11.19a |
| 11.39 | Scheduled form: missing session note | partial | `public/ui/scheduled.js:198` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/ScheduledFormScreen.swift:15` | - | - | Not found |
| 11.40 | Added or Saved notice after a routine is saved | direct | `public/ui/routines.js:353` | `apple/GhostShellKit/Sources/GhostShellScreens/Routines/RoutineFormScreen.swift:310` | - | j-routines-6-save | See 11.40a |

## 12. Sign-in

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 12.1 | Sign-in card | direct | `public/login.html:26` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:79` | 1-signin-idle | signin/1-signin-idle | - |
| 12.2 | Address field | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:87` | 1-signin-idle | - | Mac-only, kept by decision in https://github.com/kulesy/ghostshell/issues/177 |
| 12.3 | Password field and Sign in button | direct | `public/login.html:26` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:104` | 1-signin-idle | signin/1-signin-idle | - |
| 12.4 | Sign in with a passkey | direct | `public/login.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:113` | 1-signin-idle | - | Needs a passkey entitlement; iPhone path |
| 12.5 | Wrong password | direct | `public/login.js:31` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:43` | 1-wrong-password | signin/1-wrong-password | - |
| 12.6 | Locked after too many tries | direct | `public/login.js:18` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:43` | 2-locked | signin/2-locked | - |
| 12.7 | Cannot reach the server | direct | `public/login.js:17` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:43` | 3-unreachable | - | - |
| 12.8 | Bad address | extra | `public/login.js:16` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:87` | 4-bad-address | - | Follows from the Address field |
| 12.9 | No passkeys for this address | direct | `public/login.js:81` | `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:10` | - | - | - |
| 12.10 | Setup page ("No password is set yet") | missing | `public/setup.html:22` | would go near `apple/GhostShellKit/Sources/GhostShellScreens/SignIn/SignInScreen.swift:43` | - | - | See 12.10a |
| 12.11 | Signed-out return to sign-in | direct | `public/app.js:7` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/RootView.swift:15` | 1-signed-out | - | - |

## 13. Settings and notifications

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 13.1 | Notifications settings window | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationSettingsView.swift:15` | - | - | Mac-only; the page has no settings |
| 13.2 | Notify toggles: Needs you, Finishes, Fails | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationSettingsView.swift:21` | - | - | Mac-only |
| 13.3 | Which sessions: all or pinned, include routine runs | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationSettingsView.swift:30` | - | - | Mac-only |
| 13.4 | Dock badge with waiting count | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationSettingsView.swift:36` | - | - | Mac-only |
| 13.5 | macOS blocking notifications notice | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationSettingsView.swift:52` | - | - | Mac-only |
| 13.6 | Toolbar Notifications toggle | extra | https://github.com/kulesy/ghostshell/issues/177#issuecomment-6977576774 | `apple/GhostShellKit/Sources/GhostShellScreens/Notifications/NotificationToggle.swift:13` | 1-toolbar-notifications-on | - | Mac-only |
| 13.7 | Push alerts to the phone | missing | https://github.com/kulesy/ghostshell/issues/95 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Notifications/AlertPoster.swift:5` | - | - | Open PBI; iPhone path |
| 13.8 | Chrome extension reminder | direct | https://github.com/kulesy/ghostshell/pull/47 | `apple/GhostShellKit/Sources/GhostShellKit/Rules/BannerRules.swift:108` | 6-banners | banners/6-banners | - |
| 13.9 | Persisted state: view, folds, drafts, panel size | partial | `public/ui/storage.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Sidebar/SidebarState.swift:6` | 5-fold-kept | - | Panel width is not kept; no resize on the Mac |

## 14. Groups

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 14.1 | Group chat screen | direct | `public/ui/group.js:6` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupScreen.swift:5` | 11-view | groups/groups-2-group-chat | - |
| 14.2 | Group chat from its header | direct | https://github.com/kulesy/ghostshell/pull/24 | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupHeadingButton.swift:15` | 11-sidebar-heading | groups/groups-1-sidebar | - |
| 14.3 | Group screen: Chat and Sub sessions switch | partial | `public/ui/group.js:2` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupScreen.swift:104` | 11-view | groups/groups-2-group-chat | See 14.3a |
| 14.4 | Group missing, unloaded, opening, failed states | direct | `public/ui/group.js:60` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupScreen.swift:71` | - | - | - |
| 14.5 | Sub session cards with state, PR badge, next step | direct | `public/ui/subs.js:7` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionCard.swift:107` | 11-details | groups/groups-2-group-chat | https://github.com/kulesy/ghostshell/pull/17 |
| 14.6 | Sub session card: latest reply | direct | `public/ui/subs.js:159` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionCard.swift:161` | 11-details | - | - |
| 14.7 | Latest reply loading, error, none | direct | `public/ui/subs.js:157` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionCard.swift:153` | - | - | - |
| 14.8 | Sub session card: reply box | direct | `public/ui/subs.js:212` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupReplyBox.swift:26` | 11-reply-error | - | https://github.com/kulesy/ghostshell/pull/73 |
| 14.9 | Reply box: waiting-on-card note and Not sent | direct | `public/ui/subs.js:213` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupReplyBox.swift:40` | 11-reply-error | - | - |
| 14.10 | Sub session card: Archive, Stop and archive, Undo | direct | `public/ui/subs.js:37` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionsPanel.swift:57` | 11-details | - | - |
| 14.11 | Sub session card: fold | direct | `public/ui/subs.js:274` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionCard.swift:67` | 11-details | - | - |
| 14.12 | Sub sessions panel failed to read | direct | `public/ui/subs.js:339` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionsPanel.swift:35` | - | - | - |
| 14.13 | Group ranking post | partial | https://github.com/kulesy/ghostshell/pull/15 | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/GroupCards.swift:11` | - | - | Not verified on the Mac |
| 14.14 | Group sessions grouped into buckets with counts | direct | `public/ui/group-status.js:1` | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/SubSessionsPanel.swift:100` | 11-view | groups/groups-2-group-chat | - |
| 14.15 | Group heading in chip from spawn_task (Open, Start, Dismiss) | direct | https://github.com/kulesy/ghostshell/pull/73 | `apple/GhostShellKit/Sources/GhostShellScreens/Groups/ChipActions.swift:62` | 11-chip-open | - | - |

## 15. iPhone-only and web-only extras

| # | Item | Status | Reference | Target | Mac shot | Page shot | Notes |
|---|---|---|---|---|---|---|---|
| 15.1 | Swipe to archive on touch | missing | https://github.com/kulesy/ghostshell/pull/28 | `would go near apple/GhostShellKit/Sources/GhostShellScreens/Shell/PhoneShell.swift:5` | - | - | iPhone screens are open work: https://github.com/kulesy/ghostshell/issues/81 |
| 15.2 | Phone layout (single column) | partial | `public/app.js:8` | `apple/GhostShellKit/Sources/GhostShellScreens/Shell/PhoneLayout.swift:14` | - | - | Open under https://github.com/kulesy/ghostshell/issues/81 |
| 15.3 | Watch relay of waiting sessions | extra | https://github.com/kulesy/ghostshell/issues/97 | `apple/GhostShellKit/Sources/GhostShellKit/Watch/WatchRelayHandler.swift:56` | - | - | Native-only extra |
| 15.4 | Retire the web app: list each page feature against the Swift app | manual | https://github.com/kulesy/ghostshell/issues/96 | https://github.com/kulesy/ghostshell/issues/96 | - | - | This ledger is the input; the step needs an owner decision |

## Differences

Each entry comes from a side-by-side pair. A gap is a difference to close. A convention is a difference that follows a named platform rule, keeps the page's layout, and stays. A decision is a difference a recorded choice made after weighing the page's version, with its link. A question still needs a check.

| Id | Kind | Pair | What differs |
|---|---|---|---|
| 1.1a | convention | 1-list-rows | The Mac window has its own title bar and traffic lights. macOS HIG, Windows; kept native in https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623. |
| 1.4a | decision | 6-chat-rich (min) | At 640 the page shows one column with a Sessions back link. The Mac keeps the sidebar, by the decision in https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623, which weighed the page's single column. 5.9a shows what it costs the main pane. |
| 1.5a | gap, minor | 1-list-rows, 2-list-empty, 9-sidebar-routines | The empty main pane shows the diamond mark on the Mac and the arrows mark on the page. |
| 1.5b | convention | 1-list-rows | Key hints read Cmd+F, Cmd+N and Shift+Cmd+N on the Mac against Ctrl+K, Ctrl+N and Ctrl+Shift+N on the page. macOS HIG, Keyboard: Cmd+F is the standard Find. |
| 1.7a | gap | 5-project-view | The projects button opens a popup View menu (`ViewMenuContent.swift`). The page opens the projects rail. The menu came in with https://github.com/kulesy/ghostshell/pull/101, and https://github.com/kulesy/ghostshell/issues/175 and https://github.com/kulesy/ghostshell/pull/189 moved only the button. |
| 1.8a | gap, major | 5-project-view | The page docks a projects rail beside the sidebar on wide screens and opens it as a left sheet on narrow ones, with B to toggle it (1.63). The Mac has no rail, only the popup menu of 1.7a. No PR or PBI weighed the rail, and a code comment calling the menu its counterpart is not a decision. |
| 1.14a | gap | 5-search-archived, j-search-1-query | Find on the page opens a dialog over the window, with type chips (1.16), sections and a key hint footer (1.22), and it closes after a choice. The Mac filters the sidebar in an inline field under the header and keeps the filter after a choice. No PR or PBI chose the inline field. |
| 1.15a | gap, minor | 5-search-archived | The page closes search on Esc wherever focus is. The Mac handles Esc only in the search field (`SidebarHeader.swift:30`), so once focus moves to the list Esc likely leaves search open. From code, not a run. |
| 1.20a | gap, minor | 5-search-archived | The search empty state reads "Nothing matches that search." on the Mac and "Nothing matches." on the page. |
| 1.21a | gap, minor | - | While search loads, the page shows the text "Loading sessions" and the Mac shows placeholder rows. From code, no pair stages it. |
| 1.22a | gap | groups/organise-find | The page's search footer shows Close Esc, Change type with the arrows, Open Return and Unarchive Shift+Return. The Mac has no footer and no keys to change type or unarchive. |
| 1.26a | gap, minor | j-search-1-query | The Mac search result "Fix the flaky upload test" has no status dot. The page's result row has the dot row 1.26 gives every sidebar row. |
| 1.31a | gap, minor | 1-session-chosen | The chosen row on the Mac shows a chevron after the "..." button. The page shows "..." only. |
| 1.47a | gap, minor | 1-loading | While the sidebar loads, the page shows the text "Loading sessions" and the Mac shows placeholder rows. |
| 1.48a | gap | 3-unreachable | When sessions fail to load, the page shows "Could not load sessions" in the list. The Mac shows "Can't reach the server. Trying again." in the footer and retries by itself. |
| 1.52a | gap, minor | 6-accounts | The Mac's account menu always shows Accounts. The page shows it only when the server supports accounts. |
| 2.26a | gap | 8-new-group-sheet | New project and Rename project open a modal name sheet with Cancel and Save on the Mac. The page names it in an inline field in the projects rail, as the Mac already does for sessions and groups. |
| 3.15a | gap, major | 6-chat-empty | An empty chat on the Mac shows "Nothing here yet" mid-pane with the composer under it and a blank band below. The page keeps a blank thread with the composer at the bottom. |
| 3.23a | gap | 12-term-chat | The Run button on a `console` block looks turned off on the Mac, the same grey as the refused `sh` block. The page shows it on. The Mac also puts Run before Copy. |
| 3.25a | question | - | Each Markdown block on the Mac is its own view (`MarkdownView.swift:249`), so a selection may stop at a block's edge where the page selects across paragraphs. Check by selecting across two paragraphs. |
| 3.26a | gap | 7-composer-quote | The Mac quotes a whole message from its menu. The page quotes the selected text, with a Quote button beside the selection or Cmd+quote, so a part of a message can be quoted. |
| 3.31a | gap, minor | 6-chat-streaming | The Thought row on the Mac has a chevron and lighter text. |
| 3.32a | gap, minor | 6-chat-streaming | While a reply streams, the Mac shows a system spinner. The page shows its three-dot chaser and the animated shell mark. No PR chose the spinner, and the shell mark is the page's own content, not a control. |
| 3.40a | gap | 6-chat-rich | The page lists subagents as cards in a side panel tab, and each card opens. The Mac lists them as lines in a popover from the header button, with no card to open. https://github.com/kulesy/ghostshell/issues/176#issuecomment-6977301668 listed the old Mac strip as a gap, not a choice. |
| 3.54a | gap, minor | - | The Mac adds an icon and the server's error text (`ChatThreadView.swift:45`). The page shows the words and Try again only. |
| 4.1a | question | 7-widgets | The Mac code draws the page's ring (`ComposerView.swift:104`), and its text view sets no focus ring type, so a system ring may draw as well. Check in a key window whether one ring or two show. |
| 4.2a | gap | 1-session-chosen, 12-term-chat | The Mac placeholder reads "Type / for commands" with the terminal on. The page adds "or ! to run a command", and the Mac has no ! mode (rows 4.2 and 4.3). |
| 4.16a | gap, minor | 10-tool-tiles, 1-session-chosen | With no effort set, the Mac composer footer shows an "Effort" label next to the model. The page shows the model only. |
| 4.23a | gap | 7-new-session | The page has no folder step: a new session starts in the viewed project's or parent's folder, and the head says "Starts Claude Code in" the folder. The Mac asks for a path, with a Recent folders menu. |
| 5.7a | gap | 7-approval-edit, 7-approval-plan | The Mac edit and plan cards have no "All input" disclosure. The page shows it on every card. |
| 5.9a | gap, major | 7-approval-question | The Mac question card is shorter. At 960 the own-answer field and the second question sit below the fold. At 640 only the first option shows, cut through its description. The page shows both options and the own-answer field at 640. |
| 7.1a | question | 10-tool-tiles | With five pictures, the Mac shows three tiles and a "+2" tile. The page at 960 shows three tiles and no overflow tile, though `public/ui/gallery.js:32` has one. Check which is right. |
| 7.2a | gap | 10-viewer-tool | The Mac image viewer dims the chat pane and the sidebar header and footer, but leaves the sidebar list bright, and in light the title bar too, so the window looks half dimmed. The page dims the whole window. The page has Zoom and Open in a new tab buttons, and the Mac has an expand button instead. The pair also opens different pictures (3 of 7 against 6 of 7), a pair-data mismatch. |
| 7.8a | question | j-files-2-link, j-files-3-close | A toolbar icon shows in the Mac title bar once a file has opened: a panel toggle at step 2 and a document icon at step 3, after the panel has closed. Step 1 has none and the page has no counterpart. If it is the system inspector toggle it is a convention under 7.8 (macOS HIG, Inspectors), but the icon left after closing needs a look. |
| 7.8b | gap | 10-file-text-line | The Mac lays a file over the whole main pane at every width. The page puts the file panel beside the chat when the main pane is 704 or wider, and covers the chat only below that (`public/ui/terminal-rules.js:81`). From code, since no pair renders a main pane that wide. |
| 7.17a | gap, minor | 10-file-audio | The Mac draws its own play button, slider and time, with no volume or menu. The page uses the browser's audio bar, which has both. These are not system controls, and no PR chose them. |
| 7.19a | gap, minor | 10-file-binary | The Mac binary card's header has a Download button as well as the card's own. The page header has Close only. |
| 7.20a | question | 10-file-missing | For a file that is gone, the Mac says "There is no file at that path." with Close only. The page shows "TXT file, NaN MB" with Download and Open in a new tab, which looks like a page bug (https://github.com/kulesy/ghostshell/issues/177). Check which is right. |
| 7.23a | gap | 10-file-markdown, 10-file-pdf | The Mac file header has no "Open in a new tab" button (row 7.23). |
| 7.32a | gap | journey `files`, step `escape` in run https://github.com/kulesy/ghostshell/actions/runs/44886589954 | Esc closes the file panel on the page and does nothing on the Mac, where the system beeps instead. The Mac's image viewer closes on Esc (`ImageViewer.swift:101`), so the file panel is the odd one out. macOS HIG, Keyboard: Esc dismisses. The journey now closes with the Close button on both sides, so the run's sound check passes. |
| 10.7a | question | 6-force-question | The page's banner stack shows the Chrome extension banner, and the Mac's does not. The Mac shows that banner on Accounts. Check whether the pair data or `BannerRules.swift` differs. |
| 10.12b | gap, minor | 6-force-question | A click on the Mac's backdrop cancels Force restart (`BannerStack.swift:123`). The page's alert ignores a press outside it. Neither click forces a restart. |
| 10.14a | gap, minor | 6-banners | The Mac card has a faint shadow (`BannerCardView.swift:44`) and the page's has none. The Mac caps the stack at half the window, where the page keeps room for the list, and its fade stays at the end of a scrolled stack. |
| 11.1a | gap | 9-routines-list, 9-scheduled-list | With rows in the Routines or Scheduled list, the Mac sidebar loses its header (brand, New, Search) and its Routines and Scheduled tabs. The page keeps both. `9-routines-empty`, `9-scheduled-empty` and `9-sidebar-routines` keep them on the Mac, so this looks like a layout bug when the list has rows. The SCHEDULED heading on the page also has a new-schedule button the Mac lacks. |
| 11.8a | convention | 9-routines-list (dark, min) | Mac switches show grey in an inactive window. macOS HIG, Toggles. This is the system's inactive window styling in a background render. |
| 11.14a | gap, minor | j-routines-2-new to j-routines-5-prompt | The Mac form's Title and Group fields show "Title" and "Group" as placeholders. On the page both fields are blank. |
| 11.15a | gap, minor | 9-routine-form | The page suggests Group values as you type. The Mac's Group field is a text field with a chevron menu of past values, which needs a click and does not filter. |
| 11.19a | gap, minor | 9-routine-form | The schedule hint reads "in the GhostShell server's time zone" on the Mac and "in this Mac's time" on the page. |
| 11.29a | question | j-routines-1-route to j-routines-6-save | The Scheduled section lists 3 items on the Mac and 4 on the page. The page's extra row has no title, only "Starts Tomorrow, 09:00", under "Draft the release notes". Both use the same stub. Check whether the page splits one item into two rows or the Mac drops one. |
| 11.29b | gap, minor | j-routines-1-route to j-routines-6-save | The sidebar's Scheduled row "Rotate the keys" cuts off differently. The Mac keeps the title and cuts the error ("...is not th..."). The page cuts the title ("Rotate the k...") and shows the error in full. |
| 11.40a | question | j-routines-6-save | After Save, the page shows the toast "Added “Weekly digest”." and the Mac shot shows no note. The Mac code sets the same note (`RoutineFormScreen.swift:310`) and `NoteBar` shows it for 6 seconds, so the Mac shot may come after it has gone. Check with a Mac shot taken straight after Save. |
| 12.10a | gap | - | With no password set, the page serves a setup page that says so and says what to run. The Mac sign-in shows "The server answered with an error (503). Try again." From code, not a run. |
| 14.3a | gap | 11-view | Below 680pt the Mac group screen switches between Chat and Sub sessions with a segmented control at the top. The page keeps the panel beside the chat at 704 and wider and covers the chat with it below that, opened from a header button. The Mac's wide panel is a fixed 320 and the page's can be resized. |

## Pass log

**21 Nov 2026, commit d19857db.** Mac shots from the `Swift app` workflow on the `xcode-27` runner. Web shots from `page-shots.mjs --set all` in the headless shell at 960 and 640, light and dark.

- 148 pairs laid side by side. All 38 default light pairs read, plus a sample at 640 and in dark.
- 4 pairs had one side missing at the minimum size. `10-tool-tiles` has no Mac shot there. The Mac names its `6-chat-rich-middle` shot at that size `-min-<scheme>`, which this run missed and the pair run now accepts.
- 47 Mac shots had no web partner. Most are states the page shots don't stage, such as `7-composer-quote`, `7-composer-slash` and the terminal steps.
- 19 web shots had no Mac partner: `01-sign-in`, `02-sidebar`, `07b-approval-plan-buttons`, `09-accounts`, `09b-accounts-scrolled`, `10-passkeys`, `10-viewer-picture`, `11-account-menu`, the groups shots and the organise shots. The runner can't run the Mac `organise`, `groups` and `marks` flows, so those rows have no Mac shot.
- Pair-data mismatches, not gaps: the page proxy turns on Scheduled, so the page sidebar shows a Scheduled tab where the Mac chat shots don't. The `6-banners` Mac sidebar has 3 rows against 14 on the page. The Mac `7-composer-draft` has two quote chips and the page has none. `6-chat-rich-middle` and `04-chat-scrolled` stop at different scroll positions.
- More pair-data mismatches: the page's empty Routines, Scheduled, Accounts and Passkeys shots empty the whole sidebar, where the Mac keeps its groups. `6-passkeys` has two passkeys on the Mac and one on the page. The Mac Routines and Scheduled shots come from an inactive window.
- The page side of `10-file-pdf` is blank because the headless shell has no PDF viewer.

**21 Nov 2026, commit 23ceaebb.** A rerun after the pair run fixes gave 150 pairs, 2 with one side missing (`10-tool-tiles` at the minimum size) and 46 Mac shots with no web partner. A like-for-like review read all the default light pairs and a sample at 640 and in dark, and corrected 1.31a, 3.31a, 7.2a, 11.1a and the statuses of 7.2 and 11.19, and added 7.20a.

**21 Nov 2026, first journey pass, run https://github.com/kulesy/ghostshell/actions/runs/44898115869.** Six journeys from `apple/scripts/journeys.mjs`, 20 steps, played on both apps at 960 by 640 in light, with each step's pair read side by side. The web page played all 20 steps. The Mac played 18 in that run and all 20 in the rerun at https://github.com/kulesy/ghostshell/actions/runs/44908585701, after a runner fix.

- The journeys found two things the fixed shots had missed. Esc does not close the file panel on the Mac (7.32a, seen in the earlier run https://github.com/kulesy/ghostshell/actions/runs/44886589954, since this run closes the panel with its button). After a routine is saved, the page shows an Added toast and the Mac shot shows none (11.40a), though the Mac code has the same note.
- `routines`: on the Routines list screen the Mac sidebar has no brand, New, Search or footer tabs, at both `route` and `save`, as 11.1a describes. The Scheduled section holds a different number of items on each side in all six steps (11.29a), and its error row cuts off differently (11.29b). The form's Title and Group show placeholders on the Mac only (11.14a).
- `search`: the Mac runner first counted the search heading as a result and failed `query`, a runner defect now fixed. In the rerun both steps match apart from rows already logged. Row 1.14 shows at both steps: the Mac filters the sidebar inline and keeps the filter after a choice, while the page's dialog closes and the full list returns. Row 1.16 shows at `query`, where the page's dialog has type chips.
- Pair-run states, not gaps: in `approvals-question` the page shows both questions from step `open` and scrolls to the second at `pick-checks`, while the Mac card stays on the first. In `routines`, step `prompt`, the page scrolls to the prompt and the Mac stays at the top of the form, so the Mac's prompt, schedule toggle and Save went unread. The Routines window is not the key window, so the Mac draws no focus ring on the field being typed into. The Folder default and the clock times differ with the runner.
- `chat`, `approvals-bash` and `files` matched step for step apart from rows already logged and the title bar icon in `files` (7.8a). The search result has no status dot on the Mac (1.26a).

**22 Nov 2026, decision audit.** Rows 1.7 and 1.8 had been filed `translated`, though nobody chose a popup menu over the page's projects rail. This pass held every `translated` and `unsupported` row and every convention to the rule under Statuses, traced each to its PR or PBI, and kept one only where a platform rule or a recorded decision chose it.

- Kept: 1.1 by the decision in https://github.com/kulesy/ghostshell/issues/175#issuecomment-6931080623, 9.14 and 9.19 by https://github.com/kulesy/ghostshell/pull/104, 1.29 and 11.38 as system controls, and 1.2, 1.72 and 10.13 as platform limits. 3.11 moved from `unsupported` to `translated`, since the window title names the chat. 1.4 and 3.2 moved from `translated` to `unsupported` under the 1.1 decision, because keeping two columns changes the layout. Conventions 1.1a, 1.5b and 11.8a stay, and 1.4a is now a decision.
- Nobody chose these, so they are gaps now: 1.7, 1.14, 1.15, 1.20, 1.21, 1.48, 1.52, 2.26, 2.27, 3.26, 3.40, 4.23, 7.8, 8.13 and 14.3 are `partial`, and 1.8, 1.22, 1.63 and 12.10 are `missing`. 1.47, 3.32, 7.17 and 11.15 move from `direct` to `partial`. 1.47 shows placeholder rows where the page shows text, and the conventions 3.32a, 7.17a and 11.15a swapped in custom controls, not system ones. Each has a gap entry under Differences, with 7.8b as the new one for 7.8.
- These now match the page and are `direct`: 1.45, 3.8, 3.25, 3.54, 7.18, 10.12, 10.14 and 11.21. https://github.com/kulesy/ghostshell/pull/192 brought 10.12 to the page's dialog, so convention 10.12a is gone. Minor gaps 3.54a, 10.12b and 10.14a record what still differs on three of them.
- 4.1a is a question now: the Mac draws the page's ring, and a system ring may draw as well. 3.25a asks whether a Mac selection crosses paragraphs.
