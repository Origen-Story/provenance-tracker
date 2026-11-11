import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router';

// The old timeline page lives under Outputs now.
function RedirectToOutput() {
	const { id } = useParams();
	return <Navigate to={`/outputs/${id}`} replace />;
}
import { useQuery } from '@tanstack/react-query';
import AppShell from './components/layout/AppShell.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import ImportHub from './pages/ImportHub.jsx';
import ProjectList from './pages/projects/ProjectList.jsx';
import NewProject from './pages/projects/NewProject.jsx';
import ProjectSettings from './pages/projects/ProjectSettings.jsx';
import ArchivalList from './pages/archival/ArchivalList.jsx';
import ArchivalDetail from './pages/archival/ArchivalDetail.jsx';
import AIAssetList from './pages/ai-assets/AIAssetList.jsx';
import AIAssetDetail from './pages/ai-assets/AIAssetDetail.jsx';
import ProducedList from './pages/produced/ProducedList.jsx';
import ProducedDetail from './pages/produced/ProducedDetail.jsx';
import OutputsList from './pages/outputs/OutputsList.jsx';
import OutputPage from './pages/outputs/OutputPage.jsx';
import SearchPage from './pages/search/SearchPage.jsx';
import GroupsManager from './pages/search/GroupsManager.jsx';

function RequireProject({ children }) {
	const { data: project, isLoading, isFetching } = useQuery({
		queryKey: ['activeProject'],
		queryFn: () => fetch('/api/projects/active').then(r => r.json())
	});

	if (isLoading || (isFetching && !project)) return (
		<div className="min-h-screen bg-app-bg flex items-center justify-center">
			<p className="text-text-secondary text-sm">Loading...</p>
		</div>
	);

	if (!project) return <Navigate to="/projects/new" replace />;
	return children;
}

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				{/* Project setup — no shell required */}
				<Route path="/projects/new" element={<NewProject />} />

				{/* Main app — requires active project */}
				<Route path="/" element={
					<RequireProject>
						<AppShell />
					</RequireProject>
				}>
					<Route index element={<Dashboard />} />
					<Route path="settings" element={<Settings />} />
					<Route path="projects" element={<ProjectList />} />
					<Route path="projects/:id/settings" element={<ProjectSettings />} />
					<Route path="import" element={<ImportHub />} />
					<Route path="produced" element={<ProducedList />} />
					<Route path="produced/:id" element={<ProducedDetail />} />
					<Route path="produced/:id/timeline" element={<RedirectToOutput />} />
					<Route path="outputs" element={<OutputsList />} />
					<Route path="outputs/:id" element={<OutputPage />} />
					<Route path="assets" element={<AIAssetList />} />
					<Route path="assets/:id" element={<AIAssetDetail />} />
					<Route path="archival" element={<ArchivalList />} />
					<Route path="archival/:id" element={<ArchivalDetail />} />
					<Route path="search" element={<SearchPage />} />
					<Route path="search/groups" element={<GroupsManager />} />
					<Route path="manifest" element={<Navigate to="/outputs" replace />} />
					<Route path="export" element={<Navigate to="/outputs" replace />} />
				</Route>
			</Routes>
		</BrowserRouter>
	);
}
