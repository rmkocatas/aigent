// ============================================================
// OpenClaw Deploy — Embedded Webchat UI
// ============================================================

export const WEBCHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenClaw Chat</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #1a1a2e;
  --surface: #16213e;
  --surface2: #0f3460;
  --text: #e4e4e4;
  --text-dim: #8899aa;
  --accent: #0078d4;
  --accent-hover: #1a8cff;
  --user-bg: #0f3460;
  --assistant-bg: #1e2a3a;
  --border: #2a3a4a;
  --input-bg: #0d1b2a;
  --error: #ff6b6b;
  --success: #51cf66;
}
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
}

/* --- Header --- */
.header {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}
.header h1 { font-size: 16px; font-weight: 600; }
.header h1 span { color: var(--accent); }
.header-right { display: flex; align-items: center; gap: 12px; }
.status-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--error);
  transition: background 0.3s;
}
.status-dot.connected { background: var(--success); }

/* --- Auth overlay --- */
.auth-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.85);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.auth-overlay.hidden { display: none; }
.auth-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 32px;
  max-width: 420px;
  width: 90%;
  text-align: center;
}
.auth-box h2 { margin-bottom: 8px; font-size: 20px; }
.auth-box p { color: var(--text-dim); margin-bottom: 20px; font-size: 14px; }
.auth-box input {
  width: 100%;
  padding: 10px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  font-family: monospace;
  margin-bottom: 16px;
}
.auth-box input:focus { outline: none; border-color: var(--accent); }
.auth-box button {
  width: 100%;
  padding: 10px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.auth-box button:hover { background: var(--accent-hover); }

/* --- Chat area --- */
.chat-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 720px;
  width: 100%;
  padding: 14px 18px;
  border-radius: 12px;
  line-height: 1.6;
  font-size: 14px;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.message.user {
  background: var(--user-bg);
  align-self: flex-end;
  border-bottom-right-radius: 4px;
}
.message.assistant {
  background: var(--assistant-bg);
  align-self: flex-start;
  border-bottom-left-radius: 4px;
}
.message.assistant .content p { margin-bottom: 8px; }
.message.assistant .content p:last-child { margin-bottom: 0; }
.message.assistant .content pre {
  background: #0d1117;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}
.message.assistant .content code {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
}
.message.assistant .content :not(pre) > code {
  background: rgba(255,255,255,0.08);
  padding: 2px 6px;
  border-radius: 4px;
}
.meta-info {
  font-size: 11px;
  color: var(--text-dim);
  margin-top: 8px;
  display: flex;
  gap: 12px;
}
.meta-info span {
  background: rgba(255,255,255,0.05);
  padding: 2px 8px;
  border-radius: 4px;
}

/* Cursor */
.cursor {
  display: inline-block;
  width: 7px;
  height: 16px;
  background: var(--accent);
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: blink 0.8s infinite;
}
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* --- Input area --- */
.input-area {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 16px 20px;
  flex-shrink: 0;
}
.input-wrapper {
  max-width: 760px;
  margin: 0 auto;
  display: flex;
  gap: 10px;
  align-items: flex-end;
}
.input-wrapper textarea {
  flex: 1;
  padding: 10px 14px;
  background: var(--input-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 14px;
  font-family: inherit;
  resize: none;
  min-height: 42px;
  max-height: 160px;
  line-height: 1.5;
}
.input-wrapper textarea:focus { outline: none; border-color: var(--accent); }
.input-wrapper button {
  padding: 10px 18px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  height: 42px;
}
.input-wrapper button:hover { background: var(--accent-hover); }
.input-wrapper button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.input-hint {
  max-width: 760px;
  margin: 6px auto 0;
  font-size: 11px;
  color: var(--text-dim);
}

/* Error toast */
.error-toast {
  position: fixed;
  bottom: 100px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--error);
  color: #fff;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 13px;
  z-index: 200;
  opacity: 0;
  transition: opacity 0.3s;
  pointer-events: none;
}
.error-toast.show { opacity: 1; }

/* Scrollbar */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<div class="auth-overlay" id="authOverlay">
  <div class="auth-box">
    <h2>OpenClaw Chat</h2>
    <p>Enter your gateway token to connect</p>
    <input type="password" id="tokenInput" placeholder="Paste your token here..." autocomplete="off">
    <button id="tokenSubmit">Connect</button>
  </div>
</div>

<div class="header">
  <h1><span>OpenClaw</span> Chat</h1>
  <div class="header-right">
    <span id="modelLabel" style="font-size:12px;color:var(--text-dim)"></span>
    <div class="status-dot" id="statusDot" title="Disconnected"></div>
  </div>
</div>

<div class="chat-container" id="chatContainer"></div>

<div class="input-area">
  <div class="input-wrapper">
    <textarea id="messageInput" placeholder="Type a message..." rows="1" disabled></textarea>
    <button id="sendBtn" disabled>Send</button>
  </div>
  <div class="input-hint">Enter to send &middot; Shift+Enter for new line</div>
</div>

<div class="error-toast" id="errorToast"></div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js"></script>
<script>
(function() {
  'use strict';

  // --- DOM refs ---
  const authOverlay = document.getElementById('authOverlay');
  const tokenInput = document.getElementById('tokenInput');
  const tokenSubmit = document.getElementById('tokenSubmit');
  const chatContainer = document.getElementById('chatContainer');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const statusDot = document.getElementById('statusDot');
  const modelLabel = document.getElementById('modelLabel');
  const errorToast = document.getElementById('errorToast');

  let token = localStorage.getItem('openclaw_token') || '';
  let conversationId = null;
  let isStreaming = false;

  // --- Marked config ---
  marked.setOptions({
    breaks: true,
    gfm: true
  });

  // --- Auth ---
  if (token) {
    authOverlay.classList.add('hidden');
    enableChat();
    checkHealth();
  }

  tokenSubmit.addEventListener('click', doAuth);
  tokenInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doAuth();
  });

  function doAuth() {
    const val = tokenInput.value.trim();
    if (!val) return;
    token = val;
    localStorage.setItem('openclaw_token', token);
    authOverlay.classList.add('hidden');
    enableChat();
    checkHealth();
  }

  function enableChat() {
    messageInput.disabled = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }

  async function checkHealth() {
    try {
      const res = await fetch('/health');
      if (res.ok) {
        statusDot.classList.add('connected');
        statusDot.title = 'Connected';
      }
    } catch {
      statusDot.classList.remove('connected');
      statusDot.title = 'Disconnected';
    }
  }

  // --- Auto-resize textarea ---
  messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 160) + 'px';
  });

  // --- Send ---
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  async function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg || isStreaming) return;

    // Add user bubble
    addMessage('user', msg);
    messageInput.value = '';
    messageInput.style.height = 'auto';

    isStreaming = true;
    sendBtn.disabled = true;

    // Create assistant bubble with cursor
    const assistantEl = addMessage('assistant', '');
    const contentEl = assistantEl.querySelector('.content');
    contentEl.innerHTML = '<span class="cursor"></span>';

    let metaEl = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({ message: msg, conversationId: conversationId }),
      });

      if (res.status === 401) {
        showError('Invalid token. Please refresh and re-enter.');
        localStorage.removeItem('openclaw_token');
        contentEl.innerHTML = '<em style="color:var(--error)">Authentication failed</em>';
        isStreaming = false;
        sendBtn.disabled = false;
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(function() { return { error: 'Request failed' }; });
        throw new Error(err.error || 'Request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      let provider = '';
      let model = '';
      let classification = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            var eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            var data = line.slice(6);

            if (eventType === 'meta') {
              try {
                const meta = JSON.parse(data);
                conversationId = meta.conversationId;
                provider = meta.provider || '';
                model = meta.model || '';
                classification = meta.classification || '';
                modelLabel.textContent = model;
              } catch {}
            } else if (eventType === 'chunk') {
              try {
                const chunk = JSON.parse(data);
                if (chunk.content) {
                  fullText += chunk.content;
                  renderMarkdown(contentEl, fullText);
                }
              } catch {}
            } else if (eventType === 'fallback') {
              try {
                const fb = JSON.parse(data);
                provider = fb.to || provider;
              } catch {}
            } else if (eventType === 'error') {
              showError(data);
            } else if (eventType === 'done') {
              // Stream complete
            }
          }
        }
      }

      // Remove cursor, final render
      renderMarkdown(contentEl, fullText, true);

      // Add meta info
      if (provider || classification) {
        metaEl = document.createElement('div');
        metaEl.className = 'meta-info';
        if (provider) metaEl.innerHTML += '<span>' + escapeHtml(provider) + '</span>';
        if (model) metaEl.innerHTML += '<span>' + escapeHtml(model) + '</span>';
        if (classification) metaEl.innerHTML += '<span>' + escapeHtml(classification) + '</span>';
        assistantEl.appendChild(metaEl);
      }

    } catch (err) {
      contentEl.innerHTML = '<em style="color:var(--error)">' + escapeHtml(err.message) + '</em>';
      showError(err.message);
    }

    isStreaming = false;
    sendBtn.disabled = false;
    messageInput.focus();
  }

  function addMessage(role, text) {
    const el = document.createElement('div');
    el.className = 'message ' + role;
    const content = document.createElement('div');
    content.className = 'content';
    if (role === 'user') {
      content.textContent = text;
    }
    el.appendChild(content);
    chatContainer.appendChild(el);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    return el;
  }

  function renderMarkdown(el, text, final) {
    try {
      el.innerHTML = marked.parse(text) + (final ? '' : '<span class="cursor"></span>');
      el.querySelectorAll('pre code').forEach(function(block) {
        hljs.highlightElement(block);
      });
    } catch {
      el.textContent = text;
    }
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function showError(msg) {
    errorToast.textContent = msg;
    errorToast.classList.add('show');
    setTimeout(function() { errorToast.classList.remove('show'); }, 4000);
  }

  // Periodic health check
  setInterval(checkHealth, 30000);
})();
</script>
</body>
</html>`;
