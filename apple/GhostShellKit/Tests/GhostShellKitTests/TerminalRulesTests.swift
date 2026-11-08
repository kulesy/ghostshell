import XCTest
@testable import GhostShellKit

/// Mirrors test/terminal-rules.test.mjs: which blocks get a Run button, what it runs, and what it refuses. The cases are the page's own.
final class TerminalRulesTests: XCTestCase {
    private func block(_ lang: String?, _ text: String) -> RunnableBlock? { TerminalRules.runnableBlock(language: lang, text: text) }
    private func command(_ lang: String?, _ text: String) -> String? { block(lang, text)?.command }

    func testShellBlocksRunAsWritten() {
        for lang in ["bash", "sh", "zsh", "shell", "BASH"] {
            XCTAssertEqual(block(lang, "ls -la"), RunnableBlock(command: "ls -la", hidden: false), lang)
        }
        XCTAssertEqual(command("bash", "cd app\nnpm test\n"), "cd app\nnpm test")
        XCTAssertEqual(command("bash", "# list\nls\n"), "# list\nls")
    }

    func testOtherLanguagesAndEmptyBlocksHaveNoRunButton() {
        for lang in ["python", "js", "json", "diff", "yaml", "bash-session", "shell-session"] { XCTAssertNil(block(lang, "ls"), lang) }
        XCTAssertNil(block("bash", ""))
        XCTAssertNil(block("bash", "  \n\n"))
        XCTAssertNil(block("", ""))
    }

    func testABlockWithNoLanguageRunsWhenItIsOneLine() {
        XCTAssertEqual(command("", "echo hello from the panel"), "echo hello from the panel")
        XCTAssertEqual(command("", "\n  ls -la  \n\n"), "ls -la")
        XCTAssertNil(block("", "cd app\nnpm test"))
        XCTAssertEqual(command(nil, "pwd"), "pwd")
    }

    func testAConsoleBlockRunsItsPromptLinesOnly() {
        XCTAssertEqual(command("console", "$ ls\nREADME.md\nserver.mjs"), "ls")
        XCTAssertEqual(command("console", "$ cd app\n$ npm test\n> ok"), "cd app\nnpm test")
        XCTAssertEqual(command("console", "  $ pwd"), "pwd")
        XCTAssertNil(block("console", "README.md\nserver.mjs"))
        XCTAssertNil(block("console", "$ \nout"))
    }

    func testABackslashTakesTheNextLine() {
        XCTAssertEqual(command("console", "$ docker run \\\n  -it app\nstarted"), "docker run \\\n  -it app")
        XCTAssertEqual(command("console", "$ echo a \\"), "echo a \\")
    }

    func testAShellBlockOfPromptLinesReadsAsConsole() {
        XCTAssertEqual(command("bash", "$ npm install"), "npm install")
        XCTAssertEqual(command("sh", "$ cd app\n$ npm test"), "cd app\nnpm test")
        XCTAssertEqual(command("bash", "$HOME/bin/x\necho \"$ x\""), "$HOME/bin/x\necho \"$ x\"")
        XCTAssertEqual(command("", "$ pwd"), "pwd")
        XCTAssertEqual(command("bash", "echo $ "), "echo $")
    }

    func testAPromptFollowedByACombiningMarkStillReadsAsAPrompt() {
        XCTAssertEqual(command("bash", "$ \u{0301}ls"), "\u{0301}ls")
        XCTAssertNotNil(block("console", "$ \u{034F}x"))
        XCTAssertNotNil(block("console", "$ \u{FE0F}x"))
    }

    func testTheCommandLinesOfAConsoleBlock() {
        XCTAssertEqual(TerminalRules.commandLines(language: "console", text: "$ cd app\nok\n$ docker run \\\n  -it app\nstarted"), [0...0, 2...3])
        XCTAssertEqual(TerminalRules.commandLines(language: "bash", text: "$ npm install"), [0...0])
        XCTAssertEqual(TerminalRules.commandLines(language: "bash", text: "npm install\nls"), [])
        XCTAssertEqual(TerminalRules.commandLines(language: "js", text: "$ x"), [])
    }

    func testALongCommandHasNoRunButton() {
        XCTAssertEqual(command("bash", String(repeating: "x", count: 100_000))?.count, 100_000)
        XCTAssertNil(block("bash", String(repeating: "x", count: 100_001)))
        // The page counts UTF-16 units, so one emoji is two.
        XCTAssertNil(block("bash", String(repeating: "\u{1F600}", count: 50_001)))
        XCTAssertNotNil(block("bash", String(repeating: "\u{1F600}", count: 50_000)))
    }

