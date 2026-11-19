// Runs only the parity dump, never the extension's own tests.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['ios/scripts/parity/*.test.ts'], root: '.' } });
