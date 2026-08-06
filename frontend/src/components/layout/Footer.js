// src/components/layout/Footer.js
import React from "react";
import "./Footer.css"

function Footer({ disableText = false }) {
  return (
    <footer id="app-footer" className="app-footer">
      {!disableText && (
        <>
          <span className="footer-icon">©</span>
          <span className="footer-text footer-text-first">
            Viện Công nghệ thông tin và Truyền thông
          </span>
          <span className="footer-separator">-</span>
          <span className="footer-text footer-text-second">
            Học viện Kỹ thuật quân sự
          </span>
        </>
      )}
    </footer>
  );
}

export default Footer;
