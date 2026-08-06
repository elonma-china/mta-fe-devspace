"""Processing and upstream status constants."""


class ProcessingStatus:
    PENDING = "PENDING"
    UPLOADED = "UPLOADED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    ERROR = "ERROR"
    # Story 48: manual admin review status — set only via the approve endpoint
    # after a document is COMPLETED. Terminal (never changed by AI ingest sync).
    APPROVED = "APPROVED"


class UpstreamStatus:
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    # Celery task state, as returned by /documents/task/{id}.
    FAILURE = "FAILURE"
    # The document's own state, as returned by /documents/{id}/status. Different
    # word for the same outcome, and both reach the mapping.
    FAILED = "FAILED"
