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
			"src/server/db/migrations/**",
			"test/fixtures/**",
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
		files: ["src/server/**", "scripts/**", "test/**", "*.config.js"],
		languageOptions: { globals: globals.node },
	},
	{
		files: ["src/client/**", "public-viewer/**"],
		languageOptions: { globals: globals.browser },
	},
	prettier,
);
