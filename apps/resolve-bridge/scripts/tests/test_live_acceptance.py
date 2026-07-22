import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "live-acceptance.py"


def load_module():
    spec = importlib.util.spec_from_file_location("live_acceptance", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LiveAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_module()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fcpxml = self.root / "Vintage Tokyo.fcpxml"
        self.fcpxml.write_text(
            '<?xml version="1.0"?><fcpxml><resources><format id="r1" frameDuration="1/30s"/></resources>'
            '<library><event><project><sequence format="r1" duration="266/1s"/></project></event></library></fcpxml>',
            encoding="utf-8",
        )
        self.sha = hashlib.sha256(self.fcpxml.read_bytes()).hexdigest()

    def tearDown(self):
        self.temp.cleanup()

    def evidence(self, second=False):
        revision = "1" * 40
        runs = [self.acceptance_run("11111111-1111-4111-8111-111111111111", "Vintage Tokyo", revision)]
        if second:
            runs.append(self.acceptance_run("22222222-2222-4222-8222-222222222222", "Vintage Tokyo 2", revision))
        return {"projectId": "vintage-tokyo", "revision": revision, "runs": runs}

    def acceptance_run(self, job_id, project_name, revision):
        return {
            "jobId": job_id,
            "revision": revision,
            "result": {
                "status": "success",
                "resolveVersion": "21.0.3",
                "resolveBuild": "21.0.30007",
                "projectName": project_name,
                "trackCounts": {"video": 3, "audio": 1},
                "clipCounts": {"video": 34, "audio": 4},
                "offlineMediaIds": [],
                "referencedMediaIds": ["media-a", "media-b"],
                "saved": True,
                "artifactSha256": self.sha,
            },
            "artifacts": [
                {"name": "Vintage Tokyo.fcpxml", "path": str(self.fcpxml), "sha256": self.sha}
            ],
        }

    def test_accepts_exact_vintage_tokyo_evidence_and_sanitizes_report(self):
        report = self.module.verify_evidence(self.evidence())
        self.assertEqual(report["verdict"], "pass")
        self.assertEqual(report["durationFrames"], 7980)
        self.assertEqual(report["collisionStatus"], "pending-second-run")
        serialized = json.dumps(report)
        self.assertNotIn(str(self.root), serialized)
        self.assertNotIn("token", serialized.lower())

    def test_validates_repeat_names_and_immutable_first_result(self):
        first = self.module.verify_evidence(self.evidence())
        report = self.module.verify_evidence(self.evidence(second=True), baseline=first["firstRunBaseline"])
        self.assertEqual(report["collisionStatus"], "pass")

    def test_rejects_wrong_build_offline_media_and_hash_mismatch(self):
        cases = []
        wrong_build = self.evidence()
        wrong_build["runs"][0]["result"]["resolveBuild"] = "wrong"
        cases.append(wrong_build)
        offline = self.evidence()
        offline["runs"][0]["result"]["offlineMediaIds"] = ["media-a"]
        cases.append(offline)
        bad_hash = self.evidence()
        bad_hash["runs"][0]["artifacts"][0]["sha256"] = "0" * 64
        cases.append(bad_hash)
        empty_media_id = self.evidence()
        empty_media_id["runs"][0]["result"]["referencedMediaIds"] = [""]
        cases.append(empty_media_id)
        for evidence in cases:
            with self.subTest(evidence=evidence):
                with self.assertRaises(self.module.AcceptanceError):
                    self.module.verify_evidence(evidence)

    def test_latest_evidence_does_not_mix_project_revisions(self):
        resolve_root = self.root / "exports" / "resolve"

        def write_job(job_id, revision, created_at):
            job_dir = resolve_root / job_id
            job_dir.mkdir(parents=True)
            (job_dir / "job.json").write_text(json.dumps({
                "job": {
                    "id": job_id,
                    "phase": "completed",
                    "revision": revision,
                    "createdAt": created_at,
                },
                "result": {"status": "success"},
                "artifacts": [],
            }), encoding="utf-8")

        old_revision = "1" * 40
        latest_revision = "2" * 40
        write_job("00000000-0000-4000-8000-000000000001", old_revision, "2026-07-20T00:00:00Z")
        write_job("00000000-0000-4000-8000-000000000002", old_revision, "2026-07-21T00:00:00Z")
        write_job("00000000-0000-4000-8000-000000000003", latest_revision, "2026-07-22T00:00:00Z")

        evidence = self.module._latest_evidence(self.root)

        self.assertEqual(evidence["revision"], latest_revision)
        self.assertEqual(
            [run["jobId"] for run in evidence["runs"]],
            ["00000000-0000-4000-8000-000000000003"],
        )

    def test_rejects_collision_or_changed_first_run(self):
        evidence = self.evidence(second=True)
        evidence["runs"][1]["result"]["projectName"] = "Vintage Tokyo"
        with self.assertRaises(self.module.AcceptanceError):
            self.module.verify_evidence(evidence)

        baseline = self.module.verify_evidence(self.evidence())["firstRunBaseline"]
        evidence = self.evidence(second=True)
        evidence["runs"][0]["result"]["clipCounts"]["video"] = 33
        with self.assertRaises(self.module.AcceptanceError):
            self.module.verify_evidence(evidence, baseline=baseline)


if __name__ == "__main__":
    unittest.main()
