// src/features/chat/pages/Chat.js
import "./Chat.css";
import React, { useState, useEffect } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as EditIcon } from "assets/images/edit.svg";
import { ReactComponent as AddIcon } from "assets/images/add.svg";
import { ReactComponent as UploadIcon } from "assets/images/upload.svg";
import { ReactComponent as FolderStarIcon } from "assets/images/folder-star.svg";
import { ReactComponent as MoreVertIcon } from "assets/images/more-vert.svg";
import { ConversationTitleDropdown, ActionMenu } from "components";
import { AnalysisSection } from "features/analysis/components";
import { ChatInterface } from "../components";
import { DocumentSelect, UploadFileModal } from "features/documents/components";
import RepoPickerModal from "features/documents/components/repoPicker/RepoPickerModal";
import UnitFocusModal from "features/admin/components/UnitFocusModal";
import { isRepoSuperAdmin } from "lib/roles";
import DocumentViewer from "features/documents/components/viewer/DocumentViewer";
import ResizeHandle from "features/documents/components/viewer/ResizeHandle";
import {
  openViewer,
  closeViewer,
  isViewerOpen,
  sourceViewerDoc,
} from "features/documents/components/viewer/viewerHost";
import {
  clampSplitRatio,
  DEFAULT_SPLIT_RATIO,
} from "features/documents/components/viewer/viewerUtils";
import { DeleteModal, EditModal, AlertModal } from "components";
import useModalStore from "stores/useModalStore";
import useAuthStore from "stores/useAuthStore";
import useChatStore from "stores/useChatStore";
import useDocumentStore from "stores/useDocumentStore";
import { markRepositoryDocumentRead } from "features/admin/api";
import { resetWorkspace } from "stores/resetWorkspace";


