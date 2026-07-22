"""Thin, stdlib-only adapter between an OpenReel redemption and Resolve's API."""

import hashlib
import json
import os
import tempfile
import xml.etree.ElementTree as ET
from fractions import Fraction
from pathlib import Path
from urllib.parse import unquote, urlparse


ERROR_MESSAGES = {
    "ARTIFACT_HASH_MISMATCH": "A Resolve import artifact failed integrity verification.",
    "FCPXML_REJECTED": "Resolve could not import or verify the exported timeline.",
    "SAVE_FAILED": "Resolve could not save the imported project.",
    "OFFLINE_MEDIA": "Resolve imported the timeline with offline media.",
    "RESOLVE_UI_UNEXPECTED": "The required Resolve project API is unavailable.",
}

AUDIO_EXTENSIONS = {
    ".aac",
    ".aif",
    ".aiff",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".wav",
}


class BridgeFailure(Exception):
    def __init__(self, code):
        super().__init__(ERROR_MESSAGES[code])
        self.code = code


def _require(value):
    if value is None or value is False:
        raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
    return value


def _validate_request(request):
    if not isinstance(request, dict) or set(request) != {
        "jobId",
        "projectId",
        "revision",
        "artifacts",
    }:
        raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
    if not all(isinstance(request.get(key), str) and request[key] for key in ("jobId", "projectId", "revision")):
        raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
    if not isinstance(request["artifacts"], list) or not request["artifacts"]:
        raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
    for artifact in request["artifacts"]:
        if not isinstance(artifact, dict) or set(artifact) != {
            "name",
            "url",
            "mediaType",
            "byteLength",
            "sha256",
        }:
            raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
        if not all(isinstance(artifact.get(key), str) and artifact[key] for key in ("name", "url", "mediaType", "sha256")):
            raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
        if not isinstance(artifact.get("byteLength"), int) or artifact["byteLength"] < 0:
            raise BridgeFailure("RESOLVE_UI_UNEXPECTED")


def _download_verified_artifacts(request, backend):
    verified = {}
    for artifact in request["artifacts"]:
        try:
            content = backend.fetch_artifact(artifact["url"])
        except Exception:
            raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
        if not isinstance(content, bytes):
            raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
        digest = hashlib.sha256(content).hexdigest()
        if len(content) != artifact["byteLength"] or digest != artifact["sha256"]:
            raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
        verified[artifact["name"]] = content
    return verified


def _artifact(request, suffix):
    for artifact in request.get("artifacts", []):
        if artifact.get("name", "").lower().endswith(suffix):
            return artifact
    return None


def _parse_fraction(value):
    if not isinstance(value, str) or not value.endswith("s"):
        raise BridgeFailure("FCPXML_REJECTED")
    try:
        return Fraction(value[:-1])
    except (ValueError, ZeroDivisionError):
        raise BridgeFailure("FCPXML_REJECTED")


def _source_path(source):
    parsed = urlparse(source)
    if parsed.scheme != "file" or parsed.netloc not in ("", "localhost"):
        raise BridgeFailure("FCPXML_REJECTED")
    path = unquote(parsed.path)
    if not os.path.isabs(path):
        raise BridgeFailure("FCPXML_REJECTED")
    return path


