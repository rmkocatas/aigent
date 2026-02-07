// ============================================================
// OpenClaw Deploy — Package Security Scanner (GitVerify)
// ============================================================

// --- Types ---

export interface ScanFinding {
  severity: 'info' | 'warning' | 'critical';
  category: string;
  message: string;
}

export interface NpmMetadata {
  name: string;
  version: string;
  description: string;
  weeklyDownloads: number;
  publishDate: string;
  maintainerCount: number;
  deprecated: boolean;
  repositoryUrl: string | null;
  hasLifecycleScripts: boolean;
}

export interface PackageScanReport {
  packageName: string;
  score: number; // 0-10
  verdict: 'SAFE' | 'CAUTION' | 'RISKY';
  findings: ScanFinding[];
}

// --- Top npm packages for typosquatting detection ---

const TOP_PACKAGES = [
  'lodash', 'express', 'react', 'axios', 'chalk', 'commander', 'debug',
  'moment', 'uuid', 'dotenv', 'cors', 'body-parser', 'webpack', 'typescript',
  'eslint', 'prettier', 'jest', 'mocha', 'next', 'vue', 'angular', 'jquery',
  'underscore', 'async', 'request', 'bluebird', 'minimist', 'glob', 'rimraf',
  'mkdirp',
];

// --- Levenshtein Distance (DP) ---

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Create a 2D DP table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      if (i === 0) {
        dp[i][j] = j;
      } else if (j === 0) {
        dp[i][j] = i;
      } else {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,      // deletion
          dp[i][j - 1] + 1,      // insertion
          dp[i - 1][j - 1] + cost, // substitution
        );
      }
    }
  }

  return dp[m][n];
}

// --- Layer 1: Static Analysis ---

/**
 * Check if a package name is suspiciously similar to a popular npm package.
 * Uses Levenshtein distance <= 2 to flag potential typosquatting.
 */
export function checkTyposquatting(name: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lower = name.toLowerCase();

  // Exact match means it IS the package, not a typosquat
  if (TOP_PACKAGES.includes(lower)) {
    return findings;
  }

  for (const popular of TOP_PACKAGES) {
    const distance = levenshteinDistance(lower, popular);
    if (distance > 0 && distance <= 2) {
      findings.push({
        severity: 'critical',
        category: 'typosquatting',
        message: `Package name "${name}" is suspiciously similar to popular package "${popular}" (Levenshtein distance: ${distance})`,
      });
    }
  }

  return findings;
}

// --- Homoglyph / Unicode detection ---

// Cyrillic characters that look like Latin characters
const CYRILLIC_LOOKALIKES: Record<string, string> = {
  '\u0430': 'a', // а → a
  '\u0435': 'e', // е → e
  '\u043E': 'o', // о → o
  '\u0440': 'p', // р → p
  '\u0441': 'c', // с → c
  '\u0443': 'y', // у → y
  '\u0445': 'x', // х → x
  '\u0410': 'A', // А → A
  '\u0412': 'B', // В → B
  '\u0415': 'E', // Е → E
  '\u041A': 'K', // К → K
  '\u041C': 'M', // М → M
  '\u041D': 'H', // Н → H
  '\u041E': 'O', // О → O
  '\u0420': 'P', // Р → P
  '\u0421': 'C', // С → C
  '\u0422': 'T', // Т → T
  '\u0425': 'X', // Х → X
};

// Greek characters that look like Latin characters
const GREEK_LOOKALIKES: Record<string, string> = {
  '\u03B1': 'a', // α → a
  '\u03BF': 'o', // ο → o
  '\u03C1': 'p', // ρ → p
  '\u0391': 'A', // Α → A
  '\u0392': 'B', // Β → B
  '\u0395': 'E', // Ε → E
  '\u0397': 'H', // Η → H
  '\u0399': 'I', // Ι → I
  '\u039A': 'K', // Κ → K
  '\u039C': 'M', // Μ → M
  '\u039D': 'N', // Ν → N
  '\u039F': 'O', // Ο → O
  '\u03A1': 'P', // Ρ → P
  '\u03A4': 'T', // Τ → T
  '\u03A7': 'X', // Χ → X
};

