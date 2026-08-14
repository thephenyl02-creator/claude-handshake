import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        // Test-only value for the deploy-time secret. Production sets it with
        // `wrangler secret put RELAY_CREATE_TOKEN`; it is deliberately absent
        // from wrangler.toml so a real deploy fails closed until it is set.
        bindings: { RELAY_CREATE_TOKEN: 'test-create-token-not-a-real-secret' }
      }
    })
  ],
  test: {
    include: ['test/worker/**/*.test.js'],
    // Some tests post tens of messages through the full Worker + Durable
    // Object path; 5s is not enough on a loaded machine.
    testTimeout: 30000
  }
});