def _parse_fcpxml(content):
    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        raise BridgeFailure("FCPXML_REJECTED")

    project = root.find(".//project")
    sequence = root.find(".//sequence")
    if project is None or sequence is None or not project.get("name"):
        raise BridgeFailure("FCPXML_REJECTED")

    formats = {item.get("id"): item for item in root.findall(".//format")}
    sequence_format = formats.get(sequence.get("format"))
    if sequence_format is None:
        raise BridgeFailure("FCPXML_REJECTED")
    frame_duration = _parse_fraction(sequence_format.get("frameDuration"))
    duration_frames = int(_parse_fraction(sequence.get("duration")) / frame_duration)

    assets = {item.get("id"): item for item in root.findall(".//asset")}
    source_directories = []
    for asset in assets.values():
        source = asset.get("src")
        if source:
            source_directories.append(os.path.dirname(_source_path(source)))
    if not source_directories:
        raise BridgeFailure("FCPXML_REJECTED")
    media_root = os.path.commonpath(source_directories)

    lanes = {"video": set(), "audio": set()}
    clip_counts = {"video": 0, "audio": 0}
    for clip in root.findall(".//asset-clip"):
        asset = assets.get(clip.get("ref"))
        if asset is None:
            raise BridgeFailure("FCPXML_REJECTED")
        source_name = asset.get("name") or _source_path(asset.get("src", ""))
        kind = "audio" if Path(source_name).suffix.lower() in AUDIO_EXTENSIONS else "video"
        lanes[kind].add(clip.get("lane", "0"))
        clip_counts[kind] += 1

    track_counts = {kind: len(kind_lanes) for kind, kind_lanes in lanes.items()}
    return {
        "projectName": project.get("name"),
        "timelineName": project.get("name"),
        "durationFrames": duration_frames,
        "mediaRoot": media_root,
        "trackCounts": track_counts,
        "clipCounts": clip_counts,
    }


def _parse_manifest(content, request):
    try:
        manifest = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
    if not isinstance(manifest, dict):
        raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
    if (
        manifest.get("jobId") != request["jobId"]
        or manifest.get("projectId") != request["projectId"]
        or manifest.get("revision") != request["revision"]
    ):
        raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
    required = manifest.get("requiredMedia")
    if not isinstance(required, list):
        raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
    media_ids = []
    for item in required:
        if not isinstance(item, dict) or not isinstance(item.get("mediaId"), str):
            raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
        media_ids.append(item["mediaId"])
    return media_ids


def collision_safe_name(existing_names, desired_name, current_name):
    existing = {name for name in existing_names if name != current_name}
    if desired_name not in existing:
        return desired_name
    suffix = 2
    while "%s (%d)" % (desired_name, suffix) in existing:
        suffix += 1
        if suffix > 10000:
            raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
    return "%s (%d)" % (desired_name, suffix)


def _version(resolve):
    version = "unknown"
    build = "unknown"
    try:
        candidate = resolve.GetVersionString()
        if candidate:
            version = str(candidate)
    except Exception:
        pass
    try:
        parts = resolve.GetVersion()
        if isinstance(parts, (list, tuple)) and len(parts) > 3 and parts[3] is not None:
            build = str(parts[3])
    except Exception:
        pass
    return version, build


def _folder_items(folder):
    items = list(_require(folder.GetClipList()))
    for subfolder in _require(folder.GetSubFolderList()):
        items.extend(_folder_items(subfolder))
    return items


def _media_id(item):
    try:
        value = item.GetUniqueId()
        return str(value) if value else "unknown"
    except Exception:
        return "unknown"


def _is_offline(item):
    try:
        value = item.GetClipProperty("Offline")
    except TypeError:
        properties = item.GetClipProperty()
        value = properties.get("Offline") if isinstance(properties, dict) else None
    except Exception:
        return True
    return str(value).strip().lower() in {"1", "true", "yes", "offline"}


def _timeline_evidence(timeline):
    track_counts = {}
    clip_counts = {}
    for kind in ("video", "audio"):
        count = int(timeline.GetTrackCount(kind))
        track_counts[kind] = count
        clip_counts[kind] = sum(
            len(timeline.GetItemListInTrack(kind, index) or [])
            for index in range(1, count + 1)
        )
    return track_counts, clip_counts


def _base_result(resolve, request):
    version, build = _version(resolve)
    fcpxml = _artifact(request, ".fcpxml") or {}
    return {
        "requestId": request.get("jobId", "00000000-0000-4000-8000-000000000000"),
        "status": "failed",
        "resolveVersion": version,
        "resolveBuild": build,
        "projectName": "OpenReel Import",
        "trackCounts": {},
        "clipCounts": {},
        "offlineMediaIds": [],
        "referencedMediaIds": [],
        "saved": False,
        "artifactSha256": fcpxml.get("sha256", "0" * 64),
    }


