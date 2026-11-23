/**
 * client.js — браузерная половина @local/dsh-a2a-client.
 *
 * Одна панель в левом сайдбаре («A2A»): список агентов карточками и три
 * модальных окна — просмотр, добавление, редактирование. Проверка связи живёт
 * в окне просмотра, чтобы не занимать список.
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

      /* --------------------------------------------------------------- утилиты */

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

      function stateLabel(state) {
        var map = {
          TASK_STATE_COMPLETED: 'завершена',
          TASK_STATE_WORKING: 'в работе',
          TASK_STATE_SUBMITTED: 'принята',
          TASK_STATE_FAILED: 'ошибка',
          TASK_STATE_CANCELED: 'отменена',
          TASK_STATE_CANCELLED: 'отменена',
          TASK_STATE_REJECTED: 'отклонена',
          TASK_STATE_INPUT_REQUIRED: 'нужен ответ',
          TASK_STATE_AUTH_REQUIRED: 'нужна авторизация',
          MESSAGE: 'сообщение',
        }
        return map[state] || state || '—'
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

      /* ------------------------------------------------------------- атомарные */

      function Switch(props) {
        return h(
          'label',
          {
            style: Object.assign({}, styles.switchLabel, props.disabled ? { opacity: 0.5, cursor: 'default' } : null),
            title: props.enabled ? 'Отключить агента' : 'Включить агента',
          },
          h('input', {
            type: 'checkbox',
            checked: props.enabled,
            disabled: props.disabled,
            onChange: props.onChange,
            style: { position: 'absolute', opacity: 0, width: '1px', height: '1px' },
            'aria-label': props.enabled ? 'Отключить агента' : 'Включить агента',
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
            style: Object.assign({}, styles.iconBtn, props.danger ? styles.iconBtnDanger : null, props.disabled ? { opacity: 0.5, cursor: 'default' } : null),
            onClick: props.onClick,
          },
          props.children,
        )
      }

      function statusOf(agent) {
        if (agent.enabled === false) return { label: 'отключён', color: COLORS.warn }
        if (agent.error) return { label: 'нет связи', color: COLORS.error }
        if (agent.card) return { label: 'доступен', color: COLORS.ok }
        return { label: 'неизвестно', color: COLORS.muted }
      }

      function agentDescription(agent) {
        if (agent.enabled === false) return 'Отключён: инструменты a2a_* его не используют.'
        if (agent.error) return agent.error
        if (agent.card && agent.card.description) return agent.card.description
        return agent.cardUrl
      }

      /* ---------------------------------------------------------------- строка */

      function AgentRow(props) {
        var agent = props.agent
        var status = statusOf(agent)
        return h(
          'div',
          { style: styles.listCard },
          h(
            'div',
            { style: styles.row },
            h(
              'button',
              { type: 'button', style: styles.rowMain, onClick: props.onOpen, 'aria-label': 'Открыть «' + agent.name + '»' },
              h(
                'span',
                { style: styles.rowTitle },
                h('span', { style: Object.assign({}, styles.dot, { background: status.color }), 'aria-hidden': 'true' }),
                h('span', { style: styles.name }, agent.name),
                h('span', { style: badgeStyle(status.color) }, status.label),
              ),
              h('span', { style: styles.rowDesc }, agentDescription(agent)),
              h('span', { style: styles.mono }, agent.cardUrl),
            ),
            props.readOnly
              ? null
              : h(
                'div',
                { style: styles.controls },
                h(Switch, { enabled: agent.enabled !== false, disabled: props.busy, onChange: props.onToggle }),
                h(IconButton, { title: 'Редактировать', disabled: props.busy, onClick: props.onEdit }, h(PencilIcon, null)),
                h(IconButton, { title: 'Удалить', danger: true, disabled: props.busy, onClick: props.onRemove }, h(TrashIcon, null)),
              ),
          ),
        )
      }

      /* --------------------------------------------------------------- модалка */

      function Modal(props) {
        useEffect(function () {
          function onKey(event) {
            if (event.key === 'Escape') props.onClose()
          }
          window.addEventListener('keydown', onKey)
          return function () {
            window.removeEventListener('keydown', onKey)
          }
        }, [props.onClose])

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
            { role: 'dialog', 'aria-modal': 'true', 'aria-label': props.label, style: styles.dialog },
            h(
              'div',
              { style: styles.modalHeader },
              h(
                'div',
                null,
                h('h3', { style: styles.modalTitle }, props.title),
                props.subtitle ? h('p', { style: styles.modalSub }, props.subtitle) : null,
              ),
              h(IconButton, { title: 'Закрыть', onClick: props.onClose }, h('span', { style: { fontSize: '15px', lineHeight: '15px' } }, '×')),
            ),
            h('div', { style: styles.modalBody }, props.children),
            h('div', { style: styles.modalFooter }, props.footer),
          ),
        )
      }

      /* ------------------------------------------------------------------ тест */

      function TestPanel(props) {
        var textState = useState('Привет! Ответь одним предложением, что ты умеешь.')
        var text = textState[0]
        var setText = textState[1]
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
              setError(errorText(failure))
              setResult(null)
              setBusy(false)
            },
          )
        }

        return h(
          'div',
          null,
          h('div', { style: styles.sectionTitle }, 'Проверка связи'),
          h('textarea', {
            value: text,
            rows: 3,
            style: styles.textarea,
            'aria-label': 'Текст сообщения',
            placeholder: 'Текст сообщения удалённому агенту',
            onChange: function (event) {
              setText(event.target.value)
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
              'потоковый режим (SSE)',
            ),
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, styles.primary, busy ? { opacity: 0.6, cursor: 'default' } : null),
                onClick: submit,
                disabled: busy,
              },
              busy ? 'Отправляю…' : 'Отправить',
            ),
          ),
          error ? h('div', { style: Object.assign({}, styles.banner, { marginTop: '12px', marginBottom: 0 }) }, error) : null,
          result
            ? h(
              'div',
              { style: styles.result },
              h(
                'div',
                { style: styles.rowTitle },
                h('span', { style: badgeStyle(COLORS.ok) }, stateLabel(result.state)),
                h('span', { style: styles.meta }, (result.durationMs / 1000).toFixed(1) + ' с'),
                result.streaming ? h('span', { style: styles.chip }, 'SSE') : null,
              ),
              h('pre', { style: styles.answer }, result.text || '(пустой ответ)'),
              h(
                'div',
                { style: styles.mono },
                [result.taskId ? 'задача ' + result.taskId : null, result.contextId ? 'контекст ' + result.contextId : null]
                  .filter(Boolean)
                  .join(' · '),
              ),
            )
            : null,
        )
      }

      /* -------------------------------------------------------------- просмотр */

      function DetailsBody(props) {
        var agent = props.agent
        var card = agent.card
        var rows = [
          { key: 'protocol', label: 'Протокол', value: (card && card.protocolVersion) || '1.0' },
          { key: 'version', label: 'Версия агента', value: (card && card.version) || '—' },
          { key: 'skills', label: 'Умений', value: card ? String(card.skills.length) : '—' },
          { key: 'token', label: 'Токен', value: agent.hasToken ? 'задан' : 'не задан' },
          { key: 'timeout', label: 'Таймаут', value: Math.round((agent.timeoutMs || 0) / 1000) + ' с' },
          { key: 'role', label: 'Роль', value: props.defaultAgent === agent.name ? 'агент по умолчанию' : 'агент' },
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
          body.push(h('div', { key: 'err', style: Object.assign({}, styles.banner, { marginTop: '14px' }) }, agent.error))
        }

        if (card) {
          body.push(h('div', { key: 'card-title', style: styles.sectionTitle }, 'Карточка агента'))
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
            body.push(h('div', { key: 'skills-title', style: styles.sectionTitle }, 'Умения'))
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
              { key: 'off', style: Object.assign({}, styles.banner, { borderColor: COLORS.warn, marginTop: '14px', marginBottom: 0 }) },
              'Агент отключён — инструменты a2a_* его не используют. Включите его, чтобы проверить связь.',
            ),
          )
        } else {
          body.push(h('div', { key: 'test' }, h(TestPanel, { agent: agent.name, scope: props.scope, sessionId: props.sessionId })))
        }

        return h('div', null, body)
      }

      /* ----------------------------------------------------------- форма агента */

      function AgentForm(props) {
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

        function field(key, label, inputProps) {
          return h(
            'label',
            { key: key, style: styles.fieldGroup },
            h('span', { style: styles.fieldLabel }, label),
            h('input', Object.assign({ style: styles.field }, inputProps)),
          )
        }

        function submit() {
          if (!name.trim() || !url.trim()) {
            props.onError('Заполните имя и Agent Card URL.')
            return
          }
          var record = {
            name: name.trim(),
            cardUrl: url.trim(),
            timeoutSec: Number(timeout) || undefined,
          }
          if (token.trim()) record.token = token.trim()
          if (clearToken) record.clearToken = true
          props.onSubmit(record)
        }

        var fields = [
          field('name', 'Имя', {
            value: name,
            placeholder: 'test',
            disabled: props.busy,
            onChange: function (event) {
              setName(event.target.value)
            },
          }),
          field('url', 'Agent Card URL', {
            value: url,
            placeholder: 'http://localhost:3080/.well-known/agent-card.json',
            disabled: props.busy,
            onChange: function (event) {
              setUrl(event.target.value)
            },
          }),
          field('token', editing ? 'Новый токен (необязательно)' : 'Токен (необязательно)', {
            value: token,
            type: 'password',
            placeholder: editing ? 'оставьте пустым, чтобы не менять' : 'Bearer-токен',
            disabled: props.busy || clearToken,
            onChange: function (event) {
              setToken(event.target.value)
            },
          }),
          field('timeout', 'Таймаут, с', {
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
            editing
              ? 'Перед сохранением плагин проверит карточку и токен по новому адресу.'
              : 'Agent Card URL — например http://localhost:3080/.well-known/agent-card.json. Перед сохранением плагин проверит адрес и токен.',
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
              'Удалить сохранённый токен',
            )
            : null,
          props.error ? h('div', { style: Object.assign({}, styles.banner, { marginTop: '12px', marginBottom: 0 }) }, props.error) : null,
          h(
            'div',
            { style: styles.actionRow },
            h(
              'button',
              {
                type: 'button',
                style: Object.assign({}, styles.primary, props.busy ? { opacity: 0.6, cursor: 'default' } : null),
                disabled: props.busy,
                onClick: submit,
              },
              props.busy ? 'Проверяю…' : editing ? 'Сохранить' : 'Добавить',
            ),
            h(
              'button',
              { type: 'button', style: styles.ghost, disabled: props.busy, onClick: props.onCancel },
              'Отмена',
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
                setError(errorText(failure))
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
        var localAgents = data && Array.isArray(data.agents) ? data.agents : []
        var globalAgents = data && Array.isArray(data.globalAgents) ? data.globalAgents : []
        var workspace = data && data.workspace ? data.workspace : null
        var pool = modal && modal.scope === 'global' ? globalAgents : localAgents
        var current = null
        if (modal && modal.name) {
          for (var index = 0; index < pool.length; index += 1) {
            if (pool[index].name === modal.name) {
              current = pool[index]
              break
            }
          }
        }
        var readOnly = Boolean(current) && isWorkspace && modal.scope === 'global'

        function closeModal() {
          setModal(null)
          setConfirmRemove(false)
          setError(null)
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
              setModal({ mode: 'view', name: record.name, scope: isWorkspace ? 'workspace' : 'global' })
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
                onToggle: function () {
                  toggleAgent(agent)
                },
                onEdit: function () {
                  openEdit(agent)
                },
                onRemove: function () {
                  openView(agent, agentScope)
                  setConfirmRemove(true)
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
          body.push(h('div', { key: 'action-error', style: styles.banner }, error))
        }
        if (snapshot.error) {
          body.push(h('div', { key: 'banner', style: styles.banner }, 'Не удалось получить данные: ' + snapshot.error))
        }
        if (data && Array.isArray(data.warnings) && data.warnings.length > 0) {
          body.push(
            h(
              'div',
              { key: 'warn', style: styles.banner },
              data.warnings.map(function (warning) {
                return h('div', { key: warning }, '• ' + warning)
              }),
            ),
          )
        }
        if (snapshot.phase === 'loading') {
          body.push(h('div', { key: 'loading', style: styles.meta }, 'Загрузка…'))
        }

        if (isWorkspace) {
          body.push(h('div', { key: 'ws-title', style: styles.sectionTitle }, 'Рабочая область'))
          body.push(
            h(
              'div',
              { key: 'ws-path', style: Object.assign({}, styles.meta, { marginBottom: '8px', wordBreak: 'break-all' }) },
              workspace ? workspace.path + (workspace.exists ? '' : ' · файл ещё не создан') : 'рабочая область не определена',
            ),
          )
          if (workspace) {
            body.push(
              h(
                'div',
                { key: 'ws-toolbar', style: styles.toolbar },
                h('button', { type: 'button', style: styles.primary, onClick: openAdd }, 'Добавить агента'),
              ),
            )
          }
          body.push(
            localAgents.length > 0
              ? h('div', { key: 'ws-list' }, renderRows(localAgents, 'workspace', false))
              : h(
                'div',
                { key: 'ws-empty', style: styles.empty },
                workspace
                  ? 'В рабочей области агентов нет — добавьте кнопкой выше.'
                  : 'Нет рабочей области: показаны только глобальные подключения.',
              ),
          )

          body.push(h('div', { key: 'global-title', style: styles.sectionTitle }, 'Глобальные подключения'))
          body.push(
            h(
              'div',
              { key: 'global-hint', style: Object.assign({}, styles.meta, { marginBottom: '8px' }) },
              'Только просмотр: добавление и правка — в боковой панели A2A.',
            ),
          )
          body.push(
            globalAgents.length > 0
              ? h('div', { key: 'global-list' }, renderRows(globalAgents, 'global', true))
              : h('div', { key: 'global-empty', style: styles.empty }, 'Глобальных агентов нет.'),
          )
        } else {
          body.push(
            h(
              'div',
              { key: 'toolbar', style: styles.toolbar },
              h('button', { type: 'button', style: styles.primary, onClick: openAdd }, 'Добавить агента'),
            ),
          )
          body.push(
            localAgents.length > 0
              ? h('div', { key: 'list' }, renderRows(localAgents, 'global', false))
              : h('div', { key: 'empty', style: styles.empty }, 'Агентов пока нет. Добавьте первого кнопкой выше.'),
          )
        }

        if (data) {
          var source = data.store && data.store.source === 'file' ? 'a2a-client.json' : 'конфиг плагина'
          body.push(
            h(
              'div',
              { key: 'store', style: Object.assign({}, styles.meta, { marginTop: '18px', wordBreak: 'break-all' }) },
              'Реестр: ' + ((data.store && data.store.file) || '—') + ' · источник: ' + source
                + (data.at ? ' · снимок ' + new Date(data.at).toLocaleTimeString() : ''),
            ),
          )
        }

        var modalNode = null
        if (modal && modal.mode === 'add') {
          modalNode = h(
            Modal,
            {
              label: 'Добавить агента',
              title: 'Новый агент',
              subtitle: isWorkspace ? 'Рабочая область' : 'Профиль',
              onClose: closeModal,
              footer: null,
            },
            h(AgentForm, {
              mode: 'add',
              busy: busy === 'add',
              error: error,
              onSubmit: submitForm,
              onCancel: closeModal,
              onError: setError,
            }),
          )
        } else if (modal && modal.mode === 'edit' && current) {
          modalNode = h(
            Modal,
            {
              label: 'Редактировать агента',
              title: 'Изменить «' + current.name + '»',
              subtitle: current.cardUrl,
              onClose: closeModal,
              footer: null,
            },
            h(AgentForm, {
              mode: 'edit',
              agent: current,
              busy: busy === current.name,
              error: error,
              onSubmit: submitForm,
              onCancel: closeModal,
              onError: setError,
            }),
          )
        } else if (modal && modal.mode === 'view' && current) {
          var footer
          if (readOnly) {
            footer = [h('button', { key: 'close', type: 'button', style: styles.primary, onClick: closeModal }, 'Закрыть')]
          } else if (confirmRemove) {
            footer = h(
              'span',
              { style: styles.rowTitle },
              h('span', { style: styles.meta }, 'Удалить «' + current.name + '»?'),
              h(
                'button',
                {
                  type: 'button',
                  style: styles.danger,
                  disabled: busy === current.name,
                  onClick: function () {
                    removeAgent(current.name)
                  },
                },
                'Удалить',
              ),
              h(
                'button',
                { type: 'button', style: styles.ghost, onClick: function () { setConfirmRemove(false) } },
                'Отмена',
              ),
            )
          } else {
            footer = [
              h(
                'button',
                {
                  key: 'toggle',
                  type: 'button',
                  style: styles.ghost,
                  disabled: busy === current.name,
                  onClick: function () {
                    toggleAgent(current)
                  },
                },
                current.enabled === false ? 'Включить' : 'Отключить',
              ),
              h(
                'button',
                { key: 'edit', type: 'button', style: styles.ghost, onClick: function () { openEdit(current) } },
                'Редактировать',
              ),
              h(
                'button',
                { key: 'remove', type: 'button', style: styles.danger, onClick: function () { setConfirmRemove(true) } },
                'Удалить',
              ),
              h('button', { key: 'close', type: 'button', style: styles.primary, onClick: closeModal }, 'Закрыть'),
            ]
          }

          modalNode = h(
            Modal,
            {
              label: 'Агент ' + current.name,
              title: current.name,
              subtitle: current.cardUrl,
              onClose: closeModal,
              footer: footer,
            },
            h(DetailsBody, { agent: current, defaultAgent: data && data.defaultAgent, scope: scope, sessionId: sessionId }),
          )
        }

        return h(
          'section',
          { style: Object.assign({}, styles.page, isWorkspace ? { paddingTop: '20px' } : null) },
          h(
            'div',
            { style: styles.header },
            h('h2', { style: styles.title }, isWorkspace ? 'A2A рабочей области' : 'A2A-подключения'),
            h(
              'button',
              {
                type: 'button',
                style: styles.ghost,
                onClick: load,
                disabled: snapshot.phase === 'loading' || snapshot.phase === 'refreshing',
              },
              snapshot.phase === 'refreshing' ? 'Обновляю…' : 'Обновить',
            ),
          ),
          h(
            'p',
            { style: styles.lead },
            isWorkspace
              ? 'Агенты этой рабочей области (правятся здесь) и глобальные подключения профиля — только для просмотра.'
              : 'Клиент Agent2Agent 1.0: агенты карточками, правка и проверка связи — в модальных окнах.',
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
        return h(A2APanel, { scope: 'workspace', sessionId: props && props.sessionId })
      }

      module.exports = {
        name: 'a2a-client',
        inject: ['slots'],
        apply: function (ctx) {
          ctx.effect(function () {
            return ctx.slots.inject('sidebar.panellist', function* () {
              yield ctx.slots.register(
                { name: 'sidebar.panellist', id: 'a2a-client', order: 30, label: 'A2A' },
                A2AIcon,
              )
            })
          }, 'a2a-client: sidebar entry')

          ctx.effect(function () {
            return ctx.slots.inject('main', function* () {
              yield ctx.slots.register({ name: 'main', key: 'a2a-client' }, function () {
                return h(A2APanel, { scope: 'global' })
              })
            })
          }, 'a2a-client: main panel')

          ctx.effect(function () {
            return ctx.slots.inject('conversation.view', function* () {
              yield ctx.slots.register(
                { name: 'conversation.view', id: 'a2a', order: 40, label: 'A2A' },
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

