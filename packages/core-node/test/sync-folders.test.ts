import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findSyncFolder, knownSyncFolders } from "../src/sync-folders.ts";
import { machinesForTests } from "./helpers/machine.ts";

const t = machinesForTests();

describe("findSyncFolder", () => {
	it("finds nothing on a machine with no sync client", () => {
		const m = t.machine();
		expect(knownSyncFolders(m)).toEqual([]);
		expect(findSyncFolder(t.folder("projects", "film"), m)).toBeNull();
	});

	it("finds OneDrive from its environment variables, for folders not made yet too", () => {
		const onedrive = t.folder("OneDrive - Studio");
		const m = t.machine({ env: { OneDriveCommercial: onedrive } });
		const found = findSyncFolder(path.join(onedrive, "Projects", "film"), m);
		expect(found).toEqual({
			service: "OneDrive",
			folder: onedrive,
			evidence: "the OneDriveCommercial environment variable",
		});
		expect(findSyncFolder(path.dirname(onedrive), m)).toBeNull();
	});

	it("finds Dropbox from its info.json, personal and business", () => {
		const dir = t.tempDir();
		const personal = path.join(dir, "Dropbox");
		const business = path.join(dir, "Dropbox (Studio)");
		const appData = path.join(dir, "AppData");
		mkdirSync(path.join(appData, "Dropbox"), { recursive: true });
		writeFileSync(
			path.join(appData, "Dropbox", "info.json"),
			JSON.stringify({
				personal: { path: personal, host: 1 },
				business: { path: business },
			}),
		);
		const m = t.machine({ env: { APPDATA: appData } });
		expect(findSyncFolder(path.join(personal, "a"), m)?.service).toBe(
			"Dropbox",
		);
		expect(findSyncFolder(path.join(business, "a"), m)?.folder).toBe(business);
		expect(findSyncFolder(path.join(dir, "Elsewhere"), m)).toBeNull();
	});

	it("ignores a Dropbox info.json it cannot read", () => {
		const appData = t.folder("AppData");
		mkdirSync(path.join(appData, "Dropbox"));
		writeFileSync(path.join(appData, "Dropbox", "info.json"), "{ half");
		expect(knownSyncFolders(t.machine({ env: { APPDATA: appData } }))).toEqual(
			[],
		);
	});

	it("finds a folder marked by Dropbox, Syncthing or Google Drive's drive", () => {
		const m = t.machine();
		for (const [marker, service, isFolder] of [
			[".dropbox", "Dropbox", false],
			[".stfolder", "Syncthing", true],
			[".shortcut-targets-by-id", "Google Drive", true],
		] as const) {
			const top = t.folder("synced");
			if (isFolder) mkdirSync(path.join(top, marker));
			else writeFileSync(path.join(top, marker), "");
			const found = findSyncFolder(
				path.join(top, "My Drive", "Projects", "film"),
				m,
			);
			expect(found, marker).toEqual({
				service,
				folder: top,
				evidence: `${marker} in ${top}`,
			});
		}
	});

	it.skipIf(process.platform === "win32")(
		"finds macOS's CloudStorage and iCloud folders",
		() => {
			const m = { ...t.machine(), platform: "darwin" as const };
			const cloud = path.join(m.home, "Library", "CloudStorage");
			mkdirSync(path.join(cloud, "GoogleDrive-a@example.com"), {
				recursive: true,
			});
			mkdirSync(path.join(cloud, "OneDrive-Personal"));
			expect(
				findSyncFolder(
					path.join(cloud, "GoogleDrive-a@example.com", "My Drive", "x"),
					m,
				)?.service,
			).toBe("Google Drive");
			expect(
				findSyncFolder(path.join(cloud, "OneDrive-Personal", "x"), m)?.service,
			).toBe("OneDrive");
			const icloud = path.join(m.home, "Library", "Mobile Documents");
			// No iCloud folder on this Mac: nothing to report.
			expect(findSyncFolder(path.join(icloud, "x"), m)).toBeNull();
			mkdirSync(icloud);
			expect(findSyncFolder(path.join(icloud, "x"), m)?.service).toBe(
				"iCloud Drive",
			);
			expect(findSyncFolder(path.join(m.home, "Movies"), m)).toBeNull();
		},
	);

	it.runIf(process.platform === "win32")(
		"finds iCloud for Windows' folder",
		() => {
			const m = t.machine();
			mkdirSync(path.join(m.home, "iCloudDrive"));
			expect(
				findSyncFolder(path.join(m.home, "iCloudDrive", "x"), m)?.service,
			).toBe("iCloud Drive");
		},
	);
});
