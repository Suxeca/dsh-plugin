#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScienceMap } from '../src/validator.mjs';
import { compileScienceMapToHtml } from '../src/compiler.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
Science Map CLI

Usage:
  science-map doctor
  science-map validate <input.json> [--json]
  science-map compile <input.json> <output.html> [--assets <dir>]

Commands:
  doctor     Verify compiler and schema components
  validate   Validate a Science Map IR specification
  compile    Compile a Science Map JSON IR into a standalone interactive HTML
`);
}

if (!command || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'doctor') {
  console.log('Science Map Doctor');
  console.log('[ok] Node.js', process.version);
  const schemaPath = resolve(__dirname, '../schemas/science-map.schema.json');
  console.log(existsSync(schemaPath) ? '[ok] Schema found' : '[fail] Schema missing');
  console.log('[ok] Validator runtime ready');
  console.log('[ok] Visual compiler runtime ready');
  console.log('Science Map environment is ready.');
  process.exit(0);
}

if (command === 'validate') {
  const filePath = args[1];
  if (!filePath) {
    console.error('Error: missing <input.json> path');
    process.exit(1);
  }
  const isJson = args.includes('--json');
  try {
    const raw = readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const report = validateScienceMap(data);
    if (isJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      if (report.ok) {
        console.log(`[PASS] Validation passed: ${report.summary.nodeCount} nodes, ${report.summary.edgeCount} edges, 0 errors, ${report.summary.warnings} warnings.`);
      } else {
        console.error(`[FAIL] Validation failed with ${report.summary.errors} error(s):`);
        for (const diag of report.diagnostics) {
          console.error(`  - [${diag.code}] ${diag.message}`);
        }
      }
    }
    process.exit(report.ok ? 0 : 1);
  } catch (err) {
    console.error('Validation error:', err.message);
    process.exit(1);
  }
}

if (command === 'compile') {
  const inputPath = args[1];
  const outputPath = args[2];
  if (!inputPath || !outputPath) {
    console.error('Error: compile requires <input.json> and <output.html>');
    process.exit(1);
  }

  let assetsRoot = dirname(resolve(inputPath));
  const assetsIdx = args.indexOf('--assets');
  if (assetsIdx !== -1 && args[assetsIdx + 1]) {
    assetsRoot = resolve(args[assetsIdx + 1]);
  }

  try {
    const raw = readFileSync(inputPath, 'utf8');
    const spec = JSON.parse(raw);

    const report = validateScienceMap(spec);
    if (!report.ok) {
      console.error('[FAIL] Cannot compile invalid Science Map specification:');
      for (const diag of report.diagnostics) {
        console.error(`  - [${diag.code}] ${diag.message}`);
      }
      process.exit(1);
    }

    const html = compileScienceMapToHtml(spec, { assetsRoot });
    writeFileSync(outputPath, html, 'utf8');
    console.log(`[OK] Compiled Science Map successfully to: ${outputPath} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB)`);
    process.exit(0);
  } catch (err) {
    console.error('Compile error:', err);
    process.exit(1);
  }
}

console.error(`Unknown command: ${command}`);
printHelp();
process.exit(1);
