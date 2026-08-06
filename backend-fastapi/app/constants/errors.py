# app/constants/errors.py
"""Centralized catalog for API error messages."""

from __future__ import annotations


class ErrorMessages:
    """Standardized error messages in Vietnamese."""

    # Auth errors
    TOKEN_MISSING = "Thiếu token xác thực"
    TOKEN_EXPIRED = "Token đã hết hạn"
    TOKEN_INVALID = "Token không hợp lệ hoặc đã hết hạn"
    TOKEN_REVOKED = "Phiên làm việc đã bị thu hồi"
    USER_INVALID = "Người dùng không hợp lệ"
    ACCOUNT_LOCKED = "Tài khoản của bạn hiện đang bị khóa"
    ADMIN_ONLY = "Chỉ quản trị viên mới có quyền thực hiện hành động này"
    CREDENTIALS_MISSING = "Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu"
    CREDENTIALS_INVALID = "Tên đăng nhập hoặc mật khẩu không chính xác"

    # Resource errors
    NOT_FOUND = "Không tìm thấy tài nguyên yêu cầu"
    USER_NOT_FOUND = "Không tìm thấy người dùng"
    # Story 108: defensive — a residual FK conflict while deleting a user maps to
    # a clear 409 instead of a bare 500.
    USER_DELETE_CONFLICT = (
        "Không thể xoá người dùng do còn dữ liệu liên quan ràng buộc"
    )
    # Story 108: defensive — a residual FK conflict while deleting a user maps to
    # a clear 409 instead of a bare 500.
    USER_DELETE_CONFLICT = (
        "Không thể xoá người dùng do còn dữ liệu liên quan ràng buộc"
    )
    ROLE_NOT_FOUND = "Không tìm thấy vai trò"
    ITEM_NOT_FOUND = "Không tìm thấy tài nguyên"
    DOC_NOT_FOUND = "Không tìm thấy tài liệu"
    # Defensive: ingestion deduplicated the upload to a document that belongs to
    # another conversation. Its dedup is conversation-scoped, so this should not
    # happen — but a legacy row has to read as a conflict, not a 500.
    DOC_CONVERSATION_CONFLICT = "Tài liệu này đã thuộc về một hội thoại khác"

    # Permission hierarchy
    ROLE_LEVEL_INSUFFICIENT = (
        "Không thể gán vai trò có cấp độ bằng hoặc "
        "cao hơn cấp độ của bạn"
    )
    PERMISSION_DENIED = "Không có quyền thực hiện hành động này"
    LOCK_ADMIN_DENIED = "Không thể khóa tài khoản quản trị viên"
    UNIT_REQUIRED = "Người dùng phải thuộc về một đơn vị"
    UNIT_HAS_ADMIN = (
        "Đơn vị này đã có quản trị viên; "
        "mỗi đơn vị chỉ được có một quản trị viên"
    )
    ROLE_UNIT_MISMATCH = "Vai trò được chọn không thuộc đơn vị của người dùng"

    # Unit management
    UNIT_NOT_FOUND = "Không tìm thấy đơn vị"
    UNIT_NAME_REQUIRED = "Tên đơn vị không được để trống"
    UNIT_NAME_TAKEN = "Tên đơn vị đã tồn tại"
    UNIT_NOT_EMPTY = (
        "Không thể xoá đơn vị khi vẫn còn người dùng hoặc đơn vị con"
    )
    UNIT_TRANSFER_SAME = "Không thể chuyển dữ liệu sang chính đơn vị đang xoá"
    UNIT_TRANSFER_DESCENDANT = (
        "Không thể chuyển dữ liệu sang đơn vị con của đơn vị đang xoá"
    )
    USERNAME_TAKEN = "Tên đăng nhập đã tồn tại"
    USERNAME_INVALID = (
        "Tên đăng nhập chỉ gồm chữ thường và số, viết liền, không dấu"
    )

    # Document group management
    DOC_GROUP_NOT_FOUND = "Không tìm thấy nhóm tài liệu"
    DOC_GROUP_NAME_REQUIRED = "Tên nhóm tài liệu không được để trống"
    DOC_GROUP_NAME_TAKEN = "Tên nhóm tài liệu đã tồn tại"
    INVALID_FILE_TYPE = "Định dạng file không được hỗ trợ"
    UNIT_FOCUS_REQUIRED = "Vui lòng chọn đơn vị trước khi xem kho tài liệu"
    FORBIDDEN = "Bạn không có quyền truy cập tài nguyên này"

    # Functional / External service errors
    NO_FIELDS_UPDATE = "Không có trường nào để cập nhật"
    INVALID_TYPE = "Loại tài nguyên không hợp lệ"
    MISSING_FIELDS = "Thiếu thông tin bắt buộc"
    UPSTREAM_ERROR = "Lỗi kết nối từ dịch vụ AI"
    PAGE_IMAGE_UNAVAILABLE = "Không tải được ảnh trang gốc"
    PAGE_IMAGE_NOT_FOUND = "Tài liệu chưa có ảnh trang để xem trực tiếp"
    DOC_INVALID = (
        "Một hoặc nhiều tài liệu bạn chọn không còn "
        "tồn tại hoặc đang bị lỗi. Vui lòng làm mới trang."
    )
    DOC_FOREIGN = (
        "Tài liệu không thuộc cuộc hội thoại này. "
        "Vui lòng làm mới trang."
    )
    NO_DOCUMENT_SELECTED = (
        "Vui lòng chọn ít nhất một tài liệu để hỏi đáp."
    )
    READONLY_CORPUS = (
        "Dev Space chỉ đọc kho tài liệu thật — không cho phép tải lên, "
        "xử lý lại hay xoá tài liệu. Dùng \"Chọn từ kho\" để đưa tài liệu "
        "có sẵn vào hội thoại."
    )
