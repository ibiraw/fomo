/**
 * @file artifact-page.mjs
 * @description Turns the single-file build (dist-artifact/index.html) into a Claude artifact page
 *              (dist-artifact/limit.html): the artifact host supplies <html>/<head>/<body> itself, so only
 *              the head contents (title first) and the body contents are kept.
 * @author Reborn1987
 */

import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-artifact/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!head || !body) throw new Error('dist-artifact/index.html has no <head>/<body> — run the single-file build first');
const title = head.match(/<title>[\s\S]*?<\/title>/)?.[0] ?? '<title>limit</title>';
const rest = head.replace(title, '').replace(/<meta charset="[^"]*"\s*\/?>/i, '').replace(/<meta name="viewport"[^>]*>/i, '');
writeFileSync('dist-artifact/limit.html', `${title}\n${rest}\n${body}`);
console.log(`dist-artifact/limit.html written (${((title.length + rest.length + body.length) / 1024).toFixed(0)} KB)`);
