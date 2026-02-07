// ============================================================
// OpenClaw Deploy — Tool System Entry Point
// ============================================================

export { ToolRegistry } from './registry.js';
export type { ToolContext, ToolHandler } from './registry.js';
export { executeToolCall } from './executor.js';

import { ToolRegistry } from './registry.js';
import { datetimeDefinition, datetimeHandler } from './builtins/datetime.js';
import { calculatorDefinition, calculatorHandler } from './builtins/calculator.js';
import { webSearchDefinition, webSearchHandler } from './builtins/web-search.js';
import { readFileDefinition, readFileHandler, writeFileDefinition, writeFileHandler } from './builtins/file-ops.js';
import { codeRunnerDefinition, codeRunnerHandler } from './builtins/code-runner.js';
import { memoryReadDefinition, memoryReadHandler, memoryWriteDefinition, memoryWriteHandler } from './builtins/memory.js';
import { fetchUrlDefinition, fetchUrlHandler } from './builtins/fetch-url.js';
import {
  projectReadFileDefinition, projectReadFileHandler,
  projectWriteFileDefinition, projectWriteFileHandler,
} from './builtins/project-file-ops.js';
import {
  scheduleReminderDefinition, scheduleReminderHandler,
  listRemindersDefinition, listRemindersHandler,
  cancelReminderDefinition, cancelReminderHandler,
} from './builtins/scheduler.js';
import { installPackageDefinition, installPackageHandler } from './builtins/package-installer.js';

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register(datetimeDefinition, datetimeHandler);
  registry.register(calculatorDefinition, calculatorHandler);
  registry.register(webSearchDefinition, webSearchHandler);
  registry.register(readFileDefinition, readFileHandler);
  registry.register(writeFileDefinition, writeFileHandler);
  registry.register(codeRunnerDefinition, codeRunnerHandler, { defaultDenied: true });
  registry.register(memoryReadDefinition, memoryReadHandler);
  registry.register(memoryWriteDefinition, memoryWriteHandler);
  registry.register(fetchUrlDefinition, fetchUrlHandler);
  registry.register(projectReadFileDefinition, projectReadFileHandler);
  registry.register(projectWriteFileDefinition, projectWriteFileHandler);
  registry.register(scheduleReminderDefinition, scheduleReminderHandler);
  registry.register(listRemindersDefinition, listRemindersHandler);
  registry.register(cancelReminderDefinition, cancelReminderHandler);
  registry.register(installPackageDefinition, installPackageHandler, { defaultDenied: true });

  return registry;
}
