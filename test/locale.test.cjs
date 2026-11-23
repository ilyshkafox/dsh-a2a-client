/**
 * Проверка локализации панели без DSH и без зависимостей:
 *
 *   node test/locale.test.cjs
 *
 * Файл поднимает мини-рендерер с хуками, поддельный сервис локализации и
 * заглушку fetch, затем проверяет:
 *
 *   1. ключи словарей ru/en/zh совпадают и ни одно значение не пустое;
 *   2. каждый ключ, который запрашивает панель, есть в таблице, и в таблице
 *      нет забытых ключей;
 *   3. панель, окно агента, окна добавления и удаления и вкладка беседы
 *      рисуются на каждом языке без «сырых» ключей вида `panel.globalTitle`;
 *   4. смена языка при открытом окне перерисовывает подписи;
 *   5. во время загрузки не показывается «агентов нет», а ошибки host-половины
 *      помечаются как сообщение сервера;
 *   6. пробное сообщение остаётся английским на любом языке интерфейса.
 *
 * Тест не подключается к сети: снимок агентов подставлен в `fetch`.
 */
const fs = require('node:fs')
const path = require('node:path')

const code = fs.readFileSync(path.join(__dirname, '..', 'client.js'), 'utf8')
/** Текст пробного сообщения берётся из client.js: он не переводится. */
const DEFAULT_PROBE = /var DEFAULT_PROBE = '([^']*)'/.exec(code)[1]
let captured = null
const fakeWindow = {
  __ModuleLoader__: { load(definition) { captured = definition } },
  addEventListener() {},
  removeEventListener() {},
}

/* ------------------------------------------------------------ мини-React */

let dirty = false
let activeHook = null
const stateStore = new Map()
const effectStore = new Map()
const pendingEffects = []

const React = {
  createElement(type, props, ...children) {
    return { type, props: Object.assign({}, props, children.length ? { children } : {}) }
  },
  useRef(initial) {
    // Тот же слот состояния, что у useState: ссылка живёт между проходами.
    const record = activeHook
    const index = record.index++
    const key = record.component + '#ref'
    const store = stateStore.get(key) || []
    stateStore.set(key, store)
    if (!(index in store)) store[index] = { current: initial === undefined ? null : initial }
    return store[index]
  },
  useState(initial) {
    const record = activeHook
    const index = record.index++
    const store = stateStore.get(record.component) || []
    stateStore.set(record.component, store)
    if (!(index in store)) store[index] = typeof initial === 'function' ? initial() : initial
    const setter = (value) => {
      const next = typeof value === 'function' ? value(store[index]) : value
      if (!Object.is(next, store[index])) {
        store[index] = next
        dirty = true
      }
    }
    return [store[index], setter]
  },
  useEffect(fn, deps) {
    const record = activeHook
    const index = record.index++
    const store = effectStore.get(record.component) || []
    effectStore.set(record.component, store)
    const previous = store[index]
    const changed = !previous || !deps || !previous.deps
      || deps.length !== previous.deps.length
      || deps.some((value, position) => !Object.is(value, previous.deps[position]))
    if (changed) pendingEffects.push({ record: record.component, index, fn, deps, previous })
  },
  // useCallback/useMemo: тот же кэш, что у useState, — ссылка не меняется
  // между проходами, иначе эффект с зависимостью [load] перезапускался бы.
  useCallback(fn, deps) {
    return React.useMemo(() => fn, deps || [])
  },
  useMemo(factory, deps) {
    const record = activeHook
    const index = record.index++
    const key = record.component + '#memo'
    const store = stateStore.get(key) || []
    stateStore.set(key, store)
    const previous = store[index]
    if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length
      || deps.some((value, position) => !Object.is(value, previous.deps[position]))) {
      store[index] = { deps, value: factory() }
    }
    return store[index].value
  },
}

function renderComponent(component, props) {
  const previous = activeHook
  const record = { component, index: 0 }
  activeHook = record
  try {
    return renderNode(component(props))
  } finally {
    activeHook = previous
  }
}

