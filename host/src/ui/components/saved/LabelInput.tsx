import { useEffect, useRef, useState } from 'react';

type Props = {
  label: string;
  onSave: (label: string) => void;
  onCancel: () => void;
};

/** Editing the name of a starred code: Enter or leaving the field saves, Escape cancels. */
export const LabelInput = ({ label, onSave, onCancel }: Props) => {
  const [draft, setDraft] = useState(label);
  // Enter and Escape both remove the field, and a browser may report that as a blur; this keeps the
  // blur from saving a second time, or at all after Escape.
  const isDoneRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focused with the old name selected, so typing replaces it and an arrow key keeps it.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const finish = (shouldSave: boolean) => {
    if (isDoneRef.current) {
      return;
    }

    isDoneRef.current = true;

    if (shouldSave) {
      onSave(draft);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="LabelInput"
      value={draft}
      placeholder="Name, e.g. expired ticket"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          finish(true);
        } else if (event.key === 'Escape') {
          finish(false);
        }
      }}
    />
  );
};
