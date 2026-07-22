import secrets
import time
from collections.abc import Callable


def create_transcription_job_id(
    *,
    now_ns: Callable[[], int] = time.time_ns,
    token_hex: Callable[[], str] = lambda: secrets.token_hex(16),
) -> str:
    timestamp = now_ns()
    entropy = token_hex()
    if timestamp < 0 or not entropy or not entropy.isalnum() or not entropy.islower():
        raise ValueError("invalid transcription job identity entropy")
    return f"transcription-job-{timestamp:x}-{entropy}"
