/**
 * @local/dsh-a2a-client — клиент Agent2Agent (A2A) v1.0 для DeepSeek Harness.
 *
 * Подключается к удалённому A2A-агенту по его AgentCard и регистрирует
 * модельные инструменты:
 *
 *   a2a_agents — карточки настроенных агентов (имя, умения, интерфейсы);
 *   a2a_send   — отправить текст и вернуть финальный ответ агента;
 *   a2a_task   — получить / отменить / перечислить задачи.
 *
 * Реализованные методы протокола: SendMessage, SendStreamingMessage (SSE),
 * GetTask, CancelTask, ListTasks. Транспорт — JSON-RPC 2.0 с обязательным
 * заголовком `a2a-version: 1.0` и опциональным `authorization: Bearer <токен>`.
 *
 * Плагин не имеет зависимостей: только встроенный fetch и node:crypto.
 */

import { randomUUID } from 'node:crypto';
import { promises as fsp, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Имя пакета: по нему находится профиль, который действительно загрузил плагин. */
const PACKAGE_NAME = '@local/dsh-a2a-client';

export const name = 'a2a-client';

/** Регистрируем инструменты; без сервиса tools плагин просто не активируется. */
export const inject = ['tools'];

/** Версия протокола A2A, которую объявляем в каждом запросе. */
export const A2A_VERSION = '1.0';

/** Сколько живёт закэшированная карточка агента. */
const CARD_TTL_MS = 30_000;

/** Таймаут одного HTTP-вызова по умолчанию. */
const DEFAULT_TIMEOUT_MS = 180_000;

/** Предел выполнения одного инструмента (агент на той стороне может думать долго). */
const TOOL_TIMEOUT_MS = 600_000;

/**
 * Переменная окружения по умолчанию: её читает любой агент, если для него
 * не задано своё имя. Нужна для конфигов, где один токен общий на всех.
 */
export const DEFAULT_TOKEN_ENV = 'A2A_AUTH_TOKEN';

/**
 * Имя переменной с токеном конкретного агента: `A2A_TOKEN_<ИМЯ>`.
 * `my agent` → `A2A_TOKEN_MY_AGENT`. Пустая строка, если из имени не выходит
 * пригодный идентификатор (например, имя целиком из не-латиницы).
 */
export function envNameFor(agentName) {
  const slug = String(agentName ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug ? `A2A_TOKEN_${slug}` : '';
}

/** Интервал опроса GetTask, пока задача не достигла терминального состояния. */
const POLL_INTERVAL_MS = 500;

/** Состояния задачи, после которых опрос прекращается. */
const TERMINAL_STATES = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_CANCELLED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_AUTH_REQUIRED',
]);

/** Ошибка A2A/JSON-RPC с кодом и методом, чтобы её можно было показать модели. */
export class A2AError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'A2AError';
    this.code = code;
    this.method = details.method;
    this.url = details.url;
    this.reason = details.reason;
    this.cause = details.cause;
  }
}

// ─── Конфигурация ───────────────────────────────────────────────────────────

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Приводит `config` из cordis.patch.yml к внутренней форме.
 * Кривые записи не бросают исключение (иначе плагин не активируется),
 * а попадают в `warnings` и пропускаются.
 */
export function normalizeConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const warnings = [];
  const timeoutMs = positiveNumber(source.timeoutMs, DEFAULT_TIMEOUT_MS);
  const tokenEnv = typeof source.tokenEnv === 'string' && source.tokenEnv.trim()
    ? source.tokenEnv.trim()
    : DEFAULT_TOKEN_ENV;

  const rawAgents = Array.isArray(source.agents) ? source.agents : [];
  if (rawAgents.length === 0) warnings.push('В конфиге нет ни одного агента (agents: []).');

  const agents = [];
  rawAgents.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      warnings.push(`agents[${index}] пропущен: это не объект.`);
      return;
    }
    const cardUrl = String(entry.cardUrl ?? entry.agentCardUrl ?? entry.url ?? '').trim();
    if (!cardUrl) {
      warnings.push(`agents[${index}] пропущен: не задан cardUrl.`);
      return;
    }
    const agentName = String(entry.name ?? entry.id ?? `agent-${index + 1}`).trim();
    agents.push({
      name: agentName,
      cardUrl,
      // Своё имя переменной важнее общего: только оно позволяет держать
      // у разных агентов разные токены. Не задано — выведем из имени агента.
      tokenEnv: (typeof entry.tokenEnv === 'string' && entry.tokenEnv.trim())
        ? entry.tokenEnv.trim()
        : envNameFor(agentName),
      tokenEnvFallback: tokenEnv,
      token: typeof entry.token === 'string' ? entry.token.trim() : '',
      timeoutMs: positiveNumber(entry.timeoutMs, timeoutMs),
      configToken: typeof source.token === 'string' ? source.token.trim() : '',
    });
  });

  const names = new Set();
  for (const agent of agents) {
    if (names.has(agent.name)) warnings.push(`Имя агента «${agent.name}» повторяется; адресация по имени будет неоднозначной.`);
    names.add(agent.name);
  }

  const defaultAgent = typeof source.defaultAgent === 'string' && source.defaultAgent.trim()
    ? source.defaultAgent.trim()
    : agents[0]?.name;

  if (defaultAgent && !names.has(defaultAgent)) {
    warnings.push(`defaultAgent «${defaultAgent}» не найден среди agents.`);
  }

  return { agents, defaultAgent, timeoutMs, tokenEnv, warnings };
}

/**
 * Токен агента: переменная окружения важнее значения из конфига, чтобы секрет
 * можно было не хранить в файле. Порядок — от частного к общему:
 * своя переменная агента (`A2A_TOKEN_<ИМЯ>` или явный `tokenEnv`), затем общая
 * (`tokenEnv` верхнего уровня, по умолчанию `A2A_AUTH_TOKEN`), затем поля
 * `token` из конфига и из файла реестра.
 */
export function resolveToken(agent) {
  for (const envName of [agent.tokenEnv, agent.tokenEnvFallback]) {
    if (!envName) continue;
    const fromEnv = process.env[envName];
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  }
  const token = String(agent.token || agent.configToken || '').trim();
  return token || undefined;
}

function authHeaders(agent) {
  const token = resolveToken(agent);
  return token ? { authorization: `Bearer ${token}` } : {};
}

// ─── Реестр агентов профиля ─────────────────────────────────────────────────

/** Файл реестра в каталоге профиля: им владеет панель. */
export const STORE_FILE = 'a2a-client.json';

