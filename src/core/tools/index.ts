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

// --- Tier 1: Pure Utility Tools ---
import { unitConverterDefinition, unitConverterHandler } from './builtins/unit-converter.js';
import { passwordGeneratorDefinition, passwordGeneratorHandler } from './builtins/password-generator.js';
import { hashToolDefinition, hashToolHandler } from './builtins/hash-tool.js';
import { jsonFormatterDefinition, jsonFormatterHandler } from './builtins/json-formatter.js';
import { regexTesterDefinition, regexTesterHandler } from './builtins/regex-tester.js';
import { base64CodecDefinition, base64CodecHandler } from './builtins/base64-codec.js';
import { colorConverterDefinition, colorConverterHandler } from './builtins/color-converter.js';
import { cronParserDefinition, cronParserHandler } from './builtins/cron-parser.js';
import { uuidGeneratorDefinition, uuidGeneratorHandler } from './builtins/uuid-generator.js';
import { csvAnalyzerDefinition, csvAnalyzerHandler } from './builtins/csv-analyzer.js';
import { timezoneConverterDefinition, timezoneConverterHandler } from './builtins/timezone-converter.js';
import { randomQuoteDefinition, randomQuoteHandler } from './builtins/random-quote.js';

// --- Tier 2: Persistence Tools ---
import {
  noteAddDefinition, noteAddHandler,
  noteListDefinition, noteListHandler,
  noteSearchDefinition, noteSearchHandler,
  noteDeleteDefinition, noteDeleteHandler,
} from './builtins/note-taker.js';
import {
  pomodoroStartDefinition, pomodoroStartHandler,
  pomodoroStatusDefinition, pomodoroStatusHandler,
  pomodoroStopDefinition, pomodoroStopHandler,
} from './builtins/pomodoro-timer.js';

// --- Tier 3: External API Tools ---
import { weatherDefinition, weatherHandler } from './builtins/weather.js';
import { dictionaryDefinition, dictionaryHandler } from './builtins/dictionary.js';
import { ipLookupDefinition, ipLookupHandler } from './builtins/ip-lookup.js';
import { newsHeadlinesDefinition, newsHeadlinesHandler } from './builtins/news-headlines.js';

// --- Tier 4: External Dependency Tools ---
import { qrGeneratorDefinition, qrGeneratorHandler } from './builtins/qr-generator.js';
import { pdfReaderDefinition, pdfReaderHandler } from './builtins/pdf-reader.js';

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Core tools
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

  // Tier 1: Pure utility tools
  registry.register(unitConverterDefinition, unitConverterHandler);
  registry.register(passwordGeneratorDefinition, passwordGeneratorHandler);
  registry.register(hashToolDefinition, hashToolHandler);
  registry.register(jsonFormatterDefinition, jsonFormatterHandler);
  registry.register(regexTesterDefinition, regexTesterHandler);
  registry.register(base64CodecDefinition, base64CodecHandler);
  registry.register(colorConverterDefinition, colorConverterHandler);
  registry.register(cronParserDefinition, cronParserHandler);
  registry.register(uuidGeneratorDefinition, uuidGeneratorHandler);
  registry.register(csvAnalyzerDefinition, csvAnalyzerHandler);
  registry.register(timezoneConverterDefinition, timezoneConverterHandler);
  registry.register(randomQuoteDefinition, randomQuoteHandler);

  // Tier 2: Persistence tools
  registry.register(noteAddDefinition, noteAddHandler);
  registry.register(noteListDefinition, noteListHandler);
  registry.register(noteSearchDefinition, noteSearchHandler);
  registry.register(noteDeleteDefinition, noteDeleteHandler);
  registry.register(pomodoroStartDefinition, pomodoroStartHandler);
  registry.register(pomodoroStatusDefinition, pomodoroStatusHandler);
  registry.register(pomodoroStopDefinition, pomodoroStopHandler);

  // Tier 3: External API tools
  registry.register(weatherDefinition, weatherHandler);
  registry.register(dictionaryDefinition, dictionaryHandler);
  registry.register(ipLookupDefinition, ipLookupHandler);
  registry.register(newsHeadlinesDefinition, newsHeadlinesHandler);

  // Tier 4: External dependency tools
  registry.register(qrGeneratorDefinition, qrGeneratorHandler);
  registry.register(pdfReaderDefinition, pdfReaderHandler, { defaultDenied: true });

  return registry;
}
