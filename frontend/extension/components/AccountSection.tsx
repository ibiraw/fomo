/**
 * @file AccountSection.tsx
 * @description Settings → Account: detected wallets (editable), backup code (show / copy / restore), delete account,
 *              and the server address on development builds. Also exports NoAccount for when there is no usable key.
 * @author Reborn1987
 */

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SendFn } from '@/hooks/use-background';
import { shortAddress, type AccountView } from '@/lib/account';
import { HOSTED_SERVER_URL } from '@/lib/messages';

interface Props {
  readonly account: AccountView | null;
  readonly serverUrl: string;
  readonly send: SendFn;
}

/** A small secondary action that looks like a button. */
function Action({ children, onClick, danger = false }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
        danger ? 'border-sell/40 text-sell hover:bg-sell/10' : 'border-border bg-secondary hover:border-foreground/40 hover:bg-accent'
      }`}
    >
      {children}
    </button>
  );
}

/** Restore form: paste a backup code to log into that account on this browser. */
function RestoreForm({ send, onDone }: { send: SendFn; onDone?: () => void }) {
  const [code, setCode] = useState('');
  const restore = useMutation({ mutationFn: () => send({ type: 'account.restore', key: code }), onSuccess: () => { setCode(''); onDone?.(); } });
  return (
    <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); restore.mutate(); }}>
      <div className="flex gap-1.5">
        <Input aria-label="Backup code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste a backup code" className="h-8 text-xs" />
        <Button type="submit" size="sm" disabled={!code.trim() || restore.isPending}>{restore.isPending ? '…' : 'Restore'}</Button>
      </div>
      {restore.error && <p className="text-xs text-sell">{restore.error.message}</p>}
    </form>
  );
}

/** Wallet addresses: shows what was detected on fomo; lets the user correct them. */
function WalletsBlock({ account, send }: { account: AccountView | null; send: SendFn }) {
  const [editing, setEditing] = useState(false);
  const [solana, setSolana] = useState('');
  const [evm, setEvm] = useState('');
  const save = useMutation({
    mutationFn: () => send({ type: 'wallets.set', wallets: { solana: solana.trim() || null, evm: evm.trim() || null } }),
    onSuccess: () => setEditing(false),
  });
  const w = account?.wallets;

  if (editing) {
    return (
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Input aria-label="Solana wallet" value={solana} onChange={(e) => setSolana(e.target.value)} placeholder="Solana address" className="h-8 text-xs" />
        <Input aria-label="EVM wallet" value={evm} onChange={(e) => setEvm(e.target.value)} placeholder="EVM address (0x…)" className="h-8 text-xs" />
        <div className="flex gap-1.5">
          <Button type="submit" size="sm" disabled={save.isPending}>Save</Button>
          <Action onClick={() => setEditing(false)}>Cancel</Action>
        </div>
        {save.error && <p className="text-xs text-sell">{save.error.message}</p>}
      </form>
    );
  }
  return (
    <div className="flex items-start justify-between gap-2">
      <dl className="grid grid-cols-[3.5rem_1fr] gap-x-2 gap-y-0.5 text-xs">
        <dt className="text-muted-foreground">Solana</dt>
        <dd className="font-mono">{w?.solana ? shortAddress(w.solana) : <span className="text-muted-foreground">not found yet</span>}</dd>
        <dt className="text-muted-foreground">EVM</dt>
        <dd className="font-mono">{w?.evm ? shortAddress(w.evm) : <span className="text-muted-foreground">not found yet</span>}</dd>
      </dl>
      <Action onClick={() => { setSolana(w?.solana ?? ''); setEvm(w?.evm ?? ''); setEditing(true); }}>Edit</Action>
    </div>
  );
}

/** Settings → Account. */
export function AccountSection({ account, serverUrl, send }: Props) {
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [url, setUrl] = useState(serverUrl);
  const del = useMutation({ mutationFn: () => send({ type: 'account.delete' }) });
  const saveUrl = useMutation({ mutationFn: () => send({ type: 'settings.save', serverUrl: url }) });

  /** Loads and shows the backup code. */
  const reveal = async (): Promise<void> => setCode(((await send({ type: 'account.key' })) as string | null) ?? null);

  /** Copies the code; falls back to leaving it selectable. */
  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Account</h2>
        <p className="text-xs text-muted-foreground">No sign-up: this browser has its own account. Your wallets are read from your fomo login.</p>
      </div>

      {account && (
        <p className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Your ID</span>
          <code className="rounded bg-secondary px-1.5 py-0.5 font-semibold select-all">{account.shortId}</code>
          <span className="text-[11px] text-muted-foreground">— mention it if you contact support</span>
        </p>
      )}
      {account?.fomoUsername && (
        <p className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">fomo</span>
          <span className="font-semibold">@{account.fomoUsername}</span>
        </p>
      )}
      <WalletsBlock account={account} send={send} />

      <div className="space-y-1.5">
        <p className="text-xs font-medium">Backup code</p>
        <p className="text-[11px] text-muted-foreground">Use it to get your orders back after reinstalling, or on another computer. Keep it private — it is your login.</p>
        {code ? (
          <div className="space-y-1.5">
            <code className="block break-all rounded-md bg-secondary p-2 text-[11px] select-all">{code}</code>
            <div className="flex gap-1.5">
              <Action onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</Action>
              <Action onClick={() => setCode(null)}>Hide</Action>
            </div>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <Action onClick={() => void reveal()}>Show backup code</Action>
            <Action onClick={() => setRestoring((r) => !r)}>Restore from a code</Action>
          </div>
        )}
        {restoring && <RestoreForm send={send} onDone={() => setRestoring(false)} />}
      </div>

      <div className="space-y-1.5">
        {confirmDelete ? (
          <div className="space-y-1.5 rounded-md border border-sell/40 p-2">
            <p className="text-xs">Delete this account? Your open orders are cancelled and your wallets and backup code stop working. This can't be undone.</p>
            <div className="flex gap-1.5">
              <Action danger onClick={() => del.mutate()}>{del.isPending ? 'Deleting…' : 'Delete my account'}</Action>
              <Action onClick={() => setConfirmDelete(false)}>Keep my account</Action>
            </div>
            {del.error && <p className="text-xs text-sell">{del.error.message}</p>}
          </div>
        ) : (
          <Action danger onClick={() => setConfirmDelete(true)}>Delete my account</Action>
        )}
      </div>

      {!HOSTED_SERVER_URL && (
        <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); saveUrl.mutate(); }}>
          <p className="text-xs font-medium">Server address (development build)</p>
          <div className="flex gap-1.5">
            <Input aria-label="Server address" value={url} onChange={(e) => setUrl(e.target.value)} className="h-8 text-xs" />
            <Button type="submit" size="sm" disabled={saveUrl.isPending}>Save</Button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Shown when there is no usable account key (deleted here or elsewhere, or rejected by the server). */
export function NoAccount({ reason, send }: { reason: 'deleted' | 'rejected'; send: SendFn }) {
  const create = useMutation({ mutationFn: () => send({ type: 'account.new' }) });
  return (
    <div className="space-y-3">
      <p className="text-sm">{reason === 'deleted' ? 'Your account was deleted.' : "The server didn't accept this browser's account key."}</p>
      <Button className="w-full" onClick={() => create.mutate()} disabled={create.isPending}>Start a new account</Button>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Or restore an existing account with its backup code:</p>
        <RestoreForm send={send} />
      </div>
    </div>
  );
}