/** Имя профиля из аргументов процесса: `--profile desktop` / `--profile=desktop`. */
function profileFromArgv(argv = process.argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const item = String(argv[index] ?? '');
    if (item === '--profile') return String(argv[index + 1] ?? '').trim();
    if (item.startsWith('--profile=')) return item.slice('--profile='.length).trim();
  }
  return '';
}

function listProfileNames(profilesDirectory) {
  try {
    return readdirSync(profilesDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Профиль, в чьём package.json перечислен этот бандл — то есть запущенный сейчас. */
function profileOwningBundle(profilesDirectory) {
  for (const profileName of listProfileNames(profilesDirectory)) {
    try {
      const manifest = JSON.parse(readFileSync(path.join(profilesDirectory, profileName, 'package.json'), 'utf8'));
      const bundles = manifest?.dsh?.profile?.bundles;
      if (Array.isArray(bundles) && bundles.includes(PACKAGE_NAME)) return profileName;
      const dependencies = manifest?.dependencies;
      if (dependencies && Object.prototype.hasOwnProperty.call(dependencies, PACKAGE_NAME)) return profileName;
    } catch {
      // профиль без package.json — не наш
    }
  }
  return '';
}

/**
 * Каталог профиля. У процесса хоста настольного приложения переменные DSH_*
 * могут отсутствовать, поэтому кроме окружения смотрим аргументы запуска и
 * ищем профиль, который объявил этот бандл.
 */
function profileDirectory() {
  if (process.env.DSH_PROFILE_DIR) return process.env.DSH_PROFILE_DIR;
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const profilesDirectory = path.join(home, 'profiles');
  const named = profileFromArgv() || String(process.env.DSH_PROFILE ?? '').trim();
  if (named) return path.join(profilesDirectory, named);
  const owner = profileOwningBundle(profilesDirectory);
  if (owner) return path.join(profilesDirectory, owner);
  const names = listProfileNames(profilesDirectory);
  if (names.length === 1) return path.join(profilesDirectory, names[0]);
  return path.join(profilesDirectory, 'default');
}

/** Полный путь к файлу реестра — он же показывается в подвале панели. */
export function storePath() {
  return path.join(profileDirectory(), STORE_FILE);
}

/** Приводит запись агента к внутренней форме (из конфига или из файла). */
export function agentRecord(spec, fallbackTimeout) {
  const name = String(spec?.name ?? '').trim();
  const explicitEnv = String(spec?.tokenEnv ?? '').trim();
  return {
    name,
    cardUrl: String(spec?.cardUrl ?? '').trim(),
    token: String(spec?.token ?? spec?.configToken ?? '').trim(),
    // Явное имя переменной важнее выведенного из имени агента: так можно
    // подключить несколько агентов к одному токену или дать им разные.
    tokenEnv: explicitEnv || envNameFor(name),
    tokenEnvFallback: String(spec?.tokenEnvFallback ?? '').trim(),
    timeoutMs: positiveNumber(spec?.timeoutMs, fallbackTimeout ?? DEFAULT_TIMEOUT_MS),
    enabled: spec?.enabled !== false,
  };
}

/**
 * Читает файл реестра. При отсутствии файла источником служит `seedAgents`
 * (для глобального реестра — `agents` из конфига плагина).
 */
export async function loadRegistryFrom(file, seedAgents, fallbackTimeout, fallbackTokenEnv = '') {
  const warnings = [];
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed?.agents) ? parsed.agents : [];
    const agents = list
      .map((item) => agentRecord({
        ...item,
        // Общая переменная из конфига важнее сохранённой в файле: файл хранит
        // агентов, а имя переменной задаёт конфиг профиля.
        tokenEnvFallback: fallbackTokenEnv || item?.tokenEnvFallback,
      }, fallbackTimeout))
      .filter((agent) => agent.name && agent.cardUrl);
    if (agents.length !== list.length) warnings.push('Часть записей пропущена: нет name или cardUrl.');
    return { agents, source: 'file', file, exists: true, warnings };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      warnings.push(`Не удалось прочитать ${file}: ${error?.message ?? error}`);
    }
    return { agents: seedAgents, source: 'config', file, exists: false, warnings };
  }
}

/**
 * Источник агентов профиля: файл, а при его отсутствии — `agents` из конфига
 * плагина. Первое изменение из панели создаёт файл, после чего он и является
 * источником истины (патч больше не перечитывается).
 */
export async function loadAgents(config) {
  const seed = config.agents
    .map((item) => agentRecord(item, config.timeoutMs))
    .filter((agent) => agent.name && agent.cardUrl);
  return loadRegistryFrom(storePath(), seed, config.timeoutMs, config.tokenEnv);
}

/** Очередь записи: два быстрых клика в панели не должны перетереть друг друга. */
let writeChain = Promise.resolve();

