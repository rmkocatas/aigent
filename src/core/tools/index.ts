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
import { pdfGeneratorDefinition, pdfGeneratorHandler } from './builtins/pdf-generator.js';
import { presentationGeneratorDefinition, presentationGeneratorHandler } from './builtins/presentation-generator.js';
import { imageGeneratorDefinition, imageGeneratorHandler } from './builtins/image-generator.js';
import { videoGeneratorDefinition, videoGeneratorHandler } from './builtins/video-generator.js';

// --- File Delivery Tool ---
import { sendFileDefinition, sendFileHandler } from './builtins/send-file.js';

// --- Semantic Memory Tools ---
import {
  memoryRecallDefinition, memoryRecallHandler,
  memoryRememberDefinition, memoryRememberHandler,
  memoryForgetDefinition, memoryForgetHandler,
} from './builtins/semantic-memory.js';

// --- Cost Tracking Tool ---
import { costSummaryDefinition, costSummaryHandler } from './builtins/cost-summary.js';

// --- Activity Log Tool ---
import { activitySearchDefinition, activitySearchHandler, setDocumentMemory } from './builtins/activity-log.js';
export { setDocumentMemory };

// --- Memory Graph & Timeline Tools ---
import {
  memoryGraphDefinition, memoryGraphHandler,
  memoryTimelineDefinition, memoryTimelineHandler,
} from './builtins/memory-graph-tools.js';

// --- Knowledge Base / RAG Tools ---
import {
  webClipDefinition, webClipHandler,
  readLaterAddDefinition, readLaterAddHandler,
  readLaterListDefinition, readLaterListHandler,
  knowledgeSearchDefinition, knowledgeSearchHandler,
} from './builtins/knowledge-base.js';

// --- Voice & Media Tools ---
import { textToSpeechDefinition, textToSpeechHandler } from './builtins/text-to-speech.js';
import { mediaSummarizerDefinition, mediaSummarizerHandler } from './builtins/media-summarizer.js';
import { videoAnalyzerDefinition, videoAnalyzerHandler } from './builtins/video-analyzer.js';

// --- Developer Tools ---
import {
  gitDiffReviewDefinition, gitDiffReviewHandler,
  depAuditDefinition, depAuditHandler,
  generateTestsDefinition, generateTestsHandler,
} from './builtins/dev-tools.js';

// --- Trigger Tools ---
import {
  triggerAddDefinition, triggerAddHandler,
  triggerListDefinition, triggerListHandler,
  triggerRemoveDefinition, triggerRemoveHandler,
  triggerToggleDefinition, triggerToggleHandler,
} from './builtins/trigger-tools.js';

// --- Workflow Tools ---
import {
  workflowListDefinition, workflowListHandler,
  workflowRunDefinition, workflowRunHandler,
} from './builtins/workflow-tools.js';

// --- X/Twitter Search Tool ---
import { xSearchDefinition, xSearchHandler } from './builtins/x-search.js';

// --- X/Twitter Research Tool (Compound) ---
import { xResearchDefinition, xResearchHandler } from './builtins/x-research.js';

// --- Telegram Poll Tool ---
import { telegramPollDefinition, telegramPollHandler } from './builtins/telegram-poll.js';

// --- Browser Control Tools ---
import {
  browseNavigateDefinition, browseNavigateHandler,
  browseClickDefinition, browseClickHandler,
  browseTypeDefinition, browseTypeHandler,
  browseSnapshotDefinition, browseSnapshotHandler,
  browseScreenshotDefinition, browseScreenshotHandler,
  browseBackDefinition, browseBackHandler,
  browseSelectDefinition, browseSelectHandler,
  setBrowserBridge,
  getBrowserBridge,
} from './builtins/browser-tools.js';

// --- System Monitoring & Backup Tools ---
import {
  systemStatusDefinition, systemStatusHandler,
  systemBackupDefinition, systemBackupHandler,
  setSystemServices,
} from './builtins/system-tools.js';

// --- Twitter Tools (agent-twitter-client) ---
import {
  twitterSearchDefinition, twitterSearchHandler,
  twitterPostDefinition, twitterPostHandler,
  twitterTimelineDefinition, twitterTimelineHandler,
  twitterReadTweetDefinition, twitterReadTweetHandler,
  twitterLikeDefinition, twitterLikeHandler,
  twitterRetweetDefinition, twitterRetweetHandler,
  twitterFollowDefinition, twitterFollowHandler,
  twitterProfileDefinition, twitterProfileHandler,
  twitterTrendsDefinition, twitterTrendsHandler,
  setTwitterClient,
  getTwitterClient,
} from './builtins/twitter-tools.js';

