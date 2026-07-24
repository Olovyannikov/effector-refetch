import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useUnit, useProvidedScope } from 'effector-react';
import type { Query, QueryStatus } from './types';
import { attachQueryLogger, type QueryLogEntry } from './inspect';

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

function Dot({ status }: { status: QueryStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 9,
        height: 9,
        borderRadius: '50%',
        background: COLOR[status],
        marginRight: 8,
        flex: '0 0 auto',
      }}
    />
  );
}

function QueryRow({
  name,
  query,
  active,
  onSelect,
}: {
  name: string;
  query: AnyQuery;
  active: boolean;
  onSelect: () => void;
}) {
  const { status, pending } = useUnit(query);
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        padding: '6px 10px',
        border: 'none',
        background: active ? '#2b2c30' : 'transparent',
        color: '#e9ecef',
        cursor: 'pointer',
        font: 'inherit',
        textAlign: 'left',
      }}
    >
      <Dot status={status} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      {pending && <span style={{ marginLeft: 'auto', color: COLOR.pending }}>•••</span>}
    </button>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          color: '#868e96',
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          marginBottom: 4,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: 8,
  background: '#101113',
  borderRadius: 6,
  color: '#c1c2c5',
  fontSize: 12,
  maxHeight: 160,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

function QueryDetail({ name, query }: { name: string; query: AnyQuery }) {
  const state = useUnit(query) as {
    data: unknown;
    error: unknown;
    status: QueryStatus;
    pending: boolean;
    isInitialLoading: boolean;
    isRefetching: boolean;
    params: unknown;
  };
  const [log, setLog] = useState<QueryLogEntry[]>([]);
  // scope-aware: in a forked app the panel reads provider-scoped state, so the log
  // must come from the same scope (a scope-blind logger would mix every fork's runs)
  const scope = useProvidedScope();

  useEffect(() => {
    setLog([]);
    return attachQueryLogger(query, {
      name,
      scope: scope ?? undefined,
      handler: (entry) => setLog((prev) => [...prev.slice(-49), entry]),
    });
  }, [query, name, scope]);

  return (
    <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <Dot status={state.status} />
        <strong style={{ marginRight: 8 }}>{name}</strong>
        <span style={{ color: COLOR[state.status], fontSize: 12 }}>{state.status}</span>
        {state.isInitialLoading && (
          <span style={{ marginLeft: 8, color: COLOR.pending, fontSize: 12 }}>first load</span>
        )}
        {state.isRefetching && (
          <span style={{ marginLeft: 8, color: COLOR.pending, fontSize: 12 }}>refetching ⟳</span>
        )}
      </div>
      <Section title="Params">
        <pre style={preStyle}>{json(state.params)}</pre>
      </Section>
      <Section title="Data">
        <pre style={preStyle}>{json(state.data)}</pre>
      </Section>
      {state.error != null && (
        <Section title="Error">
          <pre style={{ ...preStyle, color: COLOR.fail }}>
            {json((state.error as Error)?.message ?? state.error)}
          </pre>
        </Section>
      )}
      <Section title="Log">
        <div style={preStyle as CSSProperties}>
          {log.length === 0 && <span style={{ color: '#5c5f66' }}>no activity yet</span>}
          {log.map((e, i) => (
            <div key={i} style={{ color: e.type === 'fail' ? COLOR.fail : '#c1c2c5' }}>
              <span style={{ color: '#868e96' }}>{e.type}</span>
              {e.attempt != null ? ` #${e.attempt}` : ''}
              {e.durationMs != null ? ` (${e.durationMs}ms)` : ''}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

export interface EffectorQueryDevtoolsProps {
  /** Queries to inspect, keyed by display name. */
  queries: Record<string, AnyQuery>;
  initialIsOpen?: boolean;
  position?: 'bottom-right' | 'bottom-left';
}

/**
 * A floating devtools panel (TanStack-style) listing queries with live status,
 * params, data, error and a per-query event log. React-only — import from
 * `effector-refetch/devtools`. Scope-aware via effector-react's `<Provider>`.
 */
export function EffectorQueryDevtools({
  queries,
  initialIsOpen = false,
  position = 'bottom-right',
}: EffectorQueryDevtoolsProps) {
  const keys = Object.keys(queries);
  const [open, setOpen] = useState(initialIsOpen);
  const [selected, setSelected] = useState<string>(keys[0] ?? '');

  const side = position === 'bottom-left' ? { left: 12 } : { right: 12 };
  const container: CSSProperties = {
    position: 'fixed',
    bottom: 12,
    ...side,
    zIndex: 99999,
    font: '13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
  };

  if (!open) {
    return (
      <div style={container} data-testid="eq-devtools">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-testid="eq-devtools-toggle"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            border: 'none',
            borderRadius: 999,
            background: '#1a1b1e',
            color: '#ffd8a8',
            cursor: 'pointer',
            boxShadow: '0 2px 12px rgba(0,0,0,.35)',
          }}
        >
          ⚡ queries ({keys.length})
        </button>
      </div>
    );
  }

  const activeKey = keys.includes(selected) ? selected : (keys[0] ?? '');

  return (
    <div style={container} data-testid="eq-devtools">
      <div
        style={{
          width: 540,
          height: 360,
          display: 'flex',
          flexDirection: 'column',
          background: '#1a1b1e',
          color: '#e9ecef',
          border: '1px solid #2b2c30',
          borderRadius: 10,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,.45)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid #2b2c30',
          }}
        >
          <strong style={{ color: '#ffd8a8' }}>effector-refetch</strong>
          <span style={{ marginLeft: 8, color: '#868e96' }}>devtools</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            data-testid="eq-devtools-close"
            style={{
              marginLeft: 'auto',
              border: 'none',
              background: 'transparent',
              color: '#868e96',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
          <div style={{ width: 170, borderRight: '1px solid #2b2c30', overflow: 'auto', padding: '4px 0' }}>
            {keys.map((key) => (
              <QueryRow
                key={key}
                name={key}
                query={queries[key]}
                active={key === activeKey}
                onSelect={() => setSelected(key)}
              />
            ))}
          </div>
          {activeKey ? (
            <QueryDetail key={activeKey} name={activeKey} query={queries[activeKey]} />
          ) : (
            <div style={{ flex: 1, padding: 12, color: '#5c5f66' }}>No queries.</div>
          )}
        </div>
      </div>
    </div>
  );
}
