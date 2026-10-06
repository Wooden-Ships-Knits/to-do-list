import { useCallback, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { CheckList } from '../../components/ui/CheckList';
import { Popover } from '../../components/ui/Popover';
import { COLUMN_LABELS } from '../../lib/columnSettings';
import type { ColumnId, ColumnSettings } from '../../lib/columnSettings';

interface Props {
  order: ColumnId[];
  settings: ColumnSettings;
  onChange: (visibility: Record<ColumnId, boolean>) => void;
  onReset: () => void;
}

export function ColumnChooser({ order, settings, onChange, onReset }: Props) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const selected = order.filter((id) => settings.visibility[id]);
  return (
    <>
      <Button
        ref={setAnchor}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Columns
      </Button>
      <Popover anchor={anchor} open={open} onClose={close} label="Choose columns" align="end">
        <CheckList
          legend="Show columns"
          options={order.map((id) => ({ value: id, label: COLUMN_LABELS[id] }))}
          selected={selected}
          onChange={(next) => {
            if (next.length === 0) return; // at least one column stays visible
            const visibility = { ...settings.visibility };
            for (const id of order) visibility[id] = next.includes(id);
            onChange(visibility);
          }}
        />
        <div style={{ paddingTop: 8 }}>
          <Button variant="ghost" onClick={onReset}>
            Reset to default
          </Button>
        </div>
      </Popover>
    </>
  );
}