/**
 * Check for homoglyph attacks: Cyrillic/Greek lookalikes, invisible chars,
 * RTL override, zero-width characters.
 */
export function checkHomoglyphs(text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];

  // Check for Cyrillic lookalikes
  for (const [char, latin] of Object.entries(CYRILLIC_LOOKALIKES)) {
    if (text.includes(char)) {
      findings.push({
        severity: 'critical',
        category: 'homoglyph',
        message: `Cyrillic character "${char}" (looks like Latin "${latin}") detected — possible homoglyph attack`,
      });
    }
  }

  // Check for Greek lookalikes
  for (const [char, latin] of Object.entries(GREEK_LOOKALIKES)) {
    if (text.includes(char)) {
      findings.push({
        severity: 'critical',
        category: 'homoglyph',
        message: `Greek character "${char}" (looks like Latin "${latin}") detected — possible homoglyph attack`,
      });
    }
  }

  // Check for invisible / zero-width characters
  const invisibleChars: Array<[string, RegExp]> = [
    ['Zero-width space (U+200B)', /\u200B/],
    ['Zero-width non-joiner (U+200C)', /\u200C/],
    ['Zero-width joiner (U+200D)', /\u200D/],
    ['Left-to-right mark (U+200E)', /\u200E/],
    ['Right-to-left mark (U+200F)', /\u200F/],
    ['Right-to-left override (U+202E)', /\u202E/],
    ['Left-to-right override (U+202D)', /\u202D/],
    ['Word joiner (U+2060)', /\u2060/],
    ['Zero-width no-break space / BOM (U+FEFF)', /\uFEFF/],
  ];

  for (const [label, pattern] of invisibleChars) {
    if (pattern.test(text)) {
      findings.push({
        severity: 'critical',
        category: 'homoglyph',
        message: `Invisible character detected: ${label}`,
      });
    }
  }

  return findings;
}

// --- Lifecycle script scanning ---

const LIFECYCLE_SCRIPTS = [
  'preinstall',
  'install',
  'postinstall',
  'preuninstall',
  'postuninstall',
  'prepublish',
  'prepare',
  'preprepare',
  'postprepare',
];

const HIGH_RISK_SCRIPT_PATTERNS = [
  /curl\s.*\|\s*(ba)?sh/i,
  /wget\s.*\|\s*(ba)?sh/i,
  /curl\s+-s\s+.*\|\s*node/i,
  /node\s+-e\s+"\$\(curl/i,
  /curl\s+-o\s+\/tmp\//i,
  /wget\s+-O\s+\/tmp\//i,
  /chmod\s+\+x\s+.*&&\s*\.\//i,
  /chmod\s+755\s+.*&&/i,
  /bash\s+\/tmp\//i,
  /node\s+\/tmp\//i,
  /python\s+\/tmp\//i,
  /curl.*\$npm_config/i,
  /curl.*\$HOME/i,
  /curl.*\$USER/i,
  /wget.*process\.env/i,
];

/**
 * Scan package.json scripts for dangerous lifecycle scripts.
 */
export function scanLifecycleScripts(packageJson: Record<string, unknown>): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const scripts = packageJson['scripts'] as Record<string, string> | undefined;

  if (!scripts || typeof scripts !== 'object') {
    return findings;
  }

  for (const scriptName of LIFECYCLE_SCRIPTS) {
    const scriptContent = scripts[scriptName];
    if (scriptContent && typeof scriptContent === 'string') {
      findings.push({
        severity: 'critical',
        category: 'lifecycle-script',
        message: `Lifecycle script "${scriptName}" found: ${scriptContent.slice(0, 120)}`,
      });

      // Check high-risk patterns within the script
      for (const pattern of HIGH_RISK_SCRIPT_PATTERNS) {
        if (pattern.test(scriptContent)) {
          findings.push({
            severity: 'critical',
            category: 'lifecycle-script',
            message: `High-risk pattern in "${scriptName}": matches ${pattern.source}`,
          });
        }
      }
    }
  }

  return findings;
}

