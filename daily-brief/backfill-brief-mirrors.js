#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { getExistingBriefResult, saveBriefToFirestore } = require('./generate-brief');

async function main() {
  const outputDir = process.env.OUTPUT_DIR
    ? path.resolve(process.env.OUTPUT_DIR)
    : path.join(__dirname, 'output');

  const entries = fs.existsSync(outputDir)
    ? fs.readdirSync(outputDir, { withFileTypes: true })
    : [];
  const targetDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (targetDirs.length === 0) {
    console.log('No brief directories found.');
    return;
  }

  for (const ymd of targetDirs) {
    const result = getExistingBriefResult(ymd);
    if (!result.exists) {
      continue;
    }
    await saveBriefToFirestore(result);
    console.log(`Backfilled ${ymd}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
