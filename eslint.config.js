// ESLint finds likely bugs; Prettier owns formatting (eslint-config-prettier
// turns off every rule that would argue with it). Type-aware rules come later,
// once files are TypeScript; until then this is the recommended set only.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
	{
		ignores: [
			".claude/**",
			"dist/**",
			"coverage/**",
			"packages/*/test/fixtures/**",
			"test-fixtures/**",
			"tools/**",
		],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		// The typescript-eslint parser for every file, JavaScript included: its
		// scope analysis counts a component used only in JSX as used.
		files: ["**/*.{js,jsx,mjs,ts,tsx}"],
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: { ecmaFeatures: { jsx: true } },
			ecmaVersion: 2024,
			sourceType: "module",
		},
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrors: "none",
					ignoreRestSiblings: true,
				},
			],
		},
	},
	{
		files: [
			"src/server/**",
			"packages/**",
			"scripts/**",
			"test/**",
			"*.config.js",
		],
		languageOptions: { globals: globals.node },
	},
	{
		files: ["src/client/**", "public-viewer/**"],
		languageOptions: { globals: globals.browser },
	},
	{
		// The core package is pure: it never reaches into the app or into
		// core-node, which holds everything that touches the machine
		// (CLAUDE.md, D24, D28).
		files: ["packages/core/**"],
		rules: {
			"no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"**/src/server/**",
								"**/src/client/**",
								"**/db/**",
								"drizzle-orm",
								"pg",
								"express",
								"@provenancetracker/core-node",
								"@provenancetracker/core-node/**",
								"**/core-node/**",
							],
							message:
								"packages/core is pure logic and must not import the app, core-node, the database or HTTP.",
						},
					],
				},
			],
		},
	},
	{
		// Core's own code never opens a file, starts a process or uses the
		// network: it runs SQL on a database it is handed. Its tests may use
		// temp folders. The DatabaseSync type is allowed; the module is not.
		files: ["packages/core/src/**"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						...[
							"fs",
							"fs/promises",
							"child_process",
							"net",
							"http",
							"https",
							"dns",
							"dns/promises",
							"os",
							"worker_threads",
						].flatMap((name) =>
							[name, `node:${name}`].map((spec) => ({
								name: spec,
								message:
									"packages/core never touches the machine; this belongs in packages/core-node.",
							})),
						),
						...["sqlite", "node:sqlite"].map((name) => ({
							name,
							allowTypeImports: true,
							message:
								"packages/core runs SQL on a database it is handed: import the DatabaseSync type only; opening one belongs in packages/core-node.",
						})),
					],
				},
			],
			"no-restricted-globals": [
				"error",
				{
					name: "process",
					message:
						"packages/core reads nothing from the machine; pass what it needs in (core-node's Machine).",
				},
			],
		},
	},
	prettier,
);