// --- Email Tools ---
import {
  emailCheckInboxDefinition, emailCheckInboxHandler,
  emailReadMessageDefinition, emailReadMessageHandler,
  emailSendDefinition, emailSendHandler,
  emailGetAddressDefinition, emailGetAddressHandler,
  setEmailConfig,
} from './builtins/email-tools.js';

// --- Credential Vault Tools ---
import {
  credentialStoreDefinition, credentialStoreHandler,
  credentialListDefinition, credentialListHandler,
  credentialGetDefinition, credentialGetHandler,
  setVaultConfig,
} from './builtins/credential-vault.js';

import {
  discordCreateForumPostDefinition, discordCreateForumPostHandler,
  discordCreateChannelDefinition, discordCreateChannelHandler,
  discordSendMessageDefinition, discordSendMessageHandler,
  discordListChannelsDefinition, discordListChannelsHandler,
  discordReadMessagesDefinition, discordReadMessagesHandler,
  setDiscordBot,
  getDiscordBot,
} from './builtins/discord-tools.js';

// --- Marketplace Tools ---
import {
  marketplaceBrowseTasksDefinition, marketplaceBrowseTasksHandler,
  marketplaceBrowseBountiesDefinition, marketplaceBrowseBountiesHandler,
  marketplaceEvaluateTaskDefinition, marketplaceEvaluateTaskHandler,
  marketplaceQuoteTaskDefinition, marketplaceQuoteTaskHandler,
  marketplaceAcceptTaskDefinition, marketplaceAcceptTaskHandler,
  marketplaceSubmitTaskDefinition, marketplaceSubmitTaskHandler,
  marketplaceTaskStatusDefinition, marketplaceTaskStatusHandler,
  marketplaceSendMessageDefinition, marketplaceSendMessageHandler,
  marketplaceEarningsDefinition, marketplaceEarningsHandler,
  marketplaceAgentStatsDefinition, marketplaceAgentStatsHandler,
  setMarketplaceManager,
} from './builtins/marketplace-tools.js';

export { setSystemServices };
export { setBrowserBridge, getBrowserBridge };
export { setTwitterClient, getTwitterClient };
export { setDiscordBot, getDiscordBot };
export { setEmailConfig };
export { setVaultConfig };
export { setMarketplaceManager };

