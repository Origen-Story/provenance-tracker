// How long `npm test` may take before the repo guard fails the run.
//
// 60 s on a person's machine, where the suite takes about 20 s: a suite that
// has grown slow, or a test that hangs, is noticed there. A hosted runner can
// be several times slower for no reason of the suite's (a Windows runner has
// taken over 80 s on a run where every test passed), so a workflow names a
// longer budget of its own in PT_TEST_BUDGET_SECONDS.

export const DEFAULT_BUDGET_SECONDS = 60;
export const LONGEST_BUDGET_SECONDS = 300;
export const BUDGET_VARIABLE = "PT_TEST_BUDGET_SECONDS";

/**
 * The budget for this run, in seconds: the default, or what the environment
 * names. A named budget is a whole number from the default to the longest.
 * Anything else is refused: a mistyped value never runs the tests under a
 * budget nobody chose, and nothing here can shorten or switch off the rule.
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function testBudgetSeconds(env) {
	const named = env[BUDGET_VARIABLE];
	if (named === undefined || named === "") return DEFAULT_BUDGET_SECONDS;
	const seconds = /^[0-9]{1,4}$/.test(named) ? Number(named) : NaN;
	if (!(seconds >= DEFAULT_BUDGET_SECONDS && seconds <= LONGEST_BUDGET_SECONDS))
		throw new Error(
			`${BUDGET_VARIABLE} is "${named}". It takes a whole number of seconds from ${DEFAULT_BUDGET_SECONDS} to ${LONGEST_BUDGET_SECONDS}.`,
		);
	return seconds;
}
