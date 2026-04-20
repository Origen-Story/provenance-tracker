export default function PageHeader({ title, description }) {
	return (
		<div className="mb-6">
			<h2 className="text-2xl font-bold text-text-primary">{title}</h2>
			{description && <p className="text-sm text-text-secondary mt-1">{description}</p>}
		</div>
	);
}
