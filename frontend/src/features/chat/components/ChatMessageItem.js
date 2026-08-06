import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { ReactComponent as CopyIcon } from "assets/images/copy.svg";
import { toSourceLinks, preprocessLaTeX } from "utils/helpers";
import ThinkingSection from "./ThinkingSection";

const ChatMessageItem = React.memo(({ 
  ans, 
  index, 
  copyState, 
  onCopy, 
  openSourceCard,
  previewSource,
  hideSourcePreview,
  isStreaming,
  onStop,
  loadingCaption
}) => {
  return (
    <React.Fragment>
      <div className="ci-answer-title">
        <span className="ci-answer-title-text">{ans.title}</span>
      </div>
      <div className="ci-answer-block">
        {isStreaming && (
          <ThinkingSection
            loading={isStreaming}
            currentMsg={ans.thinkingHistory?.[ans.thinkingHistory.length - 1] || loadingCaption}
            history={ans.thinkingHistory}
            onStop={onStop}
          />
        )}

        <div className="ci-answer-text markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeRaw, rehypeHighlight, rehypeKatex]}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("#source-")) {
                  const idx = Math.max(0, parseInt(href.replace("#source-", ""), 10) - 1);
                  return (
                    <button
                      type="button"
                      className="ci-src-chip"
                      onClick={(e) => openSourceCard(index, idx, e)}
                      onMouseEnter={(e) => previewSource?.(index, idx, e)}
                      onMouseLeave={() => hideSourcePreview?.()}
                    >
                      {children}
                    </button>
                  );
                }
                return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
              },
            }}
          >
            {toSourceLinks(preprocessLaTeX(ans.content ?? ""), ans.sources?.length)}
          </ReactMarkdown>
        </div>

        <div className="ci-answer-tools" aria-hidden>
          <span 
            className="ci-tool ci-tool-copy" 
            title={copyState.index === index ? copyState.message : "Sao chép"} 
            onClick={() => onCopy(ans.content, index)}
          >
            <CopyIcon />
          </span>
        </div>
      </div>
    </React.Fragment>
  );
});

export default ChatMessageItem;
