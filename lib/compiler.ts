import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    createNodeDriver,
    createNodeRuntimeDriverFactory,
    allowAllFs,
} from 'secure-exec'
import {
    createTypeScriptTools,
    type TypeScriptDiagnostic,
} from '@secure-exec/typescript'

export interface CompileResult {
    code: string
    warnings: string
}

// The compiler sandbox overlays <cwd>/node_modules at /root/node_modules/ so require('typescript')
// works. Point cwd at the package root where typescript is installed, not the project root.
const extensionDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tools = createTypeScriptTools({
    systemDriver: createNodeDriver({
        permissions: { ...allowAllFs },
        moduleAccess: { cwd: extensionDir },
    }),
    runtimeDriverFactory: createNodeRuntimeDriverFactory(),
    memoryLimit: 512,
    cpuTimeLimitMs: 30000,
})

const COMPILER_OPTIONS = {
    module: 'commonjs',
    target: 'es2022',
    strict: false,
    esModuleInterop: true,
    types: ['node'],
}

// Compiles TypeScript to CommonJS via @secure-exec/typescript. A single compileSource() call
// type-checks and compiles in one isolate boot. Throws on type errors or empty output. Returns
// the compiled JS code and any formatted warnings (empty string if none).
export class Compiler {
    async run(source: string): Promise<CompileResult> {
        const compiled = await tools.compileSource({
            sourceText: source.trim(),
            filePath: '/root/script.ts',
            compilerOptions: COMPILER_OPTIONS,
        })

        if (!compiled.success || !compiled.outputText) {
            const errors = compiled.diagnostics.filter(d => d.category === 'error')
            throw new Error(
                errors.length > 0
                    ? 'Issues:\n\n' + formatDiagnostics(errors)
                    : 'Compilation failed.',
            )
        }

        const warnings = compiled.diagnostics.filter(d => d.category === 'warning')

        return {
            code: compiled.outputText,
            warnings: formatWarnings(warnings),
        }
    }
}

// Formats a single diagnostic into "line:col - message (TScode)".
function formatDiagnostic(diagnostic: TypeScriptDiagnostic): string {
    const line = diagnostic.line ?? '?'
    const column = diagnostic.column ?? '?'
    return `${line}:${column} - ${diagnostic.message} (TS${diagnostic.code})`
}

// Joins multiple diagnostics into a newline-separated block.
function formatDiagnostics(diagnostics: TypeScriptDiagnostic[]): string {
    return diagnostics.map(formatDiagnostic).join('\n')
}

// Formats TypeScript diagnostics into a labelled block, or returns '' if none.
//   → [warnings]
//     3:12 - Unsupported feature (TS1234)
//     5:1 - Deprecated syntax (TS5678)
function formatWarnings(diagnostics: TypeScriptDiagnostic[]): string {
    if (diagnostics.length === 0) {
        return ''
    }
    return `[warnings]\n${formatDiagnostics(diagnostics)}\n\n`
}
