import unittest

from identity import create_transcription_job_id


class TranscriptionJobIdentityTests(unittest.TestCase):
    def test_creates_prefixed_path_safe_non_uuid_identity(self):
        job_id = create_transcription_job_id(
            now_ns=lambda: 0x1234,
            token_hex=lambda: "ab" * 16,
        )

        self.assertEqual(
            job_id,
            "transcription-job-1234-abababababababababababababababab",
        )
        self.assertNotRegex(
            job_id,
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        )


if __name__ == "__main__":
    unittest.main()