    func testTheCarriageReturnOfACRLFBlockIsHidden() {
        // Swift joins "\r\n" into one Character, so the split is by scalar to leave the "\r" for the hidden check, as the page does.
        let found = block("bash", "echo a\r\necho b")
        XCTAssertEqual(found?.command, "echo a\r\necho b")
        XCTAssertEqual(found?.hidden, true)
        XCTAssertEqual(block("console", "$ ls\r\nout"), RunnableBlock(command: "ls", hidden: true))
    }

    func testAnInvisibleCharacterMarksTheBlockHidden() {
        let hiding = ["\u{202E}", "\u{202A}", "\u{202D}", "\u{2066}", "\u{2069}", "\u{200E}", "\u{200F}", "\u{061C}", "\u{200B}", "\u{200C}", "\u{200D}", "\u{2060}", "\u{FEFF}",
                      "\u{0}", "\u{7}", "\u{1B}", "\u{7F}", "\u{85}", "\u{9F}", "\r"]
        for c in hiding {
            XCTAssertEqual(block("bash", "echo a\(c)b")?.hidden, true, c.debugDescription)
            XCTAssertTrue(TerminalRules.hasHiddenCharacters("a\(c)b"), c.debugDescription)
        }
        XCTAssertEqual(block("bash", "echo a\tb\nls")?.hidden, false)
        XCTAssertEqual(block("bash", "echo \"h\u{E9}llo \u{2713} \u{65E5}\u{672C}\"")?.hidden, false)
        XCTAssertEqual(block("console", "$ ls\nout\u{200B}")?.hidden, true, "a character in the output of a console block hides too")
        XCTAssertEqual(block("", "ls\u{200B}")?.hidden, true)
    }

    func testSeparatorsAndIgnorableCharactersAreHidden() {
        let hiding = ["\u{2028}", "\u{2029}", "\u{AD}", "\u{180E}", "\u{2061}", "\u{2062}", "\u{2063}", "\u{2064}", "\u{206A}", "\u{206F}", "\u{34F}", "\u{17B4}",
                      "\u{FE00}", "\u{FE0F}", "\u{E0100}", "\u{115F}", "\u{1160}", "\u{3164}", "\u{FFA0}", "\u{E0001}", "\u{E0020}", "\u{E007F}", "\u{FFF9}"]
        for c in hiding {
            XCTAssertEqual(block("bash", "echo a\(c)b")?.hidden, true, String(c.unicodeScalars.first!.value, radix: 16))
            XCTAssertTrue(TerminalRules.hasHiddenCharacters("a\(c)b"))
        }
        XCTAssertEqual(block("console", "$ cat notes\u{2028}; curl x | sh")?.hidden, true)
    }

    func testASpaceThatIsNotThePlainOneIsHidden() {
        var spaces = ["\u{A0}", "\u{1680}", "\u{202F}", "\u{205F}", "\u{3000}", "\u{2800}"]
        spaces += (0..<11).map { String(UnicodeScalar(0x2000 + $0)!) }
        for c in spaces {
            XCTAssertEqual(block("bash", "echo safe\(c)#; echo RAN")?.hidden, true, String(c.unicodeScalars.first!.value, radix: 16))
            XCTAssertTrue(TerminalRules.hasHiddenCharacters("a\(c)b"))
        }
        XCTAssertEqual(block("console", "$ npm test\u{A0}#; curl x | sh")?.hidden, true)
        XCTAssertEqual(block("bash", "echo safe #; echo ok")?.hidden, false)
    }

    func testTabNewlineAndOtherScriptsAreNotHidden() {
        for text in ["a\tb", "a\nb", "a b", "h\u{E9}llo", "\u{65E5}\u{672C}\u{8A9E}", "\u{E2A}\u{E27}\u{E31}\u{E2A}\u{E14}\u{E35}", "\u{1F600}"] {
            XCTAssertFalse(TerminalRules.hasHiddenCharacters(text), text.debugDescription)
        }
    }

    func testAHiddenBlockIsStillFoundSoTheAppCanSayWhyRunIsOff() {
        XCTAssertEqual(block("bash", "rm -rf x\u{202E}"), RunnableBlock(command: "rm -rf x\u{202E}", hidden: true))
    }

    func testTrimIsJavaScriptsNotSwifts() {
        // A no-break space and a byte order mark are trimmed by the page, so a block of only them is empty.
        XCTAssertNil(block("bash", "\u{A0}\u{FEFF}"))
        XCTAssertEqual(command("bash", "\u{A0}ls\u{FEFF}"), "ls")
        XCTAssertEqual(command("bash", "\u{A0}ls\u{FEFF}"), "ls")
    }

