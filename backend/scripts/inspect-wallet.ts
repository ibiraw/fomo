/**
 * @file inspect-wallet.ts
 * @description Dev tool: list a wallet's SOL/USDC and token holdings (both token programs). Usage: tsx scripts/inspect-wallet.ts <wallet> [mint]
 * @author Reborn1987
 */
import { address, createSolanaRpc } from '@solana/kit';

const [wallet, mint] = process.argv.slice(2);
if (!wallet) throw new Error('Usage: inspect-wallet <wallet> [mint]');
const rpc = createSolanaRpc(process.env.SOLANA_RPC_HTTP!);
const bal = await rpc.getBalance(address(wallet)).send();
console.log('SOL', Number(bal.value) / 1e9);
for (const programId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
  const res = await rpc.getTokenAccountsByOwner(address(wallet), { programId: address(programId) }, { encoding: 'jsonParsed' }).send();
  const rows = res.value.map((a) => (a.account.data as any).parsed.info).filter((i: any) => Number(i.tokenAmount.amount) > 0);
  console.log(programId.slice(0, 8), 'accounts with balance:', rows.length);
  for (const i of rows.slice(0, 15)) console.log('  ', i.mint, i.tokenAmount.uiAmountString, mint && i.mint === mint ? '<== target' : '');
}
