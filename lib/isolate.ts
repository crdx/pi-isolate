import { join, resolve } from 'node:path'
import {
    NodeRuntime,
    NodeFileSystem,
    createNodeDriver,
    createNodeRuntimeDriverFactory,
} from 'secure-exec'
import type { StdioEvent, Permissions } from 'secure-exec'
import type { Config } from './config.js'
import { loadConfig } from './config.js'

const TIMEOUT_EXIT_CODE = 124

const runtimeDriverFactory = createNodeRuntimeDriverFactory()

const TWO_PATH_METHODS = new Set(['rename', 'symlink', 'link'])

// Wraps NodeFileSystem with path rewriting. secure-exec's ModuleAccessFileSystem normalises all
// paths to virtual absolute paths (e.g. "package.json" → "/package.json", "." → "/"). Paths that
// already start with a known real root (project dir, extra read/write paths) pass through unchanged.
// Everything else gets the project root prepended, mapping the virtual "/" to the project directory.
// This means both relative paths and real absolute paths work from the agent's perspective.
function createProjectFilesystem(projectRoot: string, config: Config): NodeFileSystem {
    const knownRoots = [projectRoot, ...config.extraReadPaths, ...config.extraWritePaths]

    const rewritePath = (path: string): string => {
        for (const root of knownRoots) {
            if (path === root || path.startsWith(trailingSlash(root))) {
                return path
            }
        }
        return join(projectRoot, path)
    }

    return new Proxy(new NodeFileSystem(), {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver) as unknown
            if (typeof value !== 'function') {
                return value
            }
            const method = value as (...args: unknown[]) => unknown
            if (TWO_PATH_METHODS.has(property as string)) {
                return (first: string, second: string, ...rest: unknown[]) =>
                    method.call(target, rewritePath(first), rewritePath(second), ...rest)
            }
            return (first: string, ...rest: unknown[]) =>
                method.call(target, rewritePath(first), ...rest)
        },
    })
}

const WRITE_OPS = new Set([
    'write', 'mkdir', 'createDir', 'rm', 'rename', 'symlink', 'link',
    'chmod', 'chown', 'utimes', 'truncate',
])

function trailingSlash(path: string): string {
    return path.endsWith('/') ? path : path + '/'
}

function isWithin(resolved: string, root: string): boolean {
    return resolved === root || resolved.startsWith(trailingSlash(root))
}

// Restricts filesystem access to the project directory plus any extra paths from config. Reads and
// writes within the project are allowed. Extra paths grant read-only or read-write access depending
// on which config list they appear in. Everything else is denied with EACCES. Paths arriving here
// are virtual absolute paths from ModuleAccessFileSystem (e.g. "/package.json" for a relative
// "package.json"), so we resolve them against the project root to get the real target.
function createPermissions(projectRoot: string, config: Config): Permissions {
    const readRoots = config.extraReadPaths.map(p => resolve(p))
    const writeRoots = config.extraWritePaths.map(p => resolve(p))
    const knownRoots = [projectRoot, ...readRoots, ...writeRoots]

    // Map a virtual path to a real path using the same logic as createProjectFilesystem.
    const toRealPath = (virtualPath: string): string => {
        for (const root of knownRoots) {
            if (virtualPath === root || virtualPath.startsWith(trailingSlash(root))) {
                return virtualPath
            }
        }
        return join(projectRoot, virtualPath)
    }

    return {
        fs: (request) => {
            const resolved = toRealPath(request.path)
            const isWrite = WRITE_OPS.has(request.op)

            // Project directory: full access.
            if (isWithin(resolved, projectRoot)) {
                return { allow: true }
            }

            // Extra write paths: full access.
            if (writeRoots.some(root => isWithin(resolved, root))) {
                return { allow: true }
            }

            // Extra read paths: read-only.
            if (!isWrite && readRoots.some(root => isWithin(resolved, root))) {
                return { allow: true }
            }

            return { allow: false, reason: `access denied: ${request.path}` }
        },
    }
}

export interface RunOptions {
    code: string
    cwd: string
    timeout: number
    signal?: AbortSignal
    onOutput?(output: string): void
}

export interface RunResult {
    output: string
    exitCode: number
}

// Runs compiled JavaScript in a secure-exec V8 isolate with filesystem access restricted to the
// project root. Uses the real host filesystem with permission-based access control, so paths inside
// the isolate match what the agent sees outside (no re-rooting). The isolate's cwd is set to the
// actual project directory.
//
// Accumulates stdout/stderr line by line, streaming each chunk via onOutput. Stderr is prefixed so
// the LLM can distinguish it:
//
//   stdout "hello"  → hello
//   stderr "oh no"  → [stderr] oh no
//
// Terminates the isolate if the abort signal fires. After execution, appends any runtime error not
// already in the output:
//
//   timeout  → [Killed: timeout after 60s]
//   crash    → RangeError: Maximum call stack size exceeded
//
// Returns the trimmed output and the process exit code.
export class Sandbox {
    async run(options: RunOptions): Promise<RunResult> {
        const { code, cwd, timeout, signal, onOutput } = options

        let output = ''

        const onStdio = (event: StdioEvent) => {
            output += (event.channel === 'stderr' ? '[stderr] ' : '') + event.message + '\n'
            onOutput?.(output)
        }

        const config = loadConfig()

        const runtime = new NodeRuntime({
            systemDriver: createNodeDriver({
                filesystem: createProjectFilesystem(cwd, config),
                permissions: createPermissions(cwd, config),
            }),
            runtimeDriverFactory,
            memoryLimit: 512,
        })

        const onAbort = () => {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            runtime.terminate().catch(() => {})
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        let result
        try {
            result = await runtime.exec(code, {
                cwd,
                cpuTimeLimitMs: timeout * 1000,
                onStdio,
            })
        } finally {
            signal?.removeEventListener('abort', onAbort)
            runtime.dispose()
        }

        const exitCode = result.code

        if (result.errorMessage && !output.includes(result.errorMessage)) {
            output += exitCode === TIMEOUT_EXIT_CODE
                ? `\n[Killed: timeout after ${timeout}s]`
                : '\n' + result.errorMessage
        }

        return { output: output.trimEnd(), exitCode }
    }
}
