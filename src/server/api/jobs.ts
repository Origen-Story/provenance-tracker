// Long work the app starts (a scan, reading files, an import, a download)
// runs as a job: started by one request, watched by others, stoppable. Jobs
// live in this server's memory; one runs at a time per project, so two never
// write the same catalog at once. What a job did is kept in the catalog's own
// runs, so nothing is lost when the server stops.

import { randomUUID } from "node:crypto";

export type JobKind = "scan" | "extract" | "classify" | "import" | "download";
export type JobState = "running" | "done" | "failed" | "cancelled";

export interface JobProgress {
	step: string;
	done: number;
	total: number;
	file: string;
}

export interface JobView {
	id: string;
	projectId: string;
	kind: JobKind;
	state: JobState;
	startedAt: string;
	finishedAt: string | null;
	progress: JobProgress | null;
	/** What the job reported when it finished. */
	result: unknown;
	error: string | null;
}

interface Job extends JobView {
	controller: AbortController;
	finished: Promise<void>;
}

/** A job of this project is already running (HTTP 409). */
export class BusyError extends Error {}

const KEEP = 20;

const view = ({ controller: _c, finished: _f, ...rest }: Job): JobView => ({
	...rest,
});

export class JobRunner {
	private jobs = new Map<string, Job>();

	/**
	 * Start a job. `run` gets a signal that says it was asked to stop, and a
	 * way to say how far it has got; what it returns is the job's result.
	 */
	start(
		projectId: string,
		kind: JobKind,
		run: (ctx: {
			signal: AbortSignal;
			progress: (p: JobProgress) => void;
		}) => Promise<unknown>,
	): JobView {
		const running = [...this.jobs.values()].find(
			(j) => j.projectId === projectId && j.state === "running",
		);
		if (running)
			throw new BusyError(
				`This project is busy: a ${running.kind} started at ${running.startedAt} is still running`,
			);
		const controller = new AbortController();
		const job = {
			id: randomUUID(),
			projectId,
			kind,
			state: "running",
			startedAt: new Date().toISOString(),
			finishedAt: null,
			progress: null,
			result: null,
			error: null,
			controller,
		} as unknown as Job;
		job.finished = (async () => {
			try {
				job.result = await run({
					signal: controller.signal,
					progress: (p) => {
						job.progress = p;
					},
				});
				job.state = controller.signal.aborted ? "cancelled" : "done";
			} catch (err) {
				job.state = "failed";
				job.error = (err as Error).message;
			} finally {
				job.finishedAt = new Date().toISOString();
				this.prune(projectId);
			}
		})();
		this.jobs.set(job.id, job);
		return view(job);
	}

	get(projectId: string, id: string): JobView | null {
		const job = this.jobs.get(id);
		return job && job.projectId === projectId ? view(job) : null;
	}

	/** This project's jobs, newest first. */
	list(projectId: string): JobView[] {
		return [...this.jobs.values()]
			.filter((j) => j.projectId === projectId)
			.reverse()
			.map(view);
	}

	/** Ask a running job to stop; it stops at its next safe point. */
	cancel(projectId: string, id: string): JobView | null {
		const job = this.jobs.get(id);
		if (!job || job.projectId !== projectId) return null;
		if (job.state === "running") job.controller.abort();
		return view(job);
	}

	/** Resolves when the job has finished (for tests and shutdown). */
	async settled(id: string): Promise<JobView | null> {
		const job = this.jobs.get(id);
		if (!job) return null;
		await job.finished;
		return view(job);
	}

	private prune(projectId: string): void {
		const done = [...this.jobs.values()].filter(
			(j) => j.projectId === projectId && j.state !== "running",
		);
		for (const j of done.slice(0, Math.max(0, done.length - KEEP)))
			this.jobs.delete(j.id);
	}
}
