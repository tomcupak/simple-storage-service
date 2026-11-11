module.exports = {
	storageApi: {
		output: {
			mode: 'tags-split',
			target: 'apps/storage/src/api/schema/index.ts',
			schemas: 'apps/storage/src/api/schema/models',
			client: 'axios',
			override: {
				mutator: {
					path: 'apps/storage/src/api/customInstance.ts',
					name: 'customInstance',
				},
			},
		},
		// Management API must be running - see `npm run dev:api`
		input: 'http://localhost:10410/swagger/json',
	},
}
