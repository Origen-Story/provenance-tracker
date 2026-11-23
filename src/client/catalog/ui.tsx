// Small pieces the new pages share, in the app's own look (app.css tokens).

import type { ReactNode } from "react";

export function PageTitle({
	title,
	description,
}: {
	title: string;
	description?: ReactNode;
}) {
	return (
		<div className="mb-6">
			<h2 className="text-2xl font-bold text-text-primary">{title}</h2>
			{description && (
				<p className="text-sm text-text-secondary mt-1">{description}</p>
			)}
		</div>
	);
}

export function Card({
	children,
	className = "",
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`bg-card-bg border border-border rounded-lg p-4 ${className}`}
		>
			{children}
		</div>
	);
}

/** The API's own words when something went wrong. */
export function Problem({ error }: { error: unknown }) {
	if (!error) return null;
	return (
		<p
			role="alert"
			className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2"
		>
			{error instanceof Error ? error.message : String(error)}
		</p>
	);
}

export function Loading() {
	return <p className="text-text-secondary text-sm">Loading…</p>;
}

/** A small label: ok in green, anything else in the muted or warning colour. */
export function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
	return (
		<span
			className={`text-xs px-2 py-0.5 rounded-full ${ok ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning"}`}
		>
			{children}
		</span>
	);
}

export function Button({
	children,
	onClick,
	type = "button",
	disabled,
	quiet,
}: {
	children: ReactNode;
	onClick?: () => void;
	type?: "button" | "submit";
	disabled?: boolean;
	quiet?: boolean;
}) {
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled}
			className={
				quiet
					? "text-sm text-text-secondary hover:text-text-primary px-3 py-1.5 border border-border rounded transition-colors disabled:opacity-50"
					: "text-sm text-accent hover:text-accent-hover px-3 py-1.5 border border-accent/30 hover:border-accent rounded transition-colors disabled:opacity-50"
			}
		>
			{children}
		</button>
	);
}

export function TextField({
	label,
	value,
	onChange,
	placeholder,
	hint,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	hint?: string;
}) {
	return (
		<label className="block">
			<span className="block text-sm text-text-primary mb-1">{label}</span>
			<input
				value={value}
				onChange={(e) => onChange(e.target.value)}
				placeholder={placeholder}
				className="w-full bg-app-bg border border-border rounded px-3 py-1.5 text-sm text-text-primary"
			/>
			{hint && (
				<span className="block text-xs text-text-secondary mt-1">{hint}</span>
			)}
		</label>
	);
}

/** An ISO time as the reader's local date and time, briefly. */
export function when(iso: string | null): string {
	if (!iso) return "never";
	return new Date(iso).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}
