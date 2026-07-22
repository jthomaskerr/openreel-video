import copy
import hashlib
import json
import sys
import unittest
from pathlib import Path


RESOLVE_DIR = Path(__file__).resolve().parents[1]
FIXTURE_PATH = RESOLVE_DIR.parents[0] / "fixtures" / "ready-job.json"
sys.path.insert(0, str(RESOLVE_DIR))

from OpenReelBridge import run_import  # noqa: E402


FCPXML_BYTES = b"""<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<fcpxml version=\"1.11\">
  <resources>
    <format id=\"r1\" frameDuration=\"1/24s\" width=\"1920\" height=\"1080\"/>
    <asset id=\"r2\" name=\"tokyo.mov\" src=\"file:///Volumes/OpenReel/Vintage%20Tokyo/tokyo.mov\"/>
    <asset id=\"r3\" name=\"ambience.wav\" src=\"file:///Volumes/OpenReel/Vintage%20Tokyo/ambience.wav\"/>
  </resources>
  <library><event name=\"OpenReel\"><project name=\"Vintage Tokyo\">
    <sequence format=\"r1\" duration=\"240/24s\" tcStart=\"0s\"><spine>
      <asset-clip name=\"Tokyo\" ref=\"r2\" duration=\"240/24s\"/>
      <asset-clip name=\"Ambience\" ref=\"r3\" lane=\"-1\" duration=\"240/24s\"/>
    </spine></sequence>
  </project></event></library>
</fcpxml>
"""

