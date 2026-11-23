/**
 * client.js — браузерная половина @local/dsh-a2a-client.
 *
 * Одна панель в левом сайдбаре («A2A»): список агентов карточками и модальные
 * окна — просмотр, добавление, редактирование и подтверждение удаления.
 * Проверка связи живёт в окне просмотра, чтобы не занимать список.
 *
 * Язык панели берётся из сервиса локализации DSH (`ctx.locale`): панель
 * показывает английский, русский или китайский текст в зависимости от того,
 * какой язык выбран в «Настройки → Основные → Язык». Отдельной настройки
 * языка у плагина нет; переключение в DSH применяется сразу, без перезагрузки.
 * Языки DSH без своего словаря (ja, es, fr, de, pt) показывают английский —
 * это запасной язык цепочки локализации DSH.
 *
 * Данные приходят с loopback-маршрута `/a2a-client/api`, поднятого host-половиной;
 * токены наружу не отдаются. Сборка не нужна: файл грузит загрузчик модулей DSH.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-a2a-client',
  factory: function (require) {
    var module = { exports: {} }
    ;(function (module, exports, require) {
      var React = require('react')
      var h = React.createElement
      var useState = React.useState
      var useEffect = React.useEffect
      var useCallback = React.useCallback

      var API = '/a2a-client/api'

      /** Пространство имён словарей плагина в сервисе локализации DSH. */
      var NS = 'a2a-client'

      /**
       * Текст пробного сообщения. Это не подпись интерфейса, а полезная
       * нагрузка: удалённый агент может понимать только английский, поэтому
       * пробное сообщение одинаково на всех языках. Переводится только
       * подсказка в поле ввода.
       */
      var DEFAULT_PROBE = 'Hello! In one sentence, tell me what you can do.'

      /* --------------------------------------------------------------- утилиты */

      /**
       * Все подписи панели одной таблицей: так ключи не могут разойтись между
       * языками. Английский — запасной: на него откатываются остальные языки
       * DSH (немецкий, испанский, французский, японский, португальский).
       */
      var STRINGS = {
        'panel.globalTitle': { en: 'A2A connections', ru: 'Подключения A2A', zh: 'A2A 连接' },
        'panel.workspaceTitle': { en: 'A2A in this workspace', ru: 'A2A в рабочей области', zh: '工作区中的 A2A' },
        'panel.globalLead': {
          en: 'Agent2Agent 1.0 client: agents as cards; details, editing and a test message open in dialogs.',
          ru: 'Клиент Agent2Agent 1.0: агенты карточками, карточка агента, правка и тестовое сообщение — в модальных окнах.',
          zh: 'Agent2Agent 1.0 客户端：智能体以卡片显示，详情、编辑与测试消息在弹窗中完成。',
        },
        'panel.workspaceLead': {
          en: 'Agents of this workspace (editable here) and profile-wide connections (read-only).',
          ru: 'Агенты этой рабочей области (правятся здесь) и глобальные подключения профиля — только для просмотра.',
          zh: '此工作区的智能体（可在此编辑）以及 profile 的全局连接（只读）。',
        },

        'action.refresh': { en: 'Refresh', ru: 'Обновить', zh: '刷新' },
        'action.refreshing': { en: 'Refreshing…', ru: 'Обновление…', zh: '正在刷新…' },
        'action.addAgent': { en: 'Add agent', ru: 'Добавить агента', zh: '添加智能体' },
        'action.close': { en: 'Close', ru: 'Закрыть', zh: '关闭' },
        'action.cancel': { en: 'Cancel', ru: 'Отмена', zh: '取消' },
        'action.save': { en: 'Save', ru: 'Сохранить', zh: '保存' },
        'action.add': { en: 'Add', ru: 'Добавить', zh: '添加' },
        'action.edit': { en: 'Edit', ru: 'Редактировать', zh: '编辑' },
        'action.remove': { en: 'Delete', ru: 'Удалить', zh: '删除' },
        'action.enable': { en: 'Enable', ru: 'Включить', zh: '启用' },
        'action.disable': { en: 'Disable', ru: 'Отключить', zh: '停用' },
        'action.verifying': { en: 'Checking…', ru: 'Проверка…', zh: '正在检查…' },
        'action.sending': { en: 'Sending…', ru: 'Отправка…', zh: '正在发送…' },
        'action.send': { en: 'Send', ru: 'Отправить', zh: '发送' },

        'status.disabled': { en: 'Disabled', ru: 'Отключён', zh: '已停用' },
        'status.unreachable': { en: 'Unreachable', ru: 'Нет связи', zh: '无法连接' },
        'status.available': { en: 'Available', ru: 'Доступен', zh: '可用' },
        'status.unknown': { en: 'Unknown', ru: 'Неизвестно', zh: '未知' },
        'status.disabledDescription': {
          en: 'Disabled: a2a_* tools do not use it.',
          ru: 'Отключён: инструменты a2a_* его не используют.',
          zh: '已停用：a2a_* 工具不会使用它。',
        },
        'row.open': { en: 'Open “{name}” — {status}', ru: 'Открыть «{name}» — {status}', zh: '打开“{name}”——{status}' },
        'switch.disable': { en: 'Disable agent', ru: 'Отключить агента', zh: '停用智能体' },
        'switch.enable': { en: 'Enable agent', ru: 'Включить агента', zh: '启用智能体' },

        'state.completed': { en: 'Completed', ru: 'Завершено', zh: '已完成' },
        'state.working': { en: 'Working', ru: 'В работе', zh: '进行中' },
        'state.submitted': { en: 'Submitted', ru: 'Принято', zh: '已提交' },
        'state.failed': { en: 'Failed', ru: 'Ошибка', zh: '失败' },
        'state.canceled': { en: 'Canceled', ru: 'Отменено', zh: '已取消' },
        'state.rejected': { en: 'Rejected', ru: 'Отклонено', zh: '已拒绝' },
        'state.inputRequired': { en: 'Input required', ru: 'Нужен ответ', zh: '需要输入' },
        'state.authRequired': { en: 'Auth required', ru: 'Нужна авторизация', zh: '需要授权' },
        'state.message': { en: 'Message', ru: 'Сообщение', zh: '消息' },

        'test.title': { en: 'Test message', ru: 'Тестовое сообщение', zh: '测试消息' },
        'test.hint': {
          en: 'Sends a real message to the remote agent; the reply appears below.',
          ru: 'Отправляет настоящее сообщение удалённому агенту; ответ появится ниже.',
          zh: '向远程智能体发送真实消息，回复显示在下方。',
        },
        'test.textAria': { en: 'Message text', ru: 'Текст сообщения', zh: '消息文本' },
        'test.placeholder': {
          en: 'Message text for the remote agent',
          ru: 'Текст сообщения удалённому агенту',
          zh: '发送给远程智能体的消息文本',
        },
        'test.stream': { en: 'Streaming mode (SSE)', ru: 'Потоковый режим (SSE)', zh: '流式模式（SSE）' },
        'test.streamTitle': { en: 'Server-Sent Events', ru: 'Server-Sent Events', zh: 'Server-Sent Events' },
        'test.empty': { en: '(empty response)', ru: '(пустой ответ)', zh: '（空响应）' },
        'test.task': { en: 'task {id}', ru: 'задача {id}', zh: '任务 {id}' },
        'test.context': { en: 'context {id}', ru: 'контекст {id}', zh: '上下文 {id}' },
        'unit.seconds': { en: '{value} s', ru: '{value} с', zh: '{value} 秒' },

        'details.protocol': { en: 'Protocol', ru: 'Протокол', zh: '协议' },
        'details.version': { en: 'Agent version', ru: 'Версия агента', zh: '智能体版本' },
        'details.skillsCount': { en: 'Skills', ru: 'Умений', zh: '技能数' },
        'details.token': { en: 'Token', ru: 'Токен', zh: '令牌' },
        'details.tokenSet': { en: 'set', ru: 'задан', zh: '已设置' },
        'details.tokenUnset': { en: 'not set', ru: 'не задан', zh: '未设置' },
        'details.timeout': { en: 'Timeout', ru: 'Таймаут', zh: '超时' },
        'details.role': { en: 'Role', ru: 'Роль', zh: '角色' },
        'details.defaultRole': { en: 'default agent', ru: 'агент по умолчанию', zh: '默认智能体' },
        'details.agentRole': { en: 'agent', ru: 'агент', zh: '智能体' },
        'details.cardTitle': { en: 'Agent card', ru: 'Карточка агента', zh: '智能体卡片' },
        'details.skillsTitle': { en: 'Skills', ru: 'Умения', zh: '技能' },
        'details.disabledBanner': {
          en: 'The agent is disabled — a2a_* tools do not use it. Enable it to send a test message.',
          ru: 'Агент отключён — инструменты a2a_* его не используют. Включите его, чтобы отправить тестовое сообщение.',
          zh: '智能体已停用——a2a_* 工具不会使用它。启用后可发送测试消息。',
        },

        'form.addTitle': { en: 'New agent', ru: 'Новый агент', zh: '新建智能体' },
        'form.editTitle': { en: 'Edit “{name}”', ru: 'Изменить «{name}»', zh: '编辑“{name}”' },
        'form.workspaceSubtitle': { en: 'Workspace', ru: 'Рабочая область', zh: '工作区' },
        'form.profileSubtitle': { en: 'Profile', ru: 'Профиль', zh: 'profile' },
        'form.name': { en: 'Name', ru: 'Имя', zh: '名称' },
        'form.namePlaceholder': { en: 'my-agent', ru: 'my-agent', zh: 'my-agent' },
        'form.nameHint': {
          en: 'Latin letters, digits, space, “_”, “.”, “-”; up to 64 characters.',
          ru: 'Латинские буквы, цифры, пробел, «_», «.», «-»; до 64 символов.',
          zh: '拉丁字母、数字、空格、“_”、“.”、“-”，最多 64 个字符。',
        },
        'form.cardUrl': { en: 'Agent Card URL', ru: 'Agent Card URL', zh: 'Agent Card 地址' },
        'form.tokenNew': { en: 'New token (optional)', ru: 'Новый токен (необязательно)', zh: '新令牌（可选）' },
        'form.token': { en: 'Token (optional)', ru: 'Токен (необязательно)', zh: '令牌（可选）' },
        'form.tokenKeep': { en: 'leave empty to keep', ru: 'оставьте пустым, чтобы не менять', zh: '留空则不修改' },
        'form.tokenPlaceholder': { en: 'Bearer token', ru: 'Bearer-токен', zh: 'Bearer 令牌' },
        'form.timeout': { en: 'Timeout, s', ru: 'Таймаут, с', zh: '超时（秒）' },
        'form.hintEdit': {
          en: 'Before saving, the plugin checks the card and token at the new address. A different address needs its own token: the saved one is never sent there.',
          ru: 'Перед сохранением плагин проверит карточку и токен по новому адресу. Другому адресу нужен свой токен: сохранённый на него не отправляется.',
          zh: '保存前，插件会在新地址检查卡片和令牌。换了地址就需要新的令牌：已保存的令牌不会发往新地址。',
        },
        'form.hintAdd': {
          en: 'Agent Card URL — e.g. http://localhost:3080/.well-known/agent-card.json. The plugin checks the address and token before saving.',
          ru: 'Agent Card URL — например, http://localhost:3080/.well-known/agent-card.json. Перед сохранением плагин проверит адрес и токен.',
          zh: 'Agent Card 地址，例如 http://localhost:3080/.well-known/agent-card.json。保存前插件会检查地址和令牌。',
        },
        'form.clearToken': { en: 'Remove the saved token', ru: 'Удалить сохранённый токен', zh: '删除已保存的令牌' },
        'form.fillNameUrl': {
          en: 'Fill in the name and Agent Card URL.',
          ru: 'Укажите имя и Agent Card URL.',
          zh: '请填写名称和 Agent Card 地址。',
        },

        'panel.loading': { en: 'Loading…', ru: 'Загрузка…', zh: '加载中…' },
        'panel.loadFailed': { en: 'Failed to load data: {message}', ru: 'Не удалось получить данные: {message}', zh: '加载数据失败：{message}' },
        'panel.hostMessage': { en: 'Server message: {message}', ru: 'Сообщение сервера: {message}', zh: '服务器消息：{message}' },
        'panel.warningsTitle': { en: 'Warnings', ru: 'Предупреждения', zh: '警告' },
        'panel.workspaceSection': { en: 'Workspace', ru: 'Рабочая область', zh: '工作区' },
        'panel.workspaceFileMissing': { en: ' · file not created yet', ru: ' · файл ещё не создан', zh: ' · 文件尚未创建' },
        'panel.workspaceEmpty': {
          en: 'No agents in this workspace — add one with the button above.',
          ru: 'В рабочей области агентов нет — нажмите «Добавить агента» выше.',
          zh: '此工作区还没有智能体——用上方按钮添加。',
        },
        'panel.noWorkspace': {
          en: 'No workspace for this session: only profile-wide connections are shown.',
          ru: 'У этой сессии нет рабочей области: показаны только глобальные подключения.',
          zh: '此会话没有工作区：仅显示全局连接。',
        },
        'panel.globalSection': { en: 'Profile-wide connections', ru: 'Глобальные подключения', zh: '全局连接' },
        'panel.globalHint': {
          en: 'Read-only: add and edit in the A2A sidebar panel.',
          ru: 'Только просмотр: добавление и правка — в боковой панели A2A.',
          zh: '只读：请在 A2A 侧边栏中添加和编辑。',
        },
        'panel.globalEmpty': { en: 'No profile-wide agents.', ru: 'Глобальных агентов нет.', zh: '没有全局智能体。' },
        'panel.empty': {
          en: 'No agents yet. Add the first one with the button above.',
          ru: 'Агентов пока нет. Нажмите «Добавить агента» выше.',
          zh: '还没有智能体。用上方按钮添加第一个。',
        },
        'panel.storeLine': { en: 'Registry: {file} · source: {source}', ru: 'Реестр: {file} · источник: {source}', zh: '清单文件：{file} · 来源：{source}' },
        'panel.snapshot': { en: ' · snapshot {time}', ru: ' · снимок {time}', zh: ' · 快照 {time}' },
        'panel.sourceFile': { en: 'a2a-client.json', ru: 'a2a-client.json', zh: 'a2a-client.json' },
        'panel.sourceConfig': { en: 'plugin config', ru: 'конфиг плагина', zh: '插件配置' },
        'panel.removeTitle': { en: 'Delete agent', ru: 'Удалить агента', zh: '删除智能体' },
        'panel.removeConfirm': { en: 'Delete “{name}”?', ru: 'Удалить «{name}»?', zh: '删除“{name}”？' },
        'panel.removeHint': {
          en: 'The agent is removed from the registry; its saved token is dropped too.',
          ru: 'Агент удаляется из реестра; сохранённый токен тоже удаляется.',
          zh: '该智能体将从清单文件中移除，已保存的令牌也会删除。',
        },
      }

      /** Один язык словарём: `{ key: text }` для `ctx.locale.register`. */
      function dictionary(language) {
        var dict = {}
        Object.keys(STRINGS).forEach(function (key) {
          dict[key] = STRINGS[key][language]
        })
        return dict
      }

      /** Подставляет `{name}`-параметры в шаблон (та же схема, что у DSH). */
      function format(template, params) {
        if (!params) return String(template)
        return String(template).replace(/\{(\w+)\}/g, function (match, name) {
          return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        })
      }

      /**
       * Запасной переводчик: слот передаёт `t`, но если он почему-то не пришёл
       * (другой рендерер, отладка), панель показывает английский текст, а не
       * ключи. Без сервиса локализации плагин не активируется вовсе — это
       * заявленная зависимость `inject: ['slots', 'locale']`.
       */
      function fallbackTranslate(key, params) {
        var entry = STRINGS[key]
        return format(entry ? entry.en : key, params)
      }

      function translator(props) {
        return (props && props.t) || fallbackTranslate
      }

      /**
       * Ошибка в состоянии панели: либо ключ словаря (`{ key }`), либо готовый
       * текст от host-половины (`{ text }`, по-русски). Ключ переводится при
       * отрисовке, поэтому смена языка переводит и уже показанную ошибку.
       */
      function localError(key) {
        return { key: key }
      }

      function hostError(error) {
        return { text: errorText(error) }
      }

      function errorNode(error, t, style) {
        if (!error) return null
        var text = error.key ? t(error.key) : t('panel.hostMessage', { message: error.text })
        return h('div', { role: 'alert', style: style }, text)
      }

      function readJson(response) {
        return response.json().then(function (json) {
          if (!json || json.ok !== true) {
            throw new Error((json && json.error && json.error.message) || 'HTTP ' + response.status)
          }
          return json
        })
      }

      function getSnapshot(scope, sessionId) {
        var url = API
        if (scope === 'workspace') {
          url += '?scope=workspace&sessionId=' + encodeURIComponent(sessionId || '')
        }
        return fetch(url, { headers: { accept: 'application/json' } }).then(readJson)
      }

      function post(scope, sessionId, body) {
        var payload = Object.assign({ scope: scope, sessionId: sessionId }, body)
        return fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(readJson)
      }

      function errorText(error) {
        return String((error && error.message) || error)
      }

      function stateLabel(state, t) {
        var map = {
          TASK_STATE_COMPLETED: 'state.completed',
          TASK_STATE_WORKING: 'state.working',
          TASK_STATE_SUBMITTED: 'state.submitted',
          TASK_STATE_FAILED: 'state.failed',
          TASK_STATE_CANCELED: 'state.canceled',
          TASK_STATE_CANCELLED: 'state.canceled',
          TASK_STATE_REJECTED: 'state.rejected',
          TASK_STATE_INPUT_REQUIRED: 'state.inputRequired',
          TASK_STATE_AUTH_REQUIRED: 'state.authRequired',
          MESSAGE: 'state.message',
        }
        return map[state] ? t(map[state]) : t('status.unknown')
      }

      /** Цвет плашки состояния задачи: зелёный только у успешных исходов. */
      function stateColor(state) {
        if (state === 'TASK_STATE_COMPLETED') return COLORS.ok
        if (state === 'TASK_STATE_FAILED' || state === 'TASK_STATE_REJECTED') return COLORS.error
        if (state === 'TASK_STATE_CANCELED' || state === 'TASK_STATE_CANCELLED') return COLORS.muted
        if (state === 'TASK_STATE_WORKING' || state === 'TASK_STATE_SUBMITTED') return COLORS.brand
        return COLORS.warn
      }

      /* ---------------------------------------------------------------- токены */

      var COLORS = {
        text: 'var(--dsw-alias-label-primary)',
        muted: 'var(--dsw-alias-label-secondary)',
        border: 'var(--dsw-alias-border-l1)',
        borderStrong: 'var(--dsw-alias-border-l2)',
        card: 'var(--dsw-alias-bg-layer-1)',
        inset: 'var(--dsw-alias-bg-layer-2)',
        brand: 'var(--dsw-alias-brand-primary)',
        ok: 'var(--dsw-alias-state-success-primary)',
        warn: 'var(--dsw-alias-state-warn-primary)',
        error: 'var(--dsw-alias-state-error-primary)',
      }

      /**
       * Единственный CSS-фрагмент панели: только то, что нельзя выразить
       * инлайновым стилем — видимый фокус клавиатуры. Рендерится элементом
       * внутри панели, поэтому исчезает вместе с ней.
       */
      var CSS = [
        '.a2a-focus:focus-visible{outline:2px solid ' + COLORS.brand + ';outline-offset:2px}',
        '.a2a-row:focus-visible{outline:2px solid ' + COLORS.brand + ';outline-offset:3px;border-radius:8px}',
        '.a2a-switch input:focus-visible+span{outline:2px solid ' + COLORS.brand + ';outline-offset:2px}',
      ].join('')

      var styles = {
        page: {
          margin: '0 auto',
          padding: '32px 28px 56px',
          width: '100%',
          maxWidth: '860px',
          color: COLORS.text,
          font: 'inherit',
          boxSizing: 'border-box',
        },
        header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' },
        title: { margin: 0, fontSize: '18px', fontWeight: 600, lineHeight: '24px' },
        lead: { margin: '0 0 16px', fontSize: '13px', lineHeight: '20px', color: COLORS.muted },
        toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px', margin: '4px 0 14px' },

        listCard: {
          border: '1px solid ' + COLORS.border,
          borderRadius: '12px',
          background: COLORS.card,
          padding: '12px 14px',
          marginBottom: '10px',
        },
        row: { display: 'flex', alignItems: 'flex-start', gap: '14px' },
        controls: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px', flex: 'none', marginTop: '2px' },
        rowMain: {
          flex: '1 1 auto',
          minWidth: 0,
          display: 'block',
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          textAlign: 'left',
          color: 'inherit',
          font: 'inherit',
          cursor: 'pointer',
        },
        rowTitle: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
        name: { fontSize: '14px', fontWeight: 600, lineHeight: '20px' },
        dot: { width: '8px', height: '8px', borderRadius: '50%', flex: 'none' },
        badge: {
          fontSize: '11px',
          fontWeight: 600,
          lineHeight: '16px',
          padding: '1px 8px',
          borderRadius: '999px',
          border: '1px solid currentColor',
          whiteSpace: 'nowrap',
        },
        rowDesc: {
          margin: '5px 0 0',
          fontSize: '12.5px',
          lineHeight: '18px',
          color: COLORS.muted,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        },
        mono: {
          marginTop: '4px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '11.5px',
          lineHeight: '16px',
          color: COLORS.muted,
          wordBreak: 'break-all',
        },

        switchLabel: { display: 'inline-flex', alignItems: 'center', cursor: 'pointer', padding: '2px', position: 'relative' },
        switchTrack: {
          width: '34px',
          height: '20px',
          borderRadius: '999px',
          position: 'relative',
          display: 'inline-block',
          transition: 'background 120ms linear',
        },
        switchKnob: {
          position: 'absolute',
          top: '2px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: COLORS.card,
          transition: 'left 120ms linear',
        },
        iconBtn: {
          appearance: 'none',
          WebkitAppearance: 'none',
          width: '28px',
          height: '28px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid ' + COLORS.border,
          borderRadius: '8px',
          background: 'transparent',
          color: COLORS.muted,
          cursor: 'pointer',
          padding: 0,
        },
        iconBtnDanger: { borderColor: COLORS.error, color: COLORS.error },

        primary: {
          appearance: 'none',
          WebkitAppearance: 'none',
          border: '1px solid ' + COLORS.brand,
          borderRadius: '8px',
          background: COLORS.inset,
          color: COLORS.brand,
          font: 'inherit',
          fontSize: '12.5px',
          fontWeight: 600,
          lineHeight: '18px',
          padding: '7px 14px',
          cursor: 'pointer',
        },
        ghost: {
          appearance: 'none',
          WebkitAppearance: 'none',
          border: '1px solid ' + COLORS.border,
          borderRadius: '8px',
          background: 'transparent',
          color: COLORS.text,
          font: 'inherit',
          fontSize: '12.5px',
          fontWeight: 500,
          lineHeight: '18px',
          padding: '6px 12px',
          cursor: 'pointer',
        },
        danger: {
          appearance: 'none',
          WebkitAppearance: 'none',
          border: '1px solid ' + COLORS.error,
          borderRadius: '8px',
          background: 'transparent',
          color: COLORS.error,
          font: 'inherit',
          fontSize: '12.5px',
          fontWeight: 600,
          lineHeight: '18px',
          padding: '6px 12px',
          cursor: 'pointer',
        },

        overlay: {
          position: 'fixed',
          inset: 0,
          background: 'rgba(6, 8, 14, 0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          zIndex: 1000,
        },
        dialog: {
          width: 'min(760px, 100%)',
          maxHeight: '85vh',
          overflow: 'auto',
          boxSizing: 'border-box',
          background: COLORS.card,
          border: '1px solid ' + COLORS.borderStrong,
          borderRadius: '14px',
          padding: '20px 22px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
          color: COLORS.text,
          outline: 'none',
        },
        modalHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
        modalTitle: { margin: 0, fontSize: '16px', fontWeight: 600, lineHeight: '22px' },
        modalSub: { margin: '4px 0 0', fontSize: '12px', lineHeight: '18px', color: COLORS.muted, wordBreak: 'break-all' },
        modalBody: { marginTop: '14px' },
        modalFooter: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '8px',
          flexWrap: 'wrap',
          marginTop: '18px',
          paddingTop: '14px',
          borderTop: '1px solid ' + COLORS.border,
        },

        metaGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px 18px', marginTop: '4px' },
        metaItem: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
        metaLabel: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.05em', color: COLORS.muted },
        metaValue: { fontSize: '12.5px', lineHeight: '18px', wordBreak: 'break-all' },

        sectionTitle: { margin: '18px 0 8px', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: COLORS.muted },
        skills: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' },
        chip: {
          fontSize: '11.5px',
          lineHeight: '16px',
          padding: '2px 8px',
          borderRadius: '6px',
          border: '1px solid ' + COLORS.border,
          color: COLORS.muted,
          background: COLORS.inset,
        },
        skillRow: { marginTop: '8px', fontSize: '12.5px', lineHeight: '18px' },
        skillName: { fontWeight: 600 },
        skillDesc: { color: COLORS.muted },

        formGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px', marginTop: '12px' },
        fieldGroup: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
        fieldLabel: { fontSize: '11.5px', lineHeight: '16px', color: COLORS.muted },
        field: {
          width: '100%',
          boxSizing: 'border-box',
          background: COLORS.inset,
          color: COLORS.text,
          border: '1px solid ' + COLORS.border,
          borderRadius: '8px',
          padding: '8px 10px',
          font: 'inherit',
          fontSize: '13px',
          lineHeight: '20px',
          outline: 'none',
        },
        fieldHint: { fontSize: '11px', lineHeight: '16px', color: COLORS.muted },
        textarea: {
          width: '100%',
          boxSizing: 'border-box',
          background: COLORS.inset,
          color: COLORS.text,
          border: '1px solid ' + COLORS.border,
          borderRadius: '8px',
          padding: '9px 10px',
          font: 'inherit',
          fontSize: '13px',
          lineHeight: '20px',
          resize: 'vertical',
          outline: 'none',
        },
        checkboxRow: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: COLORS.muted },
        actionRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '10px' },

        banner: {
          border: '1px solid ' + COLORS.error,
          borderRadius: '10px',
          padding: '10px 12px',
          marginBottom: '14px',
          fontSize: '12.5px',
          lineHeight: '18px',
          color: COLORS.text,
          background: COLORS.card,
          whiteSpace: 'pre-wrap',
        },
        warnBanner: {
          border: '1px solid ' + COLORS.warn,
          borderRadius: '10px',
          padding: '10px 12px',
          marginBottom: '14px',
          fontSize: '12.5px',
          lineHeight: '18px',
          color: COLORS.text,
          background: COLORS.card,
          whiteSpace: 'pre-wrap',
        },
        hint: { margin: '0 0 8px', fontSize: '12.5px', lineHeight: '18px', color: COLORS.muted },
        meta: { fontSize: '12px', lineHeight: '18px', color: COLORS.muted },
        result: {
          marginTop: '12px',
          border: '1px solid ' + COLORS.border,
          borderRadius: '10px',
          background: COLORS.inset,
          padding: '12px 14px',
        },
        answer: {
          margin: '8px 0 0',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: '12.5px',
          lineHeight: '19px',
          maxHeight: '260px',
          overflow: 'auto',
        },
        empty: {
          border: '1px dashed ' + COLORS.border,
          borderRadius: '12px',
          padding: '18px',
          textAlign: 'center',
          color: COLORS.muted,
          fontSize: '12.5px',
        },
      }

      function badgeStyle(color) {
        return Object.assign({}, styles.badge, { color: color })
      }

      function sectionTitle(key, t, extra) {
        // В панели разделы идут под h2 страницы, в окнах — под h3 заголовка:
        // уровень передаётся, чтобы не перескакивать через ступень.
        var options = extra || {}
        var tag = options.tag || 'h4'
        var style = Object.assign({}, styles.sectionTitle, options.style || null)
        return h(tag, { style: style }, t(key))
      }

      /* ------------------------------------------------------------- атомарные */

      function Switch(props) {
        var t = translator(props)
        var title = props.enabled ? t('switch.disable') : t('switch.enable')
        return h(
          'label',
          {
            className: 'a2a-switch',
            style: Object.assign({}, styles.switchLabel, props.disabled ? { opacity: 0.5, cursor: 'default' } : null),
            title: title,
          },
          h('input', {
            type: 'checkbox',
            role: 'switch',
            checked: props.enabled,
            disabled: props.disabled,
            onChange: props.onChange,
            style: { position: 'absolute', opacity: 0, width: '1px', height: '1px' },
            'aria-label': title,
            'aria-checked': props.enabled ? 'true' : 'false',
          }),
          h(
            'span',
            {
              style: Object.assign({}, styles.switchTrack, {
                background: props.enabled ? COLORS.brand : COLORS.border,
              }),
              'aria-hidden': 'true',
            },
            h('span', { style: Object.assign({}, styles.switchKnob, { left: props.enabled ? '16px' : '2px' }) }),
          ),
        )
      }

      function PencilIcon() {
        return h(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          h('path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }),
          h('path', { d: 'M13.5 6.5l4 4' }),
        )
      }

      function TrashIcon() {
        return h(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
          h('path', { d: 'M4 7h16' }),
          h('path', { d: 'M9 7V5h6v2' }),
          h('path', { d: 'M6 7l1 13h10l1-13' }),
          h('path', { d: 'M10 11v6M14 11v6' }),
        )
      }

      function IconButton(props) {
        return h(
          'button',
          {
            type: 'button',
            title: props.title,
            'aria-label': props.title,
            disabled: props.disabled,
            className: 'a2a-focus',
            style: Object.assign({}, styles.iconBtn, props.danger ? styles.iconBtnDanger : null, props.disabled ? { opacity: 0.5, cursor: 'default' } : null),
            onClick: props.onClick,
          },
          props.children,
        )
      }

      function statusOf(agent, t) {
        if (agent.enabled === false) return { label: t('status.disabled'), color: COLORS.warn }
        if (agent.error) return { label: t('status.unreachable'), color: COLORS.error }
        if (agent.card) return { label: t('status.available'), color: COLORS.ok }
        return { label: t('status.unknown'), color: COLORS.muted }
      }

      function agentDescription(agent, t) {
        if (agent.enabled === false) return t('status.disabledDescription')
        if (agent.error) return agent.error
        if (agent.card && agent.card.description) return agent.card.description
        return agent.cardUrl
      }

      /* ---------------------------------------------------------------- строка */

      function AgentRow(props) {
        var t = translator(props)
        var agent = props.agent
        var status = statusOf(agent, t)
        return h(
          'div',
          { style: styles.listCard },
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              {
                type: 'button',
                className: 'a2a-row',
                style: styles.rowMain,
                onClick: props.onOpen,
                // Статус — единственный индикатор состояния строки, поэтому он
                // входит в доступное имя кнопки, а не только в цветную плашку.
                'aria-label': t('row.open', { name: agent.name, status: status.label }),
              },
              h(
                'span',
                { style: styles.rowTitle },
                h('span', { style: Object.assign({}, styles.dot, { background: status.color }), 'aria-hidden': 'true' }),
                h('span', { style: styles.name }, agent.name),
                h('span', { style: badgeStyle(status.color) }, status.label),
              ),
              h('span', { style: styles.rowDesc }, agentDescription(agent, t)),
              h('span', { style: styles.mono }, agent.cardUrl),
            ),
            props.readOnly
              ? null
              : h(
                'div',
                { style: styles.controls },
                h(Switch, { enabled: agent.enabled !== false, disabled: props.busy, onChange: props.onToggle, t: t }),
                h(IconButton, { title: t('action.edit'), disabled: props.busy, onClick: props.onEdit }, h(PencilIcon, null)),
                h(IconButton, { title: t('action.remove'), danger: true, disabled: props.busy, onClick: props.onRemove }, h(TrashIcon, null)),
              ),
          ),
        )
      }

      /* --------------------------------------------------------------- модалка */

      function Modal(props) {
        var t = translator(props)
        var dialogRef = React.useRef(null)
        var previousFocus = React.useRef(null)
        var titleId = 'a2a-dialog-title'

        useEffect(function () {
          function onKey(event) {
            if (event.key !== 'Escape' || event.defaultPrevented) return
            // Escape сначала снимает подтверждение удаления, и только второе
            // нажатие закрывает окно. Пока идёт запрос, окно не закрывается.
            if (props.onEscape) props.onEscape(event)
            else props.onClose()
          }
          window.addEventListener('keydown', onKey)
          return function () {
            window.removeEventListener('keydown', onKey)
          }
        }, [props.onClose, props.onEscape])

        // Фокус переносится в окно при открытии и возвращается при закрытии:
        // без этого Tab уходит в панель под оверлеем. Tab удерживается внутри
        // окна — оверлей объявлен модальным, значит фон недоступен.
        useEffect(function () {
          previousFocus.current = typeof document !== 'undefined' ? document.activeElement : null
          var node = dialogRef.current
          if (!node || typeof node.focus !== 'function') {
            return function () {
              var previous = previousFocus.current
              if (previous && typeof previous.focus === 'function') previous.focus()
            }
          }
          node.focus()

          function onKeyDown(event) {
            if (event.key !== 'Tab' || !node) return
            var focusable = node.querySelectorAll(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            )
            if (focusable.length === 0) {
              event.preventDefault()
              node.focus()
              return
            }
            var first = focusable[0]
            var last = focusable[focusable.length - 1]
            var active = document.activeElement
            if (event.shiftKey && (active === first || active === node)) {
              event.preventDefault()
              last.focus()
            } else if (!event.shiftKey && active === last) {
              event.preventDefault()
              first.focus()
            }
          }

          node.addEventListener('keydown', onKeyDown)
          return function () {
            node.removeEventListener('keydown', onKeyDown)
            var previous = previousFocus.current
            if (previous && typeof previous.focus === 'function') previous.focus()
          }
        }, [])

        return h(
          'div',
          {
            style: styles.overlay,
            onMouseDown: function (event) {
              if (event.target === event.currentTarget) props.onClose()
            },
          },
          h(
            'div',
            {
              ref: dialogRef,
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': titleId,
              tabIndex: -1,
              style: styles.dialog,
            },
            h(
              'div',
              { style: styles.modalHeader },
              h(
                'div',
                null,
                h('h3', { id: titleId, style: styles.modalTitle }, props.title),
                props.subtitle ? h('p', { style: styles.modalSub }, props.subtitle) : null,
              ),
              h(IconButton, { title: t('action.close'), onClick: props.onClose }, h('span', { style: { fontSize: '15px', lineHeight: '15px' } }, '×')),
            ),
            h('div', { style: styles.modalBody }, props.children),
            props.footer ? h('div', { style: styles.modalFooter }, props.footer) : null,
          ),
        )
      }

      /* ------------------------------------------------------------------ тест */

      function TestPanel(props) {
        var t = translator(props)
        // Пробное сообщение не хранится как переведённая строка: по умолчанию
        // берётся английский текст (payload для удалённого агента), а правка
        // пользователя живёт в черновике и переживает смену языка.
        var draftState = useState(null)
        var draft = draftState[0]
        var setDraft = draftState[1]
        var streamState = useState(false)
        var stream = streamState[0]
        var setStream = streamState[1]
        var busyState = useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var resultState = useState(null)
        var result = resultState[0]
        var setResult = resultState[1]
        var errorState = useState(null)
        var error = errorState[0]
        var setError = errorState[1]

        var text = draft === null ? DEFAULT_PROBE : draft

        function submit() {
          if (busy || !text.trim()) return
          setBusy(true)
          setError(null)
          post(props.scope, props.sessionId, { action: 'send', agent: props.agent, text: text, stream: stream }).then(
            function (json) {
              setResult(json.result)
              setBusy(false)
            },
            function (failure) {
              setError(hostError(failure))
              setResult(null)
              setBusy(false)
            },
          )
        }

        return h(
          'div',
          null,
          sectionTitle('test.title', t, { style: { marginTop: 0 } }),
          h('p', { style: styles.hint }, t('test.hint')),
          h('textarea', {
            value: text,
            rows: 3,
            style: styles.textarea,
            'aria-label': t('test.textAria'),
            placeholder: t('test.placeholder'),
            onChange: function (event) {
              setDraft(event.target.value)
            },
          }),
          h(
            'div',
            { style: styles.actionRow },
            h(
              'label',
              { style: styles.checkboxRow },
              h('input', {
                type: 'checkbox',
                style: { accentColor: COLORS.brand },
                checked: stream,
                onChange: function (event) {
                  setStream(event.target.checked)
                },
              }),
              t('test.stream'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'a2a-focus',
                style: Object.assign({}, styles.primary, busy ? { opacity: 0.6, cursor: 'default' } : null),
                onClick: submit,
                disabled: busy,
              },
              busy ? t('action.sending') : t('action.send'),
            ),
          ),
          errorNode(error, t, Object.assign({}, styles.banner, { marginTop: '12px', marginBottom: 0 })),
          result
            ? h(
              'div',
              { style: styles.result },
              h(
                'div',
                { style: styles.rowTitle },
                h('span', { style: badgeStyle(stateColor(result.state)) }, stateLabel(result.state, t)),
                h('span', { style: styles.meta }, t('unit.seconds', { value: (result.durationMs / 1000).toFixed(1) })),
                result.streaming ? h('span', { title: t('test.streamTitle'), style: styles.chip }, 'SSE') : null,
              ),
              h('pre', { style: styles.answer }, result.text || t('test.empty')),
              h(
                'div',
                { style: styles.mono },
                [result.taskId ? t('test.task', { id: result.taskId }) : null, result.contextId ? t('test.context', { id: result.contextId }) : null]
                  .filter(Boolean)
                  .join(' · '),
              ),
              // Сервер сообщает, если учётные данные не отправлены: без этой
              // строки «агент ответил без токена» выглядело бы загадкой.
              Array.isArray(result.notices) && result.notices.length > 0
                ? h(
                  'div',
                  { role: 'alert', style: Object.assign({}, styles.warnBanner, { marginTop: '10px' }) },
                  result.notices.map(function (notice, index) {
                    return h('div', { key: 'notice-' + index }, t('panel.hostMessage', { message: notice }))
                  }),
                )
                : null,
            )
            : null,
        )
      }

      /* -------------------------------------------------------------- просмотр */

      function DetailsBody(props) {
        var t = translator(props)
        var agent = props.agent
        var card = agent.card
        var rows = [
          { key: 'protocol', label: t('details.protocol'), value: (card && card.protocolVersion) || '1.0' },
          { key: 'version', label: t('details.version'), value: (card && card.version) || '—' },
          { key: 'skills', label: t('details.skillsCount'), value: card ? String(card.skills.length) : '—' },
          { key: 'token', label: t('details.token'), value: agent.hasToken ? t('details.tokenSet') : t('details.tokenUnset') },
          { key: 'timeout', label: t('details.timeout'), value: t('unit.seconds', { value: Math.round((agent.timeoutMs || 0) / 1000) }) },
          { key: 'role', label: t('details.role'), value: props.defaultAgent === agent.name ? t('details.defaultRole') : t('details.agentRole') },
        ]

        var body = [
          h(
            'div',
            { key: 'meta', style: styles.metaGrid },
            rows.map(function (row) {
              return h(
                'div',
                { key: row.key, style: styles.metaItem },
                h('span', { style: styles.metaLabel }, row.label),
                h('span', { style: styles.metaValue }, row.value),
              )
            }),
          ),
        ]

        if (agent.error) {
          body.push(h('div', { key: 'err', role: 'alert', style: Object.assign({}, styles.banner, { marginTop: '14px' }) }, agent.error))
        }

        if (card) {
          body.push(sectionTitle('details.cardTitle', t))
          if (card.description) {
            body.push(h('p', { key: 'card-desc', style: { margin: '0 0 4px', fontSize: '12.5px', lineHeight: '18px' } }, card.description))
          }
          if (card.interfaces.length > 0) {
            body.push(
              h(
                'div',
                { key: 'ifaces', style: styles.metaGrid },
                card.interfaces.map(function (item) {
                  return h(
                    'div',
                    { key: item.binding + item.url, style: styles.metaItem },
                    h('span', { style: styles.metaLabel }, item.binding),
                    h('span', { style: styles.metaValue }, item.url),
                  )
                }),
              ),
            )
          }
          if (card.skills.length > 0) {
            body.push(sectionTitle('details.skillsTitle', t))
            card.skills.forEach(function (skill) {
              body.push(
                h(
                  'div',
                  { key: 'skill-' + (skill.id || skill.name), style: styles.skillRow },
                  h('span', { style: styles.skillName }, skill.name || skill.id),
                  skill.description ? h('span', { style: styles.skillDesc }, ' — ' + skill.description) : null,
                  skill.tags && skill.tags.length
                    ? h(
                      'div',
                      { style: styles.skills },
                      skill.tags.map(function (tag) {
                        return h('span', { key: tag, style: styles.chip }, tag)
                      }),
                    )
                    : null,
                ),
              )
            })
          }
        }

        if (agent.enabled === false) {
          body.push(
            h(
              'div',
              { key: 'off', style: Object.assign({}, styles.warnBanner, { marginTop: '14px', marginBottom: 0 }) },
              t('details.disabledBanner'),
            ),
          )
        } else {
          body.push(h('div', { key: 'test' }, h(TestPanel, { agent: agent.name, scope: props.scope, sessionId: props.sessionId, t: t })))
        }

        return h('div', null, body)
      }

      /* ----------------------------------------------------------- форма агента */

      function AgentForm(props) {
        var t = translator(props)
        var editing = props.mode === 'edit' && props.agent
        var nameState = useState(editing ? props.agent.name : '')
        var name = nameState[0]
        var setName = nameState[1]
        var urlState = useState(editing ? props.agent.cardUrl : '')
        var url = urlState[0]
        var setUrl = urlState[1]
        var tokenState = useState('')
        var token = tokenState[0]
        var setToken = tokenState[1]
        var clearState = useState(false)
        var clearToken = clearState[0]
        var setClearToken = clearState[1]
        var timeoutState = useState(String(Math.round(((editing && props.agent.timeoutMs) || 180000) / 1000)))
        var timeout = timeoutState[0]
        var setTimeoutSec = timeoutState[1]

        function field(key, label, inputProps, hint) {
          return h(
            'label',
            { key: key, style: styles.fieldGroup },
            h('span', { style: styles.fieldLabel }, label),
            h('input', Object.assign({ className: 'a2a-focus', style: styles.field }, inputProps)),
            hint ? h('span', { style: styles.fieldHint }, hint) : null,
          )
        }

        function submit() {
          if (!name.trim() || !url.trim()) {
            props.onError(localError('form.fillNameUrl'))
            return
          }
          var record = {
            name: name.trim(),
            cardUrl: url.trim(),
            timeoutSec: Number(timeout) || undefined,
          }
          if (token.trim()) record.token = token.trim()
          if (clearToken) record.clearToken = true
          // submitForm сообщает об ошибке сам; гасим отказ, чтобы он не стал
          // необработанным отклонением промиса.
          var pending = props.onSubmit(record)
          if (pending && typeof pending.catch === 'function') pending.catch(function () {})
        }

        var fields = [
          field('name', t('form.name'), {
            value: name,
            placeholder: t('form.namePlaceholder'),
            disabled: props.busy,
            onChange: function (event) {
              setName(event.target.value)
            },
          }, t('form.nameHint')),
          field('url', t('form.cardUrl'), {
            value: url,
            placeholder: 'http://localhost:3080/.well-known/agent-card.json',
            disabled: props.busy,
            onChange: function (event) {
              setUrl(event.target.value)
            },
          }),
          field('token', editing ? t('form.tokenNew') : t('form.token'), {
            value: token,
            type: 'password',
            placeholder: editing ? t('form.tokenKeep') : t('form.tokenPlaceholder'),
            disabled: props.busy || clearToken,
            onChange: function (event) {
              setToken(event.target.value)
            },
          }),
          field('timeout', t('form.timeout'), {
            value: timeout,
            type: 'number',
            min: '5',
            disabled: props.busy,
            onChange: function (event) {
              setTimeoutSec(event.target.value)
            },
          }),
        ]

        return h(
          'div',
          null,
          h(
            'p',
            { style: styles.hint },
            editing ? t('form.hintEdit') : t('form.hintAdd'),
          ),
          h('div', { style: styles.formGrid }, fields),
          editing && props.agent.hasToken
            ? h(
              'label',
              { style: Object.assign({}, styles.checkboxRow, { marginTop: '10px' }) },
              h('input', {
                type: 'checkbox',
                style: { accentColor: COLORS.brand },
                checked: clearToken,
                onChange: function (event) {
                  setClearToken(event.target.checked)
                },
              }),
              t('form.clearToken'),
            )
            : null,
          errorNode(props.error, t, Object.assign({}, styles.banner, { marginTop: '12px', marginBottom: 0 })),
          h(
            'div',
            { style: styles.actionRow },
            h(
              'button',
              {
                type: 'button',
                className: 'a2a-focus',
                style: Object.assign({}, styles.primary, props.busy ? { opacity: 0.6, cursor: 'default' } : null),
                disabled: props.busy,
                onClick: submit,
              },
              props.busy ? t('action.verifying') : editing ? t('action.save') : t('action.add'),
            ),
            h(
              'button',
              { type: 'button', className: 'a2a-focus', style: styles.ghost, disabled: props.busy, onClick: props.onCancel },
              t('action.cancel'),
            ),
          ),
        )
      }

      /* ----------------------------------------------------------------- панель */

      /**
       * Панель A2A. `scope` = 'global' (боковая панель, полный доступ) или
       * 'workspace' (вкладка беседы: агенты рабочей области правятся, а
       * глобальные подключения профиля только читаются).
       */
      function A2APanel(props) {
        var t = translator(props)
        var scope = props && props.scope === 'workspace' ? 'workspace' : 'global'
        var sessionId = props && props.sessionId ? String(props.sessionId) : ''
        var isWorkspace = scope === 'workspace'

        var snapshotState = useState({ phase: 'loading', data: null, error: null })
        var snapshot = snapshotState[0]
        var setSnapshot = snapshotState[1]
        var busyState = useState(null)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var errorState = useState(null)
        var error = errorState[0]
        var setError = errorState[1]
        var modalState = useState(null)
        var modal = modalState[0]
        var setModal = modalState[1]
        var confirmState = useState(false)
        var confirmRemove = confirmState[0]
        var setConfirmRemove = confirmState[1]

        var load = useCallback(function () {
          setSnapshot(function (previous) {
            return { phase: previous.data ? 'refreshing' : 'loading', data: previous.data, error: null }
          })
          getSnapshot(scope, sessionId).then(
            function (json) {
              setSnapshot({ phase: 'ready', data: json, error: null })
            },
            function (failure) {
              setSnapshot({ phase: 'error', data: null, error: errorText(failure) })
            },
          )
        }, [scope, sessionId])

        var applySnapshot = useCallback(function (json) {
          setSnapshot({ phase: 'ready', data: json, error: null })
          setBusy(null)
        }, [])

        var act = useCallback(
          function (payload, key) {
            setBusy(key || 'panel')
            setError(null)
            return post(scope, sessionId, payload).then(
              function (json) {
                applySnapshot(json)
                return json
              },
              function (failure) {
                setError(hostError(failure))
                setBusy(null)
                throw failure
              },
            )
          },
          [scope, sessionId, applySnapshot],
        )

        useEffect(function () {
          load()
        }, [load])

        var data = snapshot.data
        var ready = snapshot.phase === 'ready' || snapshot.phase === 'refreshing'
        var localAgents = data && Array.isArray(data.agents) ? data.agents : []
        var globalAgents = data && Array.isArray(data.globalAgents) ? data.globalAgents : []
        var workspace = data && data.workspace ? data.workspace : null
        // Модалка ищет агента в том списке, из которого его открыли: в боковой
        // панели это реестр профиля, во вкладке беседы — ещё и глобальный
        // список, который там показан только для чтения.
        var pool = isWorkspace && modal && modal.scope === 'global' ? globalAgents : localAgents
        var current = null
        if (modal && modal.name) {
          for (var index = 0; index < pool.length; index += 1) {
            if (pool[index].name === modal.name) {
              current = pool[index]
              break
            }
          }
        }
        var readOnly = Boolean(current) && isWorkspace && modal && modal.scope === 'global'

        /**
         * Закрытие окна. Пока идёт запрос именно этого окна, оно не закрывается:
         * иначе результат пришёл бы в никуда. Действие над другим агентом
         * (переключатель в списке) закрытию не мешает.
         */
        function modalBusy() {
          return Boolean(busy) && Boolean(modal) && (busy === modal.name || busy === 'add' || busy === 'panel')
        }

        function closeModal() {
          if (modalBusy()) return
          setModal(null)
          setConfirmRemove(false)
          setError(null)
        }

        /** Escape в окне просмотра сначала снимает подтверждение удаления. */
        function escapeModal(event) {
          if (event) event.stopPropagation()
          if (confirmRemove) {
            setConfirmRemove(false)
            return
          }
          closeModal()
        }

        function openView(agent, agentScope) {
          setConfirmRemove(false)
          setError(null)
          setModal({ mode: 'view', name: agent.name, scope: agentScope })
        }

        function openEdit(agent) {
          setConfirmRemove(false)
          setError(null)
          setModal({ mode: 'edit', name: agent.name, scope: isWorkspace ? 'workspace' : 'global' })
        }

        function openAdd() {
          setConfirmRemove(false)
          setError(null)
          setModal({ mode: 'add', scope: isWorkspace ? 'workspace' : 'global' })
        }

        /** Удаление из строки спрашивает подтверждение отдельным окном. */
        function openRemove(agent, agentScope) {
          setConfirmRemove(false)
          setError(null)
          setModal({ mode: 'confirm', name: agent.name, scope: agentScope })
        }

        function toggleAgent(agent) {
          act({ action: agent.enabled === false ? 'enable' : 'disable', agent: agent.name }, agent.name).catch(function () {})
        }

        function removeAgent(name) {
          act({ action: 'remove', agent: name }, name).then(closeModal, function () {})
        }

        function submitForm(record) {
          var request = modal.mode === 'edit'
            ? { action: 'update', agent: modal.name, patch: record }
            : { action: 'add', agent: record }
          return act(request, modal.name || 'add').then(
            function (json) {
              // Окно могло закрыться, пока шёл запрос: тогда не открываем его снова.
              setModal(function (previous) {
                return previous ? { mode: 'view', name: record.name, scope: isWorkspace ? 'workspace' : 'global' } : previous
              })
              setError(null)
              return json
            },
            function (failure) {
              throw failure
            },
          )
        }

        function renderRows(agents, agentScope, onlyReadOnly) {
          return h(
            'div',
            null,
            agents.map(function (agent) {
              return h(AgentRow, {
                key: agentScope + ':' + agent.name,
                agent: agent,
                readOnly: onlyReadOnly,
                busy: busy === agent.name,
                t: t,
                onToggle: function () {
                  toggleAgent(agent)
                },
                onEdit: function () {
                  openEdit(agent)
                },
                onRemove: function () {
                  openRemove(agent, agentScope)
                },
                onOpen: function () {
                  openView(agent, agentScope)
                },
              })
            }),
          )
        }

        var body = []
        if (error && !modal) {
          body.push(h('div', { key: 'action-error' }, errorNode(error, t, styles.banner)))
        }
        if (snapshot.error) {
          body.push(h('div', { key: 'banner', role: 'alert', style: styles.banner }, t('panel.loadFailed', { message: snapshot.error })))
        }
        // Предупреждения приходят из host-половины по-русски: они помечаются
        // так же, как любое другое сообщение сервера, чтобы не выглядеть
        // собственными подписями панели.
        if (data && Array.isArray(data.warnings) && data.warnings.length > 0) {
          body.push(
            h(
              'div',
              { key: 'warn', style: styles.warnBanner },
              h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, t('panel.warningsTitle')),
              data.warnings.map(function (warning) {
                return h('div', { key: warning }, '• ' + t('panel.hostMessage', { message: warning }))
              }),
            ),
          )
        }
        if (snapshot.phase === 'loading') {
          body.push(h('div', { key: 'loading', role: 'status', style: styles.meta }, t('panel.loading')))
        }

        // Пустые состояния показываются только по готовым данным: иначе на
        // время загрузки и после ошибки панель утверждала бы «агентов нет».
        if (isWorkspace) {
          body.push(sectionTitle('panel.workspaceSection', t, { tag: 'h3' }))
          if (workspace) {
            body.push(
              h(
                'div',
                { key: 'ws-path', style: Object.assign({}, styles.meta, { marginBottom: '8px', wordBreak: 'break-all' }) },
                workspace.path + (workspace.exists ? '' : t('panel.workspaceFileMissing')),
              ),
            )
            body.push(
              h(
                'div',
                { key: 'ws-toolbar', style: styles.toolbar },
                h('button', { type: 'button', className: 'a2a-focus', style: styles.primary, onClick: openAdd }, t('action.addAgent')),
              ),
            )
          }
          body.push(
            localAgents.length > 0
              ? h('div', { key: 'ws-list' }, renderRows(localAgents, 'workspace', false))
              : workspace
                ? ready
                  ? h('div', { key: 'ws-empty', style: styles.empty }, t('panel.workspaceEmpty'))
                  : null
                : ready
                  ? h('div', { key: 'ws-empty', style: styles.empty }, t('panel.noWorkspace'))
                  : null,
          )

          body.push(sectionTitle('panel.globalSection', t, { tag: 'h3' }))
          body.push(
            h(
              'div',
              { key: 'global-hint', style: Object.assign({}, styles.meta, { marginBottom: '8px' }) },
              t('panel.globalHint'),
            ),
          )
          body.push(
            globalAgents.length > 0
              ? h('div', { key: 'global-list' }, renderRows(globalAgents, 'global', true))
              : ready
                ? h('div', { key: 'global-empty', style: styles.empty }, t('panel.globalEmpty'))
                : null,
          )
        } else {
          body.push(
            h(
              'div',
              { key: 'toolbar', style: styles.toolbar },
              h('button', { type: 'button', className: 'a2a-focus', style: styles.primary, onClick: openAdd }, t('action.addAgent')),
            ),
          )
          body.push(
            localAgents.length > 0
              ? h('div', { key: 'list' }, renderRows(localAgents, 'global', false))
              : ready
                ? h('div', { key: 'empty', style: styles.empty }, t('panel.empty'))
                : null,
          )
        }

        if (data) {
          var source = data.store && data.store.source === 'file' ? t('panel.sourceFile') : t('panel.sourceConfig')
          body.push(
            h(
              'div',
              { key: 'store', style: Object.assign({}, styles.meta, { marginTop: '18px', wordBreak: 'break-all' }) },
              t('panel.storeLine', { file: (data.store && data.store.file) || '—', source: source })
                + (data.at ? t('panel.snapshot', { time: new Date(data.at).toLocaleTimeString() }) : ''),
            ),
          )
        }

        var modalNode = null
        if (modal && modal.mode === 'add') {
          modalNode = h(
            Modal,
            {
              title: t('form.addTitle'),
              subtitle: isWorkspace ? t('form.workspaceSubtitle') : t('form.profileSubtitle'),
              onClose: closeModal,
              onEscape: function (event) {
                event.stopPropagation()
                closeModal()
              },
              footer: null,
              t: t,
            },
            h(AgentForm, {
              mode: 'add',
              busy: busy === 'add',
              error: error,
              onSubmit: submitForm,
              onCancel: closeModal,
              onError: setError,
              t: t,
            }),
          )
        } else if (modal && modal.mode === 'edit' && current) {
          modalNode = h(
            Modal,
            {
              title: t('form.editTitle', { name: current.name }),
              subtitle: current.cardUrl,
              onClose: closeModal,
              onEscape: function (event) {
                event.stopPropagation()
                closeModal()
              },
              footer: null,
              t: t,
            },
            h(AgentForm, {
              mode: 'edit',
              agent: current,
              busy: busy === current.name,
              error: error,
              onSubmit: submitForm,
              onCancel: closeModal,
              onError: setError,
              t: t,
            }),
          )
        } else if (modal && modal.mode === 'confirm' && current) {
          modalNode = h(
            Modal,
            {
              title: t('panel.removeTitle'),
              subtitle: current.cardUrl,
              onClose: closeModal,
              onEscape: function (event) {
                event.stopPropagation()
                closeModal()
              },
              footer: [
                h(
                  'button',
                  { key: 'cancel', type: 'button', className: 'a2a-focus', style: styles.ghost, onClick: closeModal },
                  t('action.cancel'),
                ),
                h(
                  'button',
                  {
                    key: 'remove',
                    type: 'button',
                    className: 'a2a-focus',
                    style: styles.danger,
                    disabled: busy === current.name,
                    onClick: function () {
                      removeAgent(current.name)
                    },
                  },
                  t('action.remove'),
                ),
              ],
              t: t,
            },
            h('p', { style: styles.hint }, t('panel.removeConfirm', { name: current.name })),
            h('p', { style: styles.hint }, t('panel.removeHint')),
            errorNode(error, t, Object.assign({}, styles.banner, { marginBottom: 0 })),
          )
        } else if (modal && modal.mode === 'view' && current) {
          var footer
          if (readOnly) {
            footer = [h('button', { key: 'close', type: 'button', className: 'a2a-focus', style: styles.primary, onClick: closeModal }, t('action.close'))]
          } else if (confirmRemove) {
            footer = h(
              'span',
              { style: styles.rowTitle },
              h('span', { style: styles.meta }, t('panel.removeConfirm', { name: current.name })),
              h(
                'button',
                {
                  type: 'button',
                  className: 'a2a-focus',
                  style: styles.danger,
                  disabled: busy === current.name,
                  onClick: function () {
                    removeAgent(current.name)
                  },
                },
                t('action.remove'),
              ),
              h(
                'button',
                { type: 'button', className: 'a2a-focus', style: styles.ghost, onClick: function () { setConfirmRemove(false) } },
                t('action.cancel'),
              ),
            )
          } else {
            footer = [
              h(
                'button',
                {
                  key: 'toggle',
                  type: 'button',
                  className: 'a2a-focus',
                  style: styles.ghost,
                  disabled: busy === current.name,
                  onClick: function () {
                    toggleAgent(current)
                  },
                },
                current.enabled === false ? t('action.enable') : t('action.disable'),
              ),
              h(
                'button',
                { key: 'edit', type: 'button', className: 'a2a-focus', style: styles.ghost, onClick: function () { openEdit(current) } },
                t('action.edit'),
              ),
              h(
                'button',
                { key: 'remove', type: 'button', className: 'a2a-focus', style: styles.danger, onClick: function () { setConfirmRemove(true) } },
                t('action.remove'),
              ),
              h('button', { key: 'close', type: 'button', className: 'a2a-focus', style: styles.primary, onClick: closeModal }, t('action.close')),
            ]
          }

          modalNode = h(
            Modal,
            {
              title: current.name,
              subtitle: current.cardUrl,
              onClose: closeModal,
              // Escape снимает подтверждение удаления и только второе нажатие
              // закрывает окно; × и клик по фону закрывают его сразу.
              onEscape: escapeModal,
              footer: footer,
              t: t,
            },
            h(DetailsBody, { agent: current, defaultAgent: data && data.defaultAgent, scope: scope, sessionId: sessionId, t: t }),
            errorNode(error, t, Object.assign({}, styles.banner, { marginTop: '14px', marginBottom: 0 })),
          )
        }

        return h(
          'section',
          { style: Object.assign({}, styles.page, isWorkspace ? { paddingTop: '20px' } : null) },
          h('style', { key: 'css' }, CSS),
          h(
            'div',
            { style: styles.header },
            h('h2', { style: styles.title }, isWorkspace ? t('panel.workspaceTitle') : t('panel.globalTitle')),
            h(
              'button',
              {
                type: 'button',
                className: 'a2a-focus',
                style: styles.ghost,
                onClick: load,
                disabled: snapshot.phase === 'loading' || snapshot.phase === 'refreshing',
              },
              snapshot.phase === 'refreshing' ? t('action.refreshing') : t('action.refresh'),
            ),
          ),
          h(
            'p',
            { style: styles.lead },
            isWorkspace ? t('panel.workspaceLead') : t('panel.globalLead'),
          ),
          body,
          modalNode,
        )
      }

      /* ------------------------------------------------------------------- вход */

      /**
       * Иконка левой панели: слот сам рисует кнопку и передаёт `size`/`active`,
       * а по клику открывает `main` с тем же id.
       */
      function A2AIcon(props) {
        var size = props && props.size ? props.size : 18
        var active = Boolean(props && props.active)
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.7,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
            style: { display: 'block', opacity: active ? 1 : 0.82 },
          },
          h('rect', { key: 'left', x: 2.5, y: 8.5, width: 6, height: 7, rx: 1.8 }),
          h('rect', { key: 'right', x: 15.5, y: 8.5, width: 6, height: 7, rx: 1.8 }),
          h('path', { key: 'link', d: 'M8.6 11.2h6.8M8.6 12.8h6.8' }),
        )
      }

      /** Вкладка беседы: та же панель, но привязанная к рабочей области сессии. */
      function A2AWorkspaceView(props) {
        return h(A2APanel, { scope: 'workspace', sessionId: props && props.sessionId, t: props && props.t })
      }

      module.exports = {
        name: 'a2a-client',
        // `locale` — заявленная зависимость: без сервиса локализации плагин не
        // активируется. Он входит в веб-сборку DSH, поэтому панель не теряется.
        inject: ['slots', 'locale'],
        apply: function (ctx) {
          // Словари всех трёх языков — одной регистрацией: ключи в них
          // совпадают, потому что собраны из общей таблицы STRINGS.
          ctx.effect(function () {
            return ctx.locale.register(NS, {
              en: dictionary('en'),
              ru: dictionary('ru'),
              zh: dictionary('zh'),
            })
          }, 'a2a-client: dictionaries')

          // `locale: NS` — слот сам передаёт компоненту `t` и перерисовывает
          // его при смене языка, отдельная подписка не нужна.
          ctx.effect(function () {
            return ctx.slots.inject('sidebar.panellist', function* () {
              yield ctx.slots.register(
                { name: 'sidebar.panellist', id: 'a2a-client', order: 30, label: 'A2A', locale: NS },
                A2AIcon,
              )
            })
          }, 'a2a-client: sidebar entry')

          ctx.effect(function () {
            return ctx.slots.inject('main', function* () {
              yield ctx.slots.register({ name: 'main', key: 'a2a-client', locale: NS }, function (props) {
                return h(A2APanel, { scope: 'global', t: props && props.t })
              })
            })
          }, 'a2a-client: main panel')

          ctx.effect(function () {
            return ctx.slots.inject('conversation.view', function* () {
              yield ctx.slots.register(
                { name: 'conversation.view', id: 'a2a', order: 40, label: 'A2A', locale: NS },
                A2AWorkspaceView,
              )
            })
          }, 'a2a-client: conversation view')
        },
      }
    })(module, module.exports, require)
    return module.exports
  },
})
