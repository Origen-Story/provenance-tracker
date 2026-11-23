// The app's origin badge (components/origin/OriginBadge.jsx), with the
// props the new pages pass. It is JavaScript, so TypeScript would otherwise
// read every prop as required.

import type { ComponentType } from "react";
import OriginBadgeJs from "../components/origin/OriginBadge.jsx";

export interface OriginBadgeProps {
	originClass: string;
	confirmed?: boolean;
	aiAssisted?: boolean;
	note?: string;
	signedBy?: string;
	signerName?: string;
	archive?: boolean;
	className?: string;
}

export const OriginBadge =
	OriginBadgeJs as unknown as ComponentType<OriginBadgeProps>;
