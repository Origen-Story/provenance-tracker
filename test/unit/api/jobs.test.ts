import { describe, it, expect } from "vitest";
import { BusyError, JobRunner } from "../../../src/server/api/jobs.ts";

const PROJECT = "11111111-1111-4111-8111-111111111111";

describe("JobRunner", () => {
	it("runs a job, says how far it has got, and keeps what it returned", async () => {
		const jobs = new JobRunner();
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const job = jobs.start(PROJECT, "scan", async ({ progress }) => {
			progress({ step: "scan", done: 1, total: 2, file: "a.wav" });
			await gate;
			return { counted: 2 };
		});
		expect(job.state).toBe("running");
		await Promise.resolve();
		expect(jobs.get(PROJECT, job.id)?.progress).toEqual({
			step: "scan",
			done: 1,
			total: 2,
			file: "a.wav",
		});
		// One job at a time per project; another project is not held up.
		expect(() => jobs.start(PROJECT, "extract", async () => null)).toThrow(
			BusyError,
		);
		const other = jobs.start(
			"22222222-2222-4222-8222-222222222222",
			"scan",
			async () => null,
		);
		release();
		expect(await jobs.settled(job.id)).toMatchObject({
			state: "done",
			result: { counted: 2 },
			error: null,
		});
		expect((await jobs.settled(other.id))?.state).toBe("done");
		expect(jobs.get("22222222-2222-4222-8222-222222222222", job.id)).toBeNull();
	});

	it("stops a job when asked, and records a failure in words", async () => {
		const jobs = new JobRunner();
		const job = jobs.start(
			PROJECT,
			"import",
			({ signal }) =>
				new Promise((resolve) =>
					signal.addEventListener("abort", () => resolve("stopped")),
				),
		);
		jobs.cancel(PROJECT, job.id);
		expect((await jobs.settled(job.id))?.state).toBe("cancelled");
		const bad = jobs.start(PROJECT, "download", async () => {
			throw new Error("The address answered 404 Not Found");
		});
		expect(await jobs.settled(bad.id)).toMatchObject({
			state: "failed",
			error: "The address answered 404 Not Found",
		});
		expect(jobs.list(PROJECT).map((j) => j.kind)).toEqual([
			"download",
			"import",
		]);
	});

	it("keeps the newest twenty finished jobs of a project", async () => {
		const jobs = new JobRunner();
		for (let i = 0; i < 25; i++)
			await jobs.settled(jobs.start(PROJECT, "classify", async () => i).id);
		const kept = jobs.list(PROJECT);
		expect(kept).toHaveLength(20);
		expect(kept[0].result).toBe(24);
	});
});
