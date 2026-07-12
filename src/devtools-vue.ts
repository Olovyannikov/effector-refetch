import { defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType, type VNode } from 'vue';
import { useUnit } from 'effector-vue/composition';
import type { Query, QueryStatus } from './types';
import { attachQueryLogger, type QueryLogEntry } from './inspect';

/**
 * Vue counterpart of the React devtools panel — a floating, TanStack-style
 * inspector listing queries with live status, params, data, error and a
 * per-query event log. Import from `effector-refetch/devtools/vue`.
 * Scope-aware via effector-vue's EffectorScope plugin.
 *
 * Built as render functions (no SFC) so it needs no extra build plugin.
 */

type AnyQuery = Query<any, any, any, any>;

const COLOR: Record<QueryStatus, string> = {
  initial: '#868e96',
  pending: '#f08c00',
  done: '#2f9e44',
  fail: '#e03131',
};

const json = (value: unknown): string => {
  try {
    const s = JSON.stringify(value, null, 2);
    return s && s.length > 4000 ? `${s.slice(0, 4000)}\n… (truncated)` : (s ?? String(value));
  } catch {
    return String(value);
  }
};

const preStyle: Record<string, string> = {
  margin: '0',
  padding: '8px',
  background: '#101113',
  borderRadius: '6px',
  color: '#c1c2c5',
  fontSize: '12px',
  maxHeight: '160px',
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

function dot(status: QueryStatus): VNode {
  return h('span', {
    style: {
      display: 'inline-block',
      width: '9px',
      height: '9px',
      borderRadius: '50%',
      background: COLOR[status],
      marginRight: '8px',
      flex: '0 0 auto',
    },
  });
}

const QueryRow = defineComponent({
  name: 'EqQueryRow',
  props: {
    label: { type: String, required: true },
    query: { type: Object as PropType<AnyQuery>, required: true },
    active: { type: Boolean, default: false },
    onSelect: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const u = useUnit(props.query) as unknown as {
      status: { value: QueryStatus };
      pending: { value: boolean };
    };
    return () =>
      h(
        'button',
        {
          type: 'button',
          onClick: () => props.onSelect(),
          style: {
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            padding: '6px 10px',
            border: 'none',
            background: props.active ? '#2b2c30' : 'transparent',
            color: '#e9ecef',
            cursor: 'pointer',
            font: 'inherit',
            textAlign: 'left',
          },
        },
        [
          dot(u.status.value),
          h(
            'span',
            { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            props.label,
          ),
          u.pending.value ? h('span', { style: { marginLeft: 'auto', color: COLOR.pending } }, '•••') : null,
        ],
      );
  },
});

function section(title: string, body: VNode | VNode[]): VNode {
  return h('div', { style: { marginBottom: '10px' } }, [
    h(
      'div',
      {
        style: {
          color: '#868e96',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginBottom: '4px',
        },
      },
      title,
    ),
    body,
  ]);
}

const QueryDetail = defineComponent({
  name: 'EqQueryDetail',
  props: {
    label: { type: String, required: true },
    query: { type: Object as PropType<AnyQuery>, required: true },
  },
  setup(props) {
    const u = useUnit(props.query) as unknown as {
      data: { value: unknown };
      error: { value: unknown };
      status: { value: QueryStatus };
      isInitialLoading: { value: boolean };
      isRefetching: { value: boolean };
      params: { value: unknown };
    };
    const log = ref<QueryLogEntry[]>([]);
    let detach: (() => void) | undefined;

    onMounted(() => {
      detach = attachQueryLogger(props.query, {
        name: props.label,
        handler: (entry) => {
          log.value = [...log.value.slice(-49), entry];
        },
      });
    });
    onBeforeUnmount(() => detach?.());

    return () =>
      h('div', { style: { flex: '1', padding: '12px', overflow: 'auto' } }, [
        h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '10px' } }, [
          dot(u.status.value),
          h('strong', { style: { marginRight: '8px' } }, props.label),
          h('span', { style: { color: COLOR[u.status.value], fontSize: '12px' } }, u.status.value),
          u.isInitialLoading.value
            ? h(
                'span',
                { style: { marginLeft: '8px', color: COLOR.pending, fontSize: '12px' } },
                'first load',
              )
            : null,
          u.isRefetching.value
            ? h(
                'span',
                { style: { marginLeft: '8px', color: COLOR.pending, fontSize: '12px' } },
                'refetching ⟳',
              )
            : null,
        ]),
        section('Params', h('pre', { style: preStyle }, json(u.params.value))),
        section('Data', h('pre', { style: preStyle }, json(u.data.value))),
        u.error.value != null
          ? section(
              'Error',
              h(
                'pre',
                { style: { ...preStyle, color: COLOR.fail } },
                json((u.error.value as Error)?.message ?? u.error.value),
              ),
            )
          : null,
        section(
          'Log',
          h(
            'div',
            { style: preStyle },
            log.value.length === 0
              ? [h('span', { style: { color: '#5c5f66' } }, 'no activity yet')]
              : log.value.map((e) =>
                  h('div', { style: { color: e.type === 'fail' ? COLOR.fail : '#c1c2c5' } }, [
                    h('span', { style: { color: '#868e96' } }, e.type),
                    e.attempt != null ? ` #${e.attempt}` : '',
                    e.durationMs != null ? ` (${e.durationMs}ms)` : '',
                  ]),
                ),
          ),
        ),
      ]);
  },
});

