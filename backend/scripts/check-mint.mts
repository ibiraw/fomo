/**
 * @file check-mint.mts
 * @description Checks a Solana address is a token mint and prints decimals, supply and token program.
 *              npx tsx --env-file=.env scripts/check-mint.mts <mint>   (exit 1 when it isn't a mint)
 * @author Reborn1987
 */
import { address, createSolanaRpc } from '@solana/kit';
const ca = process.argv[2]!;
const rpc = createSolanaRpc(process.env.SOLANA_RPC_HTTP!);
const r = await rpc.getAccountInfo(address(ca), { encoding: 'jsonParsed' }).send();
const data = r.value?.data as { parsed?: { type?: string; info?: { decimals: number; supply: string } } } | undefined;
if (!data?.parsed || data.parsed.type !== 'mint') { console.error('✖ not a token mint on Solana'); process.exit(1); }
console.log(`✔ mint · decimals ${data.parsed.info!.decimals} · supply ${data.parsed.info!.supply} · program ${r.value!.owner}`);