def run_import(resolve, request, backend):
    """Import one redeemed OpenReel job into Resolve's current project."""

    result = _base_result(resolve, request if isinstance(request, dict) else {})
    try:
        _validate_request(request)
        project_manager = _require(resolve.GetProjectManager())
        project = _require(project_manager.GetCurrentProject())
        media_pool = _require(project.GetMediaPool())

        verified = _download_verified_artifacts(request, backend)
        fcpxml_descriptor = _artifact(request, ".fcpxml")
        manifest_descriptor = _artifact(request, "manifest.json")
        if fcpxml_descriptor is None or manifest_descriptor is None:
            raise BridgeFailure("ARTIFACT_HASH_MISMATCH")
        fcpxml = verified[fcpxml_descriptor["name"]]
        imported = _parse_fcpxml(fcpxml)
        referenced_media_ids = _parse_manifest(
            verified[manifest_descriptor["name"]],
            request,
        )
        result.update(
            {
                "projectName": imported["projectName"],
                "timelineName": imported["timelineName"],
                "durationFrames": imported["durationFrames"],
                "referencedMediaIds": referenced_media_ids,
            }
        )

        with tempfile.TemporaryDirectory(prefix="openreel-resolve-") as temporary_root:
            fcpxml_path = os.path.join(temporary_root, "timeline.fcpxml")
            with open(fcpxml_path, "wb") as handle:
                handle.write(fcpxml)
                handle.flush()
                os.fsync(handle.fileno())
            timeline = media_pool.ImportTimelineFromFile(
                fcpxml_path,
                {
                    "timelineName": imported["timelineName"],
                    "importSourceClips": True,
                    "sourceClipsPath": imported["mediaRoot"],
                },
            )
        if timeline is None:
            raise BridgeFailure("FCPXML_REJECTED")

        current_name = _require(project.GetName())
        final_name = collision_safe_name(
            _require(project_manager.GetProjectListInCurrentFolder()),
            imported["projectName"],
            current_name,
        )
        if not project_manager.RenameProject(current_name, final_name):
            raise BridgeFailure("RESOLVE_UI_UNEXPECTED")
        result["projectName"] = final_name

        if timeline.GetName() != imported["timelineName"]:
            raise BridgeFailure("FCPXML_REJECTED")
        duration_frames = int(timeline.GetEndFrame()) - int(timeline.GetStartFrame())
        track_counts, clip_counts = _timeline_evidence(timeline)
        result.update(
            {
                "durationFrames": duration_frames,
                "trackCounts": track_counts,
                "clipCounts": clip_counts,
            }
        )
        if (
            duration_frames != imported["durationFrames"]
            or track_counts != imported["trackCounts"]
            or clip_counts != imported["clipCounts"]
            or project.GetName() != final_name
        ):
            raise BridgeFailure("FCPXML_REJECTED")

        offline_ids = sorted(
            _media_id(item)
            for item in _folder_items(_require(media_pool.GetRootFolder()))
            if _is_offline(item)
        )
        result["offlineMediaIds"] = offline_ids
        if offline_ids:
            raise BridgeFailure("OFFLINE_MEDIA")

        if not project_manager.SaveProject():
            raise BridgeFailure("SAVE_FAILED")
        result["saved"] = True
        result["status"] = "completed"
    except BridgeFailure as failure:
        result["status"] = "failed"
        result["saved"] = False
        result["failure"] = {
            "code": failure.code,
            "message": ERROR_MESSAGES[failure.code],
        }
    except Exception:
        result["status"] = "failed"
        result["saved"] = False
        result["failure"] = {
            "code": "RESOLVE_UI_UNEXPECTED",
            "message": ERROR_MESSAGES["RESOLVE_UI_UNEXPECTED"],
        }

    backend.post_result(request.get("projectId", "unknown"), request.get("jobId", "unknown"), result)
    return result
