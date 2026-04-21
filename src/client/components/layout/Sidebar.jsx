import { NavLink, useLocation } from 'react-router-dom';

function hasModule(project, mod) {
	try { return JSON.parse(project?.modules || '[]').includes(mod); }
	catch { return false; }
}

const ICONS = {
	grid: <><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></>,
	upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>,
	image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
	'file-text': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
	download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>,
	archive: <><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></>,
	settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
	</>,
	mic: <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></>,
	sparkle: <><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3z"/></>,
	search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
	tag: <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></>
};

function Icon({ name }) {
	return (
		<svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{ICONS[name]}
		</svg>
	);
}

function NavItem({ href, icon, label, exact = false, indent = false }) {
	return (
		<NavLink
			to={href}
			end={exact}
			className={({ isActive }) =>
				`flex items-center gap-3 ${indent ? 'pl-11 pr-5 py-2' : 'px-5 py-2.5'} text-sm transition-colors ${
					isActive
						? 'text-accent bg-accent/10 border-r-2 border-accent'
						: 'text-text-secondary hover:text-text-primary hover:bg-card-bg'
				}`
			}
		>
			<Icon name={icon} />
			{label}
		</NavLink>
	);
}

function SectionDivider() {
	return <div className="mx-5 my-2 border-t border-border/50" />;
}

export default function Sidebar({ activeProject }) {
	const aiAssets = hasModule(activeProject, 'ai_assets');
	const archival = hasModule(activeProject, 'archival');

	return (
		<aside className="fixed left-0 top-0 h-screen w-60 bg-sidebar-bg border-r border-border flex flex-col z-10">
			<div className="p-5 border-b border-border">
				<h1 className="font-bold tracking-wide uppercase leading-tight mb-2">
					<a href="https://www.origenstory.com/" target="_blank" rel="noopener noreferrer" className="text-base text-accent hover:text-accent-hover transition-colors block">Origen Story</a>
					<span className="text-sm text-text-primary block">Provenance Tracker</span>
				</h1>
				{activeProject ? (
					<>
						<p className="text-xs text-text-secondary mt-1 truncate">{activeProject.name}</p>
						<NavLink to="/projects" className="text-xs text-accent hover:text-accent-hover mt-1 block">
							Switch project
						</NavLink>
					</>
				) : (
					<p className="text-xs text-text-secondary mt-1">No project selected</p>
				)}
			</div>

			<nav className="flex-1 py-3">
				<NavItem href="/" icon="grid" label="Dashboard" exact />
				<NavItem href="/import" icon="upload" label="Import" />

				<SectionDivider />

				<NavItem href="/produced" icon="mic" label="Produced Assets" />
				{aiAssets && <NavItem href="/assets" icon="sparkle" label="AI Assets" />}
				{archival && (
					<>
						<NavItem href="/archival" icon="archive" label="Archival" />
						<NavItem href="/search" icon="search" label="Archive Search" indent />
						<NavItem href="/search/groups" icon="tag" label="Search Groups" indent />
					</>
				)}

				<SectionDivider />

				<NavItem href="/manifest" icon="file-text" label="Manifest" />
				<NavItem href="/export" icon="download" label="Export" />
				<NavItem href="/settings" icon="settings" label="Settings" />
			</nav>

			<div className="p-4 border-t border-border text-xs text-text-secondary">
				Origen Story · Local Tool
			</div>
		</aside>
	);
}
