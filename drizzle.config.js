/** @type {import('drizzle-kit').Config} */
export default {
	schema: './src/lib/core/db/schema.js',
	out: './src/lib/core/db/migrations',
	dialect: 'sqlite',
	dbCredentials: {
		url: './data/provenance.db'
	}
};
