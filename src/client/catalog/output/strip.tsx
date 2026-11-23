// The app's composition strip (components/timeline/Composition.jsx, D10)
// and its clock, with the props the new pages pass. They are JavaScript, so
// TypeScript would otherwise read every prop as required.

import type { ComponentType } from "react";
import CompositionJs from "../../components/timeline/Composition.jsx";
import { fmtClock as fmtClockJs } from "../../components/timeline/LaneStrip.jsx";
import type { Breakdown } from "../api.ts";

export const Composition = CompositionJs as unknown as ComponentType<{
	composition: Breakdown["composition"];
	/** The output's file, to play above the strip. */
	src?: string | null;
	kind?: "video" | "audio" | null;
	/** Its length, when the timeline does not say. */
	asset?: { durationSeconds?: number | null };
}>;

/** Seconds as m:ss.s. */
export const fmtClock = fmtClockJs as (seconds: number | null) => string;
