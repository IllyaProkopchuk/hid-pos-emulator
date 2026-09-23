import type { LogEntry as LogEntryData } from '@shared/uiProtocol';

import { getHexPreview, isHexDetail } from '@/utils/format';

type Props = {
  entry: LogEntryData;
  isExpanded: boolean;
  onToggle: () => void;
};

export const LogEntry = ({ entry, isExpanded, onToggle }: Props) => {
  // The per-report lines the host logs under a scan are indented beneath it.
  const isNested = entry.message.startsWith('report ');
  const isCollapsible = entry.detail !== undefined && isHexDetail(entry.detail);

  return (
    <div className={'Entry Direction-' + entry.direction + (isNested ? ' Entry-nested' : '')}>
      <div className="EntryHead">
        <span className="EntryTime">{entry.time}</span>
        <span className="EntryMessage">{entry.message}</span>
      </div>
      {entry.detail && (
        <div
          className={isCollapsible ? 'EntryDetail EntryDetail-clickable' : 'EntryDetail'}
          title={isCollapsible ? 'Click to expand or collapse' : undefined}
          onClick={isCollapsible ? onToggle : undefined}
        >
          {isCollapsible && !isExpanded ? getHexPreview(entry.detail) : entry.detail}
        </div>
      )}
    </div>
  );
};
