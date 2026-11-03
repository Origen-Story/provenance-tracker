import { Outlet } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Sidebar from './Sidebar.jsx';

export default function AppShell() {
	const { data: project } = useQuery({
		queryKey: ['activeProject'],
		queryFn: () => fetch('/api/projects/active').then(r => r.json())
	});

	return (
		<div className="min-h-screen bg-app-bg">
			<Sidebar activeProject={project} />
			<main className="ml-60 p-8">
				<Outlet />
			</main>
		</div>
	);
}
