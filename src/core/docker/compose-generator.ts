// ============================================================
// OpenClaw Deploy — Docker Compose Generator
// ============================================================

import type { DeploymentConfig, GeneratedSecrets, SecurityLevel } from '../../types/index.js';
import { SECURITY_LEVELS } from '../security/levels.js';

export function generateDockerCompose(
  config: DeploymentConfig,
  _secrets: GeneratedSecrets,
  securityLevel: SecurityLevel,
): string {
  const docker = SECURITY_LEVELS[securityLevel].docker;
  const port = config.gateway.port;

  const readOnly = docker.readOnlyRoot;
  const capDrop = docker.capDrop;
  const capAdd = docker.capAdd.length > 0 ? docker.capAdd : ['CHOWN', 'SETUID', 'SETGID'];
  const securityOpt = docker.securityOpt.length > 0
    ? docker.securityOpt.map(s => `${s}:true`)
    : ['no-new-privileges:true'];
  const memory = docker.memory || '1g';
  const cpus = docker.cpus || '2.0';
  const user = docker.user || '1000:1000';
  const tmpfs = docker.tmpfs.length > 0 ? docker.tmpfs : ['/tmp:size=100M'];

  let yaml = `version: '3.8'

services:
  openclaw-gateway:
    image: alpine/openclaw:latest
    container_name: openclaw-gateway
    restart: unless-stopped
    user: "${user}"
    ports:
      - "127.0.0.1:${port}:${port}"
    volumes:
      - "\${OPENCLAW_HOME:-~/.openclaw}:/home/node/.openclaw"
      - "\${OPENCLAW_WORKSPACE:-~/.openclaw/workspace}:/home/node/.openclaw/workspace"
    environment:
      OPENCLAW_CONFIG_PATH: /home/node/.openclaw/openclaw.json
      OPENCLAW_GATEWAY_PORT: "${port}"${config.llm.provider === 'ollama' ? `
      OLLAMA_HOST: "http://host.docker.internal:11434"` : ''}
    env_file:
      - .env${config.llm.provider === 'ollama' ? `
    extra_hosts:
      - "host.docker.internal:host-gateway"` : ''}
    read_only: ${readOnly}
    cap_drop:
${capDrop.map(c => `      - ${c}`).join('\n')}
    cap_add:
${capAdd.map(c => `      - ${c}`).join('\n')}
    security_opt:
${securityOpt.map(s => `      - ${s}`).join('\n')}
    tmpfs:
${tmpfs.map(t => `      - "${t}"`).join('\n')}
    deploy:
      resources:
        limits:
          memory: ${memory}
          cpus: "${cpus}"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:${port}/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"`;

  if (config.tls?.enabled && config.tls.domain) {
    yaml += `

  caddy:
    image: caddy:2-alpine
    container_name: openclaw-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      openclaw-gateway:
        condition: service_healthy

volumes:
  caddy_data:
  caddy_config:`;
  }

  return yaml + '\n';
}

export function generateCaddyfile(domain: string): string {
  return `${domain} {
  reverse_proxy openclaw-gateway:8080
  encode gzip

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
  }

  log {
    output file /var/log/caddy/access.log
    format json
  }
}
`;
}
