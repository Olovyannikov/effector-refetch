import h from 'solid-js/h';
import { createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { useUnit } from 'effector-solid';
import type { Query, QueryStatus } from './types';
import { attachQueryLogger, type QueryLogEntry } from './inspect';

/**
 * Solid counterpart of the React/Vue devtools panels — a floating, TanStack-style
 * inspector listing queries with live status, params, data, error and a per-query
 * event log. Import from `effector-refetch/devtools/solid`. Scope-aware via
 * effector-solid's `<Provider>`.
 *
 * Built with `solid-js/h` (no JSX), so it needs no extra build plugin. Reactivity
 * uses thunk children (`() => …`), which `h` inserts reactively into elements.
 * Note: `h` turns zero-arg function *props on components* into reactive getters,
 * so callback props (e.g. `onSelect`) take an argument to stay plain functions.
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
  'border-radius': '6px',
  color: '#c1c2c5',
  'font-size': '12px',
  'max-height': '160px',
  overflow: 'auto',
  'white-space': 'pre-wrap',
  'word-break': 'break-word',
};

const sectionStyle: Record<string, string> = {
  color: '#868e96',
  'font-size': '11px',
  'text-transform': 'uppercase',
  'letter-spacing': '0.5px',
  margin: '10px 0 4px',
};

function dot(status: Accessor<QueryStatus>) {
  return h('span', {
    style: () => ({
      display: 'inline-block',
      width: '9px',
      height: '9px',
      'border-radius': '50%',
      background: COLOR[status()],
      'margin-right': '8px',
      flex: '0 0 auto',
    }),
  });
}

function section(title: string, body: unknown) {
  return h('div', { style: { 'margin-bottom': '10px' } }, h('div', { style: sectionStyle }, title), body);
}

// `active`/`onSelect` arrive via h: `active` (zero-arg) becomes a reactive getter
// (read as a value); `onSelect` takes an arg so h keeps it a plain callback.
function QueryRow(props: {
  label: string;
  query: AnyQuery;
  active: boolean;
  onSelect: (key: string) => void;
}) {
  const u = useUnit(props.query) as unknown as { status: Accessor<QueryStatus>; pending: Accessor<boolean> };
  return h(
    'button',
    {
      type: 'button',
      onClick: () => props.onSelect(props.label),
      style: () => ({
        display: 'flex',
        'align-items': 'center',
        width: '100%',
        padding: '6px 10px',
        border: 'none',
        background: props.active ? '#2b2c30' : 'transparent',
        color: '#e9ecef',
        cursor: 'pointer',
        font: 'inherit',
        'text-align': 'left',
      }),
    },
    dot(() => u.status()),
    h(
      'span',
      { style: { overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' } },
      props.label,
    ),
    () => (u.pending() ? h('span', { style: { 'margin-left': 'auto', color: COLOR.pending } }, '•••') : null),
  );
}

function QueryDetail(props: { label: string; query: AnyQuery }) {
  const u = useUnit(props.query) as unknown as {
    data: Accessor<unknown>;
    error: Accessor<unknown>;
    status: Accessor<QueryStatus>;
    isInitialLoading: Accessor<boolean>;
    isRefetching: Accessor<boolean>;
    params: Accessor<unknown>;
  };
  const [log, setLog] = createSignal<QueryLogEntry[]>([]);
  let detach: (() => void) | undefined;
  onMount(() => {
    detach = attachQueryLogger(props.query, {
      name: props.label,
      handler: (entry) => setLog((prev) => [...prev.slice(-49), entry]),
    });
  });
  onCleanup(() => detach?.());

  return h(
    'div',
    { style: { flex: '1', padding: '12px', overflow: 'auto' } },
    h(
      'div',
      { style: { display: 'flex', 'align-items': 'center', 'margin-bottom': '10px' } },
      dot(() => u.status()),
      h('strong', { style: { 'margin-right': '8px' } }, props.label),
      h('span', { style: () => ({ color: COLOR[u.status()], 'font-size': '12px' }) }, () => u.status()),
      () =>
        u.isInitialLoading()
          ? h(
              'span',
              { style: { 'margin-left': '8px', color: COLOR.pending, 'font-size': '12px' } },
              'first load',
            )
          : null,
      () =>
        u.isRefetching()
          ? h(
              'span',
              { style: { 'margin-left': '8px', color: COLOR.pending, 'font-size': '12px' } },
              'refetching ⟳',
            )
          : null,
    ),
    section(
      'Params',
      h('pre', { style: preStyle }, () => json(u.params())),
    ),
    section(
      'Data',
      h('pre', { style: preStyle }, () => json(u.data())),
    ),
    () =>
      u.error() != null
        ? section(
            'Error',
            h('pre', { style: { ...preStyle, color: COLOR.fail } }, () =>
              json((u.error() as Error)?.message ?? u.error()),
            ),
          )
        : null,
    section(
      'Log',
      h('div', { style: preStyle }, () =>
        log().length === 0
          ? h('span', { style: { color: '#5c5f66' } }, 'no activity yet')
          : log().map((e) =>
              h(
                'div',
                { style: { color: e.type === 'fail' ? COLOR.fail : '#c1c2c5' } },
                h('span', { style: { color: '#868e96' } }, e.type),
                e.attempt != null ? ` #${e.attempt}` : '',
                e.durationMs != null ? ` (${e.durationMs}ms)` : '',
              ),
            ),
      ),
    ),
  );
}

export interface EffectorQueryDevtoolsProps {
  /** Queries to inspect, keyed by display name. */
  queries: Record<string, AnyQuery>;
  initialIsOpen?: boolean;
  position?: 'bottom-right' | 'bottom-left';
}

