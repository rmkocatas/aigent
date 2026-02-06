// ============================================================
// OpenClaw Deploy — Health Check
// ============================================================

export async function checkHealth(
  gatewayUrl: string,
): Promise<{ healthy: boolean; error?: string }> {
  try {
    const response = await fetch(`${gatewayUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return { healthy: true };
    }
    return { healthy: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { healthy: false, error: (err as Error).message };
  }
}

export async function waitForHealthy(
  gatewayUrl: string,
  timeoutMs = 30000,
  intervalMs = 2000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await checkHealth(gatewayUrl);
    if (result.healthy) {
      return true;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }

  return false;
}
