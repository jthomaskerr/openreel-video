#!/usr/bin/env python3
"""Verify committed OpenReel/Resolve acceptance evidence without exposing secrets."""

import argparse
import hashlib
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path


EXPECTED_PROJECT_ID = "vintage-tokyo"
EXPECTED_RESOLVE_VERSION = "21.0.3"
EXPECTED_RESOLVE_BUILD = "21.0.30007"
EXPECTED_CLIPS = 38
EXPECTED_TRACKS = 4
EXPECTED_DURATION_FRAMES = 7_980
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


class AcceptanceError(ValueError):
    """A sanitized acceptance failure safe to print or persist."""


def _require(condition, message):
    if not condition:
        raise AcceptanceError(message)


def _sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _seconds(value):
    _require(isinstance(value, str) and value.endswith("s"), "FCPXML contains an invalid time value")
    try:
        return Fraction(value[:-1])
    except (ValueError, ZeroDivisionError) as error:
        raise AcceptanceError("FCPXML contains an invalid time value") from error


def _duration_frames(fcpxml_path):
    try:
        root = ET.fromstring(fcpxml_path.read_bytes())
    except (OSError, ET.ParseError) as error:
        raise AcceptanceError("FCPXML evidence cannot be read or parsed") from error
    sequence = root.find(".//sequence")
    _require(sequence is not None, "FCPXML evidence has no sequence")
    format_id = sequence.get("format")
    format_node = next((item for item in root.findall(".//format") if item.get("id") == format_id), None)
    _require(format_node is not None, "FCPXML evidence has no matching format")
    frames = _seconds(sequence.get("duration")) / _seconds(format_node.get("frameDuration"))
    _require(frames.denominator == 1, "FCPXML duration is not frame-aligned")
    return int(frames)


def _count(values, label):
    _require(isinstance(values, dict) and values, f"{label} are missing")
    _require(all(isinstance(value, int) and value >= 0 for value in values.values()), f"{label} are invalid")
    return sum(values.values())


def _artifact_evidence(run):
    artifacts = run.get("artifacts")
    _require(isinstance(artifacts, list) and artifacts, "artifact evidence is missing")
    verified = []
    fcpxml_path = None
    for artifact in artifacts:
        _require(isinstance(artifact, dict), "artifact evidence is invalid")
        name = artifact.get("name")
        expected_hash = artifact.get("sha256")
        path_value = artifact.get("path")
        _require(isinstance(name, str) and name, "artifact name is invalid")
        _require(isinstance(expected_hash, str) and SHA256.fullmatch(expected_hash), "artifact hash is invalid")
        _require(isinstance(path_value, str), "artifact location is missing")
        path = Path(path_value)
        _require(path.is_file(), "artifact file is missing")
        _require(_sha256(path) == expected_hash, "artifact hash verification failed")
        verified.append({"name": name, "sha256": expected_hash})
        if name.endswith(".fcpxml"):
            fcpxml_path = path
    _require(fcpxml_path is not None, "FCPXML artifact evidence is missing")
    return verified, fcpxml_path


def _run_baseline(run, revision):
    result = run["result"]
    return {
        "jobId": run["jobId"],
        "revision": revision,
        "projectName": result["projectName"],
        "trackCounts": result["trackCounts"],
        "clipCounts": result["clipCounts"],
        "referencedMediaIds": sorted(result["referencedMediaIds"]),
        "saved": result["saved"],
        "artifactSha256": result["artifactSha256"],
    }


def _verify_run(run, revision):
    _require(isinstance(run, dict), "run evidence is invalid")
    _require(isinstance(run.get("jobId"), str) and UUID.fullmatch(run["jobId"]), "job ID is invalid")
    _require(run.get("revision") == revision, "job revision does not match project revision")
    result = run.get("result")
    _require(isinstance(result, dict), "Resolve result evidence is missing")
    _require(result.get("status") == "success", "Resolve import did not succeed")
    _require(result.get("resolveVersion") == EXPECTED_RESOLVE_VERSION, "Resolve version is not 21.0.3")
    _require(result.get("resolveBuild") == EXPECTED_RESOLVE_BUILD, "Resolve build is not 21.0.30007")
    _require(isinstance(result.get("projectName"), str) and result["projectName"].startswith("Vintage Tokyo"), "Resolve project name is invalid")
    _require(_count(result.get("trackCounts"), "track counts") == EXPECTED_TRACKS, "Resolve track count is not 4")
    _require(_count(result.get("clipCounts"), "clip counts") == EXPECTED_CLIPS, "Resolve clip count is not 38")
    _require(result.get("offlineMediaIds") == [], "Resolve has offline media")
    referenced = result.get("referencedMediaIds")
    _require(
        isinstance(referenced, list)
        and referenced
        and all(isinstance(media_id, str) and media_id for media_id in referenced)
        and len(referenced) == len(set(referenced)),
        "referenced media evidence is invalid",
    )
    _require(result.get("saved") is True, "Resolve project was not saved")
    result_hash = result.get("artifactSha256")
    _require(isinstance(result_hash, str) and SHA256.fullmatch(result_hash), "result artifact hash is invalid")
    artifacts, fcpxml_path = _artifact_evidence(run)
    fcpxml = next(item for item in artifacts if item["name"].endswith(".fcpxml"))
    _require(fcpxml["sha256"] == result_hash, "result and FCPXML artifact hashes differ")
    duration_frames = _duration_frames(fcpxml_path)
    _require(duration_frames == EXPECTED_DURATION_FRAMES, "FCPXML duration is not 7,980 frames")
    return {
        "jobId": run["jobId"],
        "projectName": result["projectName"],
        "trackCounts": result["trackCounts"],
        "clipCounts": result["clipCounts"],
        "referencedMediaCount": len(referenced),
        "artifacts": artifacts,
        "durationFrames": duration_frames,
    }