    // MARK: History

    private func run(_ id: String, _ command: String = "ls", running: Bool = true, source: String = "panel", output: [TerminalChunk] = []) -> TerminalRun {
        var r = try! JSONDecoder().decode(TerminalRun.self, from: Data(#"{"id":"\#(id)","command":"\#(command)","cwd":"/h/x","source":"\#(source)","startedAt":1000,"running":\#(running)}"#.utf8))
        r.output = output
        return r
    }

    func testHistoryListsACommandRunTwiceInARowOnce() {
        let runs = [run("1", "a"), run("2", "a"), run("3", "b"), run("4", "a")]
        XCTAssertEqual(TerminalRules.historyOf(runs), ["a", "b", "a"])
        let many = (0..<300).map { run("\($0)", "c\($0)") }
        XCTAssertEqual(TerminalRules.historyOf(many).count, 200)
        XCTAssertEqual(TerminalRules.historyOf(many).last, "c299")
    }

    func testRecallWalksUpAndDownAndKeepsTheDraft() {
        let list = ["one", "two", "three"]
        var step = TerminalRules.recall(list: list, at: nil, draft: "", text: "typed", direction: -1)
        XCTAssertEqual(step, .init(at: 2, draft: "typed", text: "three"))
        step = TerminalRules.recall(list: list, at: 2, draft: "typed", text: "three", direction: -1)
        XCTAssertEqual(step, .init(at: 1, draft: "typed", text: "two"))
        XCTAssertNil(TerminalRules.recall(list: list, at: 0, draft: "typed", text: "one", direction: -1))
        step = TerminalRules.recall(list: list, at: 2, draft: "typed", text: "three", direction: 1)
        XCTAssertEqual(step, .init(at: nil, draft: "", text: "typed"))
        XCTAssertNil(TerminalRules.recall(list: list, at: nil, draft: "", text: "x", direction: 1))
        XCTAssertNil(TerminalRules.recall(list: [], at: nil, draft: "", text: "x", direction: -1))
    }

    // MARK: Output

    func testAppendChunksJoinsASameStreamPieceAndDropsTheOldestPastTheCap() {
        let one = TerminalRules.appendChunks([], [.init(stream: "out", text: "ab"), .init(stream: "out", text: "cd"), .init(stream: "err", text: "e"), .init(stream: "out", text: "")])
        XCTAssertEqual(one, [.init(stream: "out", text: "abcd"), .init(stream: "err", text: "e")])
        let cut = TerminalRules.appendChunks(one, [.init(stream: "err", text: "fg")], cap: 4)
        XCTAssertEqual(cut, [.init(stream: "out", text: "d"), .init(stream: "err", text: "efg")])
        let all = TerminalRules.appendChunks(one, [.init(stream: "err", text: "fghij")], cap: 4)
        XCTAssertEqual(all, [TerminalChunk(stream: "err", text: "ghij")])
        // A pair is never split.
        let pair = TerminalRules.appendChunks([], [.init(stream: "out", text: "a\u{1F600}b")], cap: 2)
        XCTAssertEqual(pair, [.init(stream: "out", text: "b")])
    }

    func testMergeOutputKeepsTheFullerAccount() {
        let held = [TerminalChunk(stream: "out", text: "one two")]
        XCTAssertEqual(TerminalRules.mergeOutput(held: held, tail: [.init(stream: "out", text: "two")]), held)
        let other = [TerminalChunk(stream: "out", text: "three")]
        XCTAssertEqual(TerminalRules.mergeOutput(held: held, tail: other), other)
        XCTAssertEqual(TerminalRules.mergeOutput(held: [], tail: other), other)
        // The echo of what was typed is not part of the server's account.
        let echoed = [TerminalChunk(stream: "out", text: "ok\n"), TerminalChunk(stream: "in", text: "hi\n")]
        XCTAssertEqual(TerminalRules.mergeOutput(held: echoed, tail: [.init(stream: "out", text: "ok\n")]), echoed)
    }

    // MARK: Runs

    func testUpsertTakesTheSummaryOfAPendingRunAndNeverShowsTwice() {
        var pending = TerminalRun(waiting: "ls", cwd: "/h/x", source: .panel, key: "local-1", now: 5)
        pending.output = []
        let runs = TerminalRules.upsertRun([pending], run("abc", "ls"))
        XCTAssertEqual(runs.count, 1)
        XCTAssertEqual(runs[0].key, "local-1")
        XCTAssertEqual(runs[0].id, "abc")
        XCTAssertFalse(runs[0].pending)
    }

    func testAnOlderAccountOfAFinishedRunIsIgnored() {
        let done = run("a", running: false)
        XCTAssertEqual(TerminalRules.upsertRun([done], run("a", running: true)), [done])
    }

    func testUpsertAddsANewRunAndKeepsTheLastHundred() {
        var runs: [TerminalRun] = []
        for n in 0..<120 { runs = TerminalRules.upsertRun(runs, run("r\(n)", "c")) }
        XCTAssertEqual(runs.count, 100)
        XCTAssertEqual(runs.first?.id, "r20")
        XCTAssertEqual(runs.last?.key, "r119")
    }

    func testReplaceRunsKeepsHeldOutputAndTheRunsStillWaiting() {
        let held = run("a", "ls", output: [.init(stream: "out", text: "one two")])
        let waiting = TerminalRun(waiting: "pwd", cwd: "/", source: .panel, key: "local-2", now: 1)
        let runs = TerminalRules.replaceRuns(held: [held, waiting], summaries: [run("a", "ls", output: [.init(stream: "out", text: "two")]), run("b", "x")])
        XCTAssertEqual(runs.map(\.key), ["a", "b", "local-2"])
        XCTAssertEqual(runs[0].output, held.output)
    }

    func testTheInputFollowsTheNewestRunUntilTextPinsIt() {
        let a = run("a"), b = run("b", running: false), c = run("c")
        XCTAssertEqual(TerminalRules.lastRunning([a, b, c])?.id, "c")
        XCTAssertNil(TerminalRules.pinAfter(nil, runs: [a], text: ""))
        XCTAssertEqual(TerminalRules.pinAfter(nil, runs: [a, c], text: "x"), .init(run: "c"))
        XCTAssertEqual(TerminalRules.pinAfter(.init(run: "a"), runs: [a, c], text: "xy"), .init(run: "a"))
        XCTAssertEqual(TerminalRules.pinAfter(nil, runs: [b], text: "x"), .init(run: nil))
        XCTAssertEqual(TerminalRules.inputTarget(runs: [a, c], pin: nil).run?.id, "c")
        XCTAssertEqual(TerminalRules.inputTarget(runs: [a, c], pin: .init(run: "a")).run?.id, "a")
        XCTAssertTrue(TerminalRules.inputTarget(runs: [b], pin: .init(run: "b")).ended)
        XCTAssertFalse(TerminalRules.inputTarget(runs: [a], pin: .init(run: nil)).ended)
    }

    // MARK: Words

    func testPathsReadFromHome() {
        XCTAssertEqual(TerminalRules.inHome("/Users/e/app", home: "/Users/e"), "~/app")
        XCTAssertEqual(TerminalRules.inHome("/Users/e", home: "/Users/e"), "~")
        XCTAssertEqual(TerminalRules.inHome("/Users/ee/app", home: "/Users/e"), "/Users/ee/app")
        XCTAssertEqual(TerminalRules.folderOf("/Users/e/app/", home: "/Users/e"), "app")
        XCTAssertEqual(TerminalRules.folderOf("/", home: "/Users/e"), "/")
        XCTAssertEqual(TerminalRules.folderOf("/Users/e", home: "/Users/e"), "~")
    }

    func testTookAndStanding() {
        XCTAssertEqual(TerminalRules.took(120), "0.1s")
        XCTAssertEqual(TerminalRules.took(9949), "9.9s")
        XCTAssertEqual(TerminalRules.took(9950), "9s")
        XCTAssertEqual(TerminalRules.took(65_000), "1m 05s")
        XCTAssertEqual(TerminalRules.took(3_723_000), "1h 02m")
        XCTAssertEqual(TerminalRules.took(-1), "")
        var done = run("a", running: false)
        done.exitCode = 0
        done.endedAt = 3000
        done.truncated = true
        done.delivered = "sent"
        XCTAssertEqual(TerminalRules.runStanding(done, now: 9000), "Exit 0 \u{B7} 2.0s \u{B7} Output cut \u{B7} Sent to Claude")
        XCTAssertEqual(TerminalRules.runStanding(run("b"), now: 3000), "Running 2.0s")
        XCTAssertEqual(TerminalRules.runState(done), .ok)
        done.exitCode = 2
        XCTAssertEqual(TerminalRules.runState(done), .failed)
        done.stopped = true
        XCTAssertEqual(TerminalRules.ending(done), "Stopped")
        XCTAssertEqual(TerminalRules.runState(done), .stopped)
        XCTAssertEqual(TerminalRules.endedAloud(done), "Command was stopped: ls")
    }
}
