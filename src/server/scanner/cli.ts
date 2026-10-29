#!/usr/bin/env tsx
/**
 * TeleBhaja — CLI Scanner
 * Usage: npx tsx src/server/scanner/cli.ts [path]
 *        npm run scan [-- /path/to/media]
 */

import { scanner } from './scanner.js';
import { config } from '../config.js';

const mediaPath = process.argv[2] ?? config.mediaStoragePath;

console.log(`\n🎬 TeleBhaja CLI Scanner`);
console.log(`📁 Scanning: ${mediaPath}\n`);

scanner.on('log', (msg: string) => {
  process.stdout.write(`  ${msg}\n`);
});

scanner.on('status', (status) => {
  if (status.running) {
    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
    process.stdout.write(
      `  Progress: ${status.progress}% (${status.scannedCount}/${status.totalFound}) | ${status.currentFile?.split(/[\\/]/).pop() ?? ''}`
    );
  }
});

scanner.on('error', (err: Error) => {
  console.error(`\n❌ Error: ${err.message}`);
});

scanner.on('complete', (status: any) => {
  process.stdout.write('\n');
  console.log(`\n✅ Scan complete!`);
  console.log(`   Files processed: ${status.scannedCount}/${status.totalFound}`);
  if (status.errors && status.errors.length > 0) {
    console.log(`   Errors (${status.errors.length}):`);
    status.errors.slice(0, 10).forEach((e: string) => console.log(`     • ${e}`));
  }
  process.exit(0);
});

scanner.scan(mediaPath).catch((err: Error) => {
  console.error('Fatal scan error:', err.message);
  process.exit(1);
});