/** Атомарная запись реестра: временный файл и rename. */
export function persistAgentsTo(file, agents) {
  const payload = `${JSON.stringify({ version: 1, agents }, null, 2)}\n`;
  const write = async () => {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp`;
    await fsp.writeFile(temporary, payload, 'utf8');
    await fsp.rename(temporary, file);
  };
  const next = writeChain.then(write);
  writeChain = next.then(() => undefined, () => undefined);
  return next;
}

/** Запись реестра профиля. */
export function persistAgents(agents) {
  return persistAgentsTo(storePath(), agents);
}

/** Поиск агента по имени или адресу карточки. */
function findAgent(registry, request) {
  const wanted = String(request ?? '').trim();
  if (!wanted) return undefined;
  return registry.agents.find((agent) => agent.name === wanted)
    ?? registry.agents.find((agent) => agent.cardUrl === wanted);
}


// ─── Транспорт ──────────────────────────────────────────────────────────────

function timeoutSignal(timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort(outerSignal?.reason);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', onAbort);
    },
  };
}

function truncate(text, limit = 400) {
  const value = String(text ?? '');
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function looksLikeAbort(error) {
  return error?.name === 'AbortError' || error?.name === 'TimeoutError'
    || /aborted|timeout/i.test(String(error?.message ?? ''));
}

function a2aErrorFromJsonRpc(error, details) {
  const data = Array.isArray(error?.data) ? error.data : [];
  const reason = data[0]?.reason;
  const message = String(error?.message ?? 'Неизвестная ошибка A2A');
  const parts = [`Ошибка A2A (код ${error?.code ?? '?'}): ${message}`];
  if (reason) parts.push(`Причина: ${reason}${data[0]?.domain ? ` (${data[0].domain})` : ''}`);
  if (details?.method) parts.push(`Метод: ${details.method}`);
  if (details?.url) parts.push(`Endpoint: ${details.url}`);
  if (details?.hint) parts.push(details.hint);
  return new A2AError(error?.code ?? 0, parts.join('\n'), { ...details, reason });
}

const cardCache = new Map();

/** Читает и кэширует AgentCard. */
export async function fetchAgentCard(agent, options = {}) {
  const timeoutMs = positiveNumber(options.timeoutMs, agent.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const cached = cardCache.get(agent.cardUrl);
  if (!options.refresh && cached && Date.now() - cached.at < CARD_TTL_MS) return cached.card;

  const gate = timeoutSignal(timeoutMs, options.signal);
  try {
    const response = await fetch(agent.cardUrl, {
      method: 'GET',
      headers: { accept: 'application/json', 'a2a-version': A2A_VERSION, ...authHeaders(agent) },
      signal: gate.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw new A2AError(response.status, [
        `Не удалось получить карточку агента «${agent.name}»: HTTP ${response.status}`,
        `URL: ${agent.cardUrl}`,
        `Ответ: ${truncate(body, 300)}`,
      ].join('\n'), { url: agent.cardUrl });
    }
    let card;
    try {
      card = JSON.parse(body);
    } catch {
      throw new A2AError(response.status, `Карточка агента не является JSON: ${truncate(body, 300)}`, { url: agent.cardUrl });
    }
    if (!card || typeof card !== 'object') {
      throw new A2AError(0, `Пустая карточка агента: ${agent.cardUrl}`, { url: agent.cardUrl });
    }
    cardCache.set(agent.cardUrl, { at: Date.now(), card });
    return card;
  } catch (error) {
    if (error instanceof A2AError) throw error;
    if (looksLikeAbort(error)) {
      throw new A2AError(408, `Агент «${agent.name}» не ответил за ${timeoutMs} мс.\nURL: ${agent.cardUrl}`, { url: agent.cardUrl });
    }
    throw new A2AError(0, `Агент «${agent.name}» недоступен: ${error?.message ?? error}\nURL: ${agent.cardUrl}`, { url: agent.cardUrl, cause: error });
  } finally {
    gate.done();
  }
}

/** Выбирает JSON-RPC интерфейс из AgentCard (A2A 1.0: supportedInterfaces). */
export function pickEndpoint(card) {
  const interfaces = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : [];
  const jsonrpc = interfaces.find((item) => String(item?.protocolBinding ?? '').toUpperCase() === 'JSONRPC');
  const chosen = jsonrpc
    ?? interfaces.find((item) => item && typeof item.url === 'string' && item.url)
    ?? (typeof card?.url === 'string' && card.url ? { url: card.url } : undefined);
  if (!chosen?.url) {
    throw new A2AError(0, 'В карточке агента нет JSON-RPC endpoint (supportedInterfaces[].url).');
  }
  return {
    url: chosen.url,
    tenant: typeof chosen.tenant === 'string' && chosen.tenant ? chosen.tenant : undefined,
    protocolVersion: chosen.protocolVersion,
  };
}

let rpcSeq = 0;

/** Один JSON-RPC вызов с обязательным заголовком a2a-version. */
export async function rpcCall(agent, method, params, options = {}) {
  const card = options.card ?? await fetchAgentCard(agent, options);
  const endpoint = pickEndpoint(card);
  const timeoutMs = positiveNumber(options.timeoutMs, agent.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const payload = {
    jsonrpc: '2.0',
    id: ++rpcSeq,
    method,
    params: endpoint.tenant ? { ...params, tenant: endpoint.tenant } : params,
  };

  const gate = timeoutSignal(timeoutMs, options.signal);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'a2a-version': A2A_VERSION,
        ...authHeaders(agent),
      },
      body: JSON.stringify(payload),
      signal: gate.signal,
    });
    const raw = await response.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      throw new A2AError(response.status, `Ответ ${method} не JSON (HTTP ${response.status}): ${truncate(raw, 300)}`, { method, url: endpoint.url });
    }
    if (body?.error) {
      throw a2aErrorFromJsonRpc(body.error, {
        method,
        url: endpoint.url,
        hint: method === 'SendMessage' || method === 'SendStreamingMessage'
          ? 'Проверьте, что сервер объявляет A2A 1.0 и принимает токен.'
          : undefined,
      });
    }
    if (!body || !('result' in body) || body.result === undefined) {
      throw new A2AError(response.status, `Пустой ответ на ${method} (HTTP ${response.status}): ${truncate(raw, 300)}`, { method, url: endpoint.url });
    }
    return body.result;
  } catch (error) {
    if (error instanceof A2AError) throw error;
    if (looksLikeAbort(error)) {
      throw new A2AError(408, `Вызов ${method} прерван по таймауту (${timeoutMs} мс).\nEndpoint: ${endpoint.url}`, { method, url: endpoint.url });
    }
    throw new A2AError(0, `Сеть недоступна при вызове ${method}: ${error?.message ?? error}\nEndpoint: ${endpoint.url}`, { method, url: endpoint.url, cause: error });
  } finally {
    gate.done();
  }
}

// ─── Разбор ответов ─────────────────────────────────────────────────────────

function collectText(parts, out = []) {
  for (const part of Array.isArray(parts) ? parts : []) {
    if (!part || typeof part !== 'object') continue;
    if (typeof part.text === 'string') out.push(part.text);
    else if (part.data !== undefined) out.push(JSON.stringify(part.data));
    else if (typeof part.url === 'string') out.push(part.url);
  }
  return out;
}

/** Текст ответа: артефакты, затем status.message, затем последняя не-пользовательская реплика. */
export function taskText(task) {
  const chunks = [];
  for (const artifact of Array.isArray(task?.artifacts) ? task.artifacts : []) {
    collectText(artifact?.parts, chunks);
  }
  if (chunks.length === 0 && task?.status?.message) collectText(task.status.message.parts, chunks);
  if (chunks.length === 0 && Array.isArray(task?.history)) {
    const last = [...task.history].reverse().find((message) => message?.role && message.role !== 'ROLE_USER');
    if (last) collectText(last.parts, chunks);
  }
  return chunks.join('').trim();
}

/** Сводка по задаче или сообщению — единая форма для всех инструментов. */
export function summarize(task) {
  if (!task || typeof task !== 'object') {
    return { kind: 'unknown', text: JSON.stringify(task ?? null).slice(0, 1000) };
  }
  return {
    kind: 'task',
    taskId: task.id,
    contextId: task.contextId,
    state: task.status?.state ?? 'TASK_STATE_UNKNOWN',
    text: taskText(task),
    artifacts: Array.isArray(task.artifacts)
      ? task.artifacts.map((artifact) => ({
        id: artifact?.artifactId,
        name: artifact?.name,
        text: collectText(artifact?.parts).join('').trim(),
      })).filter((artifact) => artifact.text)
      : [],
  };
}

// ─── Методы протокола ───────────────────────────────────────────────────────

function buildMessage(text, options) {
  const message = {
    messageId: options.messageId ?? `dsh-${randomUUID()}`,
    role: 'ROLE_USER',
    parts: [{ text }],
  };
  if (options.contextId) message.contextId = options.contextId;
  return message;
}

/** Дожидается терминального состояния задачи (для асинхронных серверов). */
export async function waitForTask(agent, taskId, options = {}) {
  const deadline = Date.now() + positiveNumber(options.waitTimeoutMs, agent.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let last;
  for (;;) {
    last = summarize(await rpcCall(agent, 'GetTask', { id: taskId }, options));
    if (TERMINAL_STATES.has(last.state)) return last;
    if (Date.now() >= deadline) {
      throw new A2AError(408, `Задача ${taskId} не завершилась за отведённое время (состояние ${last.state}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

/** SendMessage (синхронно) + ожидание финального состояния при необходимости. */
export async function sendMessage(agent, text, options = {}) {
  const params = { message: buildMessage(text, options) };
  if (options.returnImmediately) params.configuration = { returnImmediately: true };
  const result = await rpcCall(agent, 'SendMessage', params, options);

  const direct = result?.message ? {
    kind: 'message',
    taskId: undefined,
    contextId: result.message.contextId,
    state: 'MESSAGE',
    text: collectText(result.message.parts).join('').trim(),
    artifacts: [],
  } : summarize(result?.task);

  if (options.wait === false || direct.kind !== 'task' || TERMINAL_STATES.has(direct.state)) return direct;

  const finished = await waitForTask(agent, direct.taskId, options);
  return { ...finished, text: finished.text || direct.text };
}

/** SendStreamingMessage (SSE): собирает дельты artifactUpdate в цельный текст. */
export async function streamMessage(agent, text, options = {}) {
  const card = await fetchAgentCard(agent, options);
  const endpoint = pickEndpoint(card);
  const timeoutMs = positiveNumber(options.timeoutMs, agent.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const message = buildMessage(text, options);
  const payload = {
    jsonrpc: '2.0',
    id: ++rpcSeq,
    method: 'SendStreamingMessage',
    params: endpoint.tenant ? { message, tenant: endpoint.tenant } : { message },
  };

  const gate = timeoutSignal(timeoutMs, options.signal);
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'a2a-version': A2A_VERSION,
        ...authHeaders(agent),
      },
      body: JSON.stringify(payload),
      signal: gate.signal,
    });
    if (!response.ok || !response.body) {
      const raw = await response.text().catch(() => '');
      throw new A2AError(response.status, `Потоковый вызов отклонён (HTTP ${response.status}): ${truncate(raw, 300)}`, { method: 'SendStreamingMessage', url: endpoint.url });
    }

    const state = { taskId: undefined, contextId: undefined, status: 'TASK_STATE_SUBMITTED', artifactText: new Map(), messageText: '' };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const data = frame.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        let envelope;
        try {
          envelope = JSON.parse(data);
        } catch {
          continue;
        }
        if (envelope?.error) {
          throw a2aErrorFromJsonRpc(envelope.error, { method: 'SendStreamingMessage', url: endpoint.url });
        }
        applyStreamEvent(state, envelope?.result);
      }
    }

    const text = state.artifactText.size > 0
      ? [...state.artifactText.values()].join('').trim()
      : state.messageText.trim();
    return { kind: 'task', taskId: state.taskId, contextId: state.contextId, state: state.status, text, artifacts: [] };
  } catch (error) {
    if (error instanceof A2AError) throw error;
    if (looksLikeAbort(error)) {
      throw new A2AError(408, `Поток прерван по таймауту (${timeoutMs} мс).\nEndpoint: ${endpoint.url}`, { method: 'SendStreamingMessage', url: endpoint.url });
    }
    throw new A2AError(0, `Ошибка потока: ${error?.message ?? error}\nEndpoint: ${endpoint.url}`, { method: 'SendStreamingMessage', url: endpoint.url, cause: error });
  } finally {
    gate.done();
  }
}

