import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PRIORITIES, createTask, type Priority } from '../api';

export function NewTaskDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');

  const create = () => {
    createTask({ title, body: body || undefined, priority })
      .then(() => {
        setTitle(''); setBody(''); setPriority('medium');
        onCreated(); onClose();
      })
      .catch((e: Error) => toast.error(e.message));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>New task</DialogTitle></DialogHeader>
        <div className="flex flex-col gap-2">
          <Input value={title} placeholder="Title" onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            rows={6} value={body} placeholder="markdown body (optional)"
            onChange={(e) => setBody(e.target.value)}
          />
          <Select value={priority} onValueChange={(v) => setPriority(v as Priority)}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectGroup>
            </SelectContent>
          </Select>
          <div>
            <Button size="sm" onClick={create}>Create</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