export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  // Core tools
  registry.register(datetimeDefinition, datetimeHandler, { categories: ['core'] });
  registry.register(calculatorDefinition, calculatorHandler, { categories: ['core'] });
  registry.register(webSearchDefinition, webSearchHandler, { categories: ['web'] });
  registry.register(readFileDefinition, readFileHandler, { categories: ['file'] });
  registry.register(writeFileDefinition, writeFileHandler, { categories: ['file'] });
  registry.register(codeRunnerDefinition, codeRunnerHandler, { defaultDenied: true, categories: ['code'] });
  registry.register(memoryReadDefinition, memoryReadHandler, { categories: ['memory'] });
  registry.register(memoryWriteDefinition, memoryWriteHandler, { categories: ['memory'] });
  registry.register(fetchUrlDefinition, fetchUrlHandler, { categories: ['web'] });
  registry.register(projectReadFileDefinition, projectReadFileHandler, { categories: ['file'] });
  registry.register(projectWriteFileDefinition, projectWriteFileHandler, { categories: ['file'] });
  registry.register(scheduleReminderDefinition, scheduleReminderHandler, { categories: ['reminders'] });
  registry.register(listRemindersDefinition, listRemindersHandler, { categories: ['reminders'] });
  registry.register(cancelReminderDefinition, cancelReminderHandler, { categories: ['reminders'] });
  registry.register(installPackageDefinition, installPackageHandler, { defaultDenied: true, categories: ['code'] });

  // Tier 1: Pure utility tools
  registry.register(unitConverterDefinition, unitConverterHandler, { categories: ['data'] });
  registry.register(passwordGeneratorDefinition, passwordGeneratorHandler, { categories: ['data'] });
  registry.register(hashToolDefinition, hashToolHandler, { categories: ['data'] });
  registry.register(jsonFormatterDefinition, jsonFormatterHandler, { categories: ['code'] });
  registry.register(regexTesterDefinition, regexTesterHandler, { categories: ['code'] });
  registry.register(base64CodecDefinition, base64CodecHandler, { categories: ['data'] });
  registry.register(colorConverterDefinition, colorConverterHandler, { categories: ['data'] });
  registry.register(cronParserDefinition, cronParserHandler, { categories: ['data'] });
  registry.register(uuidGeneratorDefinition, uuidGeneratorHandler, { categories: ['data'] });
  registry.register(csvAnalyzerDefinition, csvAnalyzerHandler, { categories: ['code'] });
  registry.register(timezoneConverterDefinition, timezoneConverterHandler, { categories: ['data'] });
  registry.register(randomQuoteDefinition, randomQuoteHandler, { categories: ['core'] });

  // Tier 2: Persistence tools
  registry.register(noteAddDefinition, noteAddHandler, { categories: ['notes'] });
  registry.register(noteListDefinition, noteListHandler, { categories: ['notes'] });
  registry.register(noteSearchDefinition, noteSearchHandler, { categories: ['notes'] });
  registry.register(noteDeleteDefinition, noteDeleteHandler, { categories: ['notes'] });
  registry.register(pomodoroStartDefinition, pomodoroStartHandler, { categories: ['reminders'] });
  registry.register(pomodoroStatusDefinition, pomodoroStatusHandler, { categories: ['reminders'] });
  registry.register(pomodoroStopDefinition, pomodoroStopHandler, { categories: ['reminders'] });

  // Tier 3: External API tools
  registry.register(weatherDefinition, weatherHandler, { categories: ['web'] });
  registry.register(dictionaryDefinition, dictionaryHandler, { categories: ['web'] });
  registry.register(ipLookupDefinition, ipLookupHandler, { categories: ['web'] });
  registry.register(newsHeadlinesDefinition, newsHeadlinesHandler, { categories: ['web'] });

  // Tier 4: External dependency tools
  registry.register(qrGeneratorDefinition, qrGeneratorHandler, { categories: ['data'] });
  registry.register(pdfReaderDefinition, pdfReaderHandler, { defaultDenied: true, categories: ['file'] });
  registry.register(pdfGeneratorDefinition, pdfGeneratorHandler, { defaultDenied: true, categories: ['file'] });
  registry.register(presentationGeneratorDefinition, presentationGeneratorHandler, { defaultDenied: true, categories: ['file'] });
  registry.register(imageGeneratorDefinition, imageGeneratorHandler, { categories: ['media'] });
  registry.register(videoGeneratorDefinition, videoGeneratorHandler, { categories: ['media'] });

  // File delivery
  registry.register(sendFileDefinition, sendFileHandler, { defaultDenied: true, categories: ['file'] });

  // Semantic memory tools
  registry.register(memoryRecallDefinition, memoryRecallHandler, { categories: ['memory'] });
  registry.register(memoryRememberDefinition, memoryRememberHandler, { categories: ['memory'] });
  registry.register(memoryForgetDefinition, memoryForgetHandler, { categories: ['memory'] });

  // Cost tracking
  registry.register(costSummaryDefinition, costSummaryHandler, { categories: ['core'] });

  // Activity log
  registry.register(activitySearchDefinition, activitySearchHandler, { categories: ['memory'] });

  // Memory graph & timeline
  registry.register(memoryGraphDefinition, memoryGraphHandler, { categories: ['memory'] });
  registry.register(memoryTimelineDefinition, memoryTimelineHandler, { categories: ['memory'] });

  // Knowledge base / RAG
  registry.register(webClipDefinition, webClipHandler, { categories: ['web'] });
  registry.register(readLaterAddDefinition, readLaterAddHandler, { categories: ['web'] });
  registry.register(readLaterListDefinition, readLaterListHandler, { categories: ['notes'] });
  registry.register(knowledgeSearchDefinition, knowledgeSearchHandler, { categories: ['memory'] });

  // Voice & media
  registry.register(textToSpeechDefinition, textToSpeechHandler, { categories: ['media'] });
  registry.register(mediaSummarizerDefinition, mediaSummarizerHandler, { categories: ['web'] });
  registry.register(videoAnalyzerDefinition, videoAnalyzerHandler, { categories: ['web'] });

  // Developer tools
  registry.register(gitDiffReviewDefinition, gitDiffReviewHandler, { categories: ['code'] });
  registry.register(depAuditDefinition, depAuditHandler, { categories: ['code'] });
  registry.register(generateTestsDefinition, generateTestsHandler, { categories: ['code'] });

  // Trigger/automation tools
  registry.register(triggerAddDefinition, triggerAddHandler, { categories: ['reminders'] });
  registry.register(triggerListDefinition, triggerListHandler, { categories: ['reminders'] });
  registry.register(triggerRemoveDefinition, triggerRemoveHandler, { categories: ['reminders'] });
  registry.register(triggerToggleDefinition, triggerToggleHandler, { categories: ['reminders'] });

  // Workflow templates
  registry.register(workflowListDefinition, workflowListHandler, { categories: ['core'] });
  registry.register(workflowRunDefinition, workflowRunHandler, { categories: ['core'] });

  // X/Twitter search
  registry.register(xSearchDefinition, xSearchHandler, { categories: ['web'] });

  // X/Twitter compound research tool
  registry.register(xResearchDefinition, xResearchHandler, { categories: ['web'] });

  // Telegram poll
  registry.register(telegramPollDefinition, telegramPollHandler, { categories: ['media'] });

  // Browser control (Playwright MCP bridge)
  registry.register(browseNavigateDefinition, browseNavigateHandler, { categories: ['web'] });
  registry.register(browseClickDefinition, browseClickHandler, { categories: ['web'] });
  registry.register(browseTypeDefinition, browseTypeHandler, { categories: ['web'] });
  registry.register(browseSnapshotDefinition, browseSnapshotHandler, { categories: ['web'] });
  registry.register(browseScreenshotDefinition, browseScreenshotHandler, { categories: ['web'] });
  registry.register(browseBackDefinition, browseBackHandler, { categories: ['web'] });
  registry.register(browseSelectDefinition, browseSelectHandler, { categories: ['web'] });

  // System monitoring & backup
  registry.register(systemStatusDefinition, systemStatusHandler, { categories: ['core'] });
  registry.register(systemBackupDefinition, systemBackupHandler, { categories: ['core'] });

  // Twitter tools (direct API via agent-twitter-client)
  registry.register(twitterSearchDefinition, twitterSearchHandler, { categories: ['web'] });
  registry.register(twitterPostDefinition, twitterPostHandler, { defaultDenied: true, categories: ['web'] });
  registry.register(twitterTimelineDefinition, twitterTimelineHandler, { categories: ['web'] });
  registry.register(twitterReadTweetDefinition, twitterReadTweetHandler, { categories: ['web'] });
  registry.register(twitterLikeDefinition, twitterLikeHandler, { defaultDenied: true, categories: ['web'] });
  registry.register(twitterRetweetDefinition, twitterRetweetHandler, { defaultDenied: true, categories: ['web'] });
  registry.register(twitterFollowDefinition, twitterFollowHandler, { defaultDenied: true, categories: ['web'] });
  registry.register(twitterProfileDefinition, twitterProfileHandler, { categories: ['web'] });
  registry.register(twitterTrendsDefinition, twitterTrendsHandler, { categories: ['web'] });

  // Email tools
  registry.register(emailCheckInboxDefinition, emailCheckInboxHandler, { categories: ['web'] });
  registry.register(emailReadMessageDefinition, emailReadMessageHandler, { categories: ['web'] });
  registry.register(emailSendDefinition, emailSendHandler, { defaultDenied: true, categories: ['web'] });
  registry.register(emailGetAddressDefinition, emailGetAddressHandler, { categories: ['web'] });

  // Credential vault
  registry.register(credentialStoreDefinition, credentialStoreHandler, { categories: ['data'] });
  registry.register(credentialListDefinition, credentialListHandler, { categories: ['data'] });
  registry.register(credentialGetDefinition, credentialGetHandler, { categories: ['data'] });

  // Discord server management
  registry.register(discordListChannelsDefinition, discordListChannelsHandler, { categories: ['media'] });
  registry.register(discordCreateForumPostDefinition, discordCreateForumPostHandler, { categories: ['media'] });
  registry.register(discordCreateChannelDefinition, discordCreateChannelHandler, { defaultDenied: true, categories: ['media'] });
  registry.register(discordSendMessageDefinition, discordSendMessageHandler, { categories: ['media'] });
  registry.register(discordReadMessagesDefinition, discordReadMessagesHandler, { categories: ['media'] });

  // Marketplace tools (MoltLaunch)
  registry.register(marketplaceBrowseTasksDefinition, marketplaceBrowseTasksHandler, { categories: ['marketplace'] });
  registry.register(marketplaceBrowseBountiesDefinition, marketplaceBrowseBountiesHandler, { categories: ['marketplace'] });
  registry.register(marketplaceEvaluateTaskDefinition, marketplaceEvaluateTaskHandler, { categories: ['marketplace'] });
  registry.register(marketplaceQuoteTaskDefinition, marketplaceQuoteTaskHandler, { categories: ['marketplace'] });
  registry.register(marketplaceAcceptTaskDefinition, marketplaceAcceptTaskHandler, { categories: ['marketplace'] });
  registry.register(marketplaceSubmitTaskDefinition, marketplaceSubmitTaskHandler, { categories: ['marketplace'] });
  registry.register(marketplaceTaskStatusDefinition, marketplaceTaskStatusHandler, { categories: ['marketplace'] });
  registry.register(marketplaceSendMessageDefinition, marketplaceSendMessageHandler, { categories: ['marketplace'] });
  registry.register(marketplaceEarningsDefinition, marketplaceEarningsHandler, { categories: ['marketplace'] });
  registry.register(marketplaceAgentStatsDefinition, marketplaceAgentStatsHandler, { categories: ['marketplace'] });

  return registry;
}