MANIFEST_BYTES = (
    json.dumps(
        {
            "schemaVersion": "1.0",
            "jobId": "resolve-job-test-1",
            "projectId": "vintage-tokyo",
            "revision": "0123456789abcdef0123456789abcdef01234567",
            "planId": "plan-vintage-tokyo",
            "target": {"id": "davinci-resolve", "contractVersion": "1"},
            "selection": {"kind": "project"},
            "requiredMedia": [
                {
                    "mediaId": "media-1",
                    "semanticFilename": "tokyo.mov",
                    "canonicalRelativePath": "media/tokyo.mov",
                    "expectedByteSize": 1024,
                    "lfsOid": "sha256:" + "1" * 64,
                },
                {
                    "mediaId": "media-2",
                    "semanticFilename": "ambience.wav",
                    "canonicalRelativePath": "media/ambience.wav",
                    "expectedByteSize": 512,
                    "lfsOid": "sha256:" + "2" * 64,
                },
            ],
            "artifacts": [
                {
                    "path": "exports/resolve/resolve-job-test-1/Vintage Tokyo.fcpxml",
                    "byteLength": len(FCPXML_BYTES),
                    "sha256": hashlib.sha256(FCPXML_BYTES).hexdigest(),
                }
            ],
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    + "\n"
).encode("utf-8")

REPORT_BYTES = b"# Resolve Compatibility Report\n\nStatus: ready\n"


class FakeMediaItem:
    def __init__(self, media_id, offline=False):
        self.media_id = media_id
        self.offline = offline

    def GetUniqueId(self):
        return self.media_id

    def GetClipProperty(self, name=None):
        values = {"Offline": "1" if self.offline else "0"}
        return values if name is None else values.get(name, "")


class FakeFolder:
    def __init__(self, media_items):
        self.media_items = media_items

    def GetClipList(self):
        return list(self.media_items)

    def GetSubFolderList(self):
        return []


class FakeTimeline:
    def __init__(self, name="Vintage Tokyo", duration=240, track_counts=None, clip_counts=None):
        self.name = name
        self.duration = duration
        self.track_counts = track_counts or {"video": 1, "audio": 1}
        self.clip_counts = clip_counts or {"video": 1, "audio": 1}

    def GetName(self):
        return self.name

    def GetStartFrame(self):
        return 0

    def GetEndFrame(self):
        return self.duration

    def GetTrackCount(self, kind):
        return self.track_counts.get(kind, 0)

    def GetItemListInTrack(self, kind, index):
        if index < 1 or index > self.GetTrackCount(kind):
            return []
        return [object()] * self.clip_counts.get(kind, 0)


class FakeMediaPool:
    def __init__(self, timeline, media_items, reject=False):
        self.timeline = timeline
        self.root = FakeFolder(media_items)
        self.reject = reject
        self.imports = []

    def ImportTimelineFromFile(self, path, options):
        self.imports.append((path, options))
        return None if self.reject else self.timeline

    def GetRootFolder(self):
        return self.root


class FakeProject:
    def __init__(self, name, timeline=None, media_items=None, reject=False):
        self.name = name
        self.timeline = timeline or FakeTimeline()
        self.media_pool = FakeMediaPool(
            self.timeline,
            media_items or [FakeMediaItem("media-1"), FakeMediaItem("media-2")],
            reject,
        )

    def GetName(self):
        return self.name

    def GetMediaPool(self):
        return self.media_pool

    def GetCurrentTimeline(self):
        return self.timeline


class FakeProjectManager:
    def __init__(self, project, project_names=None, save=True):
        self.project = project
        self.project_names = list(project_names or [project.name])
        self.save = save
        self.created_projects = []
        self.renames = []
        self.save_calls = 0

    def GetCurrentProject(self):
        return self.project

    def GetProjectListInCurrentFolder(self):
        return list(self.project_names)

    def RenameProject(self, old_name, new_name):
        self.renames.append((old_name, new_name))
        if old_name != self.project.name:
            return False
        self.project.name = new_name
        return True

    def SaveProject(self):
        self.save_calls += 1
        return self.save

    def CreateProject(self, name):
        self.created_projects.append(name)
        raise AssertionError("The Python adapter must never create a project")


class FakeResolve:
    def __init__(
        self,
        current_project="OpenReel Import 123",
        project_names=None,
        timeline=None,
        media_items=None,
        reject=False,
        save=True,
        api_available=True,
    ):
        project = FakeProject(current_project, timeline, media_items, reject)
        self.manager = FakeProjectManager(project, project_names, save) if api_available else None

    def GetProjectManager(self):
        return self.manager

    def GetVersionString(self):
        return "21.0.3"

    def GetVersion(self):
        return [21, 0, 3, 210030007, ""]


class FakeBackend:
    def __init__(self, fixture, overrides=None):
        artifacts = {
            fixture["artifacts"][0]["url"]: FCPXML_BYTES,
            fixture["artifacts"][1]["url"]: MANIFEST_BYTES,
            fixture["artifacts"][2]["url"]: REPORT_BYTES,
        }
        artifacts.update(overrides or {})
        self.artifacts = artifacts
        self.posts = []

    def fetch_artifact(self, url):
        return self.artifacts[url]

    def post_result(self, project_id, job_id, result):
        self.posts.append((project_id, job_id, copy.deepcopy(result)))


class OpenReelBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ready_request = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))

    def test_fixture_matches_current_backend_redemption_dto_and_artifacts(self):
        self.assertEqual(
            set(self.ready_request),
            {"jobId", "projectId", "revision", "artifacts"},
        )
        self.assertEqual(
            [set(artifact) for artifact in self.ready_request["artifacts"]],
            [
                {"name", "url", "mediaType", "byteLength", "sha256"},
                {"name", "url", "mediaType", "byteLength", "sha256"},
                {"name", "url", "mediaType", "byteLength", "sha256"},
            ],
        )
        for artifact, content in zip(
            self.ready_request["artifacts"],
            (FCPXML_BYTES, MANIFEST_BYTES, REPORT_BYTES),
        ):
            self.assertEqual(artifact["byteLength"], len(content))
            self.assertEqual(artifact["sha256"], hashlib.sha256(content).hexdigest())

    def test_imports_into_current_project_and_renames_same_project(self):
        resolve = FakeResolve()
        backend = FakeBackend(self.ready_request)

        result = run_import(resolve, self.ready_request, backend)

        manager = resolve.manager
        self.assertIsNotNone(manager)
        assert manager is not None
        self.assertEqual(manager.created_projects, [])
        self.assertEqual(manager.renames, [("OpenReel Import 123", "Vintage Tokyo")])
        self.assertEqual(result["requestId"], "resolve-request-test-1")
        self.assertEqual(result["offlineMediaIds"], [])
        self.assertEqual(result["referencedMediaIds"], ["media-1", "media-2"])
        self.assertEqual(result["trackCounts"], {"video": 1, "audio": 1})
        self.assertEqual(result["clipCounts"], {"video": 1, "audio": 1})
        self.assertEqual(result["durationFrames"], 240)
        self.assertTrue(result["saved"])
        self.assertEqual(len(backend.posts), 1)

        imported_path, options = manager.project.media_pool.imports[0]
        self.assertTrue(Path(imported_path).name.endswith(".fcpxml"))
        self.assertEqual(
            options,
            {
                "timelineName": "Vintage Tokyo",
                "importSourceClips": True,
                "sourceClipsPath": "/Volumes/OpenReel/Vintage Tokyo",
            },
        )

    def test_uses_collision_safe_project_name(self):
        resolve = FakeResolve(
            project_names=["OpenReel Import 123", "Vintage Tokyo", "Vintage Tokyo (2)"],
        )

        result = run_import(resolve, self.ready_request, FakeBackend(self.ready_request))

        manager = resolve.manager
        self.assertIsNotNone(manager)
        assert manager is not None
        self.assertEqual(result["projectName"], "Vintage Tokyo (3)")
        self.assertEqual(
            manager.renames,
            [("OpenReel Import 123", "Vintage Tokyo (3)")],
        )

    def test_rejects_hash_mismatch_and_posts_one_sanitized_failure(self):
        request = copy.deepcopy(self.ready_request)
        request["artifacts"][0]["sha256"] = "f" * 64
        backend = FakeBackend(request)

        result = run_import(FakeResolve(), request, backend)

        self.assertEqual(result["failure"]["code"], "ARTIFACT_HASH_MISMATCH")
        self.assertEqual(len(backend.posts), 1)
        diagnostic = json.dumps(result)
        self.assertNotIn("nonce-test-artifact", diagnostic)
        self.assertNotIn("/Volumes/OpenReel", diagnostic)

    def test_reports_fcpxml_rejection_once(self):
        backend = FakeBackend(self.ready_request)
        result = run_import(FakeResolve(reject=True), self.ready_request, backend)

        self.assertEqual(result["failure"]["code"], "FCPXML_REJECTED")
        self.assertEqual(len(backend.posts), 1)

    def test_reports_save_failure_once(self):
        backend = FakeBackend(self.ready_request)
        result = run_import(FakeResolve(save=False), self.ready_request, backend)

        self.assertEqual(result["failure"]["code"], "SAVE_FAILED")
        self.assertFalse(result["saved"])
        self.assertEqual(len(backend.posts), 1)

    def test_reports_missing_resolve_api_once(self):
        backend = FakeBackend(self.ready_request)
        result = run_import(
            FakeResolve(api_available=False),
            self.ready_request,
            backend,
        )

        self.assertEqual(result["failure"]["code"], "RESOLVE_UI_UNEXPECTED")
        self.assertEqual(len(backend.posts), 1)

    def test_reports_offline_media_with_exact_referenced_ids(self):
        media_items = [FakeMediaItem("media-1"), FakeMediaItem("media-2", offline=True)]
        backend = FakeBackend(self.ready_request)

        result = run_import(
            FakeResolve(media_items=media_items),
            self.ready_request,
            backend,
        )

        self.assertEqual(result["failure"]["code"], "OFFLINE_MEDIA")
        self.assertEqual(result["offlineMediaIds"], ["media-2"])
        self.assertEqual(result["referencedMediaIds"], ["media-1", "media-2"])
        self.assertEqual(len(backend.posts), 1)

    def test_rejects_timeline_count_mismatch(self):
        backend = FakeBackend(self.ready_request)
        timeline = FakeTimeline(clip_counts={"video": 2, "audio": 1})

        result = run_import(
            FakeResolve(timeline=timeline),
            self.ready_request,
            backend,
        )

        self.assertEqual(result["failure"]["code"], "FCPXML_REJECTED")
        self.assertEqual(len(backend.posts), 1)


if __name__ == "__main__":
    unittest.main()