/** Один SSE-кадр → накопленное состояние потока. */
function applyStreamEvent(state, result) {
  if (!result || typeof result !== 'object') return;
  if (result.task) {
    state.taskId ??= result.task.id;
    state.contextId ??= result.task.contextId;
    if (result.task.status?.state) state.status = result.task.status.state;
  }
  if (result.statusUpdate) {
    state.taskId ??= result.statusUpdate.taskId;
    state.contextId ??= result.statusUpdate.contextId;
    if (result.statusUpdate.status?.state) state.status = result.statusUpdate.status.state;
    const statusText = collectText(result.statusUpdate.status?.message?.parts).join('').trim();
    if (statusText) state.messageText = statusText;
  }
  if (result.artifactUpdate) {
    state.taskId ??= result.artifactUpdate.taskId;
    state.contextId ??= result.artifactUpdate.contextId;
    const artifact = result.artifactUpdate.artifact;
    const chunk = collectText(artifact?.parts).join('');
    const key = artifact?.artifactId ?? 'default';
    if (chunk) {
      // A2A: `append` по умолчанию false — кадр заменяет текст артефакта.
      // Финальный кадр (lastChunk) присылает полный текст повторно, поэтому
      // склеивать его с дельтами нельзя.
      state.artifactText.set(key, result.artifactUpdate.append === true
        ? (state.artifactText.get(key) ?? '') + chunk
        : chunk);
    }
  }
  if (result.message) {
    state.contextId ??= result.message.contextId;
    state.status = 'MESSAGE';
    state.messageText = collectText(result.message.parts).join('').trim();
  }
}

export async function getTask(agent, taskId, options = {}) {
  const result = await rpcCall(agent, 'GetTask', { id: taskId }, options);
  return summarize(result?.task ?? result);
}

export async function cancelTask(agent, taskId, options = {}) {
  const result = await rpcCall(agent, 'CancelTask', { id: taskId }, options);
  return summarize(result?.task ?? result);
}

