// src/features/chat/components/ChatInterface.js
import React, { useState, useEffect, useRef, useCallback } from "react";
import "./ChatInterface.css";
import { ReactComponent as SendIcon } from "assets/images/send.svg";
import { UploadFileSection, SourceCard, UploadFileModal } from "features/documents/components";
import { AlertModal } from "components/common";
import ChatMessageItem from "./ChatMessageItem";
import MicButton from "./MicButton";
import ThinkingSection from "./ThinkingSection";
import { resizeTextarea } from "./resizeTextarea";
import { isSelectionRequired, resolveSendDocIds } from "./chatSendGuard";
import useAuthStore from "stores/useAuthStore";
import useDocumentStore from "stores/useDocumentStore";
import useChatStore from "stores/useChatStore";
import useModalStore from "stores/useModalStore";
import { copyTextToClipboard } from "utils/helpers";

export default function ChatInterface({
  onUpload,
  onOpenSourceDoc,
  loadingCaption = "Hệ thống đang xử lý",
  placeholder = "Nhập nội dung trò chuyện",
}) {
  const { user } = useAuthStore();
  const { selectedConvId, fetchConversations } = useChatStore();
  const { selectedDocumentIds, numDocuments, documents } = useDocumentStore();
  const { showModal } = useModalStore();

  const scrollWrapRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  // Story 131: hover-preview close timer (cancelable when the pointer moves onto
  // the card, so users can read/scroll it).
  const hoverTimer = useRef(null);

  // ── Chat store ──
  const {
    messages,
    isStreaming,
  } = useChatStore();

  const sendMessage = useChatStore((s) => s.send);
  const stopStream = useChatStore((s) => s.stop);

  // Hydrate messages when conversation changes
  useEffect(() => {
    useChatStore.getState().hydrateMessages(user?.id, selectedConvId);
  }, [user?.id, selectedConvId]);

  const [input, setInput] = useState("");
  const [copyState, setCopyState] = useState({ index: null, message: "" });
  const [srcPopup, setSrcPopup] = useState({ open: false, ansIdx: null, srcIdx: null, x: 0, y: 0 });

  const scrollToBottom = (smooth = true) => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    } else if (scrollWrapRef.current) {
      scrollWrapRef.current.scrollTop = scrollWrapRef.current.scrollHeight;
    }
  };

  // Story 137: goes through the shared helper so copying also works when the
  // page is served over plain HTTP, where `navigator.clipboard` is absent.
  // The two labels and the 1s reset are unchanged.
  const handleCopy = useCallback(async (text, i) => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    setCopyState({ index: i, message: ok ? "Đã copy" : "Copy lỗi" });
    setTimeout(() => setCopyState({ index: null, message: "" }), 1000);
  }, []);

  // Story 109: CLICKING a citation opens the document viewer at the cited page.
  // If the cited doc is not part of this session (onOpenSourceDoc returns false),
  // fall back to the SourceCard text popover (the previous behavior). Story 131:
  // when the viewer opens, dismiss any hover-preview popup.
  const openSourceCard = useCallback((ansIdx, srcIdx, evt) => {
    const msg = useChatStore.getState().messages?.[ansIdx];
    const src = msg?.sources?.[srcIdx];
    // The answer narrows the highlight: the cited chunk is window-enriched and
    // on a short document covers all of it, so on its own it marks the whole page.
    if (src && onOpenSourceDoc && onOpenSourceDoc(src, msg?.content)) {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
      setSrcPopup((s) => ({ ...s, open: false }));
      return;
    }
    setSrcPopup({ open: true, ansIdx, srcIdx, x: evt?.clientX ?? 0, y: evt?.clientY ?? 0 });
  }, [onOpenSourceDoc]);

  // Story 131: HOVERING a citation shows a NotebookLM-style preview card (source
  // document name + page + enriched_content). The card carries a "Mở tài liệu"
  // button that opens the full viewer (keeps the story-109 affordance).
  const previewSource = useCallback((ansIdx, srcIdx, evt) => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    setSrcPopup({ open: true, ansIdx, srcIdx, x: evt?.clientX ?? 0, y: evt?.clientY ?? 0 });
  }, []);
  const hideSourcePreview = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(
      () => setSrcPopup((s) => ({ ...s, open: false })),
      200
    );
  }, []);
  const cancelHidePreview = useCallback(() => {
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }, []);
  const openSourceFromCard = useCallback(() => {
    const msg = useChatStore.getState().messages?.[srcPopup.ansIdx];
    const src = msg?.sources?.[srcPopup.srcIdx];
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setSrcPopup((s) => ({ ...s, open: false }));
    if (src && onOpenSourceDoc) onOpenSourceDoc(src, msg?.content);
  }, [srcPopup.ansIdx, srcPopup.srcIdx, onOpenSourceDoc]);

  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  // Story 134: the AI may only answer from EXPLICITLY selected documents. When
  // the conversation has documents but none are selected, asking is blocked (a
  // conversation with no documents at all — general chat — is not). This
  // replaced the old "fall back to ALL completed docs" behavior, which made
  // unchecking everything a no-op (the model still answered from every doc).
  const selectionRequired = isSelectionRequired(
    numDocuments,
    selectedDocumentIds.length
  );

  const handleSend = useCallback((text, overrideDocumentIds = null) => {
    // Block a normal ask when a selection is required but empty. An explicit
    // override (analysis / im-compose) carries its own document ids and is
    // never blocked.
    const hasOverride =
      Array.isArray(overrideDocumentIds) && overrideDocumentIds.length > 0;
    if (!hasOverride && selectionRequired) return;

    sendMessage(text, {
      userId: user?.id,
      conversationId: selectedConvId,
      documentIds: resolveSendDocIds(overrideDocumentIds, selectedDocumentIds),
    });
  }, [sendMessage, user?.id, selectedConvId, selectedDocumentIds, selectionRequired]);

  useEffect(() => { resizeTextarea(inputRef.current); }, [input]);
  useEffect(() => { requestAnimationFrame(() => scrollToBottom(true)); }, [messages.length, isStreaming]);

  useEffect(() => {
    const onCompose = (e) => {
      const { text, documentIds } = e.detail || {};
      if (text) isStreaming ? setInput(text) : handleSend(text, documentIds);
    };
    window.addEventListener("im-compose", onCompose);
    return () => window.removeEventListener("im-compose", onCompose);
  }, [isStreaming, handleSend]);

  useEffect(() => {
    const onEsc = (e) => { if (e.key === "Escape") setSrcPopup(s => ({ ...s, open: false })); };
    const onClickAway = (e) => {
      if (!e.target.closest(".ci-src-card") && !e.target.closest(".ci-src-chip")) {
        setSrcPopup(s => ({ ...s, open: false }));
      }
    };
    document.addEventListener("keydown", onEsc);
    document.addEventListener("click", onClickAway);
    return () => {
      document.removeEventListener("keydown", onEsc);
      document.removeEventListener("click", onClickAway);
    };
  }, []);

  const isDisabled = !selectedConvId || (numDocuments === 0 && messages.length === 0);

  return (
    <div className="ci-frame">
      {!isDisabled ? (
        <div className="ci-chat-response" ref={scrollWrapRef}>
          {messages.map((ans, i) => (
            <ChatMessageItem
              key={`ans-${i}`}
              ans={ans}
              index={i}
              copyState={copyState}
              onCopy={handleCopy}
              openSourceCard={openSourceCard}
              previewSource={previewSource}
              hideSourcePreview={hideSourcePreview}
              isStreaming={isStreaming && i === messages.length - 1}
              onStop={stopStream}
              loadingCaption={loadingCaption}
            />
          ))}
          <div ref={bottomRef} style={{ height: 1 }} />
          {srcPopup.open && (
            <SourceCard
              srcPopup={srcPopup}
              srcIdx={srcPopup.srcIdx}
              closeSourceCard={() => setSrcPopup(s => ({ ...s, open: false }))}
              src={messages?.[srcPopup.ansIdx]?.sources?.[srcPopup.srcIdx]}
              onOpen={openSourceFromCard}
              onMouseEnter={cancelHidePreview}
              onMouseLeave={hideSourcePreview}
            />
          )}
        </div>
      ) : (
        <div className="ci-chat-response">
          <UploadFileSection
            autoUpload={false}
            disabled={true}
            onClickAlternative={() => {
              if (!selectedConvId) {
                showModal(AlertModal, {
                  title: "Tạo sổ ghi chú trước",
                  message: "Vui lòng tạo hoặc chọn một sổ ghi chú trước khi tải tài liệu.",
                });
              } else {
                showModal(UploadFileModal, { onUpload });
              }
            }}
          />
        </div>
      )}

      {/* Story 134: block the ask until at least one document is selected. */}
      {!isDisabled && selectionRequired && (
        <div className="ci-select-hint" role="status">
          Vui lòng chọn ít nhất 1 tài liệu để hỏi đáp.
        </div>
      )}

      <div className={`ci-input-frame ${isDisabled ? "is-disabled" : ""}`}>
        <textarea
          ref={inputRef} className="ci-input" placeholder={placeholder} value={input}
          onChange={(e) => { setInput(e.target.value); resizeTextarea(e.target); }}
          disabled={isDisabled} rows={1}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" && !e.shiftKey &&
              !isDisabled && !isStreaming && !selectionRequired
            ) {
              e.preventDefault();
              handleSend(input);
              setInput("");
            }
          }}
        />
        {/* Dev Space: dictate into the box, never straight onto the wire.
            Appends so a partly-typed message survives, and leaves sending to
            the user because STT is not reliable enough to ask on its own. */}
        <MicButton
          disabled={isDisabled || isStreaming}
          onTranscribed={(text) => {
            setInput((prev) => (prev ? `${prev} ${text}` : text).trim());
            requestAnimationFrame(() => {
              inputRef.current?.focus();
              resizeTextarea(inputRef.current);
            });
          }}
        />
        <button
          type="button" className="ci-send"
          onClick={() => { handleSend(input); setInput(""); }}
          disabled={isDisabled || isStreaming || selectionRequired}
          aria-label="Gửi" title="Gửi"
        >
          <SendIcon className="ci-send-icon" />
        </button>
      </div>
    </div>
  );
}
