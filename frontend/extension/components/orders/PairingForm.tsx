/**
 * @file PairingForm.tsx
 * @description Server URL + pairing code form shown until the extension is paired with the local server.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  readonly serverUrl: string;
  readonly badToken: boolean;
  readonly onSave: (serverUrl: string, token: string) => Promise<unknown>;
}

/** Lets the user paste the pairing code printed by the server. */
export function PairingForm({ serverUrl, badToken, onSave }: Props) {
  const [url, setUrl] = useState(serverUrl);
  const [token, setToken] = useState('');
  const save = useMutation({ mutationFn: () => onSave(url, token) });

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="text-sm text-muted-foreground">
        Start the server on your PC (<code>npm run dev</code> in <code>backend/</code>) and paste the pairing code it prints.
      </p>
      {badToken && <p className="text-sm text-destructive">That pairing code was rejected. Check it and try again.</p>}
      <div className="space-y-1.5">
        <Label htmlFor="token">Pairing code</Label>
        <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste pairing code" autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="url">Server address</Label>
        <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} />
      </div>
      {save.error && <p className="text-sm text-destructive">{save.error.message}</p>}
      <Button type="submit" className="w-full" disabled={!token.trim() || save.isPending}>
        {save.isPending ? 'Connecting…' : 'Connect'}
      </Button>
    </form>
  );
}