function renderNode(node) {
  if (node == null || node === false) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.map(renderNode)
  if (typeof node.type === 'function') return renderComponent(node.type, node.props)
  const props = Object.assign({}, node.props)
  if (props.children !== undefined) props.children = renderNode(props.children)
  return { type: node.type, props }
}

function runEffects() {
  const effects = pendingEffects.splice(0)
  for (const effect of effects) {
    const store = effectStore.get(effect.record)
    store[effect.index] = { deps: effect.deps }
    if (effect.previous && effect.previous.cleanup) effect.previous.cleanup()
    store[effect.index].cleanup = effect.fn()
  }
}

/** Плоский обход отрисованного дерева: текст и строковые пропсы. */
function collect(node, out = []) {
  if (node == null || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out }
  if (Array.isArray(node)) { node.forEach(child => collect(child, out)); return out }
  if (node.props) {
    for (const [key, value] of Object.entries(node.props)) {
      if (key === 'children') continue
      if (typeof value === 'string' && value.trim()) out.push(value)
    }
    collect(node.props.children, out)
  }
  return out
}

function find(node, predicate) {
  if (node == null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate)
      if (hit) return hit
    }
    return null
  }
  if (predicate(node)) return node
  return find(node.props && node.props.children, predicate)
}

function findButton(node, text) {
  return find(node, (candidate) => {
    if (candidate.type !== 'button') return false
    const children = candidate.props && candidate.props.children
    return Array.isArray(children) ? children.some(child => child === text) : children === text
  })
}

/* ------------------------------------------------ поддельный DSH и данные */

const registrations = []
const dictionaries = {}

const ctx = {
  effect(fn) { return fn() },
  locale: { register(ns, dicts) { dictionaries[ns] = dicts; return () => {} } },
  slots: {
    inject(key, callback) {
      const iterator = callback()
      let step = iterator.next()
      while (!step.done) step = iterator.next()
      return () => {}
    },
    register(options, component) { registrations.push({ options, component }); return () => {} },
  },
}

const snapshot = {
  ok: true,
  scope: 'global',
  agents: [
    {
      name: 'alpha',
      cardUrl: 'https://agent.example.com/.well-known/agent-card.json',
      hasToken: true,
      timeoutMs: 120000,
      enabled: true,
      card: {
        name: 'Alpha',
        description: 'Remote helper',
        version: '2.1.0',
        protocolVersion: '1.0',
        interfaces: [{ binding: 'JSONRPC', url: 'https://agent.example.com/rpc' }],
        skills: [{ id: 'echo', name: 'Echo', description: 'Echoes text', tags: ['test'] }],
      },
      error: null,
    },
    {
      name: 'beta',
      cardUrl: 'https://beta.example.com/card.json',
      hasToken: false,
      timeoutMs: 60000,
      enabled: false,
      card: null,
      error: null,
    },
  ],
  defaultAgent: 'alpha',
  warnings: [],
  store: { file: 'C:/Users/me/.dsh/profiles/desktop/a2a-client.json', source: 'file' },
  at: '2026-11-23T20:00:00.000Z',
  api: '/a2a-client/api',
}

const workspaceSnapshot = Object.assign({}, snapshot, {
  scope: 'workspace',
  workspace: { path: 'G:/local/demo', title: 'demo', file: 'G:/local/demo/.dsh/a2a-client.json', exists: true },
  agents: [snapshot.agents[0]],
  globalAgents: [snapshot.agents[1]],
})

let served = snapshot
globalThis.fetch = async () => ({ json: async () => served })

/* ------------------------------------------------------------------ тест */

function assert(condition, message) {
  if (!condition) throw new Error('FAIL: ' + message)
}

function translate(language) {
  return (key, params) => {
    let text = dictionaries['a2a-client'][language][key]
    if (text === undefined) return key
    if (params) text = text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
    return text
  }
}

async function render(t, root) {
  let tree = null
  for (let pass = 0; pass < 8; pass += 1) {
    dirty = false
    tree = renderNode(root(t))
    runEffects()
    await new Promise(resolve => setTimeout(resolve, 0))
    if (!dirty) break
  }
  return tree
}

