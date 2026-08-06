// src/features/documents/components/UploadFileList.js
import React from "react";
import "./UploadFileList.css";
import { ReactComponent as DeleteIcon } from "assets/images/delete.svg";
import { ReactComponent as FileIcon } from "assets/images/file.svg";
import { formatSize } from "utils/helpers";

/**
 * UploadFileList
 *
 * Props:
 * - files: Array<{ id: string | number, name: string, size?: number }>
 * - onRemove?: (id) => void
 */
export default function UploadFileList({
  files = [],
  onRemove
}) {
  if (!files.length) return null;

  // Split into two columns like Figma: left = even index, right = odd index
  const leftColumn = [];
  const rightColumn = [];

  files.forEach((file, idx) => {
    if (idx % 2 === 0) leftColumn.push(file);
    else rightColumn.push(file);
  });

  const renderItem = (file) => (
    <div className="ufl-item" key={file.id ?? file.name}>
      <div className="ufl-item-main">
        <div className="ufl-item-icon">
          <FileIcon />
        </div>
        <div className="ufl-item-text">
          <div className="ufl-item-name" title={file.name}>
            {file.name}
          </div>
          {file.size != null && (
            <div className="ufl-item-size">{formatSize(file.size)}</div>
          )}
        </div>
      </div>

      {onRemove && (
        <button
          type="button"
          className="ufl-item-delete"
          onClick={() => onRemove(file.id ?? file.name)}
          aria-label={`Xoá ${file.name}`}
        >
          <DeleteIcon />
        </button>
      )}
    </div>
  );

  return (
    <div className="ufl-wrapper">
      <div className="ufl-container">
        {files.map(renderItem)}
      </div>
    </div>
  );
}
