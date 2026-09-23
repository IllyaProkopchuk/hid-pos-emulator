import { useLayoutEffect, useRef, useState } from 'react';

import type { LogEntry as LogEntryData } from '@shared/uiProtocol';

import { LogEntry } from '@/components/log/LogEntry';

/** How close to the bottom, in pixels, still counts as following the log. */
const PINNED_THRESHOLD_PX = 40;

type Props = {
  entries: Array<LogEntryData>;
  onClear: () => void;
};

/** Traffic log. Follows new entries until the user scrolls up, then offers a way back down. */
export const Log = ({ entries, onClear }: Props) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [isFromAppOnly, setIsFromAppOnly] = useState(false);
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<number>>(new Set());
  // A ref as well as state: the scroll handler has to read it synchronously, the button renders it.
  const isPinnedRef = useRef(true);
  const [isPinned, setIsPinned] = useState(true);

  const visible = isFromAppOnly ? entries.filter((entry) => entry.direction === 'fromApp') : entries;

  // Keyed on the newest id rather than the count, because a capped log gains an entry without growing.
  const newestId = visible[visible.length - 1]?.id;

  const setPinned = (value: boolean) => {
    isPinnedRef.current = value;
    setIsPinned(value);
  };

  const scrollToBottom = () => {
    const log = logRef.current;

    if (log) {
      log.scrollTop = log.scrollHeight;
    }
  };

  useLayoutEffect(() => {
    if (isPinnedRef.current) {
      scrollToBottom();
    }
  }, [newestId, visible.length, expandedIds]);

  const toggleExpanded = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  return (
    <section>
      <div className="LogHeader">
        <h2>Log</h2>
        <button
          type="button"
          onClick={() => {
            setExpandedIds(new Set());
            onClear();
          }}
        >
          Clear
        </button>
      </div>
      <div className="LogControls">
        <label>
          <input
            type="checkbox"
            checked={isFromAppOnly}
            onChange={(event) => setIsFromAppOnly(event.target.checked)}
          />{' '}
          fromApp only
        </label>
      </div>
      <div
        ref={logRef}
        className="Log"
        onScroll={(event) => {
          const log = event.currentTarget;

          setPinned(log.scrollHeight - log.scrollTop - log.clientHeight < PINNED_THRESHOLD_PX);
        }}
      >
        {visible.length === 0 ? (
          <div className="Empty">No traffic yet</div>
        ) : (
          visible.map((entry) => (
            <LogEntry
              key={entry.id}
              entry={entry}
              isExpanded={expandedIds.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))
        )}
      </div>
      <button
        type="button"
        className="JumpToLatest"
        hidden={isPinned}
        onClick={() => {
          setPinned(true);
          scrollToBottom();
        }}
      >
        Jump to latest
      </button>
    </section>
  );
};
