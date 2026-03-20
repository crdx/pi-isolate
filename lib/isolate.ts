import { join } from 'node:path'
import {
    NodeRuntime,
    NodeFileSystem,
    createNodeDriver,
    createNodeRuntimeDriverFactory,
    allowAllFs,
} from 'secure-exec'
import type { StdioEvent } from 'secure-exec'

const TIMEOUT_EXIT_CODE = 124

const runtimeDriverFactory = createNodeRuntimeDriverFactory()

const TWO_PATH_METHODS = new Set(['rename', 'symlink', 'link'])

// Re-roots NodeFileSystem so virtual "/" maps to the given root directory. secure-exec normalises
// ".." before paths reach the VFS, so all paths are structurally confined. No escape from root.
// Created per-call to avoid shared mutable state across parallel tool executions.
function createRootedFilesystem(root: string) {
    return new Proxy(new NodeFileSystem(), {
        get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver) as unknown
            if (typeof value !== 'function') {
                return value
            }
            const method = value as (...args: unknown[]) => unknown
            if (TWO_PATH_METHODS.has(property as string)) {
                return (first: string, second: string, ...rest: unknown[]) =>
                    method.call(target, join(root, first), join(root, second), ...rest)
            }
            return (first: string, ...rest: unknown[]) =>
                method.call(target, join(root, first), ...rest)
        },
    })
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
// project root. The VFS re-roots virtual "/" to the project directory, and sandbox cwd is set to
// "/" so relative paths work naturally.
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

        const runtime = new NodeRuntime({
            systemDriver: createNodeDriver({
                filesystem: createRootedFilesystem(cwd),
                permissions: { ...allowAllFs },
            }),
            runtimeDriverFactory,
            memoryLimit: 128,
        })

        const onAbort = () => {
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            runtime.terminate().catch(() => {})
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        let result
        try {
            result = await runtime.exec(code, {
                cwd: '/',
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
