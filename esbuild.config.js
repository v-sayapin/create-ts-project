import { rm } from 'node:fs/promises';
import process from 'node:process';

import { build, context } from 'esbuild';

const isProduction = process.env.NODE_ENV === 'production';
const isWatch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').BuildOptions}
 */
const options = {
	entryPoints: ['src/index.ts'],
	outfile: 'dist/index.js',
	platform: 'node',
	target: 'node22',
	format: 'esm',
	bundle: true,
	minify: isProduction,
	sourcemap: !isProduction,
	banner: { js: '#!/usr/bin/env node' },
	packages: isProduction ? 'bundle' : 'external',
	logLevel: 'info',
};

if (isWatch) {
	/**
	 * @type {import('esbuild').BuildContext}
	 */
	const ctx = await context(options);
	await ctx.watch();
} else {
	await rm('dist', { recursive: true, force: true });
	await build(options);
}
