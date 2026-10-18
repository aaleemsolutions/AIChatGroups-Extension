/**
 * Master Test Runner for Gemini Chat Folders Firefox Extension
 */

const { spawnSync } = require('child_process');
const path = require('path');

console.log('====================================================');
console.log('🦊 Gemini Chat Folders - Full Extension Test Suite');
console.log('====================================================\n');

let allPassed = true;

// 1. Run Unit Tests (Storage & Multi-Device Sync Engine)
console.log('--- 1. Storage & Firefox Sync Engine Tests ---');
const unitRes = spawnSync(process.execPath, [path.join(__dirname, 'storage-sync.test.js')], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});
if (unitRes.status !== 0) {
  allPassed = false;
  console.error('❌ Storage Sync unit tests failed!\n');
} else {
  console.log('✅ Unit Tests Passed Successfully!\n');
}

// 2. Run DOM Integration Tests (Real Gemini Sidebar DOM Snippet)
console.log('--- 2. Gemini Live DOM Integration Tests ---');
const domRes = spawnSync(process.execPath, [path.join(__dirname, 'dom-integration.test.js')], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});
if (domRes.status !== 0) {
  allPassed = false;
  console.error('❌ DOM Integration tests failed!\n');
} else {
  console.log('✅ DOM Integration Tests Passed Successfully!\n');
}

// 3. Run Persistence & Strict Mutation Tests
console.log('--- 3. Storage Persistence & Immutability Tests ---');
const persRes = spawnSync(process.execPath, [path.join(__dirname, 'persistence.test.js')], {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..')
});
if (persRes.status !== 0) {
  allPassed = false;
  console.error('❌ Persistence tests failed!\n');
} else {
  console.log('✅ Persistence & Immutability Tests Passed Successfully!\n');
}

console.log('====================================================');
if (allPassed) {
  console.log('🏆 ALL TEST SUITES PASSED! Extension is fully verified.');
  console.log('====================================================');
  process.exit(0);
} else {
  console.log('❌ SOME TESTS FAILED.');
  console.log('====================================================');
  process.exit(1);
}
