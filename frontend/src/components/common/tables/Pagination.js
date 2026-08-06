import React from 'react';
import { ReactComponent as ChevronLeft } from "assets/images/chevron-left.svg";
import { ReactComponent as ChevronRight } from "assets/images/chevron-right.svg";

export default function Pagination({ page, limit, totalCount, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));

  const pageList = React.useMemo(() => {
    const keep = new Set([1, 2, totalPages, totalPages - 1, page, page - 1, page + 1]);
    const arr = [...keep].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      out.push(arr[i]);
      if (i < arr.length - 1 && arr[i + 1] !== arr[i] + 1) out.push("…");
    }
    return out;
  }, [page, totalPages]);

  return (
    <nav className="pagination">
      <button className="icon-btn" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
        <ChevronLeft className="icon-svg left" />
      </button>
      <div className="pagination__pages">
        {pageList.map((p, i) => p === "…" ? (
          <span key={`ellip-${i}`} className="page page--ellipsis">…</span>
        ) : (
          <button key={`page-${p}`} className={`page ${p === page ? "page--active" : ""}`} onClick={() => onPageChange(p)}>{p}</button>
        ))}
      </div>
      <button className="icon-btn" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
        <ChevronRight className="icon-svg right" />
      </button>
    </nav>
  );
}
