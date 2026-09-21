/** The webpack build emits one generated package.json per app, each listing only what that
 *  bundle requires at runtime. The standalone image runs both apps out of one directory, so the
 *  two lists are merged into a single install instead of two node_modules trees.
 *
 *  Both files are generated from the same lockfile, so a package appearing in both must appear
 *  at the same version - if it ever does not, the merge is wrong and the build stops rather
 *  than silently giving one of the apps a dependency it was not built against. */

import { readFileSync, writeFileSync } from 'node:fs'

const [, , output, ...inputs] = process.argv
if (!output || inputs.length === 0) {
	console.error('usage: merge-package-json.mjs <output> <input...>')
	process.exit(1)
}

const dependencies = {}
const origin = {}

for (const input of inputs) {
	const pkg = JSON.parse(readFileSync(input, 'utf8'))
	for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
		if (dependencies[name] && dependencies[name] !== version) {
			console.error(
				`merge-package-json: ${name} is ${dependencies[name]} in ${origin[name]} `
				+ `but ${version} in ${input}`,
			)
			process.exit(1)
		}
		dependencies[name] = version
		origin[name] = input
	}
}

const merged = {
	name: 'storage-standalone',
	version: '1.0.0',
	private: true,
	dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
}

writeFileSync(output, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`merge-package-json: ${Object.keys(dependencies).length} packages -> ${output}`)
