#!/usr/bin/env node
'use strict';
/* Usage: node tools/compact-fastlane.js <fast_lane.ai> [out.json]  (~220 pts, corners on FULL resolution) */
const fs=require('node:fs');
const {parseFastLane,compactFastLane}=require('./lib/fastLane');
const [input,output]=process.argv.slice(2);
if(!input){ console.error('Usage: node tools/compact-fastlane.js <fast_lane.ai> [out.json]'); process.exit(2); }
const compact=compactFastLane(parseFastLane(fs.readFileSync(input)));
const json=JSON.stringify(compact,null,2);
if(output) fs.writeFileSync(output,json); else process.stdout.write(json+'\n');
console.error(`Compacté: ${compact.sourcePointCount} -> ${compact.pointCount} points, ${compact.corners.length} virages`);
