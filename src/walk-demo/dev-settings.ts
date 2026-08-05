/**
 * Developer settings — tools that must never reach a viewer.
 *
 * Resolved in precedence order:
 *   1. ?dev= query param  — explicit, and remembered in localStorage
 *   2. localStorage       — whatever you last chose, including "off"
 *   3. VITE_DEV_FLAGS     — the .env default
 *
 * Query param forms:
 *   ?dev=1                 every flag
 *   ?dev=collision         one flag
 *   ?dev=collision,portals several
 *   ?dev=0                 clear everything, overriding the .env default
 *
 * The env default is what makes tooling on by default for developers, while
 * ?dev=0 still lets you see the app exactly as a visitor would without editing
 * a file. Production builds ignore all of it — see `devEnabled`.
 */

export type DevFlag = 'collision' | 'portals';

const ALL_FLAGS: readonly DevFlag[] = ['collision', 'portals'];
const STORAGE_KEY = 'walkthrough-studio:dev-flags';

/** Null when nothing was ever stored, which is distinct from a stored "off". */
function readStored(): Set<string> | null {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? new Set(JSON.parse(raw) as string[]) : null;
    } catch {
        return null;
    }
}

function parseFlags(value: string): Set<string> {
    const v = value.trim().toLowerCase();
    if (v === '0' || v === 'off' || v === 'false' || v === '') {
        return new Set();
    }
    if (v === '1' || v === 'true' || v === 'all') {
        return new Set(ALL_FLAGS);
    }
    return new Set(
        v
            .split(',')
            .map((f) => f.trim())
            .filter((f): f is DevFlag => (ALL_FLAGS as readonly string[]).includes(f)),
    );
}

function write(flags: Set<string>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...flags]));
    } catch {
        // Private browsing and similar; the query param still works per-load.
    }
}

function resolve(): Set<string> {
    const param = new URLSearchParams(location.search).get('dev');
    if (param !== null) {
        const flags = parseFlags(param);
        write(flags);
        return flags;
    }
    return readStored() ?? parseFlags(String(import.meta.env.VITE_DEV_FLAGS ?? ''));
}

const active: Set<string> = resolve();

/**
 * Always false in a production build, because `import.meta.env.DEV` is a
 * build-time literal. Note this makes the dev code INERT in production, not
 * absent: the panel methods still ship as dead code inside the class, since
 * class methods are not tree-shaken. Moving the panel to a dynamically imported
 * module is what it would take to drop it from the bundle entirely.
 */
export function devEnabled(flag: DevFlag): boolean {
    return import.meta.env.DEV && active.has(flag);
}

const TOGGLE_KEY = 'walkthrough-studio:dev-toggles';

function readToggles(): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(TOGGLE_KEY);
        return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
        return {};
    }
}

/**
 * Remembered state of an individual debug toggle, separate from the flags above:
 * a flag decides whether a control EXISTS, a toggle whether it is currently on.
 * Both default off so a reload never surprises you with a scene full of debug
 * geometry — you turn a view on when you want it, and it stays on until you say
 * otherwise.
 */
export function readDevToggle(name: string, fallback = false): boolean {
    const stored = readToggles()[name];
    return typeof stored === 'boolean' ? stored : fallback;
}

export function writeDevToggle(name: string, value: boolean): void {
    try {
        localStorage.setItem(TOGGLE_KEY, JSON.stringify({ ...readToggles(), [name]: value }));
    } catch {
        // Private browsing; the toggle still works for this session.
    }
}

/** Flags currently on, for logging what is active at startup. */
export function activeDevFlags(): DevFlag[] {
    return ALL_FLAGS.filter((f) => devEnabled(f));
}