export async function listTasks(agent, options = {}) {
  const params = { pageSize: positiveNumber(options.pageSize, 20) };
  if (options.contextId) params.contextId = options.contextId;
  const result = await rpcCall(agent, 'ListTasks', params, options);
  const tasks = Array.isArray(result?.tasks) ? result.tasks : [];
  return { tasks: tasks.map((task) => summarize(task)), totalSize: result?.totalSize };
}

// ─── Оформление для модели и человека ───────────────────────────────────────

function formatCard(client, card) {
  const interfaces = (Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [])
    .map((item) => `${item.protocolBinding ?? '?'} ${item.url ?? ''}`.trim())
    .join('; ');
  const skills = (Array.isArray(card.skills) ? card.skills : [])
    .map((skill) => `  • ${skill.id ?? '?'} — ${skill.name ?? ''}${skill.description ? `: ${skill.description}` : ''}`)
    .join('\n');
  const lines = [
    `Агент: ${client.name}`,
    `Карточка: ${client.cardUrl}`,
    `Имя: ${card.name ?? '—'} · версия: ${card.version ?? '—'} · протокол: ${card.protocolVersion ?? A2A_VERSION}`,
  ];
  if (card.description) lines.push(`Описание: ${card.description}`);
  if (interfaces) lines.push(`Интерфейсы: ${interfaces}`);
  if (skills) lines.push(`Умения (${card.skills.length}):\n${skills}`);
  lines.push(`Токен: ${resolveToken(client) ? 'задан' : 'не задан'}`);
  return lines.join('\n');
}

function formatResult(client, summary, durationMs, streaming) {
  const parts = [summary.text || '(пустой ответ)'];
  parts.push('');
  parts.push([
    `Агент: ${client.name}`,
    summary.taskId ? `Задача: ${summary.taskId}` : undefined,
    summary.contextId ? `Контекст: ${summary.contextId}` : undefined,
    `Состояние: ${summary.state}`,
    `Режим: ${streaming ? 'потоковый (SSE)' : 'обычный'}`,
    `Длительность: ${(durationMs / 1000).toFixed(1)} с`,
  ].filter(Boolean).join(' · '));
  return parts.join('\n');
}

// ─── HTTP-маршрут панели настроек ───────────────────────────────────────────

/** Адрес, который опрашивает страница «Настройки → A2A». */
export const API_PATH = '/a2a-client/api';

/** Сколько ждать карточку агента при отрисовке панели. */
const PANEL_CARD_TIMEOUT_MS = 8_000;

function splitHost(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const bracketed = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracketed !== null) return { hostname: bracketed[1], port: bracketed[2] ?? '' };
  const plain = text.match(/^([A-Za-z0-9._-]+)(?::(\d{1,5}))?$/);
  if (plain === null) return null;
  return { hostname: plain[1], port: plain[2] ?? '' };
}

function isLoopback(hostname) {
  const value = String(hostname ?? '').toLowerCase();
  return value === 'localhost' || value === '::1' || value === '[::1]' || value === '0.0.0.0' || /^127\./.test(value);
}

/**
 * Панель может менять состояние удалённого агента, поэтому маршрут отвечает
 * только своей же странице: loopback-соединение, loopback-хост и совпадающий Origin.
 */
function gateRequest(req) {
  const remote = String(req.socket?.remoteAddress ?? '').replace(/^::ffff:/i, '');
  if (!isLoopback(remote)) return 'bad-remote';
  const host = splitHost(req.headers.host);
  if (host === null || !isLoopback(host.hostname)) return 'bad-host';
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin.length === 0) return null;
  if (origin === 'dsh-app://app') return null;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return 'cross-origin';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'cross-origin';
  const defaultPort = parsed.protocol === 'https:' ? '443' : '80';
  if (String(parsed.hostname).toLowerCase() !== String(host.hostname).toLowerCase()) return 'cross-origin';
  if ((parsed.port || defaultPort) !== (host.port || defaultPort)) return 'cross-origin';
  return null;
}

function respondJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Слишком большой запрос.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Тело запроса не является JSON.'));
      }
    });
    req.on('error', reject);
  });
}

/** Компактная карточка для панели: без токенов и лишних полей. */
function panelCard(card) {
  const interfaces = (Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [])
    .map((item) => ({ binding: item.protocolBinding ?? '?', url: item.url ?? '' }));
  const skills = (Array.isArray(card.skills) ? card.skills : []).map((skill) => ({
    id: skill.id ?? '',
    name: skill.name ?? '',
    description: skill.description ?? '',
    tags: Array.isArray(skill.tags) ? skill.tags : [],
  }));
  return {
    name: card.name ?? '',
    description: card.description ?? '',
    version: card.version ?? '',
    protocolVersion: card.protocolVersion ?? A2A_VERSION,
    interfaces,
    skills,
  };
}

// ─── Панель: снимки и API ───────────────────────────────────────────────────

/** Один агент для панели: карточка (если включён), наличие токена, таймаут. */
async function describeAgent(agent) {
  const base = {
    name: agent.name,
    cardUrl: agent.cardUrl,
    hasToken: Boolean(resolveToken(agent)),
    timeoutMs: agent.timeoutMs,
    enabled: agent.enabled !== false,
  };
  if (!base.enabled) return { ...base, card: null, error: null };
  try {
    const card = await fetchAgentCard(agent, { timeoutMs: PANEL_CARD_TIMEOUT_MS, refresh: true });
    return { ...base, card: panelCard(card), error: null };
  } catch (error) {
    return { ...base, card: null, error: String(error?.message ?? error) };
  }
}

/** Снимок одного реестра. */
async function buildSnapshot(registry, extra = {}) {
  const agents = await Promise.all(registry.agents.map(describeAgent));
  return {
    agents,
    defaultAgent: registry.defaultName ?? null,
    warnings: [...registry.warnings],
    store: { file: registry.file, source: registry.source },
    at: new Date().toISOString(),
    api: API_PATH,
    ...extra,
  };
}

/**
 * Один обработчик на обе панели: боковая работает с реестром профиля,
 * вкладка беседы — с реестром рабочей области (глобальные там только читаются).
 */