def verify_evidence(evidence, baseline=None):
    _require(isinstance(evidence, dict), "acceptance evidence is invalid")
    _require(evidence.get("projectId") == EXPECTED_PROJECT_ID, "acceptance evidence is not Vintage Tokyo")
    revision = evidence.get("revision")
    _require(isinstance(revision, str) and SHA40.fullmatch(revision), "project revision is invalid")
    runs = evidence.get("runs")
    _require(isinstance(runs, list) and 1 <= len(runs) <= 2, "acceptance evidence must contain one or two runs")
    verified_runs = [_verify_run(run, revision) for run in runs]
    first_baseline = _run_baseline(runs[0], revision)
    collision_status = "pending-second-run"
    if len(runs) == 2:
        _require(runs[0]["jobId"] != runs[1]["jobId"], "repeat run reused the first job ID")
        _require(runs[0]["result"]["projectName"] != runs[1]["result"]["projectName"], "repeat run reused the first Resolve project name")
        _require(baseline is not None, "first-run baseline is required for collision verification")
        _require(first_baseline == baseline, "first-run evidence changed after the repeat import")
        collision_status = "pass"
    return {
        "verdict": "pass",
        "projectId": EXPECTED_PROJECT_ID,
        "revision": revision,
        "resolveVersion": EXPECTED_RESOLVE_VERSION,
        "resolveBuild": EXPECTED_RESOLVE_BUILD,
        "durationFrames": EXPECTED_DURATION_FRAMES,
        "runs": verified_runs,
        "collisionStatus": collision_status,
        "firstRunBaseline": first_baseline,
        "directResolveSaveTimestampCheck": "pending-live-observation",
    }


def _latest_evidence(project_dir):
    resolve_root = project_dir / "exports" / "resolve"
    records = []
    for job_file in resolve_root.glob("*/job.json"):
        try:
            persisted = json.loads(job_file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AcceptanceError(f"Resolve evidence {job_file.parent.name} could not be read") from error
        job = persisted.get("job", {})
        result = persisted.get("result")
        if job.get("phase") != "completed" or not isinstance(result, dict):
            continue
        artifacts = []
        for artifact in persisted.get("artifacts", []):
            name = artifact.get("name")
            if isinstance(name, str):
                artifacts.append({**artifact, "path": str(job_file.parent / name)})
        records.append((job.get("createdAt", ""), {
            "jobId": job.get("id"),
            "revision": job.get("revision"),
            "result": result,
            "artifacts": artifacts,
        }))
    _require(records, "no completed Resolve evidence is available")
    records.sort(key=lambda item: item[0])
    revision = records[-1][1].get("revision")
    latest = [run for _, run in records if run.get("revision") == revision][-2:]
    return {"projectId": EXPECTED_PROJECT_ID, "revision": revision, "runs": latest}


def _arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="Prepared backend evidence envelope")
    source.add_argument("--latest", action="store_true", help="Read latest committed jobs from the backend project store")
    parser.add_argument("--project-dir", type=Path, help="Vintage Tokyo backend project directory")
    parser.add_argument("--output", type=Path, default=Path("/tmp/openreel-resolve-acceptance/result.json"))
    return parser.parse_args(argv)


def main(argv=None):
    args = _arguments(argv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    baseline_path = args.output.parent / "first-run-baseline.json"
    try:
        if args.input:
            evidence = json.loads(args.input.read_text(encoding="utf-8"))
        else:
            configured = args.project_dir or (Path(os.environ["OPENREEL_PROJECT_DIR"]) if os.environ.get("OPENREEL_PROJECT_DIR") else None)
            _require(configured is not None, "set --project-dir or OPENREEL_PROJECT_DIR for --latest")
            evidence = _latest_evidence(configured)
        baseline = json.loads(baseline_path.read_text(encoding="utf-8")) if baseline_path.is_file() else None
        report = verify_evidence(evidence, baseline=baseline)
        args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if baseline is None:
            baseline_path.write_text(json.dumps(report["firstRunBaseline"], indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"PASS: {report['collisionStatus']}")
        return 0
    except (AcceptanceError, OSError, json.JSONDecodeError) as error:
        failure = {"verdict": "fail", "reason": str(error) if isinstance(error, AcceptanceError) else "acceptance evidence could not be read"}
        args.output.write_text(json.dumps(failure, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"FAIL: {failure['reason']}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