export function EffectorQueryDevtools(props: EffectorQueryDevtoolsProps) {
  const keys = () => Object.keys(props.queries);
  const [open, setOpen] = createSignal(props.initialIsOpen ?? false);
  const [selected, setSelected] = createSignal<string>(Object.keys(props.queries)[0] ?? '');

  const container = () => ({
    position: 'fixed',
    bottom: '12px',
    ...(props.position === 'bottom-left' ? { left: '12px' } : { right: '12px' }),
    'z-index': '99999',
    font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  });

  const activeKey = () => (keys().includes(selected()) ? selected() : (keys()[0] ?? ''));

  const pill = () =>
    h(
      'button',
      {
        type: 'button',
        onClick: () => setOpen(true),
        'data-testid': 'eq-devtools-toggle',
        style: {
          display: 'flex',
          'align-items': 'center',
          gap: '6px',
          padding: '6px 12px',
          border: 'none',
          'border-radius': '999px',
          background: '#1a1b1e',
          color: '#ffd8a8',
          cursor: 'pointer',
          'box-shadow': '0 2px 12px rgba(0,0,0,.35)',
        },
      },
      () => `⚡ queries (${keys().length})`,
    );

  const panel = () =>
    h(
      'div',
      {
        style: {
          width: '540px',
          height: '360px',
          display: 'flex',
          'flex-direction': 'column',
          background: '#1a1b1e',
          color: '#e9ecef',
          border: '1px solid #2b2c30',
          'border-radius': '10px',
          overflow: 'hidden',
          'box-shadow': '0 8px 32px rgba(0,0,0,.45)',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            'align-items': 'center',
            padding: '8px 12px',
            'border-bottom': '1px solid #2b2c30',
          },
        },
        h('strong', { style: { color: '#ffd8a8' } }, 'effector-refetch'),
        h('span', { style: { 'margin-left': '8px', color: '#868e96' } }, 'devtools'),
        h(
          'button',
          {
            type: 'button',
            onClick: () => setOpen(false),
            'data-testid': 'eq-devtools-close',
            style: {
              'margin-left': 'auto',
              border: 'none',
              background: 'transparent',
              color: '#868e96',
              cursor: 'pointer',
            },
          },
          '✕',
        ),
      ),
      h(
        'div',
        { style: { display: 'flex', flex: '1', 'min-height': '0' } },
        h(
          'div',
          {
            style: {
              width: '170px',
              'border-right': '1px solid #2b2c30',
              overflow: 'auto',
              padding: '4px 0',
            },
          },
          () =>
            keys().map((key) =>
              h(QueryRow, {
                label: key,
                query: props.queries[key],
                active: () => key === activeKey(),
                onSelect: (k: string) => setSelected(k),
              }),
            ),
        ),
        () =>
          activeKey()
            ? h(QueryDetail, { label: activeKey(), query: props.queries[activeKey()] })
            : h('div', { style: { flex: '1', padding: '12px', color: '#5c5f66' } }, 'No queries.'),
      ),
    );

  return h('div', { style: container, 'data-testid': 'eq-devtools' }, () => (open() ? panel() : pill()));
}
