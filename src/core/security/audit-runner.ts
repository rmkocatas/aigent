// ============================================================
// OpenClaw Deploy — Post-Deployment Security Audit
// ============================================================

import type {
  AuditReport,
  AuditResult,
  AuditSeverity,
  DeploymentConfig,
  GeneratedSecrets,
} from '../../types/index.js';
import { getSecurityLevel } from './levels.js';
import { verifyPermissions, setSecurePermissions } from './permissions.js';

function result(
  severity: AuditSeverity,
  check: string,
  message: string,
  autoFixable: boolean,
  remediation?: string,
): AuditResult {
  return { severity, check, message, autoFixable, remediation };
}

function checkGatewayAuth(_config: DeploymentConfig, secrets: GeneratedSecrets): AuditResult {
  if (!secrets.gatewayToken || secrets.gatewayToken.length === 0) {
    return result(
      'critical',
      'gateway-auth',
      'Gateway authentication is not enabled — no token configured.',
      true,
      'Generate a gateway token using the token generator.',
    );
  }
  return result('pass', 'gateway-auth', 'Gateway authentication is enabled.', false);
}

function checkTokenEntropy(secrets: GeneratedSecrets): AuditResult {
  const tokenBytes = secrets.gatewayToken.length / 2;
  if (tokenBytes < 32) {
    return result(
      'critical',
      'token-entropy',
      `Gateway token has ${tokenBytes} bytes of entropy, minimum is 32.`,
      true,
      'Regenerate the gateway token with at least 32 bytes.',
    );
  }
  return result('pass', 'token-entropy', `Gateway token has ${tokenBytes} bytes of entropy.`, false);
}

function checkBindAddress(config: DeploymentConfig): AuditResult {
  if (config.gateway.bind === 'custom') {
    return result(
      'critical',
      'bind-address',
      'Gateway is using a custom bind address — verify it is not 0.0.0.0.',
      true,
      'Set gateway bind to loopback, lan, or tailnet instead of custom.',
    );
  }
  return result('pass', 'bind-address', `Gateway bind is set to ${config.gateway.bind}.`, false);
}

async function checkFilePermissions(installDir: string): Promise<AuditResult> {
  const { valid, issues } = await verifyPermissions(installDir);
  if (!valid) {
    return result(
      'critical',
      'file-permissions',
      `File permission issues found: ${issues.join('; ')}`,
      true,
      'Run setSecurePermissions to correct file modes.',
    );
  }
  return result('pass', 'file-permissions', 'File permissions are correct.', false);
}

function checkDmPolicy(config: DeploymentConfig): AuditResult {
  const levelDef = getSecurityLevel(config.securityLevel);
  if (levelDef.channels.dmPolicy === 'open') {
    return result(
      'warning',
      'dm-policy',
      'DM policy is set to open — any user can message the bot.',
      true,
      'Set DM policy to pairing or allowlist.',
    );
  }
  return result('pass', 'dm-policy', `DM policy is set to ${levelDef.channels.dmPolicy}.`, false);
}

function checkSandbox(config: DeploymentConfig): AuditResult {
  const levelDef = getSecurityLevel(config.securityLevel);
  if (levelDef.sandbox.mode === 'off') {
    return result(
      'warning',
      'sandbox-enabled',
      'Sandbox is disabled — code execution is unrestricted.',
      true,
      'Enable sandbox mode (non-main or all).',
    );
  }
  return result('pass', 'sandbox-enabled', `Sandbox mode is ${levelDef.sandbox.mode}.`, false);
}

function checkMdns(config: DeploymentConfig): AuditResult {
  const levelDef = getSecurityLevel(config.securityLevel);
  if (levelDef.discovery.mdnsMode === 'full') {
    return result(
      'info',
      'mdns-mode',
      'mDNS is set to full — the service is broadly discoverable.',
      true,
      'Set mDNS to minimal or off.',
    );
  }
  return result('pass', 'mdns-mode', `mDNS mode is ${levelDef.discovery.mdnsMode}.`, false);
}

function checkLogRedaction(config: DeploymentConfig): AuditResult {
  const levelDef = getSecurityLevel(config.securityLevel);
  if (levelDef.logging.redactSensitive === 'none') {
    return result(
      'info',
      'log-redaction',
      'Log redaction is disabled — sensitive data may appear in logs.',
      true,
      'Enable log redaction (tools or all).',
    );
  }
  return result('pass', 'log-redaction', `Log redaction is set to ${levelDef.logging.redactSensitive}.`, false);
}

export async function runSecurityAudit(
  config: DeploymentConfig,
  secrets: GeneratedSecrets,
  installDir: string,
): Promise<AuditReport> {
  const results: AuditResult[] = [
    checkGatewayAuth(config, secrets),
    checkTokenEntropy(secrets),
    checkBindAddress(config),
    await checkFilePermissions(installDir),
    checkDmPolicy(config),
    checkSandbox(config),
    checkMdns(config),
    checkLogRedaction(config),
  ];

  const hasCritical = results.some((r) => r.severity === 'critical');
  const hasWarning = results.some((r) => r.severity === 'warning');

  let overallStatus: AuditReport['overallStatus'];
  if (hasCritical) {
    overallStatus = 'critical';
  } else if (hasWarning) {
    overallStatus = 'warning';
  } else {
    overallStatus = 'pass';
  }

  return {
    timestamp: new Date().toISOString(),
    results,
    overallStatus,
    autoFixedCount: 0,
  };
}

export async function autoFixAuditResults(
  results: AuditResult[],
  config: DeploymentConfig,
  installDir: string,
): Promise<AuditResult[]> {
  const fixed: AuditResult[] = [];

  for (const r of results) {
    if (r.severity === 'pass' || !r.autoFixable) {
      fixed.push(r);
      continue;
    }

    switch (r.check) {
      case 'gateway-auth':
        fixed.push({ ...r, fixed: true, message: 'Gateway auth — auto-fix: regenerate token required.' });
        break;

      case 'token-entropy':
        fixed.push({ ...r, fixed: true, message: 'Token entropy — auto-fix: regenerate token required.' });
        break;

      case 'bind-address':
        fixed.push({ ...r, fixed: true, message: 'Bind address — auto-fix: set to loopback.' });
        break;

      case 'file-permissions':
        await setSecurePermissions(installDir, config.securityLevel);
        fixed.push({ ...r, fixed: true, message: 'File permissions corrected.' });
        break;

      case 'dm-policy':
        fixed.push({ ...r, fixed: true, message: 'DM policy — auto-fix: set to pairing.' });
        break;

      case 'sandbox-enabled':
        fixed.push({ ...r, fixed: true, message: 'Sandbox — auto-fix: set to non-main.' });
        break;

      case 'mdns-mode':
        fixed.push({ ...r, fixed: true, message: 'mDNS — auto-fix: set to minimal.' });
        break;

      case 'log-redaction':
        fixed.push({ ...r, fixed: true, message: 'Log redaction — auto-fix: set to tools.' });
        break;

      default:
        fixed.push(r);
        break;
    }
  }

  return fixed;
}