function createPanelApiHandler(globalRegistry, options) {
  /** contextId, чтобы тестовые сообщения из панели продолжали один диалог. */
  const panelContexts = new Map();

  async function resolveTarget(scope, sessionId) {
    if (scope !== 'workspace') return { scope: 'global', registry: globalRegistry, workspace: null };
    const workspace = options.resolveWorkspace(sessionId);
    if (!workspace) {
      return {
        scope: 'workspace',
        registry: null,
        workspace: null,
        warning: 'Сессия не привязана к рабочей области — показаны только глобальные агенты.',
      };
    }
    let registry = options.workspaceRegistries.get(workspace.file);
    if (!registry) {
      const loaded = await loadRegistryFrom(workspace.file, [], DEFAULT_TIMEOUT_MS, options.tokenEnv);
      registry = {
        agents: loaded.agents,
        defaultName: loaded.agents[0]?.name ?? null,
        warnings: [...loaded.warnings],
        file: workspace.file,
        source: loaded.source,
      };
      options.workspaceRegistries.set(workspace.file, registry);
    }
    return { scope: 'workspace', registry, workspace };
  }

  async function snapshotFor(target) {
    const own = target.registry
      ? await buildSnapshot(target.registry)
      : { agents: [], defaultAgent: null, warnings: [], store: { file: null, source: 'none' }, at: new Date().toISOString(), api: API_PATH };
    if (target.scope !== 'workspace') return { ...own, scope: 'global' };

    const globalAgents = await Promise.all(globalRegistry.agents.map(describeAgent));
    const warnings = [...own.warnings];
    if (target.warning) warnings.push(target.warning);
    return {
      ...own,
      scope: 'workspace',
      workspace: target.workspace
        ? {
          path: target.workspace.path,
          title: target.workspace.title,
          file: target.workspace.file,
          exists: Boolean(target.registry && target.registry.source === 'file'),
        }
        : null,
      globalAgents,
      warnings,
    };
  }

  async function commit(registry) {
    await persistAgentsTo(registry.file, registry.agents);
    registry.source = 'file';
  }

  function requireAgent(registry, name) {
    const agent = findAgent(registry, name);
    if (!agent) {
      const known = registry.agents.map((item) => item.name).join(', ') || '—';
      throw new Error(`Агент «${String(name ?? '')}» не найден. Настроены: ${known}.`);
    }
    return agent;
  }

  function validateName(registry, name, self) {
    const value = String(name ?? '').trim();
    if (!value) throw new Error('Укажите имя агента.');
    if (value.length > 64) throw new Error('Имя длиннее 64 символов.');
    if (!/^[A-Za-z0-9_. -]+$/.test(value)) throw new Error('В имени допустимы буквы, цифры, пробел, «_», «.», «-».');
    const clash = registry.agents.some((item) => item !== self && item.name.toLowerCase() === value.toLowerCase());
    if (clash) throw new Error(`Агент «${value}» уже есть.`);
    return value;
  }

  function validateUrl(cardUrl) {
    const value = String(cardUrl ?? '').trim();
    if (!value) throw new Error('Укажите Agent Card URL.');
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error('Agent Card URL должен быть абсолютным адресом, например http://localhost:3080/.well-known/agent-card.json.');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Поддерживаются только http:// и https://.');
    return value;
  }

  async function verify(record, name) {
    try {
      await fetchAgentCard(record, { timeoutMs: PANEL_CARD_TIMEOUT_MS, refresh: true });
    } catch (error) {
      throw new Error(`Не удалось подключиться к «${name}»: ${error?.message ?? error}`);
    }
  }

  async function addAgent(registry, input) {
    const name = validateName(registry, input?.name);
    const cardUrl = validateUrl(input?.cardUrl);
    const record = agentRecord({
      name,
      cardUrl,
      token: input?.token,
      // Имя переменной выводится из имени агента: панель по-прежнему
      // принимает токен полем, но переменная окружения важнее него.
      tokenEnv: input?.tokenEnv,
      tokenEnvFallback: options.tokenEnv,
      timeoutMs: positiveNumber(Number(input?.timeoutSec) * 1000, DEFAULT_TIMEOUT_MS),
    }, DEFAULT_TIMEOUT_MS);
    await verify(record, name);
    registry.agents.push(record);
    if (!registry.defaultName) registry.defaultName = name;
    return commit(registry);
  }

  async function updateAgent(registry, targetName, patch) {
    const agent = requireAgent(registry, targetName);
    const has = (key) => patch && Object.prototype.hasOwnProperty.call(patch, key);
    const nextName = has('name') ? validateName(registry, patch.name, agent) : agent.name;
    const cardUrl = has('cardUrl') ? validateUrl(patch.cardUrl) : agent.cardUrl;
    const timeoutMs = has('timeoutSec')
      ? positiveNumber(Number(patch.timeoutSec) * 1000, agent.timeoutMs)
      : agent.timeoutMs;
    let token = agent.token;
    if (patch?.clearToken === true) token = '';
    else if (typeof patch?.token === 'string' && patch.token.trim()) token = patch.token.trim();

    const candidate = agentRecord({
      name: nextName,
      cardUrl,
      token,
      tokenEnv: has('tokenEnv') ? patch.tokenEnv : agent.tokenEnv,
      tokenEnvFallback: agent.tokenEnvFallback || options.tokenEnv,
      timeoutMs,
      enabled: agent.enabled,
    }, agent.timeoutMs);
    await verify(candidate, nextName);

    const renamed = nextName !== agent.name;
    Object.assign(agent, candidate);
    if (renamed) {
      options.forgetAgent?.(targetName);
      panelContexts.delete(targetName);
      if (registry.defaultName === targetName) registry.defaultName = nextName;
    }
    return commit(registry);
  }

  async function removeAgent(registry, name) {
    const agent = requireAgent(registry, name);
    registry.agents = registry.agents.filter((item) => item !== agent);
    panelContexts.delete(agent.name);
    options.forgetAgent?.(agent.name);
    if (registry.defaultName === agent.name) registry.defaultName = registry.agents[0]?.name ?? null;
    return commit(registry);
  }

  async function setEnabled(registry, name, enabled) {
    const agent = requireAgent(registry, name);
    agent.enabled = Boolean(enabled);
    if (agent.enabled && !registry.defaultName) registry.defaultName = agent.name;
    return commit(registry);
  }

  function readScope(req, body) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const scope = String(body?.scope ?? url.searchParams.get('scope') ?? 'global');
    const sessionId = String(body?.sessionId ?? url.searchParams.get('sessionId') ?? '');
    return { scope: scope === 'workspace' ? 'workspace' : 'global', sessionId };
  }

  return async function handleA2aClientApi(req, res) {
    const refusal = gateRequest(req);
    if (refusal !== null) {
      respondJson(res, 403, { ok: false, error: { message: `Запрос отклонён (${refusal}).` } });
      return;
    }
    const method = req.method ?? 'GET';
    if (method === 'GET' || method === 'HEAD') {
      try {
        const { scope, sessionId } = readScope(req);
        respondJson(res, 200, { ok: true, ...(await snapshotFor(await resolveTarget(scope, sessionId))) });
      } catch (error) {
        respondJson(res, 500, { ok: false, error: { message: String(error?.message ?? error) } });
      }
      return;
    }
    if (method !== 'POST') {
      respondJson(res, 405, { ok: false, error: { message: 'Метод не поддерживается.' } });
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      respondJson(res, 400, { ok: false, error: { message: String(error?.message ?? error) } });
      return;
    }

    const action = String(body?.action ?? '');
    const { scope, sessionId } = readScope(req, body);
    try {
      const target = await resolveTarget(scope, sessionId);
      const registry = target.registry;

      if (action === 'refresh' || action === 'cards') {
        respondJson(res, 200, { ok: true, ...(await snapshotFor(target)) });
        return;
      }

      if (action === 'send') {
        // В рабочей области агент ищется сначала среди её записей, затем среди
        // глобальных — чтобы из вкладки можно было проверить и те, и другие.
        const agent = registry
          ? (findAgent(registry, body?.agent) ?? (scope === 'workspace' ? findAgent(globalRegistry, body?.agent) : undefined))
          : findAgent(globalRegistry, body?.agent);
        if (!agent) throw new Error(`Агент «${String(body?.agent ?? '')}» не найден.`);
        if (agent.enabled === false) throw new Error(`Агент «${agent.name}» отключён — включите его в панели A2A.`);
        const text = String(body?.text ?? '').trim();
        if (!text) throw new Error('Текст сообщения пуст.');
        const timeoutMs = positiveNumber(Number(body?.timeoutSec) * 1000, agent.timeoutMs);
        const key = `${scope}::${agent.name}`;
        const options = { timeoutMs, waitTimeoutMs: timeoutMs, contextId: panelContexts.get(key) || undefined };
        const started = Date.now();
        const summary = body?.stream
          ? await streamMessage(agent, text, options)
          : await sendMessage(agent, text, options);
        if (summary.contextId) panelContexts.set(key, summary.contextId);
        respondJson(res, 200, {
          ok: true,
          result: {
            agent: agent.name,
            text: summary.text,
            state: summary.state,
            taskId: summary.taskId ?? null,
            contextId: summary.contextId ?? null,
            streaming: Boolean(body?.stream),
            durationMs: Date.now() - started,
          },
        });
        return;
      }

      // Изменять можно только записи рабочей области: глобальные из вкладки
      // беседы недоступны, их правят в боковой панели.
      if (!registry) throw new Error('Рабочая область не найдена — изменения недоступны.');

      if (action === 'add') {
        await addAgent(registry, body?.agent);
        respondJson(res, 200, { ok: true, ...(await snapshotFor(target)) });
        return;
      }
      if (action === 'update') {
        await updateAgent(registry, body?.agent, body?.patch);
        respondJson(res, 200, { ok: true, ...(await snapshotFor(target)) });
        return;
      }
      if (action === 'remove') {
        await removeAgent(registry, body?.agent);
        respondJson(res, 200, { ok: true, ...(await snapshotFor(target)) });
        return;
      }
      if (action === 'enable' || action === 'disable') {
        await setEnabled(registry, body?.agent, action === 'enable');
        respondJson(res, 200, { ok: true, ...(await snapshotFor(target)) });
        return;
      }

      throw new Error(`Неизвестное действие: «${action}».`);
    } catch (error) {
      respondJson(res, 200, { ok: false, error: { message: String(error?.message ?? error) } });
    }
  };
}

