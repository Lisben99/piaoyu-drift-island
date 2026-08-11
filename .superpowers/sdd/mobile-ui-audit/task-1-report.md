# Task 1 report: Controlled viewport and scroll roots

## RED

Command:

```powershell
& 'C:\Users\共产主义接班人\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server\test-mobile-ui.js
```

Output (expected):

```text
tests 4
pass 0
fail 4
AssertionError: index.html must define syncAppViewport()
AssertionError: page-home must use main-tab-page
```

The initial failure was caused by the missing viewport helpers and missing main-tab page/scroll-root markup, rather than a test harness error.

## GREEN

Command:

```powershell
& 'C:\Users\共产主义接班人\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server\test-mobile-ui.js
```

Output:

```text
✔ syncAppViewport uses the rounded visual viewport height and falls back to innerHeight
✔ resetPageScroll clears the page and all nested scroll roots
✔ navigateTo preserves stack and replace semantics before resetting after page entry
✔ each main tab page has one dedicated scroll root
tests 4
pass 4
fail 0
```

## Syntax check

Command:

```powershell
$node = 'C:\Users\共产主义接班人\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$tempFile = Join-Path $env:TEMP 'piaoyu-mobile-ui-inline.js'
$html = Get-Content -Raw -Encoding UTF8 index.html
$scripts = [regex]::Matches($html, '(?s)<script\b(?![^>]*\bsrc=)[^>]*>(.*?)</script>') | ForEach-Object { $_.Groups[1].Value }
[IO.File]::WriteAllText($tempFile, [string]::Join("`n", [string[]]$scripts), [Text.UTF8Encoding]::new($false))
& $node --check $tempFile
$syntaxExit = $LASTEXITCODE
Remove-Item -LiteralPath $tempFile
exit $syntaxExit
```

Output:

```text
exit 0 (no output)
```

## Changed files

- `index.html`
- `server/test-mobile-ui.js`
- `.superpowers/sdd/mobile-ui-audit/task-1-report.md`

## Commit

`fix(ui): stabilize mobile viewport navigation`

## Self-review

- `html` and `body` are fixed-height, overflow-locked roots; `#app` uses `--app-height` with a `100dvh` fallback and no content-driven minimum height.
- `syncAppViewport`, `resetPageScroll`, and `navigateTo` are exercised from the actual definitions extracted from `index.html` in a controlled VM DOM.
- Navigation retains push/replace stack behavior and resets each page's scroll root only after the page-entry work runs.
- Home, lobby, community, messages, and settings are isolated main-tab pages, each with exactly one scroll root; status and tab bars include safe-area padding.
- No admin page or backend API was modified. `git diff --check` reported no whitespace errors.

## Concerns

None.
