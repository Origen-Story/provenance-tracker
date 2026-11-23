import { BrowserRouter, Routes, Route, Navigate } from "react-router";
// The app's pages, on the project catalogs (Phase 6): the project is in the
// address, never a global active project.
import CatalogShell from "./catalog/CatalogShell.tsx";
import ProjectPicker from "./catalog/ProjectPicker.tsx";
import ProjectHome from "./catalog/ProjectHome.tsx";
import AssetsList from "./catalog/AssetsList.tsx";
import AssetDetail from "./catalog/AssetDetail.tsx";
import MediaPage from "./catalog/MediaPage.tsx";
import OutputsList from "./catalog/OutputsList.tsx";
import OutputPage from "./catalog/OutputPage.tsx";
import ProjectSettings from "./catalog/ProjectSettings.tsx";

export default function App() {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/catalog" element={<CatalogShell />}>
					<Route index element={<ProjectPicker />} />
				</Route>
				<Route path="/catalog/:projectId" element={<CatalogShell />}>
					<Route index element={<ProjectHome />} />
					<Route path="assets" element={<AssetsList />} />
					<Route path="assets/:assetId" element={<AssetDetail />} />
					<Route path="media" element={<MediaPage />} />
					<Route path="outputs" element={<OutputsList />} />
					<Route path="outputs/:assetId" element={<OutputPage />} />
					<Route path="settings" element={<ProjectSettings />} />
				</Route>
				{/* Anything else, including the old app's addresses: the projects. */}
				<Route path="*" element={<Navigate to="/catalog" replace />} />
			</Routes>
		</BrowserRouter>
	);
}
