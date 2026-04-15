import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_PATH = join(homedir(), '.pi', 'agent', 'pi-isolate.json')

export interface Config {
    extraReadPaths: string[]
    extraWritePaths: string[]
}

const DEFAULT_CONFIG: Config = {
    extraReadPaths: [],
    extraWritePaths: [],
}

// Expands leading ~ to the user's home directory.
function expandHome(path: string): string {
    if (path === '~' || path.startsWith('~/')) {
        return homedir() + path.slice(1)
    }
    return path
}

// Reads pi-isolate.json from the pi config directory. Returns defaults if the file is missing.
// Throws on malformed JSON so misconfigurations are loud.
export function loadConfig(): Config {
    let raw: string
    try {
        raw = readFileSync(CONFIG_PATH, 'utf-8')
    } catch {
        return DEFAULT_CONFIG
    }

    const parsed = JSON.parse(raw) as Partial<Config>

    return {
        extraReadPaths: (parsed.extraReadPaths ?? []).map(expandHome),
        extraWritePaths: (parsed.extraWritePaths ?? []).map(expandHome),
    }
}