export default function Chat() {
    const { user } = useAuthStore();
    const {
        conversations, convLoading, selectedConvId, setSelectedConvId,
        fetchConversations, createConversation, deleteConversation, renameConversation,
    } = useChatStore();
    const { selectedDocumentIds, uploadFiles } = useDocumentStore();

    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState("chat"); // "doc", "chat", "analysis"
    const [actionMenuOpen, setActionMenuOpen] = useState(false);
    const [actionMenuPos, setActionMenuPos] = useState({ x: 0, y: 0 });
    // Story 15: the right column shows either "Bảng thông tin" (AnalysisSection)
    // or the Document Viewer. viewerDoc=null means analysis is shown. The
    // analysis state lives in its own store, so toggling never resets it.
    const [viewerDoc, setViewerDoc] = useState(null);
    // Story 135: bumped on every citation click so the viewer re-focuses the
    // cited page even when it is already open on the same document + page (the
    // user may have scrolled away). documentId/page alone don't change, so this
    // nonce is what re-arms the one-shot focus inside DocumentViewer.
    const [focusNonce, setFocusNonce] = useState(0);
    const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
    const bodyRef = React.useRef(null);

    const handlePreviewDoc = React.useCallback((doc) => {
        setViewerDoc((prev) => openViewer(prev, doc));
        // Story 54: opening a REPOSITORY document marks it read for this user
        // (data only — regular users get no badge/highlight yet). Fire-and-forget;
        // a non-repo conversation doc is skipped so the read table stays clean.
        const list = useDocumentStore.getState().documents || [];
        const full = list.find((x) => x.id === doc?.id);
        if (full?.from_repository) {
            markRepositoryDocumentRead(doc.id).catch(() => {});
        }
    }, []);
    const handleCloseViewer = React.useCallback(() => {
        setViewerDoc(closeViewer());
    }, []);
    // Story 109: open the viewer from a chat citation. Resolve the cited
    // document_id + page against THIS conversation's documents, open the viewer
    // at that page, and (mobile) switch to the panel that hosts it. Returns false
    // when the cited doc is not part of this session so the caller falls back to
    // the SourceCard text popover.
    const handleOpenSourceDoc = React.useCallback((source, answerText) => {
        const docs = useDocumentStore.getState().documents || [];
        const target = sourceViewerDoc(source, docs, answerText);
        if (!target) return false;
        setViewerDoc(target);
        // Story 135: re-arm the viewer's citation focus on every click, so a
        // click always jumps to the cited page + highlight — even onto a
        // different open document, or the same page after scrolling away.
        setFocusNonce((n) => n + 1);
        setActiveTab("analysis");
        const full = docs.find((x) => String(x.id) === String(target.id));
        if (full?.from_repository) {
            markRepositoryDocumentRead(target.id).catch(() => {});
        }
        return true;
    }, []);
    const getBodyRect = React.useCallback(
        () => bodyRef.current?.getBoundingClientRect(),
        []
    );

    const { showModal, hideModal } = useModalStore();

    // Story 16: open the repository picker. Requires an active conversation so
    // the chosen docs can be linked into it.
    // Story 35: a super-admin has no own unit, so first focus a unit (pre-step)
    // and open the picker scoped to it; a unit user/admin opens it directly.
    const openRepoPicker = React.useCallback((unitId, unitName) => {
        showModal(RepoPickerModal, {
            unitName,
            unitId,
            userId: user?.id,
            conversationId: selectedConvId,
            onImported: () => {
                useDocumentStore.getState().fetchDocuments(user?.id, selectedConvId);
            },
        });
    }, [user?.id, selectedConvId, showModal]);

    const handleOpenRepoPicker = React.useCallback(() => {
        if (!selectedConvId) {
            showModal(AlertModal, {
                title: "Tạo sổ ghi chú trước",
                message: "Vui lòng tạo hoặc chọn một sổ ghi chú trước khi chọn tài liệu kho.",
            });
            return;
        }
        if (isRepoSuperAdmin(user)) {
            // Pre-step: choose which unit's repository to browse.
            showModal(UnitFocusModal, {
                currentUnitId: null,
                onSelect: (unit) => openRepoPicker(unit.id, unit.name),
            });
        } else {
            openRepoPicker(undefined, user?.unit_name);
        }
    }, [selectedConvId, user, showModal, openRepoPicker]);
    const navigate = useNavigate();
    const location = useLocation();
    const { conversationId } = useParams();

    // Fetch conversations on mount
    useEffect(() => {
        fetchConversations(user?.id);
    }, [user?.id, fetchConversations]);

    // Story 15: auto-close the viewer (restore "Bảng thông tin") whenever the
    // active conversation changes, so the viewer never sticks across docs.
    useEffect(() => {
        setViewerDoc(closeViewer());
    }, [selectedConvId]);

    async function handleUploadFiles(files) {
        hideModal();
        // Guard: conversation must exist (enforced by UI, but double-check here)
        if (!selectedConvId) return;
        const result = await uploadFiles(user.id, selectedConvId, files, {
            onError: (msg) => setError(msg),
        });

        // Show inform modal on partial or total failure
        if (result.errorCount > 0) {
            const errorDetails = result.errors && result.errors.length > 0
                ? "\n\nChi tiết lỗi:\n" + result.errors.map(err => `- ${err}`).join("\n")
                : "";
            if (result.successCount > 0) {
                showModal(AlertModal, {
                    title: "Kết quả tải tài liệu",
                    message: `Tải thành công ${result.successCount} tài liệu, ${result.errorCount} tài liệu thất bại.${errorDetails}`,
                });
            } else {
                showModal(AlertModal, {
                    title: "Tải tài liệu thất bại",
                    message: `Không thể tải ${result.errorCount} tài liệu. Vui lòng thử lại.${errorDetails}`,
                });
            }
        }
    }

    async function confirmDeleteConversation(targetId) {
        if (!targetId) return;
        try {
            await deleteConversation(user.id, targetId);
            if (String(targetId) === String(selectedConvId)) {
                resetWorkspace();
                navigate("/chat");
            }
            hideModal();
        } catch (e) {
            console.error("Delete conversation failed", e);
            setError(e.message || "Xoá sổ ghi chú thất bại");
        }
    }

    async function confirmRenameConversation(newName, convId) {
        if (!convId) return;
        try {
            await renameConversation(user.id, convId, newName);
            hideModal();
        } catch (e) {
            console.error("Rename conversation failed:", e);
            setError(e.message || "Đổi tên sổ ghi chú thất bại");
        }
    }

    async function handleCreateConversation() {
        try {
            resetWorkspace();
            const newConv = await createConversation(user.id);
            setSelectedConvId(newConv.id);
            navigate(`/chat/${newConv.id}`);
        } catch (err) {
            console.error("Create conversation failed:", err);
        }
    }

    function handleSelectConversation(id) {
        const target = `/chat/${id}`;
        if (location.pathname !== target) {
            useChatStore.getState().switchConversation(id);
            useDocumentStore.getState().clearDocuments();
            navigate(target);
        }
    }

    const handleMoreClick = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        // Position menu so it drops down from the icon, aligning right edge with the icon roughly
        setActionMenuPos({ x: rect.right - 150, y: rect.bottom + 8 });
        setActionMenuOpen(true);
    };

    const handleActionMenuClose = () => {
        setActionMenuOpen(false);
    };

    const handleActionMenuAction = async (action) => {
        if (action === "rename") {
            const conv = conversations.find(c => String(c.id) === String(selectedConvId));
            showModal(EditModal, {
                title: "Đổi tên sổ ghi chú", label: "Tên mới", placeholder: "Nhập tên mới…",
                initialValue: conv?.name || "", maxLength: 200,
                onConfirm: async (newName) => { await confirmRenameConversation(newName, selectedConvId); }
            });
        } else if (action === "delete") {
            const conv = conversations.find(c => String(c.id) === String(selectedConvId));
            showModal(DeleteModal, {
                title: "Xoá sổ ghi chú",
                message: `Bạn chắc chắn muốn xoá sổ ghi chú "${conv?.name || `#${selectedConvId}`}"? Hành động không thể hoàn tác.`,
                cancelLabel: "Huỷ", confirmLabel: "Đồng ý",
                onConfirm: async () => { await confirmDeleteConversation(selectedConvId); }
            });
        }
    };

    useEffect(() => {
        if (!conversationId) return;
        const convIdNum = Number(conversationId);
        if (Number.isNaN(convIdNum)) {
            navigate("/chat", { replace: true });
        } else if (convIdNum !== selectedConvId) {
            setSelectedConvId(convIdNum);
        }
    }, [conversationId, selectedConvId, navigate, setSelectedConvId]);

    useEffect(() => {
        const isChatRoot = location.pathname === "/chat" || location.pathname === "/chat/";
        if (isChatRoot) {
            if (selectedConvId !== null || selectedDocumentIds.length) {
                resetWorkspace();
            }
        }
    }, [location.pathname, selectedConvId, selectedDocumentIds.length]);

    const viewerOpen = isViewerOpen(viewerDoc);

    return (
        <div className="chat-body" ref={bodyRef}>
            <div className="chat-mobile-tabs">
                <div 
                    className={`chat-tab ${activeTab === 'doc' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('doc')}
                >
                    Quản lý tài liệu
                    <div className="tab-indicator" />
                </div>
                <div 
                    className={`chat-tab ${activeTab === 'chat' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('chat')}
                >
                    Cuộc trò chuyện
                    <div className="tab-indicator" />
                </div>
                <div 
                    className={`chat-tab ${activeTab === 'analysis' ? 'active' : ''}`} 
                    onClick={() => setActiveTab('analysis')}
                >
                    Bảng thông tin
                    <div className="tab-indicator" />
                </div>
            </div>

            <div className={`document-panel ${activeTab !== 'doc' ? 'mobile-hidden' : ''}`}>
                <header className="panel-header desktop-only">
                    <div className="panel-header-row"><h3 className="panel-title">Quản lý tài liệu</h3></div>
                    <div className="panel-divider" />
                </header>
                <div className="panel-body">
                    <div className="panel-nav" onClick={handleCreateConversation}>
                        <span className="panel-nav-icon"><AddIcon /></span>
                        <span className="panel-nav-label">Tạo sổ ghi chú mới</span>
                    </div>
                    <div className="panel-nav" onClick={() => {
                        if (!selectedConvId) {
                            showModal(AlertModal, {
                                title: "Tạo sổ ghi chú trước",
                                message: "Vui lòng tạo hoặc chọn một sổ ghi chú trước khi tải tài liệu.",
                            });
                            return;
                        }
                        showModal(UploadFileModal, { onUpload: handleUploadFiles });
                    }}>
                        <span className="panel-nav-icon"><UploadIcon /></span>
                        <span className="panel-nav-label">Tải tài liệu lên</span>
                    </div>
                    <div className="panel-nav" onClick={handleOpenRepoPicker}>
                        <span className="panel-nav-icon"><FolderStarIcon /></span>
                        <span className="panel-nav-label">Chọn từ kho tài liệu</span>
                    </div>
                    <DocumentSelect
                        selectAllLabel="Chọn tất cả các tài liệu"
                        onPreview={handlePreviewDoc}
                    />
                </div>
            </div>

            <div className={`conversation-panel ${activeTab !== 'chat' ? 'mobile-hidden' : ''}`}>
                <header className="panel-header">
                    <div className="panel-header-row">
                        <div className="panel-title">
                            <ConversationTitleDropdown
                                conversations={conversations}
                                selectedId={selectedConvId}
                                onChange={(id) => { if (String(id) !== String(selectedConvId)) handleSelectConversation(id); }}
                                onDeleteItem={(id, name) => {
                                    showModal(DeleteModal, {
                                        title: "Xoá sổ ghi chú",
                                        message: `Bạn chắc chắn muốn xoá sổ ghi chú "${name || `#${id}`}"? Hành động không thể hoàn tác.`,
                                        cancelLabel: "Huỷ",confirmLabel: "Đồng ý",
                                        onConfirm: async () => { await confirmDeleteConversation(id); }
                                    });
                                }}
                                placeholder={convLoading ? "Đang tải sổ ghi chú..." : "Chọn sổ ghi chú"}
                            />
                        </div>
                        <span className="panel-action">
                            {selectedConvId != null && (
                                <>
                                    <EditIcon className="desktop-actions" onClick={() => {
                                        const conv = conversations.find(c => String(c.id) === String(selectedConvId));
                                        showModal(EditModal, {
                                            title: "Đổi tên sổ ghi chú", label: "Tên mới", placeholder: "Nhập tên mới…",
                                            initialValue: conv?.name || "", maxLength: 200,
                                            onConfirm: async (newName) => { await confirmRenameConversation(newName, selectedConvId); }
                                        });
                                    }} />
                                    <DeleteIcon className="desktop-actions" onClick={() => {
                                        const conv = conversations.find(c => String(c.id) === String(selectedConvId));
                                        showModal(DeleteModal, {
                                            title: "Xoá sổ ghi chú",
                                            message: `Bạn chắc chắn muốn xoá sổ ghi chú "${conv?.name || `#${selectedConvId}`}"? Hành động không thể hoàn tác.`,
                                            cancelLabel: "Huỷ", confirmLabel: "Đồng ý",
                                            onConfirm: async () => { await confirmDeleteConversation(selectedConvId); }
                                        });
                                    }} />
                                    <MoreVertIcon className="mobile-actions" onClick={handleMoreClick} />
                                </>
                            )}
                        </span>
                    </div>
                    <div className="panel-divider" />
                </header>
                <ActionMenu
                    open={actionMenuOpen}
                    x={actionMenuPos.x - 40}
                    y={actionMenuPos.y}
                    onClose={handleActionMenuClose}
                    onAction={handleActionMenuAction}
                    editLabel="Sửa sổ ghi chú"
                    deleteLabel="Xoá sổ ghi chú"
                />
                <ChatInterface
                    onUpload={handleUploadFiles}
                    onOpenSourceDoc={handleOpenSourceDoc}
                />
            </div>

            {viewerOpen && (
                <ResizeHandle
                    onResize={(r) => setSplitRatio(clampSplitRatio(1 - r))}
                    getContainerRect={getBodyRect}
                />
            )}

            <div
                className={`analysis-panel ${activeTab !== 'analysis' ? 'mobile-hidden' : ''}`}
                // Story 60: no Math.round — sub-percent precision so the pane lands
                // exactly where the drag ghost did (N4: divider tracks the cursor).
                style={viewerOpen ? { flex: `0 0 ${(splitRatio * 100).toFixed(2)}%` } : undefined}
            >
                {viewerOpen ? (
                    <DocumentViewer
                        documentId={viewerDoc.id}
                        documentName={viewerDoc.name}
                        initialPage={viewerDoc.page}
                        highlightText={viewerDoc.highlight}
                        highlightCharStart={viewerDoc.charStart}
                        highlightCharEnd={viewerDoc.charEnd}
                        highlightAnswer={viewerDoc.answer}
                        highlightSegments={viewerDoc.segments}
                        focusNonce={focusNonce}
                        userId={user?.id}
                        conversationId={selectedConvId}
                        onClose={handleCloseViewer}
                    />
                ) : (
                    <>
                        <header className="panel-header desktop-only">
                            <div className="panel-header-row"><h3 className="panel-title">Bảng thông tin</h3></div>
                            <div className="panel-divider" />
                        </header>
                        <div className="panel-body">
                            <AnalysisSection
                                onCreated={() => { }}
                                onRemoved={() => { }}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
