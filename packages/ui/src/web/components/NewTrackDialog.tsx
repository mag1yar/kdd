import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createTrack, type Track } from '../api';

export function NewTrackDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: (t: Track) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => { if (open) { setName(''); setDescription(''); } }, [open]);

  const create = () => {
    if (!name.trim()) return;
    createTrack({ name, description: description || undefined })
      .then((t) => { onCreated(t); onClose(); })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New track</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2">
          <Input
            autoFocus value={name} placeholder="Name (e.g. Основной бэк)"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
          <Textarea
            rows={3} value={description}
            placeholder='"use when…" — routing hint for the agent (optional)'
            onChange={(e) => setDescription(e.target.value)}
          />
          <div><Button size="sm" onClick={create}>Create</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