// --- Code pattern scanning ---

const CODE_PATTERNS: Array<{ pattern: RegExp; severity: ScanFinding['severity']; category: string; label: string }> = [
  // Code execution
  { pattern: /\beval\s*\(/, severity: 'critical', category: 'code-execution', label: 'eval() call' },
  { pattern: /\bnew\s+Function\s*\(/, severity: 'critical', category: 'code-execution', label: 'new Function() constructor' },
  { pattern: /\bFunction\s*\(/, severity: 'critical', category: 'code-execution', label: 'Function() constructor' },
  { pattern: /\bexecSync\s*\(/, severity: 'critical', category: 'code-execution', label: 'execSync() call' },
  { pattern: /\bexec\s*\(/, severity: 'critical', category: 'code-execution', label: 'exec() call' },
  { pattern: /\bspawn\s*\(/, severity: 'critical', category: 'code-execution', label: 'spawn() call' },
  { pattern: /\bspawnSync\s*\(/, severity: 'critical', category: 'code-execution', label: 'spawnSync() call' },
  { pattern: /require\s*\(\s*['"]child_process['"]\s*\)/, severity: 'critical', category: 'code-execution', label: "require('child_process')" },
  { pattern: /import\s*\(\s*['"]child_process['"]\s*\)/, severity: 'critical', category: 'code-execution', label: "dynamic import('child_process')" },

  // Obfuscation
  { pattern: /[A-Za-z0-9+/=]{100,}/, severity: 'critical', category: 'obfuscation', label: 'Long base64-like string (>100 chars)' },
  { pattern: /String\.fromCharCode\s*\([0-9,\s]+\)/, severity: 'critical', category: 'obfuscation', label: 'String.fromCharCode() call' },
  { pattern: /atob\s*\(\s*['"][A-Za-z0-9+/=]+['"]\s*\)/, severity: 'critical', category: 'obfuscation', label: 'atob() base64 decode' },
  { pattern: /Buffer\.from\s*\(\s*['"][A-Za-z0-9+/=]+['"]\s*,\s*['"]base64['"]\s*\)/, severity: 'critical', category: 'obfuscation', label: 'Buffer.from() base64 decode' },
  { pattern: /_0x[a-fA-F0-9]+/, severity: 'critical', category: 'obfuscation', label: 'Obfuscated variable name (_0x...)' },

  // Network calls in code (suspicious in install context)
  { pattern: /\bcurl\b/, severity: 'warning', category: 'network', label: 'curl command reference' },
  { pattern: /\bwget\b/, severity: 'warning', category: 'network', label: 'wget command reference' },

  // Data exfiltration patterns
  { pattern: /process\.env\b.*(?:fetch|axios|http|https|request)/s, severity: 'critical', category: 'exfiltration', label: 'Environment variables combined with network access' },
  { pattern: /(?:fetch|axios|http|https|request).*process\.env\b/s, severity: 'critical', category: 'exfiltration', label: 'Network access combined with environment variables' },

  // Reverse shell patterns
  { pattern: /\/bin\/sh/, severity: 'warning', category: 'shell', label: '/bin/sh reference' },
  { pattern: /\/bin\/bash/, severity: 'warning', category: 'shell', label: '/bin/bash reference' },
  { pattern: /bash\s+-i/, severity: 'critical', category: 'shell', label: 'Interactive bash session' },
  { pattern: /nc\s+-e/, severity: 'critical', category: 'shell', label: 'Netcat with execute flag' },
];

/**
 * Scan source code for suspicious patterns: eval(), exec(), spawn(),
 * new Function(), dynamic import(), base64 decoding, obfuscation, network calls.
 */
export function scanCodePatterns(code: string): ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const { pattern, severity, category, label } of CODE_PATTERNS) {
    if (pattern.test(code)) {
      findings.push({
        severity,
        category,
        message: `Suspicious code pattern: ${label}`,
      });
    }
  }

  return findings;
}

// --- Layer 2: Reputation checks (network) ---

/**
 * Fetch npm registry metadata and check reputation signals.
 */
export async function checkNpmRegistry(packageName: string): Promise<{ findings: ScanFinding[]; metadata: NpmMetadata | null }> {
  const findings: ScanFinding[] = [];

  try {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);

    if (!response.ok) {
      if (response.status === 404) {
        findings.push({
          severity: 'critical',
          category: 'registry',
          message: `Package "${packageName}" not found on npm registry`,
        });
      } else {
        findings.push({
          severity: 'warning',
          category: 'registry',
          message: `npm registry returned status ${response.status}`,
        });
      }
      return { findings, metadata: null };
    }

    const data = await response.json() as Record<string, unknown>;

    // Extract metadata
    const distTags = data['dist-tags'] as Record<string, string> | undefined;
    const latestVersion = distTags?.['latest'] ?? 'unknown';
    const timeMap = data['time'] as Record<string, string> | undefined;
    const publishDate = timeMap?.[latestVersion] ?? timeMap?.['created'] ?? '';
    const maintainers = data['maintainers'] as Array<Record<string, string>> | undefined;
    const maintainerCount = maintainers?.length ?? 0;
    const description = (data['description'] as string) ?? '';
    const deprecated = typeof (data['versions'] as Record<string, Record<string, unknown>> | undefined)?.[latestVersion]?.['deprecated'] === 'string';

    // Repository URL
    const repo = data['repository'] as { url?: string } | undefined;
    let repositoryUrl: string | null = null;
    if (repo?.url) {
      repositoryUrl = repo.url
        .replace(/^git\+/, '')
        .replace(/\.git$/, '')
        .replace(/^ssh:\/\/git@github\.com/, 'https://github.com');
    }

    // Check latest version package.json for lifecycle scripts
    const versions = data['versions'] as Record<string, Record<string, unknown>> | undefined;
    const latestPkg = versions?.[latestVersion] ?? {};
    const hasLifecycleScripts = LIFECYCLE_SCRIPTS.some(s => {
      const scripts = latestPkg['scripts'] as Record<string, string> | undefined;
      return scripts?.[s] !== undefined;
    });

    const metadata: NpmMetadata = {
      name: packageName,
      version: latestVersion,
      description,
      weeklyDownloads: 0, // Will be fetched separately if needed
      publishDate,
      maintainerCount,
      deprecated,
      repositoryUrl,
      hasLifecycleScripts,
    };

    // Reputation flags
    if (deprecated) {
      findings.push({
        severity: 'warning',
        category: 'reputation',
        message: 'Package is deprecated',
      });
    }

    if (maintainerCount <= 1) {
      findings.push({
        severity: 'warning',
        category: 'reputation',
        message: `Single maintainer (${maintainerCount})`,
      });
    }

    // Check age
    if (publishDate) {
      const published = new Date(publishDate);
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      if (published > sixMonthsAgo) {
        findings.push({
          severity: 'warning',
          category: 'reputation',
          message: `Package is less than 6 months old (published: ${publishDate})`,
        });
      }
    }

    // Try to get download counts from the downloads API
    try {
      const dlResponse = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`);
      if (dlResponse.ok) {
        const dlData = await dlResponse.json() as Record<string, unknown>;
        const downloads = dlData['downloads'] as number | undefined;
        if (downloads !== undefined) {
          metadata.weeklyDownloads = downloads;
          if (downloads < 1000) {
            findings.push({
              severity: 'warning',
              category: 'reputation',
              message: `Low weekly downloads: ${downloads} (< 1,000)`,
            });
          }
        }
      }
    } catch {
      // Download count check is best-effort
    }

    return { findings, metadata };
  } catch (err) {
    findings.push({
      severity: 'warning',
      category: 'registry',
      message: `Failed to fetch npm registry: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { findings, metadata: null };
  }
}

/**
 * Check GitHub repository for reputation signals.
 */
export async function checkGitHubRepo(repoUrl: string): Promise<ScanFinding[]> {
  const findings: ScanFinding[] = [];

  // Parse owner/repo from URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    findings.push({
      severity: 'info',
      category: 'github',
      message: `Could not parse GitHub URL: ${repoUrl}`,
    });
    return findings;
  }

  const owner = match[1];
  const repo = match[2];

  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      findings.push({
        severity: 'warning',
        category: 'github',
        message: `GitHub API returned status ${response.status} for ${owner}/${repo}`,
      });
      return findings;
    }

    const data = await response.json() as Record<string, unknown>;

    const stars = data['stargazers_count'] as number;
    const archived = data['archived'] as boolean;
    const pushedAt = data['pushed_at'] as string;

    if (stars < 50) {
      findings.push({
        severity: 'warning',
        category: 'github',
        message: `Low star count: ${stars} (< 50)`,
      });
    }

    if (archived) {
      findings.push({
        severity: 'warning',
        category: 'github',
        message: 'Repository is archived',
      });
    }

    if (pushedAt) {
      const lastPush = new Date(pushedAt);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      if (lastPush < oneYearAgo) {
        findings.push({
          severity: 'warning',
          category: 'github',
          message: `No updates in over 1 year (last push: ${pushedAt})`,
        });
      }
    }

    // Check contributor count
    try {
      const contribResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=5`, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (contribResponse.ok) {
        const contributors = await contribResponse.json() as unknown[];
        if (contributors.length < 3) {
          findings.push({
            severity: 'warning',
            category: 'github',
            message: `Few contributors: ${contributors.length} (< 3)`,
          });
        }
      }
    } catch {
      // Contributor check is best-effort
    }
  } catch (err) {
    findings.push({
      severity: 'warning',
      category: 'github',
      message: `Failed to fetch GitHub data: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return findings;
}

// --- Scoring ---

function calculateScore(findings: ScanFinding[]): number {
  let score = 0;
  for (const finding of findings) {
    switch (finding.severity) {
      case 'info':
        score += 0;
        break;
      case 'warning':
        score += 1;
        break;
      case 'critical':
        score += 3;
        break;
    }
  }
  return Math.min(score, 10);
}

function verdictFromScore(score: number): 'SAFE' | 'CAUTION' | 'RISKY' {
  if (score <= 2) return 'SAFE';
  if (score <= 5) return 'CAUTION';
  return 'RISKY';
}

// --- Full Scan ---

/**
 * Run a full security scan on an npm package.
 * 1. Check typosquatting
 * 2. Check homoglyphs
 * 3. Fetch from npm registry, check lifecycle scripts, check reputation
 * 4. If repo URL present, check GitHub
 * 5. Calculate score and verdict
 */
export async function scanPackage(packageName: string): Promise<PackageScanReport> {
  const findings: ScanFinding[] = [];

  // 1. Typosquatting check
  findings.push(...checkTyposquatting(packageName));

  // 2. Homoglyph check
  findings.push(...checkHomoglyphs(packageName));

  // 3. npm registry check
  const { findings: registryFindings, metadata } = await checkNpmRegistry(packageName);
  findings.push(...registryFindings);

  // If we got package metadata, scan the lifecycle scripts and code
  if (metadata?.hasLifecycleScripts) {
    // The lifecycle scripts were already flagged via metadata; add a general finding
    findings.push({
      severity: 'warning',
      category: 'lifecycle-script',
      message: 'Package contains lifecycle scripts (preinstall/postinstall/etc.)',
    });
  }

  // 4. GitHub repo check
  if (metadata?.repositoryUrl) {
    const githubFindings = await checkGitHubRepo(metadata.repositoryUrl);
    findings.push(...githubFindings);
  }

  // 5. Score and verdict
  const score = calculateScore(findings);
  const verdict = verdictFromScore(score);

  return {
    packageName,
    score,
    verdict,
    findings,
  };
}