export const EffectorQueryDevtools = defineComponent({
  name: 'EffectorQueryDevtools',
  props: {
    /** Queries to inspect, keyed by display name. */
    queries: { type: Object as PropType<Record<string, AnyQuery>>, required: true },
    initialIsOpen: { type: Boolean, default: false },
    position: { type: String as PropType<'bottom-right' | 'bottom-left'>, default: 'bottom-right' },
  },
  setup(props) {
    const open = ref(props.initialIsOpen);
    const selected = ref<string>(Object.keys(props.queries)[0] ?? '');

    return () => {
      const keys = Object.keys(props.queries);
      const container: Record<string, string> = {
        position: 'fixed',
        bottom: '12px',
        ...(props.position === 'bottom-left' ? { left: '12px' } : { right: '12px' }),
        zIndex: '99999',
        font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
      };

      if (!open.value) {
        return h('div', { style: container, 'data-testid': 'eq-devtools' }, [
          h(
            'button',
            {
              type: 'button',
              onClick: () => (open.value = true),
              'data-testid': 'eq-devtools-toggle',
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                border: 'none',
                borderRadius: '999px',
                background: '#1a1b1e',
                color: '#ffd8a8',
                cursor: 'pointer',
                boxShadow: '0 2px 12px rgba(0,0,0,.35)',
              },
            },
            `⚡ queries (${keys.length})`,
          ),
        ]);
      }

      const activeKey = keys.includes(selected.value) ? selected.value : (keys[0] ?? '');

      return h('div', { style: container, 'data-testid': 'eq-devtools' }, [
        h(
          'div',
          {
            style: {
              width: '540px',
              height: '360px',
              display: 'flex',
              flexDirection: 'column',
              background: '#1a1b1e',
              color: '#e9ecef',
              border: '1px solid #2b2c30',
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,.45)',
            },
          },
          [
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom: '1px solid #2b2c30',
                },
              },
              [
                h('strong', { style: { color: '#ffd8a8' } }, 'effector-refetch'),
                h('span', { style: { marginLeft: '8px', color: '#868e96' } }, 'devtools'),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => (open.value = false),
                    'data-testid': 'eq-devtools-close',
                    style: {
                      marginLeft: 'auto',
                      border: 'none',
                      background: 'transparent',
                      color: '#868e96',
                      cursor: 'pointer',
                    },
                  },
                  '✕',
                ),
              ],
            ),
            h('div', { style: { display: 'flex', flex: '1', minHeight: '0' } }, [
              h(
                'div',
                {
                  style: {
                    width: '170px',
                    borderRight: '1px solid #2b2c30',
                    overflow: 'auto',
                    padding: '4px 0',
                  },
                },
                keys.map((key) =>
                  h(QueryRow, {
                    key,
                    label: key,
                    query: props.queries[key],
                    active: key === activeKey,
                    onSelect: () => (selected.value = key),
                  }),
                ),
              ),
              activeKey
                ? h(QueryDetail, { key: activeKey, label: activeKey, query: props.queries[activeKey] })
                : h('div', { style: { flex: '1', padding: '12px', color: '#5c5f66' } }, 'No queries.'),
            ]),
          ],
        ),
      ]);
    };
  },
});
