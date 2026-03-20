# pi-isolate

**pi-isolate** is a pi extension that runs TypeScript (or JavaScript) in a sandboxed V8 isolate. Filesystem access is confined to the project root. No network, no subprocesses.

## Installation

```bash
pi install https://github.com/crdx/pi-isolate
```

## Usage

Just ask your agent to calculate something or to write a script and it should use the tool.

The guidelines tell it to use it for "calculations, data transformations, and bulk processing", so it should also trigger it itself when appropriate.

## How it works

The code is typechecked and then run in a V8 isolate with no networking or subprocess capabilities.

The isolate can read and write files within the project root but cannot escape it. Both relative paths (`README.md`) and sandbox-absolute paths (`/README.md`) work, as they all resolve to the project directory.

This functionality is provided by the [`secure-exec`](https://secureexec.dev) package.

## Display format

The tool's `intent` parameter is a one-line label shown before the script in the tool header. This is useful for quickly seeing what the agent thinks its code is doing without reading it.

The script itself is rendered with syntax highlighting, with a horizontal rule separating the script and the output. Collapsing and expanding works the same way as the other built-in tools.

## Differences from upstream example

The [secure-exec AI agent example](https://secureexec.dev/docs/use-cases/ai-agent-code-exec) calls `typecheckSource()` and `compileSource()` as separate steps. This extension just uses `compileSource()` since it typechecks as part of compilation and returns all diagnostics anyway. This reduces the time it takes to run each script.

## Node compatibility

Needs Node 24 (LTS).

Node 25 segfaults in `isolated-vm` during V8 context creation.

## Contributions

Open an [issue](https://github.com/crdx/pi-isolate/issues) or send a [pull request](https://github.com/crdx/pi-isolate/pulls).

## Licence

[GPLv3](LICENCE).
