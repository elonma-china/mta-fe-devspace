"""Audit action and entity type constants."""


class AuditEntityTypes:
    USER = "user"
    UNIT = "unit"
    CONVERSATION = "conversation"
    DOCUMENT = "document"
    DOCUMENT_GROUP = "document_group"
    INFO_TABLE = "info_table"
    LLM = "llm"
    TOOL = "tool"


class AuditActions:
    # Auth & User
    AUTH_LOGIN_SUCCESS = "auth.login.success"
    AUTH_LOGIN_FAILED = "auth.login.failed"
    USER_CREATE = "user.create"
    USER_UPDATE = "user.update"
    USER_DELETE = "user.delete"
    USER_FORCE_LOGOUT = "user.force_logout"
    USER_LOCK = "user.lock"
    USER_UNLOCK = "user.unlock"

    # Unit
    UNIT_CREATE = "unit.create"
    UNIT_UPDATE = "unit.update"
    UNIT_DELETE = "unit.delete"

    # Document group
    DOCUMENT_GROUP_CREATE = "document_group.create"
    DOCUMENT_GROUP_UPDATE = "document_group.update"
    DOCUMENT_GROUP_DELETE = "document_group.delete"

    # Conversation
    CONVERSATION_CREATE = "conversation.create"
    CONVERSATION_DELETE = "conversation.delete"
    CONVERSATION_RENAME = "conversation.rename"

    # Document
    DOCUMENT_UPLOAD = "conversation.documents.upload"
    DOCUMENT_DELETE = "conversation.documents.delete"
    DOCUMENT_RENAME = "conversation.documents.rename"
    DOCUMENT_STATUS = "conversation.documents.status"
    DOCUMENT_UPDATE = "document.update"

    # Info Table
    INFO_TABLE_CREATE = "conversation.info_table.create"
    INFO_TABLE_DELETE = "conversation.info_table.delete"

    # LLM
    LLM_QUERY_STREAM_REQUEST = "llm.query.stream.request"
    LLM_QUERY_STREAM_UPSTREAM_ERROR = "llm.query.stream.upstream_error"
    LLM_QUERY_STREAM_ERROR = "llm.query.stream.error"

    # Tool
    TOOL_INVOKE = "tool.invoke"
    TOOL_PROXY_ERROR = "tool.proxy.error"
    TOOL_STATUS = "tool.status"