// ─── Плагин ─────────────────────────────────────────────────────────────────

/**
 * Выбирает агента для инструментов: явное имя, иначе defaultAgent, иначе
 * первый включённый. Отключённый агент — понятная ошибка, а не «не найден».
 */
export function selectAgent(registry, requested) {
  const enabled = registry.agents.filter((agent) => agent.enabled !== false);
  const wanted = String(requested ?? '').trim() || registry.defaultName || enabled[0]?.name;
  if (!wanted) {
    throw new Error('Не настроен ни один A2A-агент: добавьте его в панели A2A.');
  }
  const agent = findAgent(registry, wanted);
  if (!agent) {
    const known = registry.agents.map((item) => item.name).join(', ') || '—';
    throw new Error(`Агент «${wanted}» не найден. Настроены: ${known}.`);
  }
  if (agent.enabled === false) {
    throw new Error(`Агент «${agent.name}» отключён — включите его в панели A2A.`);
  }
  return agent;
}

export async function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig);
  for (const warning of config.warnings) ctx.logger?.warn?.(`[a2a-client] ${warning}`);

  const loaded = await loadAgents(config);
  for (const warning of loaded.warnings) ctx.logger?.warn?.(`[a2a-client] ${warning}`);

  /** Живой реестр профиля: боковая панель меняет его и сохраняет в a2a-client.json профиля. */
  const registry = {
    agents: loaded.agents,
    defaultName: config.defaultAgent ?? loaded.agents[0]?.name ?? null,
    warnings: [...config.warnings, ...loaded.warnings],
    file: loaded.file,
    source: loaded.source,
  };

  /** Реестры рабочих областей: ключ — путь к файлу `<workspace>/.dsh/a2a-client.json`. */
  const workspaceRegistries = new Map();

  /** Рабочая область, которой принадлежит сессия (по данным реестра областей). */
  function resolveWorkspace(sessionId) {
    const id = String(sessionId ?? '').trim();
    if (!id) return null;
    const service = ctx.get('workspaceRegistry');
    if (!service || typeof service.list !== 'function') return null;
    for (const workspace of service.list()) {
      const sessions = Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [];
      if (sessions.includes(id)) {
        return {
          id: workspace.id,
          path: workspace.path,
          title: workspace.title,
          file: path.join(workspace.path, '.dsh', STORE_FILE),
        };
      }
    }
    return null;
  }

  /** Реестр рабочей области сессии, лениво загружаемый из её файла. */
  async function workspaceRegistry(workspace) {
    let local = workspaceRegistries.get(workspace.file);
    if (!local) {
      const fileLoaded = await loadRegistryFrom(workspace.file, [], DEFAULT_TIMEOUT_MS, config.tokenEnv);
      local = {
        agents: fileLoaded.agents,
        defaultName: fileLoaded.agents[0]?.name ?? null,
        warnings: [...fileLoaded.warnings],
        file: workspace.file,
        source: fileLoaded.source,
      };
      workspaceRegistries.set(workspace.file, local);
    }
    return local;
  }

  /**
   * Реестр для инструментов: агенты рабочей области сессии плюс глобальные,
   * которых она не перекрывает по имени.
   */
  async function registryForSession(sessionId) {
    const workspace = resolveWorkspace(sessionId);
    if (!workspace) return registry;
    const local = await workspaceRegistry(workspace);
    if (local.agents.length === 0) return registry;
    const names = new Set(local.agents.map((agent) => agent.name));
    return {
      agents: [...local.agents, ...registry.agents.filter((agent) => !names.has(agent.name))],
      defaultName: local.agents[0]?.name ?? registry.defaultName,
      warnings: [...local.warnings, ...registry.warnings],
      file: local.file,
      source: local.source,
    };
  }

  /** contextId прошлых вызовов: ключ «сессия + агент» → контекст на удалённой стороне. */
  const contexts = new Map();
  const contextKey = (sessionId, agentName) => `${sessionId}::${agentName}`;

  /** Удалённого агента забываем полностью, иначе новый с тем же именем унаследует чужой контекст. */
  const forgetAgent = (agentName) => {
    for (const key of [...contexts.keys()]) {
      if (key.endsWith(`::${agentName}`)) contexts.delete(key);
    }
  };

  // Маршрут для панелей A2A; без веб-сервера плагин работает как обычно.
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(
      () => webCtx.webServer.register({
        kind: 'exact',
        path: API_PATH,
        handler: createPanelApiHandler(registry, { resolveWorkspace, workspaceRegistries, forgetAgent, tokenEnv: config.tokenEnv }),
      }),
      'a2a-client: panel API',
    );
  });

  ctx.effect(() => ctx.tools.register({
    name: 'a2a_agents',
    description: 'Показать настроенных A2A-агентов: имя, карточку, умения и интерфейсы. Используйте в начале работы, чтобы понять, какие удалённые агенты доступны.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Имя агента. Не указано — все настроенные.' },
        refresh: { type: 'boolean', description: 'Перечитать карточку с сервера, не из кэша.' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }];
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const sessionRegistry = await registryForSession(exec?.agent?.id);
      const targets = args?.agent ? [selectAgent(sessionRegistry, args.agent)] : sessionRegistry.agents;
      if (targets.length === 0) return 'Ни одного A2A-агента не настроено: добавьте его в панели A2A.';
      const blocks = [];
      for (const agent of targets) {
        try {
          const card = await fetchAgentCard(agent, { refresh: Boolean(args?.refresh), signal: exec?.signal });
          blocks.push(formatCard(agent, card));
        } catch (error) {
          blocks.push(`Агент: ${agent.name}\nКарточка: ${agent.cardUrl}\nОшибка: ${error.message}`);
        }
      }
      if (sessionRegistry.warnings.length > 0) blocks.push(`Предупреждения:\n${sessionRegistry.warnings.map((w) => `• ${w}`).join('\n')}`);
      return blocks.join('\n\n');
    },
  }), 'a2a-client: a2a_agents');

  ctx.effect(() => ctx.tools.register({
    name: 'a2a_send',
    description: 'Отправить сообщение удалённому A2A-агенту и вернуть его финальный ответ. Продолжение диалога — тем же contextId (он возвращается в ответе и запоминается автоматически).',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Текст сообщения удалённому агенту.' },
        agent: { type: 'string', description: 'Имя настроенного агента; по умолчанию defaultAgent.' },
        contextId: { type: 'string', description: 'Контекст прошлой задачи для продолжения диалога.' },
        stream: { type: 'boolean', description: 'Использовать SendStreamingMessage (SSE) вместо SendMessage.' },
        timeoutSec: { type: 'number', description: 'Таймаут ожидания ответа в секундах (по умолчанию из конфига).' },
      },
      required: ['text'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }];
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const text = String(args?.text ?? '').trim();
      if (!text) throw new Error('Параметр text обязателен и не может быть пустым.');
      const sessionRegistry = await registryForSession(exec?.agent?.id);
      const agent = selectAgent(sessionRegistry, args?.agent);
      const sessionId = String(exec?.agent?.id ?? 'global');
      const contextId = args?.contextId || contexts.get(contextKey(sessionId, agent.name));
      const options = {
        contextId,
        signal: exec?.signal,
        timeoutMs: positiveNumber(Number(args?.timeoutSec) * 1000, agent.timeoutMs),
        waitTimeoutMs: positiveNumber(Number(args?.timeoutSec) * 1000, agent.timeoutMs),
      };
      const started = Date.now();
      const summary = args?.stream
        ? await streamMessage(agent, text, options)
        : await sendMessage(agent, text, options);
      if (summary.contextId) {
        if (contexts.size > 500) contexts.clear();
        contexts.set(contextKey(sessionId, agent.name), summary.contextId);
      }
      return formatResult(agent, summary, Date.now() - started, Boolean(args?.stream));
    },
  }), 'a2a-client: a2a_send');

  ctx.effect(() => ctx.tools.register({
    name: 'a2a_task',
    description: 'Работа с задачами удалённого A2A-агента: get — состояние и результат по taskId, cancel — отмена, list — последние задачи.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'cancel', 'list'], description: 'Что сделать с задачами.' },
        taskId: { type: 'string', description: 'Идентификатор задачи для action=get/cancel.' },
        agent: { type: 'string', description: 'Имя настроенного агента.' },
        contextId: { type: 'string', description: 'Фильтр по контексту для action=list.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'string' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }];
      },
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    async execute(args, exec) {
      const action = String(args?.action ?? '').trim();
      const sessionRegistry = await registryForSession(exec?.agent?.id);
      const agent = selectAgent(sessionRegistry, args?.agent);
      const options = { signal: exec?.signal, timeoutMs: agent.timeoutMs };

      if (action === 'list') {
        const result = await listTasks(agent, { ...options, contextId: args?.contextId });
        if (result.tasks.length === 0) return `У агента ${agent.name} нет задач.`;
        const rows = result.tasks.map((task) => [
          `• ${task.taskId ?? '?'} · ${task.state}`,
          task.contextId ? `  контекст: ${task.contextId}` : undefined,
          task.text ? `  ${truncate(task.text, 200)}` : undefined,
        ].filter(Boolean).join('\n'));
        return `Задачи агента ${agent.name} (${result.tasks.length}):\n${rows.join('\n')}`;
      }

      const taskId = String(args?.taskId ?? '').trim();
      if (!taskId) throw new Error(`Для action=${action} нужен taskId.`);

      const summary = action === 'cancel'
        ? await cancelTask(agent, taskId, options)
        : await getTask(agent, taskId, options);

      return formatResult(agent, summary, 0, false);
    },
  }), 'a2a-client: a2a_task');
}