/** Сброс состояния компонентов: эмуляция нового монтирования панели. */
function resetState() {
  stateStore.clear()
  effectStore.clear()
  pendingEffects.length = 0
  activeHook = null
}

async function main() {
  new Function('window', code)(fakeWindow)
  const plugin = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected module: ' + name)
  })
  plugin.apply(ctx)

  /* 1. Словари: одинаковый набор ключей и непустые значения. */
  const en = dictionaries['a2a-client'].en
  const ru = dictionaries['a2a-client'].ru
  const zh = dictionaries['a2a-client'].zh
  const enKeys = Object.keys(en).sort()
  assert(JSON.stringify(enKeys) === JSON.stringify(Object.keys(ru).sort()), 'ru key set differs')
  assert(JSON.stringify(enKeys) === JSON.stringify(Object.keys(zh).sort()), 'zh key set differs')
  for (const key of enKeys) {
    for (const [language, dict] of Object.entries({ en, ru, zh })) {
      assert(typeof dict[key] === 'string' && dict[key].trim() !== '', 'empty ' + language + ' value: ' + key)
    }
  }
  console.log('dictionary keys:', enKeys.length)

  /* 2. Каждый запрошенный ключ определён, каждый определённый — используется. */
  const referenced = new Set()
  // Ключ может попасть в словарь двумя путями: прямо в `t('...')` или через
  // помощник вроде `sectionTitle('...', t)` / `localError('...')`, поэтому
  // собираются все строковые литералы вида `namespace.key`.
  for (const match of code.matchAll(/'([a-z][a-zA-Z]*\.[a-zA-Z]+)'/g)) referenced.add(match[1])
  // Имена слотов DSH — не ключи словаря, хотя выглядят так же.
  for (const slot of ['sidebar.panellist', 'conversation.view', 'plugins.bundle.config', 'plugins.row.config']) referenced.delete(slot)
  const missing = [...referenced].filter(key => !(key in en))
  assert(missing.length === 0, 'keys used but not defined: ' + missing.join(', '))
  // Ключи state.* выбираются по переменной, поэтому в тексте их не видно.
  const unused = enKeys.filter(key => !referenced.has(key) && !key.startsWith('state.'))
  assert(unused.length === 0, 'defined but unused keys: ' + unused.join(', '))
  console.log('referenced keys:', referenced.size)
  /* 3. Каждая точка входа объявляет пространство имён словарей. */
  const mainRegistration = registrations.find(entry => entry.options.name === 'main')
  assert(mainRegistration, 'main registration missing')
  for (const entry of registrations) {
    assert(entry.options.locale === 'a2a-client', 'missing locale option: ' + entry.options.name)
  }
  console.log('registrations with locale:', registrations.length)

  const expectations = {
    zh: {
      add: '添加智能体',
      title: 'A2A 连接',
      row: '打开“alpha”——可用',
      badge: '可用',
      disabled: '已停用',
      remove: '删除“alpha”？',
      test: '测试消息',
      warnings: '警告',
    },
    en: {
      add: 'Add agent',
      title: 'A2A connections',
      row: 'Open “alpha” — Available',
      badge: 'Available',
      disabled: 'Disabled',
      remove: 'Delete “alpha”?',
      test: 'Test message',
      warnings: 'Warnings',
    },
    ru: {
      add: 'Добавить агента',
      title: 'Подключения A2A',
      row: 'Открыть «alpha» — Доступен',
      badge: 'Доступен',
      disabled: 'Отключён',
      remove: 'Удалить «alpha»?',
      test: 'Тестовое сообщение',
      warnings: 'Предупреждения',
    },
  }

  served = snapshot
  for (const [language, expected] of Object.entries(expectations)) {
    const t = translate(language)
    const root = (translateFn) => mainRegistration.component({ t: translateFn })

    let tree = await render(t, root)
    let texts = collect(tree)
    assert(texts.includes(expected.add), language + ': add button missing; got ' + texts.slice(0, 12).join(' | '))
    assert(texts.includes(expected.title), language + ': title missing')
    assert(texts.includes(expected.row), language + ': row aria-label (with status) missing; got ' + texts.filter(x => x.startsWith('Open') || x.startsWith('Открыть') || x.startsWith('打开')).join(' | '))
    assert(texts.includes(expected.badge), language + ': status badge missing')
    assert(texts.includes(expected.disabled), language + ': disabled badge missing')
    assert(texts.includes('alpha') && texts.includes('beta'), language + ': agent names missing')

    // Строка открывает окно агента: метаданные, карточка, умения, тестовое сообщение.
    const opener = find(tree, node => node.props && node.props['aria-label'] === expected.row)
    assert(opener && typeof opener.props.onClick === 'function', language + ': row opener not clickable')
    opener.props.onClick()
    tree = await render(t, root)
    texts = collect(tree)
    assert(texts.includes(expected.test), language + ': test panel missing')
    assert(texts.includes(t('details.protocol')) && texts.includes(t('details.cardTitle')), language + ': details missing')
    assert(texts.includes('Echo'), language + ': card skill name missing')
    assert(texts.some(text => text.includes('Echoes text')), language + ': card skill description missing')
    assert(texts.includes(t('action.remove')), language + ': remove button missing')

    // Пробное сообщение — английская полезная нагрузка, одинаково на всех языках.
    assert(texts.includes(DEFAULT_PROBE), language + ': probe payload missing or translated')

    // Удаление спрашивает подтверждение на активном языке.
    const removeButton = findButton(tree, t('action.remove'))
    assert(removeButton, language + ': remove button not found')
    removeButton.props.onClick()
    tree = await render(t, root)
    texts = collect(tree)
    assert(texts.includes(expected.remove), language + ': confirm question missing; got ' + texts.slice(-8).join(' | '))

    const leaked = texts.filter(text => /^[a-z][a-zA-Z]*\.[a-zA-Z]+$/.test(text))
    assert(leaked.length === 0, language + ': raw keys leaked: ' + leaked.join(', '))
    console.log(language + ' panel + agent dialog OK, strings:', texts.length)
  }

  // Окно добавления: поля, подсказка про имя и подсказка на активном языке.
  for (const language of ['zh', 'ru']) {
    const t = translate(language)
    const root = (translateFn) => mainRegistration.component({ t: translateFn })
    let tree = await render(t, root)
    const addButton = findButton(tree, t('action.addAgent'))
    assert(addButton, language + ': add button not clickable')
    addButton.props.onClick()
    tree = await render(t, root)
    const texts = collect(tree)
    assert(texts.includes(t('form.addTitle')), language + ': add dialog title missing')
    assert(texts.includes(t('form.name')) && texts.includes(t('form.cardUrl')) && texts.includes(t('form.timeout')), language + ': add form fields missing')
    assert(texts.includes(t('form.nameHint')), language + ': name rule hint missing')
    assert(texts.includes(t('action.cancel')), language + ': add dialog cancel missing')
    console.log(language + ' add dialog OK')
  }

  // Смена языка при открытом окне: подписи перерисовываются, а правка в поле
  // ввода и текст ошибки не застревают на прежнем языке.
  {
    const treeRu = await render(translate('ru'), (translateFn) => mainRegistration.component({ t: translateFn }))
    const addButton = findButton(treeRu, translate('ru')('action.addAgent'))
    addButton.props.onClick()
    const before = collect(await render(translate('ru'), (translateFn) => mainRegistration.component({ t: translateFn })))
    assert(before.includes('Новый агент'), 'ru add dialog title missing before switch')

    const after = collect(await render(translate('zh'), (translateFn) => mainRegistration.component({ t: translateFn })))
    assert(after.includes('新建智能体'), 'dialog did not re-render in zh after switch')
    assert(!after.includes('Новый агент'), 'ru title still shown after switch to zh')
    console.log('live language switch OK')
  }

  // Пустые состояния не показываются, пока данные не пришли, и не дублируют
  // сообщение об ошибке загрузки — ни в боковой панели, ни во вкладке беседы.
  {
    const t = translate('en')
    const pending = new Promise(() => {})
    const realFetch = globalThis.fetch

    resetState()
    globalThis.fetch = () => pending
    const loading = collect(await render(t, (translateFn) => mainRegistration.component({ t: translateFn })))
    assert(loading.includes('Loading…'), 'loading label missing')
    assert(!loading.includes(t('panel.empty')), 'empty state shown while loading')

    // Вкладка беседы: отсутствие рабочей области — тоже факт, известный только
    // по загруженным данным, поэтому «нет рабочей области» до ответа не пишется.
    const view = registrations.find(entry => entry.options.name === 'conversation.view')
    resetState()
    const loadingWorkspace = collect(await render(t, (translateFn) => view.component({ sessionId: 'session-1', t: translateFn })))
    assert(!loadingWorkspace.includes(t('panel.noWorkspace')), 'no-workspace message shown while loading')

    globalThis.fetch = realFetch
    served = snapshot
    resetState()
    console.log('loading state OK')
  }

  // Ошибки и предупреждения host-половины приходят по-русски, поэтому панель
  // помечает их как сообщение сервера, а свои подписи оставляет на языке DSH.
  {
    resetState()
    const t = translate('zh')
    const failure = { ok: false, error: { message: 'Сервер недоступен' } }

    globalThis.fetch = async () => ({ json: async () => failure })
    let tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    let texts = collect(tree)
    assert(texts.includes(t('panel.loadFailed', { message: 'Сервер недоступен' })), 'load error is not localized: ' + texts.join(' | '))

    // Ошибка действия: список загрузился, а POST отклонён сервером.
    resetState()
    globalThis.fetch = async (url, init) => ({
      json: async () => (init && init.method === 'POST' ? failure : served),
    })
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    const toggle = find(tree, node => node.props && node.props.role === 'switch')
    assert(toggle && typeof toggle.props.onChange === 'function', 'agent switch missing')
    toggle.props.onChange({ target: { checked: false } })
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    texts = collect(tree)
    assert(texts.includes(t('panel.hostMessage', { message: 'Сервер недоступен' })), 'host action error is not labelled: ' + texts.join(' | '))

    // Предупреждения конфига — тоже сообщения сервера.
    resetState()
    const warned = Object.assign({}, snapshot, { warnings: ['Имя агента «alpha» повторяется.'] })
    globalThis.fetch = async () => ({ json: async () => warned })
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    texts = collect(tree)
    assert(texts.includes(t('panel.warningsTitle')), 'warnings heading missing')
    assert(
      texts.some(text => text.includes(t('panel.hostMessage', { message: 'Имя агента «alpha» повторяется.' }))),
      'warning is not labelled as a server message: ' + texts.join(' | '),
    )

    globalThis.fetch = async () => ({ json: async () => served })
    resetState()
    console.log('host message labelling OK')
  }

  // Вкладка беседы: рабочая область правится, глобальные записи только читаются.
  const view = registrations.find(entry => entry.options.name === 'conversation.view')
  assert(view, 'conversation view registration missing')
  served = workspaceSnapshot
  for (const language of ['zh', 'ru']) {
    const t = translate(language)
    const root = (translateFn) => view.component({ sessionId: 'session-1', t: translateFn })
    let tree = await render(t, root)
    const texts = collect(tree)
    assert(texts.includes(t('panel.workspaceTitle')), language + ': workspace title missing')
    assert(texts.includes(t('panel.globalSection')), language + ': global section missing')
    assert(texts.includes(t('panel.globalHint')), language + ': read-only hint missing')

    const opener = find(tree, node => node.props && node.props['aria-label'] === t('row.open', { name: 'beta', status: t('status.disabled') }))
    assert(opener, language + ': global row missing')
    opener.props.onClick()
    tree = await render(t, root)
    const dialog = find(tree, node => node.props && node.props.role === 'dialog')
    assert(dialog, language + ': read-only dialog missing')
    const dialogTexts = collect(dialog)
    assert(dialogTexts.includes(t('action.close')), language + ': read-only close missing')
    assert(!dialogTexts.includes(t('action.edit')), language + ': read-only dialog offers editing')
    assert(!dialogTexts.includes(t('action.remove')), language + ': read-only dialog offers deletion')
    console.log(language + ' workspace view OK')
  }

  // Удаление из строки открывает отдельное подтверждение, а не карточку агента.
  {
    resetState()
    served = snapshot
    const t = translate('en')
    let tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    const trash = find(tree, node => node.props && node.props['aria-label'] === t('action.remove') && node.type === 'button')
    assert(trash, 'row delete button missing')
    trash.props.onClick()
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    const dialog = find(tree, node => node.props && node.props.role === 'dialog')
    assert(dialog, 'confirm dialog missing')
    const dialogTexts = collect(dialog)
    assert(dialogTexts.includes(t('panel.removeTitle')), 'confirm dialog title missing')
    assert(dialogTexts.includes(t('panel.removeConfirm', { name: 'alpha' })), 'confirm question missing')
    assert(dialogTexts.includes(t('panel.removeHint')), 'confirm hint missing')
    assert(!dialogTexts.includes(t('details.protocol')), 'confirm dialog shows the agent details')
    console.log('row delete confirmation OK')
  }

  // Действие над другим агентом не блокирует закрытие окна: «занято» относится
  // только к работе самого окна.
  {
    resetState()
    served = snapshot
    const t = translate('en')
    const slow = new Promise(() => {})
    globalThis.fetch = async (url, init) => (
      init && init.method === 'POST' ? slow : { json: async () => served }
    )
    let tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))

    // Переключатель в строке запускает запрос, который не завершается.
    const rowToggle = find(tree, node => node.props && node.props.role === 'switch')
    rowToggle.props.onChange({ target: { checked: false } })
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))

    // Открываем окно другого агента и закрываем его — оно должно закрыться.
    const opener = find(tree, node => node.props && node.props['aria-label'] === t('row.open', { name: 'beta', status: t('status.disabled') }))
    assert(opener, 'second row missing')
    opener.props.onClick()
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    let dialog = find(tree, node => node.props && node.props.role === 'dialog')
    assert(dialog, 'view dialog did not open while another agent was busy')

    const closeButton = find(dialog, node => node.type === 'button' && node.props && node.props['aria-label'] === t('action.close'))
    assert(closeButton, 'dialog close button missing')
    closeButton.props.onClick()
    tree = await render(t, (translateFn) => mainRegistration.component({ t: translateFn }))
    dialog = find(tree, node => node.props && node.props.role === 'dialog')
    assert(!dialog, 'dialog stayed open although the busy action belonged to another agent')

    globalThis.fetch = async () => ({ json: async () => served })
    resetState()
    console.log('busy scope OK')
  }

  // Заголовки разделов не перескакивают уровень: в панели h2 → h3.
  {
    resetState()
    served = workspaceSnapshot
    const t = translate('en')
    const view = registrations.find(entry => entry.options.name === 'conversation.view')
    const tree = await render(t, (translateFn) => view.component({ sessionId: 'session-1', t: translateFn }))
    const headings = []
    ;(function walk(node) {
      if (node == null || typeof node !== 'object') return
      if (Array.isArray(node)) return node.forEach(walk)
      if (node.type === 'h2' || node.type === 'h3' || node.type === 'h4') headings.push(node.type)
      walk(node.props && node.props.children)
    })(tree)
    assert(headings[0] === 'h2', 'page title is not h2')
    assert(headings.slice(1).every(tag => tag === 'h3'), 'panel sections are not h3: ' + headings.join(','))
    served = snapshot
    resetState()
    console.log('heading levels OK')
  }

  // Без места `t` панель показывает английский, а не ключи.
  served = snapshot
  resetState()
  const fallbackTexts = collect(await render(null, () => mainRegistration.component({})))
  assert(fallbackTexts.includes('Add agent'), 'fallback render is not English')
  console.log('fallback OK')

  console.log('ALL CHECKS PASSED')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
